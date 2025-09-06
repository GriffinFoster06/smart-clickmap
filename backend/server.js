import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Simple in-memory storage
const gameState = {
    running: false,
    clicks: new Map(), // channelId → Map(userId → { x, y, timestamp })
    lastUpdate: Date.now()
};

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add WebSocket headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, UPGRADE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Health check with comprehensive diagnostics
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '4.0.0',
        uptime: process.uptime(),
        websocket: {
            enabled: !!wss,
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size,
            connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        environment: {
            node_env: process.env.NODE_ENV || 'unknown',
            port: PORT,
            render_service: process.env.RENDER_SERVICE_NAME || 'unknown',
            render_service_id: process.env.RENDER_SERVICE_ID || 'unknown'
        },
        game_data: {
            total_channels: gameState.clicks.size,
            total_clicks: Array.from(gameState.clicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0),
            channels: Array.from(gameState.clicks.entries()).map(([channel, clicks]) => ({
                channel,
                clicks: clicks.size
            }))
        }
    });
});

// WebSocket debug endpoint  
app.get('/ws-debug', (req, res) => {
    console.log('🔍 WebSocket Debug requested');

    const debug = {
        timestamp: new Date().toISOString(),
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0,
            integrated_with_http: true,
            ready_state: wss ? 'operational' : 'not_initialized'
        },
        connected_clients: {
            channels: connectedClients.size,
            total_connections: Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0),
            by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        server_info: {
            listening: !!httpServer && httpServer.listening,
            address: httpServer ? httpServer.address() : null,
            port: PORT,
            single_port_mode: true,
            environment: process.env.NODE_ENV || 'development'
        }
    };

    console.log('🔍 Debug result:', JSON.stringify(debug, null, 2));
    res.json(debug);
});

// WebSocket connection test helper
app.get('/ws-test/:channelId', (req, res) => {
    const { channelId } = req.params;
    const wsUrl = `wss://${req.get('host')}/ws/${channelId}`;

    res.json({
        test_url: wsUrl,
        server_ready: !!httpServer && httpServer.listening,
        websocket_ready: !!wss,
        client_count: wss ? wss.clients.size : 0,
        instructions: [
            'Test WebSocket connection in browser console:',
            `const ws = new WebSocket('${wsUrl}');`,
            `ws.onopen = () => console.log('✅ Connected to ${channelId}');`,
            `ws.onerror = (e) => console.log('❌ Connection error:', e);`,
            `ws.onclose = (e) => console.log('🔒 Connection closed:', e.code, e.reason);`,
            `ws.onmessage = (e) => console.log('📨 Message received:', e.data);`
        ]
    });
});

// START endpoint
app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');

    try {
        gameState.running = true;
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Game started successfully');

        // Broadcast to all connected clients
        broadcastToAll({
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start'
        });

        res.json({
            success: true,
            status: 'started',
            running: true,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session',
            details: error.message
        });
    }
});

// STOP endpoint
app.post('/stop', (req, res) => {
    console.log('⏹️ STOP endpoint called');

    try {
        gameState.running = false;
        gameState.lastUpdate = Date.now();

        console.log('✅ Game stopped successfully');

        const currentData = getCurrentHeatmapData('all');
        currentData.running = false;
        currentData.action = 'stop';

        broadcastToAll(currentData);

        res.json({
            success: true,
            status: 'stopped',
            running: false,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session',
            details: error.message
        });
    }
});

// RESET endpoint
app.post('/reset', (req, res) => {
    console.log('🗑️ RESET endpoint called');

    try {
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Data reset successfully');

        broadcastToAll({
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset'
        });

        res.json({
            success: true,
            status: 'reset',
            running: gameState.running,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data',
            details: error.message
        });
    }
});

// Click handling with enhanced logging
app.post('/click', (req, res) => {
    console.log('🖱️ CLICK endpoint called');

    try {
        if (!gameState.running) {
            console.log('   ❌ Game not running');
            return res.status(400).json({
                success: false,
                error: 'Game not running'
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log('   ❌ No token provided');
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`   ❌ Invalid coordinates: (${x}, ${y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
            console.log(`   📝 Created new channel: ${channelId}`);
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)})`);
        console.log(`   Total clicks in channel: ${gameState.clicks.get(channelId).size}`);

        // Get updated data and broadcast immediately
        const updatedData = getCurrentHeatmapData(channelId);
        console.log(`   📡 Broadcasting: ${updatedData.clusters.length} clusters to channel ${channelId}`);
        broadcastToChannel(channelId, updatedData);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0,
            channelId: channelId
        });

    } catch (error) {
        console.error('❌ Click error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token or request',
            details: error.message
        });
    }
});

// Enhanced heatmap endpoint with detailed logging
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%`);

    try {
        const data = getCurrentHeatmapData(channelId, threshold);

        if (data.totalClicks > 0) {
            console.log(`✅ Heatmap: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
        }

        res.json(data);

    } catch (error) {
        console.error('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data',
            details: error.message
        });
    }
});

// Get current heatmap data with SMART clustering
function getCurrentHeatmapData(channelId, threshold = 3) {
    // If no specific channel requested, aggregate all channels WITH clustering
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        // Collect all points from all channels
        gameState.clicks.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            // Add all points to the aggregate
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        // Process ALL points into clusters
        const clusters = processClicksIntoSmartClusters(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    // Handle specific channel
    const channelClicks = gameState.clicks.get(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    const points = Array.from(channelClicks.values());
    const clusters = processClicksIntoSmartClusters(points, threshold);

    console.log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: gameState.lastUpdate
    };
}

// SMART CLUSTERING with label-overlap merging and aggressive shape detection
function processClicksIntoSmartClusters(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧠 SMART clustering: ${points.length} points, ${threshold}% threshold`);

    // Step 1: AGGRESSIVE spatial clustering
    const rawClusters = performAggressiveSpatialClustering(points);
    console.log(`   Spatial clustering: ${points.length} points → ${rawClusters.length} spatial clusters`);
    
    // Step 2: Calculate metrics and initial sizing
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculatePreciseClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster,
            isTop: false
        };
    });

    // Step 3: SMART MERGING based on label overlap
    const mergedClusters = performLabelOverlapMerging(enrichedClusters);
    console.log(`   Label-overlap merging: ${enrichedClusters.length} → ${mergedClusters.length} merged clusters`);

    // Step 4: Filter by threshold (but be lenient for small datasets)
    const effectiveThreshold = points.length < 10 ? Math.min(threshold, 5) : threshold;
    const filteredClusters = mergedClusters.filter(c => c.percentage >= effectiveThreshold);
    console.log(`   Threshold filter: ${mergedClusters.length} → ${filteredClusters.length} (threshold: ${effectiveThreshold}%)`);

    // Step 5: AGGRESSIVE shape detection
    const shapedClusters = filteredClusters.map(cluster => {
        const shapeData = detectOptimalShape(cluster.points, cluster);
        return {
            ...cluster,
            ...shapeData
        };
    });

    // Step 6: Final size calculation and optimization
    const finalClusters = shapedClusters.map(cluster => ({
        ...cluster,
        visualSize: calculateOptimalVisualSize(cluster, shapedClusters)
    }));

    // Step 7: Sort and mark top cluster
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    console.log(`✅ SMART clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`);
    finalClusters.forEach((c, i) => {
        if (i < 3) { // Log first few for debugging
            console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks, ${c.shapeType}, size: ${c.visualSize}px)`);
        }
    });

    return finalClusters;
}

// AGGRESSIVE spatial clustering - merges more aggressively
function performAggressiveSpatialClustering(points) {
    const clusters = [];
    const visited = new Set();
    const noise = new Set();

    const totalPoints = points.length;
    
    // AGGRESSIVE epsilon - larger merging radius
    const adaptiveEps = calculateAggressiveEps(points);
    
    // PERMISSIVE minPts - easier cluster formation
    let minPts = Math.max(1, Math.floor(totalPoints * 0.02)); // Only 2% minimum
    if (totalPoints <= 5) minPts = 1;

    console.log(`   AGGRESSIVE clustering params: eps=${adaptiveEps.toFixed(4)}, minPts=${minPts}, total=${totalPoints}`);

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;

        visited.add(i);
        const neighbors = findNeighbors(points, i, adaptiveEps);
        
        console.log(`   Point ${i}: found ${neighbors.length} neighbors (need ${minPts})`);

        if (neighbors.length >= minPts) {
            // This point can start a cluster
            const cluster = [];
            expandCluster(points, i, neighbors, cluster, visited, adaptiveEps, minPts);
            if (cluster.length > 0) {
                clusters.push(cluster);
                console.log(`   ✅ Created cluster with ${cluster.length} points`);
            }
        } else {
            // ALWAYS create single-point clusters for unmerged points
            clusters.push([points[i]]);
            console.log(`   ➡️ Single-point cluster: point ${i}`);
        }
    }

    console.log(`   AGGRESSIVE result: ${clusters.length} clusters, ${noise.size} noise points`);
    return clusters;
}

// AGGRESSIVE epsilon calculation - promotes merging
function calculateAggressiveEps(points) {
    if (points.length < 2) return 0.2;

    // Calculate all pairwise distances
    const distances = [];
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    if (distances.length === 0) return 0.2;
    
    let epsilon;
    
    if (points.length <= 3) {
        // For very small datasets, use aggressive merging
        const maxDistance = Math.max(...distances);
        epsilon = Math.min(0.3, maxDistance * 0.8); // Merge if within 80% of max distance
        console.log(`   Very small dataset: max=${maxDistance.toFixed(4)}, epsilon=${epsilon.toFixed(4)}`);
    } else if (points.length <= 8) {
        // Small datasets: use 50th percentile * generous multiplier
        const median = distances[Math.floor(distances.length * 0.5)];
        epsilon = Math.max(0.08, Math.min(0.3, median * 2.0)); // 2x median distance
        console.log(`   Small dataset: median=${median.toFixed(4)}, epsilon=${epsilon.toFixed(4)}`);
    } else {
        // Larger datasets: use 40th percentile * multiplier
        const percentile40 = distances[Math.floor(distances.length * 0.4)];
        epsilon = Math.max(0.06, Math.min(0.25, percentile40 * 1.8)); // 1.8x 40th percentile
        console.log(`   Large dataset: 40th percentile=${percentile40.toFixed(4)}, epsilon=${epsilon.toFixed(4)}`);
    }
    
    return epsilon;
}

// Find neighbors within epsilon distance
function findNeighbors(points, pointIndex, eps) {
    const neighbors = [];
    const point = points[pointIndex];

    for (let i = 0; i < points.length; i++) {
        if (i !== pointIndex) {
            const distance = euclideanDistance(point, points[i]);
            if (distance <= eps) {
                neighbors.push(i);
            }
        }
    }

    return neighbors;
}

// Expand cluster using DBSCAN algorithm
function expandCluster(points, pointIndex, neighbors, cluster, visited, eps, minPts) {
    cluster.push(points[pointIndex]);

    let i = 0;
    while (i < neighbors.length) {
        const neighborIndex = neighbors[i];

        if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex);
            const newNeighbors = findNeighbors(points, neighborIndex, eps);

            if (newNeighbors.length >= minPts) {
                neighbors.push(...newNeighbors);
            }
        }

        // Add to cluster if not already in another cluster
        const neighborPoint = points[neighborIndex];
        if (!cluster.some(p => p.x === neighborPoint.x && p.y === neighborPoint.y)) {
            cluster.push(neighborPoint);
        }

        i++;
    }
}

// PRECISE cluster metrics calculation
function calculatePreciseClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    // PRECISE centroid calculation using weighted average
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    // Calculate precise spatial metrics
    const distances = clusterPoints.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    // Standard deviation for spread measurement
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const stdDev = Math.sqrt(distanceVariance);

    // Compactness and density
    const compactness = avgDistance / (maxDistance || 0.001);
    const area = Math.PI * Math.pow(maxDistance, 2);
    const density = count / (area || 0.001);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        radius: maxDistance,
        spread: avgDistance,
        maxSpread: maxDistance,
        minSpread: minDistance,
        stdDev,
        compactness,
        density,
        area
    };
}

// LABEL OVERLAP MERGING - merge clusters if their labels would overlap
function performLabelOverlapMerging(clusters) {
    if (clusters.length <= 1) return clusters;

    console.log(`   🏷️ Checking label overlaps for ${clusters.length} clusters...`);

    const merged = [];
    const used = new Set();

    for (let i = 0; i < clusters.length; i++) {
        if (used.has(i)) continue;

        let currentCluster = clusters[i];
        const toMerge = [i];

        // Check for overlaps with remaining clusters
        for (let j = i + 1; j < clusters.length; j++) {
            if (used.has(j)) continue;

            if (wouldLabelsOverlap(currentCluster, clusters[j])) {
                toMerge.push(j);
                console.log(`   🔗 Merging clusters ${i} and ${j} (label overlap)`);
            }
        }

        // If we found clusters to merge
        if (toMerge.length > 1) {
            const allPoints = [];
            toMerge.forEach(idx => {
                allPoints.push(...clusters[idx].points);
                used.add(idx);
            });

            // Recalculate metrics for merged cluster
            const mergedMetrics = calculatePreciseClusterMetrics(allPoints, clusters[0].percentage > 0 ? 
                Math.round(allPoints.length * 100 / clusters[0].percentage * clusters[0].count) : allPoints.length);
            
            merged.push({
                ...mergedMetrics,
                id: `merged_${i}`,
                points: allPoints,
                isTop: false,
                wasMerged: true
            });
        } else {
            // No merge needed
            merged.push(currentCluster);
            used.add(i);
        }
    }

    console.log(`   🏷️ Label overlap merging: ${clusters.length} → ${merged.length} clusters`);
    return merged;
}

// Check if two clusters' labels would overlap
function wouldLabelsOverlap(cluster1, cluster2) {
    // Estimate label size based on percentage
    const fontSize1 = Math.max(18, Math.min(50, (cluster1.visualSize || 80) * 0.4));
    const fontSize2 = Math.max(18, Math.min(50, (cluster2.visualSize || 80) * 0.4));
    
    const label1Width = (cluster1.percentage.toString().length + 1) * fontSize1 * 0.6; // Rough estimate
    const label2Width = (cluster2.percentage.toString().length + 1) * fontSize2 * 0.6;
    
    // Convert normalized coordinates to screen coordinates (assume 1920x1080)
    const SCREEN_W = 1920;
    const SCREEN_H = 1080;
    
    const x1 = cluster1.x * SCREEN_W;
    const y1 = cluster1.y * SCREEN_H;
    const x2 = cluster2.x * SCREEN_W;
    const y2 = cluster2.y * SCREEN_H;
    
    // Calculate bounding boxes with padding
    const padding = 10;
    const box1 = {
        left: x1 - label1Width/2 - padding,
        right: x1 + label1Width/2 + padding,
        top: y1 - fontSize1/2 - padding,
        bottom: y1 + fontSize1/2 + padding
    };
    
    const box2 = {
        left: x2 - label2Width/2 - padding,
        right: x2 + label2Width/2 + padding,
        top: y2 - fontSize2/2 - padding,
        bottom: y2 + fontSize2/2 + padding
    };
    
    // Check for overlap
    const overlap = !(box1.right < box2.left || 
                     box2.right < box1.left || 
                     box1.bottom < box2.top || 
                     box2.bottom < box1.top);
    
    if (overlap) {
        const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        console.log(`   📏 Labels would overlap: distance=${distance.toFixed(0)}px, thresholds=(${label1Width.toFixed(0)}, ${label2Width.toFixed(0)})`);
    }
    
    return overlap;
}

// AGGRESSIVE shape detection - much more likely to use polygons
function detectOptimalShape(points, cluster) {
    if (points.length === 1) {
        return {
            shapeType: 'circle',
            shapeConfidence: 1.0,
            circularity: 1.0,
            polygonPoints: null
        };
    }

    console.log(`   🔍 Analyzing shape for cluster with ${points.length} points...`);

    // Calculate shape characteristics
    const shapeMetrics = calculateAdvancedShapeMetrics(points, cluster.x, cluster.y);
    
    // AGGRESSIVE thresholds - much more likely to detect non-circular shapes
    const CIRCULARITY_THRESHOLD = 0.4;  // LOWERED from 0.7 - less circular required
    const SIMPLE_THRESHOLD = 0.2;       // LOWERED from 0.3 - less simple required
    
    // Force polygon for certain conditions
    const forcePolygon = (
        points.length >= 4 ||                           // 4+ points should usually be polygons
        shapeMetrics.eccentricity > 0.3 ||             // Elongated
        shapeMetrics.irregularity > 0.3 ||             // Irregular
        shapeMetrics.convexity < 0.8 ||                // Non-convex
        shapeMetrics.aspectRatio > 1.5                 // Wide/tall
    );

    if (forcePolygon) {
        console.log(`   🔷 FORCED polygon (ecc:${shapeMetrics.eccentricity.toFixed(2)}, irreg:${shapeMetrics.irregularity.toFixed(2)}, conv:${shapeMetrics.convexity.toFixed(2)})`);
        return generateIntelligentPolygon(points, cluster, shapeMetrics);
    }

    // Calculate circularity score
    const circularityScore = calculateCircularityScore(points, cluster.x, cluster.y, shapeMetrics);
    
    // Use circle only if VERY circular
    if (circularityScore >= CIRCULARITY_THRESHOLD && shapeMetrics.irregularity <= SIMPLE_THRESHOLD) {
        console.log(`   ⭕ Using circle (circularity: ${circularityScore.toFixed(2)})`);
        return {
            shapeType: 'circle',
            shapeConfidence: circularityScore,
            circularity: circularityScore,
            polygonPoints: null,
            ...shapeMetrics
        };
    } else {
        console.log(`   🔷 Using polygon (circularity: ${circularityScore.toFixed(2)} < ${CIRCULARITY_THRESHOLD})`);
        return generateIntelligentPolygon(points, cluster, shapeMetrics);
    }
}

// Calculate advanced shape metrics
function calculateAdvancedShapeMetrics(points, centroidX, centroidY) {
    // Distance analysis
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    const distanceStdDev = Math.sqrt(distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length);

    // Bounding box analysis
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const aspectRatio = Math.max(width, height) / Math.min(width || 0.001, height || 0.001);

    // Eccentricity (via covariance matrix)
    const eccentricity = calculateEccentricity(points);
    
    // Convex hull analysis
    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = width * height;
    const convexity = hullArea / (boundingArea || 0.001);
    
    // Irregularity (how much shape deviates from perfect)
    const irregularity = Math.min(1, (distanceStdDev / avgDistance) * 2 + (1 - convexity));

    return {
        avgDistance,
        maxDistance,
        minDistance,
        distanceStdDev,
        width,
        height,
        aspectRatio,
        eccentricity,
        convexity,
        irregularity,
        hull,
        hullArea,
        boundingArea
    };
}

// Circularity score calculation
function calculateCircularityScore(points, centroidX, centroidY, metrics) {
    if (points.length === 1) return 1.0;

    // How consistent are distances from center?
    const distanceConsistency = 1 - Math.min(1, metrics.distanceStdDev / metrics.avgDistance);
    
    // How convex is the shape?
    const convexityScore = metrics.convexity;
    
    // How close to 1:1 aspect ratio?
    const aspectRatioScore = 1 - Math.min(1, (metrics.aspectRatio - 1) / 2);
    
    // Weighted combination (more weight on distance consistency)
    const circularity = (
        distanceConsistency * 0.5 +
        convexityScore * 0.3 +
        aspectRatioScore * 0.2
    );

    return Math.max(0, Math.min(1, circularity));
}

// Generate intelligent polygon based on shape analysis
function generateIntelligentPolygon(points, cluster, metrics) {
    const pointCount = points.length;
    
    let shapeType, polygonPoints, confidence;
    
    if (pointCount <= 3) {
        // Very small clusters: simple triangular
        shapeType = 'simple_polygon';
        polygonPoints = generateRegularPolygon(cluster.x, cluster.y, metrics.maxDistance, Math.max(3, pointCount));
        confidence = 0.7;
    } else if (metrics.convexity >= 0.7 && metrics.irregularity <= 0.4) {
        // Regular-ish: use regular polygon
        shapeType = 'regular_polygon';
        const sides = Math.max(4, Math.min(12, 4 + Math.floor(pointCount / 2)));
        polygonPoints = generateRegularPolygon(cluster.x, cluster.y, metrics.maxDistance, sides);
        confidence = 0.8;
    } else if (metrics.aspectRatio > 2.0 || metrics.eccentricity > 0.6) {
        // Elongated: elliptical polygon
        shapeType = 'elliptical_polygon';
        polygonPoints = generateEllipticalPolygon(points, cluster.x, cluster.y);
        confidence = 0.85;
    } else if (metrics.convexity >= 0.5) {
        // Moderately irregular: adaptive polygon
        shapeType = 'adaptive_polygon';
        polygonPoints = generateAdaptivePolygon(points, cluster.x, cluster.y);
        confidence = 0.9;
    } else {
        // Very irregular: hull polygon
        shapeType = 'hull_polygon';
        polygonPoints = generateHullPolygon(points, metrics.hull);
        confidence = 0.95;
    }

    console.log(`   🎨 Generated ${shapeType} with ${polygonPoints.length} vertices (confidence: ${confidence.toFixed(2)})`);

    return {
        shapeType,
        polygonPoints,
        shapeConfidence: confidence,
        circularity: calculateCircularityScore(points, cluster.x, cluster.y, metrics),
        ...metrics
    };
}

// Generate different polygon types
function generateRegularPolygon(centerX, centerY, radius, sides) {
    const points = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        points.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }
    
    return points;
}

function generateEllipticalPolygon(points, centerX, centerY) {
    // Calculate principal axes using covariance matrix
    const ellipseParams = calculateEllipseParameters(points, centerX, centerY);
    const sides = Math.max(6, Math.min(12, points.length));
    
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        
        // Ellipse equation
        const localX = ellipseParams.majorAxis * Math.cos(angle);
        const localY = ellipseParams.minorAxis * Math.sin(angle);
        
        // Rotate by orientation
        const rotatedX = localX * Math.cos(ellipseParams.orientation) - localY * Math.sin(ellipseParams.orientation);
        const rotatedY = localX * Math.sin(ellipseParams.orientation) + localY * Math.cos(ellipseParams.orientation);
        
        polygonPoints.push({
            x: centerX + rotatedX,
            y: centerY + rotatedY
        });
    }
    
    return polygonPoints;
}

function generateAdaptivePolygon(points, centerX, centerY) {
    const sides = Math.max(5, Math.min(16, points.length + 2));
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        
        // Find the furthest point in this direction
        let maxDistance = 0;
        for (const point of points) {
            const toPoint = { x: point.x - centerX, y: point.y - centerY };
            const distance = Math.sqrt(toPoint.x * toPoint.x + toPoint.y * toPoint.y);
            const pointAngle = Math.atan2(toPoint.y, toPoint.x);
            
            // If point is roughly in this direction
            const angleDiff = Math.abs(((pointAngle - angle + Math.PI) % (2 * Math.PI)) - Math.PI);
            if (angleDiff < Math.PI / sides) {
                maxDistance = Math.max(maxDistance, distance);
            }
        }
        
        // Use at least 50% of max distance if no points found in this direction
        const radius = Math.max(maxDistance, 0.5 * Math.max(...points.map(p => 
            Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2))
        )));
        
        polygonPoints.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }
    
    return polygonPoints;
}

function generateHullPolygon(points, hull) {
    if (!hull || hull.length < 3) {
        // Fallback
        const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const avgRadius = points.reduce((sum, p) => 
            sum + Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2)), 0) / points.length;
        return generateRegularPolygon(centerX, centerY, avgRadius, 6);
    }
    
    // Use hull directly but smooth it slightly
    return hull.map(point => ({ x: point.x, y: point.y }));
}

// Calculate ellipse parameters for elongated shapes
function calculateEllipseParameters(points, centerX, centerY) {
    // Covariance matrix calculation
    let cxx = 0, cyy = 0, cxy = 0;
    
    for (const point of points) {
        const dx = point.x - centerX;
        const dy = point.y - centerY;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }
    
    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;
    
    // Eigenvalues and eigenvectors
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) {
        return {
            majorAxis: Math.sqrt(cxx + cyy),
            minorAxis: Math.sqrt(cxx + cyy),
            orientation: 0
        };
    }
    
    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;
    
    const majorAxis = Math.sqrt(Math.max(lambda1, lambda2)) * 2;
    const minorAxis = Math.sqrt(Math.min(lambda1, lambda2)) * 2;
    
    // Orientation
    let orientation = 0;
    if (Math.abs(cxy) > 1e-10) {
        orientation = Math.atan2(lambda1 - cxx, cxy);
    }
    
    return { majorAxis, minorAxis, orientation };
}

// OPTIMAL visual size calculation
function calculateOptimalVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;
    const shapeComplexity = cluster.irregularity || 0;

    // Enhanced size bounds
    const MIN_SIZE = 40;   // Slightly larger minimum
    const MAX_SIZE = 300;  // Larger maximum for complex shapes
    const OPTIMAL_SIZE = 90; // Sweet spot

    // 1. BASE SIZE from percentage (more aggressive scaling)
    let baseSize;
    if (percentage >= 60) {
        baseSize = OPTIMAL_SIZE * 1.8 + (percentage - 60) * 3; // Very large for high %
    } else if (percentage >= 30) {
        baseSize = OPTIMAL_SIZE * 1.2 + (percentage - 30) * 2; // Large for medium-high %
    } else if (percentage >= 15) {
        baseSize = OPTIMAL_SIZE * 0.8 + (percentage - 15) * 2.5; // Medium for medium %
    } else if (percentage >= 5) {
        baseSize = OPTIMAL_SIZE * 0.6 + (percentage - 5) * 2; // Small-medium for low-medium %
    } else {
        baseSize = MIN_SIZE + percentage * 4; // Small for very low %
    }

    // 2. DENSITY multiplier (high density = more compact = slightly smaller)
    const densityMultiplier = Math.pow(Math.max(0.5, Math.min(2.5, density)), 0.2);
    
    // 3. SPREAD bonus (more spread = larger visual area needed)
    const spreadBonus = Math.min(60, spread * 1200); // Up to +60px
    
    // 4. SHAPE COMPLEXITY bonus (complex shapes need more space)
    const complexityBonus = shapeComplexity * 40; // Up to +40px for very complex shapes
    
    // 5. COUNT bonus (multi-click clusters get bonus)
    const countBonus = count > 1 ? Math.log10(count + 1) * 15 : 0;
    
    // 6. RELATIVE scaling (maintain proportions)
    let relativeScale = 1.0;
    if (allClusters.length > 1) {
        const maxPercentage = Math.max(...allClusters.map(c => c.percentage || 0));
        const minPercentage = Math.min(...allClusters.map(c => c.percentage || 0));
        
        if (maxPercentage > minPercentage) {
            const range = maxPercentage - minPercentage;
            const position = (percentage - minPercentage) / range;
            relativeScale = 0.6 + (position * 1.0); // 0.6x to 1.6x range
        }
    }

    // COMBINE all factors
    let finalSize = (baseSize + spreadBonus + complexityBonus + countBonus) * densityMultiplier * relativeScale;

    // ENFORCE bounds
    finalSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalSize));

    console.log(`   💎 Size calc: ${percentage}% → base=${baseSize.toFixed(0)} + spread=${spreadBonus.toFixed(0)} + complex=${complexityBonus.toFixed(0)} = ${finalSize.toFixed(0)}px`);

    return Math.round(finalSize);
}

// Utility functions
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateConvexHull(points) {
    if (points.length < 3) return points;

    // Find bottom-most point
    let bottom = points[0];
    for (const point of points) {
        if (point.y < bottom.y || (point.y === bottom.y && point.x < bottom.x)) {
            bottom = point;
        }
    }

    // Sort by polar angle
    const sortedPoints = points.filter(p => p !== bottom).sort((a, b) => {
        const angleA = Math.atan2(a.y - bottom.y, a.x - bottom.x);
        const angleB = Math.atan2(b.y - bottom.y, b.x - bottom.x);
        return angleA - angleB;
    });

    const hull = [bottom];
    for (const point of sortedPoints) {
        while (hull.length > 1 && crossProduct(hull[hull.length-2], hull[hull.length-1], point) <= 0) {
            hull.pop();
        }
        hull.push(point);
    }

    return hull;
}

function crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function calculatePolygonArea(points) {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

function calculateEccentricity(points) {
    if (points.length < 2) return 0;

    const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    let cxx = 0, cyy = 0, cxy = 0;
    for (const point of points) {
        const dx = point.x - meanX;
        const dy = point.y - meanY;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }

    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;

    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;

    if (discriminant < 0) return 0;

    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;

    const minLambda = Math.min(lambda1, lambda2);
    const maxLambda = Math.max(lambda1, lambda2);

    if (maxLambda === 0) return 0;
    return 1 - (minLambda / maxLambda);
}

// WebSocket broadcasting functions
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(data);
    let sentCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('WebSocket send error:', error);
                clients.delete(ws);
            }
        } else {
            clients.delete(ws);
        }
    });

    if (sentCount > 0) {
        console.log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} clusters`);
    }
}

function broadcastToAll(data) {
    let totalSent = 0;
    connectedClients.forEach((clients, channelId) => {
        const channelData = channelId === 'all' ? data : getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
    });

    if (totalSent > 0) {
        console.log(`📡 Broadcast to all: ${totalSent} clients`);
    }
}

// ===== HTTP SERVER CREATION =====
console.log('🔧 Creating HTTP server...');
const httpServer = createServer(app);

// ===== WEBSOCKET SERVER INTEGRATION =====
console.log('🔧 Creating WebSocket server integrated with HTTP server...');
let wss;
try {
    wss = new WebSocketServer({
        server: httpServer,
        perMessageDeflate: false,
        clientTracking: true
    });
    console.log('✅ WebSocket server integrated with HTTP server on single port');
} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// Handle WebSocket upgrade requests explicitly
httpServer.on('upgrade', (request, socket, head) => {
    console.log('🔗 WebSocket upgrade request received:');
    console.log(`   URL: ${request.url}`);

    if (request.url && request.url.startsWith('/ws/')) {
        console.log('✅ Valid WebSocket path, handling upgrade...');
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log('❌ Invalid WebSocket path, closing connection');
        socket.destroy();
    }
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const startTime = Date.now();
    console.log(`🔗 NEW WEBSOCKET CONNECTION`);
    console.log(`   URL: ${req.url}`);

    let channelId = null;
    if (req.url) {
        const match = req.url.match(/\/ws\/([^?&\/]+)/);
        if (match) {
            channelId = match[1];
            console.log(`   Channel: ${channelId}`);
        }
    }

    if (!channelId) {
        console.error('❌ No channel ID found in WebSocket URL');
        ws.close(1008, 'Channel ID required: /ws/CHANNEL_ID');
        return;
    }

    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    const clientCount = connectedClients.get(channelId).size;
    const totalClients = wss.clients.size;

    console.log(`✅ WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
        console.log(`📨 Initial data sent: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Message from ${channelId}:`, data);

            ws.send(JSON.stringify({
                type: 'echo',
                received: data,
                timestamp: Date.now(),
                channelId: channelId
            }));
        } catch (error) {
            console.error('❌ Message parsing error:', error);
        }
    });

    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`🔒 WebSocket disconnected: ${channelId} after ${duration}ms`);
    });

    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${channelId}:`, error);
    });

    const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (pingError) {
                console.error('❌ Keep-alive ping error:', pingError);
                clearInterval(keepAlive);
            }
        } else {
            clearInterval(keepAlive);
        }
    }, 25000);

    ws.on('close', () => {
        clearInterval(keepAlive);
    });
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('SIGTERM', () => {
    console.log('📝 Received SIGTERM, starting graceful shutdown...');

    connectedClients.forEach((clients, channelId) => {
        clients.forEach(ws => {
            try {
                ws.close(1000, 'Server shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });
    });

    httpServer.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v4.0.0 SMART MERGING & SHAPE DETECTION');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log('🎉 SMART clustering server with label-overlap merging operational!');
    }, 1000);
});

export default httpServer;
