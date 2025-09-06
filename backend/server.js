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

// Get current heatmap data with FIXED clustering and intelligent shapes
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

        // Process ALL points into clusters with fixed algorithm
        const clusters = processClicksIntoAdvancedClusters(allPoints, threshold);

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
    const clusters = processClicksIntoAdvancedClusters(points, threshold);

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

// FIXED CLUSTERING ALGORITHM - Fresh calculation every time, proper merging
function processClicksIntoAdvancedClusters(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧮 FRESH clustering: ${points.length} points, ${threshold}% threshold`);

    // ALWAYS do fresh clustering calculation - no bias from previous results
    const rawClusters = performFreshDensityBasedClustering(points);
    console.log(`   Fresh clustering: ${points.length} points → ${rawClusters.length} spatial clusters`);
    
    // Step 2: Calculate comprehensive metrics for each cluster  
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster,
            isTop: false
        };
    });

    // Step 3: Filter by threshold (but be more lenient for small datasets)
    const effectiveThreshold = points.length < 10 ? Math.min(threshold, 5) : threshold;
    const filteredClusters = enrichedClusters.filter(c => c.percentage >= effectiveThreshold);
    console.log(`   Threshold filter: ${enrichedClusters.length} → ${filteredClusters.length} (threshold: ${effectiveThreshold}%)`);

    // Step 4: Smart cluster splitting for oversized clusters
    const splitClusters = [];
    for (const cluster of filteredClusters) {
        const splits = smartClusterSplitting(cluster);
        splitClusters.push(...splits);
    }
    console.log(`   Cluster splitting: ${filteredClusters.length} → ${splitClusters.length} final clusters`);

    // Step 5: Sort and mark top cluster
    splitClusters.sort((a, b) => b.percentage - a.percentage);
    if (splitClusters.length > 0) {
        splitClusters[0].isTop = true;
    }

    // Step 6: Calculate intelligent visual sizes
    const finalClusters = splitClusters.map(cluster => ({
        ...cluster,
        visualSize: calculateIntelligentVisualSize(cluster, splitClusters)
    }));

    console.log(`✅ FRESH clustering result: ${rawClusters.length} raw → ${filteredClusters.length} filtered → ${finalClusters.length} final`);
    finalClusters.forEach((c, i) => {
        if (i < 3) { // Log first few for debugging
            console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks, size: ${c.visualSize}px, center: ${c.x.toFixed(3)},${c.y.toFixed(3)})`);
        }
    });

    return finalClusters;
}

// FRESH density-based clustering - starts from scratch every time
function performFreshDensityBasedClustering(points) {
    const clusters = [];
    const visited = new Set();
    const noise = new Set();

    const totalPoints = points.length;
    
    // FIXED epsilon calculation - handles overlapping points properly
    const adaptiveEps = calculateFixedEps(points);
    
    // SIMPLIFIED minPts - overlapping points should always merge
    let minPts;
    if (totalPoints === 1) {
        minPts = 0; // Single point = cluster
    } else if (totalPoints <= 4) {
        minPts = 1; // Any point with 1+ neighbors forms a cluster
    } else {
        minPts = 2; // Minimum 2 neighbors for larger datasets
    }

    console.log(`   🔥 FRESH clustering params: eps=${adaptiveEps.toFixed(4)}, minPts=${minPts}, total=${totalPoints}`);

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;

        visited.add(i);
        const neighbors = findNeighborsFixed(points, i, adaptiveEps);
        
        console.log(`   Point ${i}(${points[i].x.toFixed(3)},${points[i].y.toFixed(3)}): found ${neighbors.length} neighbors`);

        if (neighbors.length >= minPts) {
            // This point can start/join a cluster
            const cluster = [];
            expandClusterFixed(points, i, neighbors, cluster, visited, adaptiveEps, minPts);
            if (cluster.length > 0) {
                clusters.push(cluster);
                console.log(`   ✅ MERGED cluster: ${cluster.length} points`);
            }
        } else {
            // Single point cluster (always allowed for small datasets)
            clusters.push([points[i]]);
            console.log(`   ➡️ Single-point cluster: point ${i}`);
        }
    }

    console.log(`   🔥 FRESH result: ${clusters.length} clusters, ${noise.size} noise points`);
    
    // DEBUG: Show cluster details
    clusters.forEach((cluster, idx) => {
        if (cluster.length > 1) {
            const points_str = cluster.map(p => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(',');
            console.log(`   Multi-point cluster ${idx}: ${cluster.length} points - ${points_str}`);
        }
    });
    
    return clusters;
}

// FIXED epsilon calculation - properly handles overlapping and nearby points
function calculateFixedEps(points) {
    if (points.length < 2) return 0.15;

    // Calculate all pairwise distances
    const distances = [];
    let minDistance = Infinity;
    let maxDistance = 0;
    
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
            minDistance = Math.min(minDistance, dist);
            maxDistance = Math.max(maxDistance, dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    console.log(`   📏 Distance analysis: min=${minDistance.toFixed(4)}, max=${maxDistance.toFixed(4)}`);
    console.log(`   📏 First 5 distances: [${distances.slice(0, 5).map(d => d.toFixed(4)).join(', ')}]`);
    
    if (distances.length === 0) return 0.15;
    
    let epsilon;
    
    // FIXED: Handle overlapping points (very small distances)
    if (minDistance < 0.01) {
        // We have overlapping or very close points - use larger epsilon to merge them
        const closeThreshold = 0.05; // 5% of screen
        epsilon = Math.max(closeThreshold, minDistance * 10);
        console.log(`   🎯 OVERLAPPING points detected! Using epsilon=${epsilon.toFixed(4)} to merge them`);
    } else {
        // Regular case - use adaptive epsilon based on distribution
        if (points.length <= 5) {
            // Small datasets: be generous to allow merging
            const median = distances[Math.floor(distances.length / 2)];
            epsilon = Math.max(0.08, Math.min(0.3, median * 2.0));
        } else {
            // Larger datasets: use percentile approach
            const percentile30 = distances[Math.floor(distances.length * 0.3)];
            epsilon = Math.max(0.05, Math.min(0.2, percentile30 * 1.5));
        }
        console.log(`   📊 Regular clustering: epsilon=${epsilon.toFixed(4)}`);
    }
    
    return epsilon;
}

// FIXED neighbor finding with better debugging
function findNeighborsFixed(points, pointIndex, eps) {
    const neighbors = [];
    const point = points[pointIndex];

    for (let i = 0; i < points.length; i++) {
        if (i !== pointIndex) {
            const distance = euclideanDistance(point, points[i]);
            if (distance <= eps) {
                neighbors.push(i);
                console.log(`      Point ${i}: distance=${distance.toFixed(4)} ✅ NEIGHBOR`);
            } else {
                console.log(`      Point ${i}: distance=${distance.toFixed(4)} ❌ too far (eps=${eps.toFixed(4)})`);
            }
        }
    }

    return neighbors;
}

// FIXED cluster expansion - ensures proper merging
function expandClusterFixed(points, pointIndex, neighbors, cluster, visited, eps, minPts) {
    cluster.push(points[pointIndex]);
    console.log(`     🔗 Starting cluster with point ${pointIndex}`);

    let i = 0;
    while (i < neighbors.length) {
        const neighborIndex = neighbors[i];

        if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex);
            const newNeighbors = findNeighborsFixed(points, neighborIndex, eps);

            // FIXED: Lower threshold for adding new neighbors
            if (newNeighbors.length >= Math.max(1, minPts - 1)) {
                // Add all new neighbors to the expansion list
                for (const newNeighbor of newNeighbors) {
                    if (!neighbors.includes(newNeighbor)) {
                        neighbors.push(newNeighbor);
                    }
                }
                console.log(`     🔗 Point ${neighborIndex} expands cluster (${newNeighbors.length} new neighbors)`);
            }
        }

        // Add to cluster if not already included
        const neighborPoint = points[neighborIndex];
        if (!cluster.some(p => p.x === neighborPoint.x && p.y === neighborPoint.y)) {
            cluster.push(neighborPoint);
            console.log(`     ➕ Added point ${neighborIndex} to cluster`);
        }

        i++;
    }
    
    console.log(`     ✅ Final cluster size: ${cluster.length} points`);
}

// Calculate comprehensive cluster metrics with INTELLIGENT SHAPE DETECTION
function calculateClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    // Calculate centroid
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    // Calculate spatial metrics
    const spatialMetrics = calculateSpatialMetrics(clusterPoints, centroidX, centroidY);

    // INTELLIGENT SHAPE ANALYSIS - determine if circle or polygon is better
    const shapeAnalysis = analyzeClusterShape(clusterPoints, centroidX, centroidY);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        ...spatialMetrics,
        ...shapeAnalysis
    };
}

// INTELLIGENT SHAPE ANALYSIS - determines optimal representation
function analyzeClusterShape(points, centroidX, centroidY) {
    if (points.length === 1) {
        return {
            shapeType: 'circle',
            circularity: 1.0,
            eccentricity: 0,
            irregularity: 0,
            convexity: 1,
            preferredSides: 8,
            complexity: 0,
            shapeConfidence: 1.0,
            polygonPoints: null
        };
    }

    // 1. CALCULATE SHAPE METRICS
    const shapeMetrics = calculateAdvancedShapeMetrics(points, centroidX, centroidY);
    
    // 2. CIRCULARITY TEST - how well does a circle represent this cluster?
    const circularityScore = calculateCircularityScore(points, centroidX, centroidY, shapeMetrics);
    
    // 3. DECISION MAKING - circle vs polygon
    const useCircle = shouldUseCircularRepresentation(circularityScore, shapeMetrics, points.length);
    
    if (useCircle) {
        console.log(`   📍 Cluster shape: CIRCLE (circularity: ${circularityScore.toFixed(2)}, confidence: ${(1 - shapeMetrics.irregularity).toFixed(2)})`);
        return {
            shapeType: 'circle',
            circularity: circularityScore,
            eccentricity: shapeMetrics.eccentricity,
            irregularity: shapeMetrics.irregularity,
            convexity: shapeMetrics.convexity,
            preferredSides: 8,
            complexity: shapeMetrics.complexity,
            shapeConfidence: 1 - shapeMetrics.irregularity,
            polygonPoints: null
        };
    } else {
        // 4. GENERATE INTELLIGENT POLYGON
        const polygonShape = generateIntelligentPolygon(points, centroidX, centroidY, shapeMetrics);
        console.log(`   🔷 Cluster shape: ${polygonShape.type.toUpperCase()} (${polygonShape.sides} sides, confidence: ${polygonShape.confidence.toFixed(2)})`);
        return {
            shapeType: polygonShape.type,
            circularity: circularityScore,
            eccentricity: shapeMetrics.eccentricity,
            irregularity: shapeMetrics.irregularity,
            convexity: shapeMetrics.convexity,
            preferredSides: polygonShape.sides,
            complexity: shapeMetrics.complexity,
            shapeConfidence: polygonShape.confidence,
            polygonPoints: polygonShape.points,
            shapeOrientation: polygonShape.orientation
        };
    }
}

// ADVANCED SHAPE METRICS calculation
function calculateAdvancedShapeMetrics(points, centroidX, centroidY) {
    // Calculate distances from centroid
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    // Standard deviation of distances (measures how "circular" the distribution is)
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const distanceStdDev = Math.sqrt(distanceVariance);

    // Eccentricity calculation using covariance matrix
    const eccentricity = calculateEccentricity(points);
    
    // Convex hull analysis
    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = calculateBoundingArea(points);
    const convexity = hullArea / (boundingArea || 0.001);
    
    // Irregularity measure (how much the shape deviates from a perfect form)
    const irregularity = Math.min(1, (distanceStdDev / avgDistance) + (1 - convexity) * 0.5);
    
    // Overall complexity score
    const complexity = (irregularity * 0.4) + (eccentricity * 0.4) + ((1 - convexity) * 0.2);

    return {
        avgDistance,
        maxDistance,
        minDistance,
        distanceStdDev,
        eccentricity,
        convexity,
        irregularity,
        complexity,
        hull,
        hullArea,
        boundingArea
    };
}

// CIRCULARITY SCORE - how well would a circle represent this cluster?
function calculateCircularityScore(points, centroidX, centroidY, metrics) {
    if (points.length === 1) return 1.0;

    // Factor 1: Distance variation from centroid (perfect circle = all equal distances)
    const distanceConsistency = 1 - Math.min(1, metrics.distanceStdDev / metrics.avgDistance);
    
    // Factor 2: Convexity (circles are convex)
    const convexityScore = metrics.convexity;
    
    // Factor 3: Aspect ratio (circles have aspect ratio = 1)
    const aspectRatioScore = 1 - Math.min(1, metrics.eccentricity);
    
    // Factor 4: Area efficiency (how much of bounding area is used)
    const areaEfficiency = metrics.hullArea / (Math.PI * Math.pow(metrics.maxDistance, 2));
    
    // Weighted combination
    const circularity = (
        distanceConsistency * 0.4 +
        convexityScore * 0.25 +
        aspectRatioScore * 0.25 +
        Math.min(1, areaEfficiency) * 0.1
    );

    return Math.max(0, Math.min(1, circularity));
}

// DECISION: Should we use circular representation?
function shouldUseCircularRepresentation(circularityScore, metrics, pointCount) {
    // Thresholds for using circles
    const CIRCULARITY_THRESHOLD = 0.7;  // High circularity required
    const LOW_COMPLEXITY_THRESHOLD = 0.3; // Low complexity preferred
    const MIN_POINTS_FOR_POLYGON = 3;    // Need enough points for meaningful polygon
    
    // Always use circle for very small clusters
    if (pointCount < MIN_POINTS_FOR_POLYGON) return true;
    
    // Use circle if highly circular
    if (circularityScore >= CIRCULARITY_THRESHOLD) return true;
    
    // Use circle if low complexity regardless of circularity
    if (metrics.complexity <= LOW_COMPLEXITY_THRESHOLD) return true;
    
    // Use circle if moderately circular AND low irregularity
    if (circularityScore >= 0.5 && metrics.irregularity <= 0.4) return true;
    
    // Otherwise, use polygon for better representation
    return false;
}

// GENERATE INTELLIGENT POLYGON based on cluster shape
function generateIntelligentPolygon(points, centroidX, centroidY, metrics) {
    const pointCount = points.length;
    
    // Determine polygon type and complexity
    let polygonType, sides, confidence;
    
    if (pointCount <= 4) {
        // Small clusters: simple polygons
        polygonType = 'simple_polygon';
        sides = Math.max(pointCount, 4);
        confidence = 0.8;
    } else if (metrics.convexity >= 0.8 && metrics.irregularity <= 0.5) {
        // Regular-ish distribution: regular polygon
        polygonType = 'regular_polygon';
        sides = calculateOptimalSides(metrics, pointCount);
        confidence = 0.9 - metrics.irregularity;
    } else if (metrics.eccentricity > 0.6) {
        // Elongated distribution: elliptical polygon  
        polygonType = 'elliptical_polygon';
        sides = Math.max(6, Math.min(12, Math.floor(pointCount * 0.8)));
        confidence = 0.8;
    } else {
        // Irregular distribution: hull-based or adaptive polygon
        polygonType = metrics.convexity >= 0.6 ? 'adaptive_polygon' : 'hull_polygon';
        sides = Math.max(5, Math.min(16, Math.floor(pointCount * 0.7)));
        confidence = 0.7 + metrics.convexity * 0.2;
    }

    // Generate polygon points based on type
    let polygonPoints;
    let orientation = 0;
    
    switch (polygonType) {
        case 'hull_polygon':
            polygonPoints = generateHullBasedPolygon(points, metrics.hull);
            break;
            
        case 'elliptical_polygon':
            const ellipseParams = calculateEllipseParameters(points, centroidX, centroidY);
            polygonPoints = generateEllipticalPolygon(centroidX, centroidY, ellipseParams, sides);
            orientation = ellipseParams.orientation;
            break;
            
        case 'adaptive_polygon':
            polygonPoints = generateAdaptivePolygon(points, centroidX, centroidY, sides, metrics);
            break;
            
        default: // regular_polygon, simple_polygon
            polygonPoints = generateRegularPolygon(centroidX, centroidY, metrics.maxDistance, sides);
            break;
    }

    return {
        type: polygonType,
        sides: sides,
        points: polygonPoints,
        confidence: confidence,
        orientation: orientation
    };
}

// Calculate optimal number of sides for regular polygons
function calculateOptimalSides(metrics, pointCount) {
    // Base sides on complexity and point count
    const complexityFactor = Math.min(1, metrics.complexity * 2);
    const countFactor = Math.min(1, pointCount / 20);
    
    const baseSides = 6; // Hexagon as default
    const additionalSides = Math.floor((complexityFactor + countFactor) * 6);
    
    return Math.max(4, Math.min(14, baseSides + additionalSides));
}

// GENERATE HULL-BASED POLYGON (follows actual point distribution)
function generateHullBasedPolygon(points, hull) {
    if (!hull || hull.length < 3) {
        // Fallback to regular polygon
        const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const avgDistance = points.reduce((sum, p) => 
            sum + Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2)), 0) / points.length;
        return generateRegularPolygon(centroidX, centroidY, avgDistance, 6);
    }
    
    // Use convex hull directly, but smooth it slightly
    return smoothPolygonPoints(hull, 0.1);
}

// GENERATE ELLIPTICAL POLYGON (for elongated clusters)
function generateEllipticalPolygon(centerX, centerY, ellipseParams, sides) {
    const points = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        
        // Ellipse equation with rotation
        const localX = ellipseParams.majorAxis * Math.cos(angle);
        const localY = ellipseParams.minorAxis * Math.sin(angle);
        
        // Rotate by orientation
        const rotatedX = localX * Math.cos(ellipseParams.orientation) - localY * Math.sin(ellipseParams.orientation);
        const rotatedY = localX * Math.sin(ellipseParams.orientation) + localY * Math.cos(ellipseParams.orientation);
        
        points.push({
            x: centerX + rotatedX,
            y: centerY + rotatedY
        });
    }
    
    return points;
}

// GENERATE ADAPTIVE POLYGON (adapts to point density in different directions)
function generateAdaptivePolygon(points, centerX, centerY, sides, metrics) {
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        
        // Calculate ideal radius in this direction based on actual point distribution
        const idealRadius = calculateDirectionalRadius(points, centerX, centerY, angle, metrics.maxDistance);
        
        const x = centerX + idealRadius * Math.cos(angle);
        const y = centerY + idealRadius * Math.sin(angle);
        
        polygonPoints.push({ x, y });
    }
    
    return smoothPolygonPoints(polygonPoints, 0.2);
}

// GENERATE REGULAR POLYGON (fallback)
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

// Calculate ellipse parameters for elongated clusters
function calculateEllipseParameters(points, centerX, centerY) {
    // Calculate covariance matrix
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
    
    // Calculate eigenvalues and eigenvectors
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) {
        // Fallback to circular
        const avgDist = Math.sqrt(cxx + cyy);
        return {
            majorAxis: avgDist,
            minorAxis: avgDist,
            orientation: 0
        };
    }
    
    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;
    
    const majorAxis = Math.sqrt(Math.max(lambda1, lambda2)) * 2;
    const minorAxis = Math.sqrt(Math.min(lambda1, lambda2)) * 2;
    
    // Calculate orientation (angle of major axis)
    let orientation = 0;
    if (Math.abs(cxy) > 1e-10) {
        orientation = Math.atan2(lambda1 - cxx, cxy);
    } else if (cxx > cyy) {
        orientation = 0;
    } else {
        orientation = Math.PI / 2;
    }
    
    return { majorAxis, minorAxis, orientation };
}

// Calculate ideal radius in a specific direction
function calculateDirectionalRadius(points, centerX, centerY, direction, maxRadius) {
    const directionVector = { x: Math.cos(direction), y: Math.sin(direction) };
    let maxProjection = 0;
    
    for (const point of points) {
        const toPoint = { x: point.x - centerX, y: point.y - centerY };
        
        // Project point onto direction vector
        const projection = toPoint.x * directionVector.x + toPoint.y * directionVector.y;
        
        if (projection > 0) { // Only consider points in the positive direction
            maxProjection = Math.max(maxProjection, projection);
        }
    }
    
    // Add some padding and ensure minimum radius
    return Math.max(maxRadius * 0.3, Math.min(maxRadius, maxProjection * 1.1));
}

// Smooth polygon points to reduce jaggedness
function smoothPolygonPoints(points, smoothingFactor) {
    if (points.length < 3 || smoothingFactor <= 0) return points;
    
    const smoothed = [];
    const n = points.length;
    
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];
        
        // Weighted average with neighbors
        const smoothX = curr.x * (1 - smoothingFactor) + (prev.x + next.x) * smoothingFactor / 2;
        const smoothY = curr.y * (1 - smoothingFactor) + (prev.y + next.y) * smoothingFactor / 2;
        
        smoothed.push({ x: smoothX, y: smoothY });
    }
    
    return smoothed;
}

// Calculate spatial dispersion metrics
function calculateSpatialMetrics(points, centroidX, centroidY) {
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );

    // Density calculation
    const area = Math.PI * Math.pow(maxDistance, 2);
    const density = points.length / (area || 0.001);

    // Compactness: how tightly clustered the points are
    const compactness = avgDistance / (maxDistance || 0.001);

    return {
        radius: maxDistance,
        spread: avgDistance,
        maxSpread: maxDistance,
        stdDev,
        density,
        compactness,
        area
    };
}

// INTELLIGENT visual size calculation based on multiple factors
function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;
    const compactness = cluster.compactness || 0.5;

    // Size bounds
    const MIN_SIZE = 35;  // Minimum readable size
    const MAX_SIZE = 280; // Maximum before it becomes unwieldy
    const OPTIMAL_SIZE = 85; // Sweet spot for most clusters

    // 1. BASE SIZE from click percentage (primary factor)
    let baseSize;
    if (percentage >= 50) {
        baseSize = OPTIMAL_SIZE + (percentage - 50) * 2.5; // Large clusters get bigger
    } else if (percentage >= 25) {
        baseSize = OPTIMAL_SIZE * (0.7 + (percentage - 25) * 0.012); // 70-100% of optimal
    } else if (percentage >= 10) {
        baseSize = OPTIMAL_SIZE * (0.5 + (percentage - 10) * 0.0133); // 50-70% of optimal
    } else {
        baseSize = MIN_SIZE + (percentage * 2); // Small clusters scale linearly
    }

    // 2. DENSITY ADJUSTMENT (secondary factor)
    // High density = more compact = slightly smaller
    // Low density = spread out = slightly larger
    const densityMultiplier = Math.pow(Math.max(0.3, Math.min(3.0, density)), 0.25);
    
    // 3. SPATIAL SPREAD ADJUSTMENT (tertiary factor)
    // More spread = larger visual representation
    const spreadBonus = Math.min(40, spread * 800); // Max +40px for spread
    
    // 4. COMPACTNESS ADJUSTMENT
    // Less compact = needs more visual space
    const compactnessMultiplier = Math.max(0.8, Math.min(1.3, 1.2 - compactness * 0.4));
    
    // 5. COUNT BONUS (ensures minimum representation for multi-click clusters)
    const countBonus = count > 1 ? Math.log10(count + 1) * 12 : 0;
    
    // 6. RELATIVE SCALING (maintain proportions between clusters)
    let relativeScale = 1.0;
    if (allClusters.length > 1) {
        const maxPercentage = Math.max(...allClusters.map(c => c.percentage || 0));
        const minPercentage = Math.min(...allClusters.map(c => c.percentage || 0));
        
        if (maxPercentage > minPercentage) {
            const range = maxPercentage - minPercentage;
            const position = (percentage - minPercentage) / range;
            
            // Ensure largest cluster is at least 1.5x the smallest
            relativeScale = 0.7 + (position * 0.8); // 0.7x to 1.5x range
        }
    }

    // COMBINE ALL FACTORS
    let finalSize = (baseSize + spreadBonus + countBonus) * densityMultiplier * compactnessMultiplier * relativeScale;

    // ENFORCE ABSOLUTE BOUNDS
    finalSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalSize));

    console.log(`   Size calc for ${percentage}%: base=${baseSize.toFixed(0)}, density×${densityMultiplier.toFixed(2)}, spread+${spreadBonus.toFixed(0)}, final=${finalSize.toFixed(0)}px`);

    return Math.round(finalSize);
}

// INTELLIGENT cluster splitting based on visual size and complexity
function smartClusterSplitting(cluster) {
    const visualSize = cluster.visualSize || calculateIntelligentVisualSize(cluster, [cluster]);
    const MAX_VISUAL_SIZE = 220; // Pixels - when to consider splitting
    const MIN_POINTS_FOR_SPLIT = 4; // Need enough points to meaningfully split
    
    // Don't split if cluster is small enough or has too few points
    if (visualSize <= MAX_VISUAL_SIZE || cluster.points.length < MIN_POINTS_FOR_SPLIT) {
        return [cluster];
    }

    // Don't split very compact clusters (they're supposed to be together)
    if (cluster.compactness > 0.8 && cluster.points.length < 8) {
        return [cluster];
    }

    console.log(`   🔪 SPLITTING large cluster: ${cluster.percentage}% (${cluster.points.length} points, ${visualSize}px)`);

    // Calculate optimal number of sub-clusters
    const sizeFactor = visualSize / MAX_VISUAL_SIZE;
    const complexityFactor = (cluster.eccentricity || 0) + (cluster.irregularity || 0);
    
    // More sub-clusters for larger, more complex shapes
    const numSubClusters = Math.min(4, Math.max(2, Math.ceil(sizeFactor * (1 + complexityFactor))));
    
    console.log(`   Split factors: size=${sizeFactor.toFixed(2)}, complexity=${complexityFactor.toFixed(2)}, splits=${numSubClusters}`);

    // Use improved k-means clustering for splitting
    const subClusters = performIntelligentKMeansSplitting(cluster.points, numSubClusters);

    // Create new cluster objects for each sub-cluster
    const splitResults = subClusters.map((subPoints, index) => {
        const subMetrics = calculateClusterMetrics(subPoints, cluster.points.length);
        
        // Sub-clusters inherit some properties but are marked as splits
        return {
            id: `${cluster.id}_${index}`,
            ...subMetrics,
            points: subPoints,
            parentId: cluster.id,
            isSplit: true,
            isTop: false,
            // Inherit complexity from parent but reduce it
            complexity: (cluster.complexity || 0) * 0.7,
            eccentricity: (cluster.eccentricity || 0) * 0.6
        };
    });

    console.log(`   ✂️ Split into ${splitResults.length} sub-clusters: ${splitResults.map(s => s.percentage + '%').join(', ')}`);
    return splitResults;
}

// IMPROVED k-means clustering with better initialization
function performIntelligentKMeansSplitting(points, k) {
    if (k <= 1 || points.length <= k) return [points];

    // INTELLIGENT centroid initialization using k-means++
    const centroids = initializeCentroidsKMeansPlusPlus(points, k);
    
    let clusters = [];
    let iterations = 0;
    const maxIterations = 25;
    let previousCentroids = null;

    while (iterations < maxIterations) {
        // Assign points to nearest centroid
        clusters = Array(k).fill(null).map(() => []);

        for (const point of points) {
            let minDist = Infinity;
            let closestCentroid = 0;

            for (let i = 0; i < centroids.length; i++) {
                const dist = euclideanDistance(point, centroids[i]);
                if (dist < minDist) {
                    minDist = dist;
                    closestCentroid = i;
                }
            }

            clusters[closestCentroid].push(point);
        }

        // Update centroids
        previousCentroids = centroids.map(c => ({...c}));
        let converged = true;
        
        for (let i = 0; i < centroids.length; i++) {
            if (clusters[i].length > 0) {
                const newX = clusters[i].reduce((sum, p) => sum + p.x, 0) / clusters[i].length;
                const newY = clusters[i].reduce((sum, p) => sum + p.y, 0) / clusters[i].length;

                const movement = euclideanDistance(centroids[i], {x: newX, y: newY});
                if (movement > 0.001) {
                    converged = false;
                }

                centroids[i] = {x: newX, y: newY};
            }
        }

        if (converged) {
            console.log(`   K-means converged after ${iterations + 1} iterations`);
            break;
        }
        iterations++;
    }

    // Filter out empty clusters and ensure reasonable distribution
    const validClusters = clusters.filter(cluster => cluster.length > 0);
    
    // If we end up with uneven clusters, try to rebalance
    if (validClusters.length > 1) {
        const rebalanced = rebalanceClusters(validClusters, points.length / validClusters.length);
        return rebalanced;
    }

    return validClusters;
}

// K-means++ initialization for better cluster separation
function initializeCentroidsKMeansPlusPlus(points, k) {
    const centroids = [];
    
    // Choose first centroid randomly
    centroids.push({...points[Math.floor(Math.random() * points.length)]});
    
    // Choose remaining centroids with probability proportional to squared distance
    for (let c = 1; c < k; c++) {
        const distances = points.map(point => {
            const minDistToCentroid = Math.min(...centroids.map(centroid => 
                Math.pow(euclideanDistance(point, centroid), 2)
            ));
            return minDistToCentroid;
        });
        
        const totalDistance = distances.reduce((sum, d) => sum + d, 0);
        let randomValue = Math.random() * totalDistance;
        
        for (let i = 0; i < points.length; i++) {
            randomValue -= distances[i];
            if (randomValue <= 0) {
                centroids.push({...points[i]});
                break;
            }
        }
    }
    
    return centroids;
}

// Rebalance clusters to avoid one huge cluster and several tiny ones
function rebalanceClusters(clusters, targetAvgSize) {
    // Simple rebalancing: if a cluster is > 2x average, try to redistribute
    const rebalanced = [];
    
    for (const cluster of clusters) {
        if (cluster.length > targetAvgSize * 2 && clusters.length > 1) {
            // Split oversized cluster in half
            const mid = Math.floor(cluster.length / 2);
            rebalanced.push(cluster.slice(0, mid));
            rebalanced.push(cluster.slice(mid));
        } else {
            rebalanced.push(cluster);
        }
    }
    
    return rebalanced;
}

// Utility functions
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateConvexHull(points) {
    // Graham scan algorithm for convex hull
    if (points.length < 3) return points;

    // Find the bottom-most point (or left most in case of tie)
    let bottom = points[0];
    for (const point of points) {
        if (point.y < bottom.y || (point.y === bottom.y && point.x < bottom.x)) {
            bottom = point;
        }
    }

    // Sort points by polar angle with respect to bottom point
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

function calculateBoundingArea(points) {
    if (points.length === 0) return 0;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    
    return width * height;
}

function calculateEccentricity(points) {
    if (points.length < 2) return 0;

    // Calculate covariance matrix
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

    // Calculate eigenvalues
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;

    if (discriminant < 0) return 0;

    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;

    // Eccentricity
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
    // CRITICAL: Use the HTTP server, not a separate port
    wss = new WebSocketServer({
        server: httpServer,  // Use the same HTTP server - this is the key fix!
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
    console.log(`   Origin: ${request.headers.origin}`);
    console.log(`   Connection: ${request.headers.connection}`);
    console.log(`   Upgrade: ${request.headers.upgrade}`);

    // Only handle WebSocket upgrade requests for /ws/ paths
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
    console.log(`   Origin: ${req.headers.origin}`);
    console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);

    // Extract channel ID from URL: /ws/channelId
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

    // Add to tracking
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    const clientCount = connectedClients.get(channelId).size;
    const totalClients = wss.clients.size;

    console.log(`✅ WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

    // Send initial data immediately
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
        console.log(`📨 Initial data sent: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Message from ${channelId}:`, data);

            // Echo back for testing
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

    // Handle connection close
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
        console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
        console.log(`   Remaining clients in channel: ${clients ? clients.size : 0}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${channelId}:`, error);
    });

    // Keep-alive mechanism
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
    }, 25000); // 25 second keep-alive

    ws.on('close', () => {
        clearInterval(keepAlive);
    });

    ws.on('pong', () => {
        console.log(`🏓 Pong received from ${channelId}`);
    });
});

// WebSocket server error handling
wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
    console.error('   Stack:', error.stack);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📝 Received SIGTERM, starting graceful shutdown...');

    // Close all WebSocket connections
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
    console.log('🚀 ClickMap EBS v4.0.0 - COMPLETE: Fixed Clustering + Intelligent Shapes');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🔍 Debug endpoint: https://smart-clickmap-backend.onrender.com/ws-debug`);
    console.log(`🧪 Test endpoint: https://smart-clickmap-backend.onrender.com/ws-test/167556274`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Final status verification
    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   HTTP server address: ${JSON.stringify(httpServer.address())}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   WebSocket clients: ${wss ? wss.clients.size : 0}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log(`   Single port mode: ${PORT}`);
        console.log('🎉 COMPLETE SYSTEM: Overlapping merge fix + Dynamic shapes + Fresh clustering!');
    }, 1000);
});

export default httpServer;
