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

// Get current heatmap data with SMART LABEL-BASED MERGING
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
        const clusters = processClicksWithSmartMerging(allPoints, threshold);

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
    const clusters = processClicksWithSmartMerging(points, threshold);

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

// SMART LABEL-BASED MERGING ALGORITHM
function processClicksWithSmartMerging(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧠 SMART MERGING: ${points.length} points, ${threshold}% threshold`);

    // Step 1: Create initial clusters (each click starts as its own cluster)
    let clusters = points.map((point, index) => ({
        id: index,
        points: [point],
        x: point.x,
        y: point.y,
        count: 1,
        percentage: Math.round(100 / points.length)
    }));

    console.log(`   Initial: ${clusters.length} single-point clusters`);

    // Step 2: Calculate visual sizes and label areas for all clusters
    clusters = clusters.map(cluster => ({
        ...cluster,
        ...calculateClusterMetrics(cluster.points, points.length),
        visualSize: calculateIntelligentVisualSize(cluster, clusters)
    }));

    console.log(`   Calculated sizes: ${clusters.map(c => c.visualSize).join(', ')}`);

    // Step 3: SMART MERGING - merge clusters whose labels would overlap
    const mergedClusters = performLabelBasedMerging(clusters);

    console.log(`   After label merging: ${clusters.length} → ${mergedClusters.length} clusters`);

    // Step 4: Filter by threshold (but be more lenient for small datasets)
    const effectiveThreshold = points.length < 10 ? Math.min(threshold, 5) : threshold;
    const filteredClusters = mergedClusters.filter(c => c.percentage >= effectiveThreshold);

    console.log(`   After threshold filter: ${mergedClusters.length} → ${filteredClusters.length} (${effectiveThreshold}%)`);

    // Step 5: Add intelligent shape analysis to final clusters
    const finalClusters = filteredClusters.map(cluster => ({
        ...cluster,
        ...analyzeClusterShape(cluster.points, cluster.x, cluster.y)
    }));

    // Step 6: Sort and mark top cluster
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    console.log(`✅ SMART MERGING result: ${finalClusters.length} final clusters`);
    finalClusters.forEach((c, i) => {
        if (i < 3) { // Log first few for debugging
            console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks, size: ${c.visualSize}px, shape: ${c.shapeType})`);
        }
    });

    return finalClusters;
}

// LABEL-BASED MERGING - merge clusters whose percentage labels would overlap
function performLabelBasedMerging(clusters) {
    if (clusters.length <= 1) return clusters;

    console.log(`🏷️ LABEL MERGING: checking ${clusters.length} clusters for label overlaps`);

    let merged = [...clusters];
    let foundMerge = true;
    let iterations = 0;
    const maxIterations = 20; // Prevent infinite loops

    while (foundMerge && iterations < maxIterations) {
        foundMerge = false;
        iterations++;

        console.log(`   Iteration ${iterations}: checking ${merged.length} clusters`);

        for (let i = 0; i < merged.length && !foundMerge; i++) {
            for (let j = i + 1; j < merged.length && !foundMerge; j++) {
                const cluster1 = merged[i];
                const cluster2 = merged[j];

                // Check if their labels would overlap
                if (wouldLabelsOverlap(cluster1, cluster2)) {
                    console.log(`   🔗 MERGING: Cluster ${i} (${cluster1.percentage}%) + Cluster ${j} (${cluster2.percentage}%) - labels overlap`);

                    // Merge the clusters
                    const mergedCluster = mergeTwoClusters(cluster1, cluster2, merged.length);

                    // Remove the old clusters and add the new one
                    merged = merged.filter((_, index) => index !== i && index !== j);
                    merged.push(mergedCluster);

                    foundMerge = true;
                }
            }
        }

        console.log(`   After iteration ${iterations}: ${merged.length} clusters remaining`);
    }

    console.log(`🏷️ LABEL MERGING complete: ${clusters.length} → ${merged.length} (${iterations} iterations)`);
    return merged;
}

// Check if two clusters' percentage labels would visually overlap
function wouldLabelsOverlap(cluster1, cluster2) {
    // Assume a 1920x1080 viewport for calculations
    const VIEWPORT_WIDTH = 1920;
    const VIEWPORT_HEIGHT = 1080;

    // Convert cluster positions to screen coordinates
    const x1 = cluster1.x * VIEWPORT_WIDTH;
    const y1 = cluster1.y * VIEWPORT_HEIGHT;
    const x2 = cluster2.x * VIEWPORT_WIDTH;
    const y2 = cluster2.y * VIEWPORT_HEIGHT;

    // Calculate label sizes (percentage text + margins)
    const label1 = calculateLabelDimensions(cluster1.percentage, cluster1.visualSize);
    const label2 = calculateLabelDimensions(cluster2.percentage, cluster2.visualSize);

    // Label positioning (simplified - labels try to center on cluster, but avoid edges)
    const labelX1 = Math.max(label1.width/2, Math.min(VIEWPORT_WIDTH - label1.width/2, x1));
    const labelY1 = Math.max(label1.height/2, Math.min(VIEWPORT_HEIGHT - label1.height/2, y1));
    const labelX2 = Math.max(label2.width/2, Math.min(VIEWPORT_WIDTH - label2.width/2, x2));
    const labelY2 = Math.max(label2.height/2, Math.min(VIEWPORT_HEIGHT - label2.height/2, y2));

    // Check for rectangle overlap (with small buffer)
    const buffer = 8; // 8px buffer between labels
    const overlap = !(
        labelX1 + label1.width/2 + buffer < labelX2 - label2.width/2 ||
        labelX2 + label2.width/2 + buffer < labelX1 - label1.width/2 ||
        labelY1 + label1.height/2 + buffer < labelY2 - label2.height/2 ||
        labelY2 + label2.height/2 + buffer < labelY1 - label1.height/2
    );

    if (overlap) {
        const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        console.log(`     💥 OVERLAP detected: distance=${distance.toFixed(0)}px, label1=${label1.width}x${label1.height}, label2=${label2.width}x${label2.height}`);
    }

    return overlap;
}

// Calculate label dimensions based on percentage and visual size
function calculateLabelDimensions(percentage, visualSize) {
    // Dynamic font sizing (matching frontend logic)
    const baseFontSize = Math.max(18, Math.min(50, visualSize * 0.4));
    const importanceBonus = percentage >= 25 ? 2 : 0;
    const fontSize = baseFontSize + importanceBonus;

    // Estimate text width (rough approximation)
    const text = `${percentage}%`;
    const charWidth = fontSize * 0.6; // Approximate character width
    const textWidth = text.length * charWidth;

    // Add some padding
    const padding = 8;
    
    return {
        width: textWidth + padding,
        height: fontSize + padding,
        fontSize: fontSize
    };
}

// Merge two clusters into one
function mergeTwoClusters(cluster1, cluster2, totalClusters) {
    // Combine all points
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;

    // Calculate new centroid (weighted by point count)
    const newX = (cluster1.x * cluster1.count + cluster2.x * cluster2.count) / totalCount;
    const newY = (cluster1.y * cluster1.count + cluster2.y * cluster2.count) / totalCount;

    // Calculate new percentage based on total points
    const newPercentage = Math.round((totalCount / (totalClusters * 1.0)) * 100); // Rough estimation

    // Create merged cluster
    const mergedCluster = {
        id: `merged_${cluster1.id}_${cluster2.id}`,
        points: allPoints,
        x: newX,
        y: newY,
        count: totalCount,
        percentage: newPercentage
    };

    // Recalculate metrics
    const metrics = calculateClusterMetrics(allPoints, totalClusters);
    Object.assign(mergedCluster, metrics);

    // Recalculate visual size
    mergedCluster.visualSize = calculateIntelligentVisualSize(mergedCluster, [mergedCluster]);

    console.log(`   🔗 Merged result: ${totalCount} points, ${newPercentage}%, size: ${mergedCluster.visualSize}px`);

    return mergedCluster;
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

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        ...spatialMetrics
    };
}

// Calculate spatial dispersion metrics
function calculateSpatialMetrics(points, centroidX, centroidY) {
    if (points.length === 1) {
        return {
            radius: 0.05,
            spread: 0.05,
            maxSpread: 0.05,
            stdDev: 0,
            density: 1,
            compactness: 1,
            area: 0.01
        };
    }

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
    const compactness = maxDistance > 0 ? avgDistance / maxDistance : 1;

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

    // Calculate shape metrics
    const eccentricity = calculateEccentricity(points);
    const convexity = calculateConvexity(points);
    const irregularity = 1 - convexity;
    const complexity = (irregularity * 0.4) + (eccentricity * 0.6);

    // Circularity test
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const circularity = 1 - Math.min(1, Math.sqrt(distanceVariance) / avgDistance);

    // Decide on shape type
    const useCircle = circularity >= 0.7 || (complexity <= 0.3 && points.length < 5);
    
    if (useCircle) {
        return {
            shapeType: 'circle',
            circularity,
            eccentricity,
            irregularity,
            convexity,
            preferredSides: 8,
            complexity,
            shapeConfidence: circularity,
            polygonPoints: null
        };
    } else {
        // Generate polygon
        const sides = Math.max(6, Math.min(12, 6 + Math.floor(complexity * 8)));
        const polygonPoints = generateAdaptivePolygon(points, centroidX, centroidY, sides);
        
        return {
            shapeType: eccentricity > 0.6 ? 'elliptical_polygon' : 'adaptive_polygon',
            circularity,
            eccentricity,
            irregularity,
            convexity,
            preferredSides: sides,
            complexity,
            shapeConfidence: 1 - irregularity,
            polygonPoints
        };
    }
}

// Generate adaptive polygon points
function generateAdaptivePolygon(points, centerX, centerY, sides) {
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    const maxRadius = Math.max(...points.map(p => 
        Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2))
    ));

    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        const radius = calculateDirectionalRadius(points, centerX, centerY, angle, maxRadius);
        
        polygonPoints.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }
    
    return polygonPoints;
}

// Calculate ideal radius in a specific direction
function calculateDirectionalRadius(points, centerX, centerY, direction, maxRadius) {
    const directionVector = { x: Math.cos(direction), y: Math.sin(direction) };
    let maxProjection = 0;
    
    for (const point of points) {
        const toPoint = { x: point.x - centerX, y: point.y - centerY };
        const projection = toPoint.x * directionVector.x + toPoint.y * directionVector.y;
        
        if (projection > 0) {
            maxProjection = Math.max(maxProjection, projection);
        }
    }
    
    return Math.max(maxRadius * 0.3, Math.min(maxRadius, maxProjection * 1.1));
}

// Calculate eccentricity (elongation)
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

// Calculate convexity
function calculateConvexity(points) {
    if (points.length < 3) return 1;

    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = calculateBoundingArea(points);

    return hullArea / (boundingArea || 0.001);
}

// Convex hull calculation
function calculateConvexHull(points) {
    if (points.length < 3) return points;

    let bottom = points[0];
    for (const point of points) {
        if (point.y < bottom.y || (point.y === bottom.y && point.x < bottom.x)) {
            bottom = point;
        }
    }

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

    // Base size from percentage
    let baseSize;
    if (percentage >= 50) {
        baseSize = OPTIMAL_SIZE + (percentage - 50) * 2.5;
    } else if (percentage >= 25) {
        baseSize = OPTIMAL_SIZE * (0.7 + (percentage - 25) * 0.012);
    } else if (percentage >= 10) {
        baseSize = OPTIMAL_SIZE * (0.5 + (percentage - 10) * 0.0133);
    } else {
        baseSize = MIN_SIZE + (percentage * 2);
    }

    // Density and spread adjustments
    const densityMultiplier = Math.pow(Math.max(0.3, Math.min(3.0, density)), 0.25);
    const spreadBonus = Math.min(40, spread * 800);
    const compactnessMultiplier = Math.max(0.8, Math.min(1.3, 1.2 - compactness * 0.4));
    const countBonus = count > 1 ? Math.log10(count + 1) * 12 : 0;

    // Relative scaling
    let relativeScale = 1.0;
    if (allClusters.length > 1) {
        const maxPercentage = Math.max(...allClusters.map(c => c.percentage || 0));
        const minPercentage = Math.min(...allClusters.map(c => c.percentage || 0));
        
        if (maxPercentage > minPercentage) {
            const range = maxPercentage - minPercentage;
            const position = (percentage - minPercentage) / range;
            relativeScale = 0.7 + (position * 0.8);
        }
    }

    // Combine all factors
    let finalSize = (baseSize + spreadBonus + countBonus) * densityMultiplier * compactnessMultiplier * relativeScale;

    // Enforce bounds
    finalSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalSize));

    return Math.round(finalSize);
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
    console.log(`   Origin: ${request.headers.origin}`);

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
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${channelId}:`, error);
    });
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
    console.log('🚀 ClickMap EBS v4.0.0 SMART LABEL-BASED MERGING');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🏷️ SMART MERGING: Clusters merge when percentage labels would overlap`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Final status verification
    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   Smart merging enabled: YES`);
        console.log('🎉 Smart label-based merging server fully operational!');
    }, 1000);
});

export default httpServer;
