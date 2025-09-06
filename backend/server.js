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

// Get current heatmap data with STATELESS clustering and overlap merging
function getCurrentHeatmapData(channelId, threshold = 3) {
    console.log(`🔄 STATELESS CLUSTERING: Recalculating from scratch...`);
    
    // If no specific channel requested, aggregate all channels
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

        // Process ALL points into clusters (STATELESS)
        const clusters = processClicksWithOverlapMerging(allPoints, threshold);

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
    const clusters = processClicksWithOverlapMerging(points, threshold);

    console.log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} final clusters`);

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

// STATELESS CLUSTERING WITH OVERLAP MERGING - No bias towards old clusters
function processClicksWithOverlapMerging(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧮 STATELESS clustering with overlap merging: ${points.length} points`);

    // STEP 1: Create initial clusters (every click starts as its own cluster)
    let clusters = points.map((point, index) => ({
        id: index,
        points: [point],
        x: point.x,
        y: point.y,
        count: 1,
        percentage: Math.round(100 / points.length)
    }));

    console.log(`   Step 1: Created ${clusters.length} initial clusters`);

    // STEP 2: Iteratively merge overlapping clusters
    let mergesMade = true;
    let iteration = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (mergesMade && iteration < maxIterations) {
        iteration++;
        mergesMade = false;

        console.log(`   Merge iteration ${iteration}: ${clusters.length} clusters`);

        // Check all pairs of clusters for overlap
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const cluster1 = clusters[i];
                const cluster2 = clusters[j];

                if (shouldMergeClusters(cluster1, cluster2)) {
                    console.log(`   🔗 Merging clusters ${i} (${cluster1.percentage}%) and ${j} (${cluster2.percentage}%)`);
                    
                    // Merge cluster2 into cluster1
                    const mergedCluster = mergeTwoClusters(cluster1, cluster2, points.length);
                    
                    // Replace cluster1 with merged, remove cluster2
                    clusters[i] = mergedCluster;
                    clusters.splice(j, 1);
                    
                    mergesMade = true;
                    break; // Start over with new cluster arrangement
                }
            }
            if (mergesMade) break; // Restart from beginning
        }
    }

    console.log(`   Merging complete after ${iteration} iterations: ${clusters.length} final clusters`);

    // STEP 3: Calculate full metrics for final clusters
    const enrichedClusters = clusters.map((cluster, index) => {
        const metrics = calculateClusterMetrics(cluster.points, points.length);
        const shapeAnalysis = analyzeClusterShape(cluster.points, metrics.x, metrics.y);
        const visualSize = calculateIntelligentVisualSize(metrics, clusters);

        return {
            id: index,
            ...metrics,
            ...shapeAnalysis,
            visualSize,
            points: cluster.points,
            isTop: false
        };
    });

    // STEP 4: Filter by threshold and mark top cluster
    const filteredClusters = enrichedClusters.filter(c => c.percentage >= threshold);
    filteredClusters.sort((a, b) => b.percentage - a.percentage);
    
    if (filteredClusters.length > 0) {
        filteredClusters[0].isTop = true;
    }

    console.log(`✅ FINAL: ${clusters.length} merged → ${filteredClusters.length} above threshold`);
    
    return filteredClusters;
}

// OVERLAP DETECTION - Should two clusters merge?
function shouldMergeClusters(cluster1, cluster2) {
    // Calculate distance between cluster centers
    const distance = Math.sqrt(
        Math.pow(cluster1.x - cluster2.x, 2) + 
        Math.pow(cluster1.y - cluster2.y, 2)
    );

    // Estimate visual radii (rough calculation for overlap detection)
    const radius1 = estimateVisualRadius(cluster1);
    const radius2 = estimateVisualRadius(cluster2);

    // Merge if visual circles would overlap significantly
    const overlapThreshold = 0.8; // 80% of combined radii
    const mergeDistance = (radius1 + radius2) * overlapThreshold;

    const shouldMerge = distance < mergeDistance;

    if (shouldMerge) {
        console.log(`   📏 Distance: ${distance.toFixed(4)}, Radii: ${radius1.toFixed(4)} + ${radius2.toFixed(4)} = ${(radius1 + radius2).toFixed(4)}, Threshold: ${mergeDistance.toFixed(4)} → MERGE`);
    }

    return shouldMerge;
}

// ESTIMATE VISUAL RADIUS for overlap detection (simpler calculation)
function estimateVisualRadius(cluster) {
    // Base radius on percentage and point count
    const baseRadius = 0.03; // 3% of screen
    const percentageBonus = (cluster.percentage / 100) * 0.08; // Up to 8% more
    const countBonus = Math.log10(cluster.count + 1) * 0.02; // Logarithmic count bonus
    
    return baseRadius + percentageBonus + countBonus;
}

// MERGE TWO CLUSTERS into one
function mergeTwoClusters(cluster1, cluster2, totalPoints) {
    // Combine all points
    const combinedPoints = [...cluster1.points, ...cluster2.points];
    
    // Recalculate centroid
    const centroidX = combinedPoints.reduce((sum, p) => sum + p.x, 0) / combinedPoints.length;
    const centroidY = combinedPoints.reduce((sum, p) => sum + p.y, 0) / combinedPoints.length;
    
    // Recalculate metrics
    const count = combinedPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    return {
        id: `merged_${cluster1.id}_${cluster2.id}`,
        points: combinedPoints,
        x: centroidX,
        y: centroidY,
        count,
        percentage
    };
}

// CALCULATE CLUSTER METRICS
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

// SPATIAL METRICS calculation
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

// INTELLIGENT SHAPE ANALYSIS
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
    const shapeMetrics = calculateAdvancedShapeMetrics(points, centroidX, centroidY);
    
    // Circularity test
    const circularityScore = calculateCircularityScore(points, centroidX, centroidY, shapeMetrics);
    
    // Decision: circle vs polygon
    const useCircle = shouldUseCircularRepresentation(circularityScore, shapeMetrics, points.length);
    
    if (useCircle) {
        console.log(`   📍 Cluster shape: CIRCLE (circularity: ${circularityScore.toFixed(2)})`);
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
        // Generate intelligent polygon
        const polygonShape = generateIntelligentPolygon(points, centroidX, centroidY, shapeMetrics);
        console.log(`   🔷 Cluster shape: ${polygonShape.type.toUpperCase()} (${polygonShape.sides} sides)`);
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

// ADVANCED SHAPE METRICS
function calculateAdvancedShapeMetrics(points, centroidX, centroidY) {
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const distanceStdDev = Math.sqrt(distanceVariance);

    const eccentricity = calculateEccentricity(points);
    
    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = calculateBoundingArea(points);
    const convexity = hullArea / (boundingArea || 0.001);
    
    const irregularity = Math.min(1, (distanceStdDev / avgDistance) + (1 - convexity) * 0.5);
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

// CIRCULARITY SCORE
function calculateCircularityScore(points, centroidX, centroidY, metrics) {
    if (points.length === 1) return 1.0;

    const distanceConsistency = 1 - Math.min(1, metrics.distanceStdDev / metrics.avgDistance);
    const convexityScore = metrics.convexity;
    const aspectRatioScore = 1 - Math.min(1, metrics.eccentricity);
    const areaEfficiency = metrics.hullArea / (Math.PI * Math.pow(metrics.maxDistance, 2));
    
    const circularity = (
        distanceConsistency * 0.4 +
        convexityScore * 0.25 +
        aspectRatioScore * 0.25 +
        Math.min(1, areaEfficiency) * 0.1
    );

    return Math.max(0, Math.min(1, circularity));
}

// SHOULD USE CIRCULAR REPRESENTATION?
function shouldUseCircularRepresentation(circularityScore, metrics, pointCount) {
    const CIRCULARITY_THRESHOLD = 0.7;
    const LOW_COMPLEXITY_THRESHOLD = 0.3;
    const MIN_POINTS_FOR_POLYGON = 3;
    
    if (pointCount < MIN_POINTS_FOR_POLYGON) return true;
    if (circularityScore >= CIRCULARITY_THRESHOLD) return true;
    if (metrics.complexity <= LOW_COMPLEXITY_THRESHOLD) return true;
    if (circularityScore >= 0.5 && metrics.irregularity <= 0.4) return true;
    
    return false;
}

// GENERATE INTELLIGENT POLYGON
function generateIntelligentPolygon(points, centroidX, centroidY, metrics) {
    const pointCount = points.length;
    
    let polygonType, sides, confidence;
    
    if (pointCount <= 4) {
        polygonType = 'simple_polygon';
        sides = Math.max(pointCount, 4);
        confidence = 0.8;
    } else if (metrics.convexity >= 0.8 && metrics.irregularity <= 0.5) {
        polygonType = 'regular_polygon';
        sides = calculateOptimalSides(metrics, pointCount);
        confidence = 0.9 - metrics.irregularity;
    } else if (metrics.eccentricity > 0.6) {
        polygonType = 'elliptical_polygon';
        sides = Math.max(6, Math.min(12, Math.floor(pointCount * 0.8)));
        confidence = 0.8;
    } else {
        polygonType = metrics.convexity >= 0.6 ? 'adaptive_polygon' : 'hull_polygon';
        sides = Math.max(5, Math.min(16, Math.floor(pointCount * 0.7)));
        confidence = 0.7 + metrics.convexity * 0.2;
    }

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
            
        default:
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

// INTELLIGENT VISUAL SIZE CALCULATION
function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;
    const compactness = cluster.compactness || 0.5;

    const MIN_SIZE = 35;
    const MAX_SIZE = 280;
    const OPTIMAL_SIZE = 85;

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

    // Adjustments
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

    let finalSize = (baseSize + spreadBonus + countBonus) * densityMultiplier * compactnessMultiplier * relativeScale;
    finalSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, finalSize));

    return Math.round(finalSize);
}

// HELPER FUNCTIONS
function calculateOptimalSides(metrics, pointCount) {
    const complexityFactor = Math.min(1, metrics.complexity * 2);
    const countFactor = Math.min(1, pointCount / 20);
    const baseSides = 6;
    const additionalSides = Math.floor((complexityFactor + countFactor) * 6);
    return Math.max(4, Math.min(14, baseSides + additionalSides));
}

function generateHullBasedPolygon(points, hull) {
    if (!hull || hull.length < 3) {
        const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const avgDistance = points.reduce((sum, p) => 
            sum + Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2)), 0) / points.length;
        return generateRegularPolygon(centroidX, centroidY, avgDistance, 6);
    }
    return smoothPolygonPoints(hull, 0.1);
}

function generateEllipticalPolygon(centerX, centerY, ellipseParams, sides) {
    const points = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        const localX = ellipseParams.majorAxis * Math.cos(angle);
        const localY = ellipseParams.minorAxis * Math.sin(angle);
        const rotatedX = localX * Math.cos(ellipseParams.orientation) - localY * Math.sin(ellipseParams.orientation);
        const rotatedY = localX * Math.sin(ellipseParams.orientation) + localY * Math.cos(ellipseParams.orientation);
        
        points.push({
            x: centerX + rotatedX,
            y: centerY + rotatedY
        });
    }
    
    return points;
}

function generateAdaptivePolygon(points, centerX, centerY, sides, metrics) {
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        const idealRadius = calculateDirectionalRadius(points, centerX, centerY, angle, metrics.maxDistance);
        const x = centerX + idealRadius * Math.cos(angle);
        const y = centerY + idealRadius * Math.sin(angle);
        polygonPoints.push({ x, y });
    }
    
    return smoothPolygonPoints(polygonPoints, 0.2);
}

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

function calculateEllipseParameters(points, centerX, centerY) {
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
    
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) {
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

function smoothPolygonPoints(points, smoothingFactor) {
    if (points.length < 3 || smoothingFactor <= 0) return points;
    
    const smoothed = [];
    const n = points.length;
    
    for (let i = 0; i < n; i++) {
        const prev = points[(i - 1 + n) % n];
        const curr = points[i];
        const next = points[(i + 1) % n];
        
        const smoothX = curr.x * (1 - smoothingFactor) + (prev.x + next.x) * smoothingFactor / 2;
        const smoothY = curr.y * (1 - smoothingFactor) + (prev.y + next.y) * smoothingFactor / 2;
        
        smoothed.push({ x: smoothX, y: smoothY });
    }
    
    return smoothed;
}

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

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
    console.log(`   Origin: ${request.headers.origin}`);
    console.log(`   Connection: ${request.headers.connection}`);
    console.log(`   Upgrade: ${request.headers.upgrade}`);

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
        console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
        console.log(`   Remaining clients in channel: ${clients ? clients.size : 0}`);
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

    ws.on('pong', () => {
        console.log(`🏓 Pong received from ${channelId}`);
    });
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
    console.error('   Stack:', error.stack);
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

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v4.0.0 STATELESS CLUSTERING with OVERLAP MERGING');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🔍 Debug endpoint: https://smart-clickmap-backend.onrender.com/ws-debug`);
    console.log(`🧪 Test endpoint: https://smart-clickmap-backend.onrender.com/ws-test/167556274`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   HTTP server address: ${JSON.stringify(httpServer.address())}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   WebSocket clients: ${wss ? wss.clients.size : 0}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log(`   Single port mode: ${PORT}`);
        console.log('🎉 STATELESS clustering with overlap merging fully operational!');
    }, 1000);
});

export default httpServer;
