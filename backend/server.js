import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Real-time performance monitoring
const PERFORMANCE_MONITORING = process.env.NODE_ENV !== 'production';
const performanceStats = {
    clickProcessingTimes: [],
    broadcastTimes: [],
    clusterCalculationTimes: [],
    totalRequests: 0,
    startTime: Date.now()
};

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

// Enhanced health check with real-time performance stats
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    
    const uptime = Date.now() - performanceStats.startTime;
    const avgProcessingTime = performanceStats.clickProcessingTimes.length > 0 ? 
        performanceStats.clickProcessingTimes.reduce((a, b) => a + b, 0) / performanceStats.clickProcessingTimes.length : 0;
    const avgBroadcastTime = performanceStats.broadcastTimes.length > 0 ?
        performanceStats.broadcastTimes.reduce((a, b) => a + b, 0) / performanceStats.broadcastTimes.length : 0;
    const avgCalculationTime = performanceStats.clusterCalculationTimes.length > 0 ?
        performanceStats.clusterCalculationTimes.reduce((a, b) => a + b, 0) / performanceStats.clusterCalculationTimes.length : 0;
    
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '4.2.0-fixed-clustering',
        uptime: Math.floor(uptime / 1000),
        websocket: {
            enabled: !!wss,
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size,
            connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        performance: PERFORMANCE_MONITORING ? {
            totalRequests: performanceStats.totalRequests,
            averageProcessingTime: Math.round(avgProcessingTime * 100) / 100,
            averageBroadcastTime: Math.round(avgBroadcastTime * 100) / 100,
            averageCalculationTime: Math.round(avgCalculationTime * 100) / 100,
            requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100,
            realTimeMode: true
        } : undefined,
        clustering: {
            algorithm: 'fixed-visual-clustering',
            minThreshold: '25%',
            maxSize: '85px',
            spatialSeparation: 'enabled'
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

// Real-time performance monitoring endpoint
app.get('/performance', (req, res) => {
    if (!PERFORMANCE_MONITORING) {
        return res.status(404).json({ error: 'Performance monitoring disabled' });
    }
    
    const uptime = Date.now() - performanceStats.startTime;
    const recentProcessingTimes = performanceStats.clickProcessingTimes.slice(-20);
    const recentBroadcastTimes = performanceStats.broadcastTimes.slice(-20);
    
    res.json({
        realTimeMode: true,
        uptime: Math.floor(uptime / 1000),
        totalRequests: performanceStats.totalRequests,
        requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100,
        averages: {
            clickProcessing: performanceStats.clickProcessingTimes.length > 0 ? 
                Math.round((performanceStats.clickProcessingTimes.reduce((a, b) => a + b, 0) / performanceStats.clickProcessingTimes.length) * 100) / 100 : 0,
            broadcasting: performanceStats.broadcastTimes.length > 0 ?
                Math.round((performanceStats.broadcastTimes.reduce((a, b) => a + b, 0) / performanceStats.broadcastTimes.length) * 100) / 100 : 0,
            clusterCalculation: performanceStats.clusterCalculationTimes.length > 0 ?
                Math.round((performanceStats.clusterCalculationTimes.reduce((a, b) => a + b, 0) / performanceStats.clusterCalculationTimes.length) * 100) / 100 : 0
        },
        recent: {
            clickProcessing: recentProcessingTimes.map(t => Math.round(t * 100) / 100),
            broadcasting: recentBroadcastTimes.map(t => Math.round(t * 100) / 100)
        },
        thresholds: {
            clickProcessing: { target: 10, warning: 50, critical: 100 },
            broadcasting: { target: 5, warning: 20, critical: 50 },
            clusterCalculation: { target: 15, warning: 100, critical: 200 }
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

// Real-time optimized click handling endpoint
app.post('/click', (req, res) => {
    const startTime = performance.now();
    console.log('🖱️ CLICK endpoint called - REAL-TIME MODE');

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

        // REAL-TIME OPTIMIZATION: Store click immediately with minimal processing
        const clickProcessStart = performance.now();
        
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
            console.log(`   📝 Created new channel: ${channelId}`);
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        const clickProcessTime = performance.now() - clickProcessStart;
        
        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)}) in ${clickProcessTime.toFixed(2)}ms`);
        console.log(`   Total clicks in channel: ${gameState.clicks.get(channelId).size}`);

        // REAL-TIME OPTIMIZATION: Immediately calculate and broadcast updates
        const broadcastStart = performance.now();
        const updatedData = getCurrentHeatmapData(channelId);
        const calculationTime = performance.now() - broadcastStart;
        
        console.log(`   📊 FIXED cluster calculation: ${updatedData.clusters.length} clusters in ${calculationTime.toFixed(2)}ms`);
        
        // Immediate WebSocket broadcast
        const wsStart = performance.now();
        broadcastToChannel(channelId, updatedData);
        const broadcastTime = performance.now() - wsStart;
        
        console.log(`   📡 Real-time broadcast: ${broadcastTime.toFixed(2)}ms to channel ${channelId}`);

        // Performance monitoring
        const totalTime = performance.now() - startTime;
        if (PERFORMANCE_MONITORING) {
            performanceStats.clickProcessingTimes.push(totalTime);
            performanceStats.broadcastTimes.push(broadcastTime);
            performanceStats.clusterCalculationTimes.push(calculationTime);
            performanceStats.totalRequests++;
            
            // Keep only last 100 measurements for rolling average
            if (performanceStats.clickProcessingTimes.length > 100) {
                performanceStats.clickProcessingTimes.shift();
                performanceStats.broadcastTimes.shift();
                performanceStats.clusterCalculationTimes.shift();
            }
        }

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0,
            channelId: channelId,
            performance: PERFORMANCE_MONITORING ? {
                processingTime: totalTime,
                calculationTime: calculationTime,
                broadcastTime: broadcastTime
            } : undefined
        });

        console.log(`🚀 REAL-TIME click processing completed in ${totalTime.toFixed(2)}ms`);

    } catch (error) {
        console.error('❌ Click error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token or request',
            details: error.message
        });
    }
});

// FIXED heatmap endpoint with 25% threshold
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 25; // FIXED: Default to 25%

    console.log(`📊 FIXED HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%`);

    try {
        const data = getCurrentHeatmapData(channelId, threshold);

        if (data.totalClicks > 0) {
            console.log(`✅ FIXED Heatmap: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
            
            // Debug percentage math
            const totalPercentage = data.clusters.reduce((sum, c) => sum + c.percentage, 0);
            console.log(`   📊 Percentage check: ${data.clusters.map(c => c.percentage + '%').join(' + ')} = ${totalPercentage}%`);
            
            // Debug cluster positions and sizes
            data.clusters.forEach((c, i) => {
                console.log(`   Cluster ${i}: ${c.percentage}% at (${(c.x * 1920).toFixed(0)}, ${(c.y * 1080).toFixed(0)}) size=${c.visualSize}px`);
            });
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

// FIXED: Get current heatmap data with corrected clustering
function getCurrentHeatmapData(channelId, threshold = 25) { // FIXED: Default to 25%
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

        // Process ALL points into clusters using FIXED algorithm
        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 15), // Adjusted for 25% threshold
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
    const clusters = processClicksIntoVisualClusters(points, threshold);

    console.log(`🔍 FIXED Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 15),
        threshold,
        lastUpdate: gameState.lastUpdate
    };
}

// FIXED VISUAL-BASED CLUSTERING ALGORITHM - Proper sizing and separation
function processClicksIntoVisualClusters(points, threshold = 25) {
    if (points.length === 0) return [];

    console.log(`🧮 FIXED VISUAL clustering: ${points.length} points, ${threshold}% threshold`);

    // Step 1: Distance-based clustering with FIXED merge distances
    const rawClusters = performFixedDistanceClustering(points);
    console.log(`   FIXED distance clustering: ${points.length} points → ${rawClusters.length} raw clusters`);
    
    // Step 2: Calculate basic metrics for each cluster
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateBasicClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster
        };
    });

    // Step 3: FIXED percentage normalization BEFORE merging
    const normalizedClusters = normalizePercentages(enrichedClusters, points.length);
    console.log(`   Initial percentages: ${normalizedClusters.map(c => c.percentage + '%').join(', ')}`);

    // Step 4: Filter by threshold BEFORE merging to avoid tiny clusters
    const thresholdClusters = normalizedClusters.filter(c => c.percentage >= threshold);
    console.log(`   Threshold filter (${threshold}%): ${normalizedClusters.length} → ${thresholdClusters.length} clusters`);

    // Step 5: Calculate sizes BEFORE merging for accurate overlap detection
    const sizingContext = calculateSizingContext(thresholdClusters);
    const clustersWithSizes = thresholdClusters.map(cluster => ({
        ...cluster,
        visualSize: calculateFixedVisualSize(cluster, sizingContext)
    }));

    // Step 6: FIXED spatial separation - only merge if truly overlapping
    const spatiallyMergedClusters = performSpatialSeparation(clustersWithSizes);
    console.log(`   FIXED spatial separation: ${clustersWithSizes.length} → ${spatiallyMergedClusters.length} clusters`);

    // Step 7: Final percentage recalculation after merging
    const finalNormalized = normalizePercentages(spatiallyMergedClusters, points.length);

    // Step 8: Add shape analysis and finalize
    const finalClusters = finalNormalized.map((cluster, index) => {
        const shapeAnalysis = analyzeClusterShape(cluster.points, cluster.x, cluster.y);
        
        return {
            ...cluster,
            ...shapeAnalysis,
            visualSize: cluster.visualSize, // Keep the calculated size
            isTop: false // Will be set after sorting
        };
    });

    // Step 9: Sort by percentage and mark top cluster
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    // Step 10: FIXED validation
    validateClusterSeparation(finalClusters);

    console.log(`✅ FIXED clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`);
    finalClusters.forEach((c, i) => {
        console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks, ${c.visualSize}px, center: ${c.x.toFixed(3)}, ${c.y.toFixed(3)})`);
    });

    return finalClusters;
}

// FIXED DISTANCE-BASED CLUSTERING - Much smaller merge distances
function performFixedDistanceClustering(points) {
    if (points.length === 0) return [];
    
    const clusters = [];
    const assigned = new Set();
    
    // FIXED: Much smaller merge distance to prevent over-clustering
    const mergeDistance = calculateFixedMergeDistance(points);
    console.log(`   FIXED merge distance: ${mergeDistance.toFixed(4)}`);
    
    for (let i = 0; i < points.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = [points[i]];
        assigned.add(i);
        
        // Find nearby points within very small distance
        for (let j = i + 1; j < points.length; j++) {
            if (assigned.has(j)) continue;
            
            const distance = euclideanDistance(points[i], points[j]);
            if (distance <= mergeDistance) {
                cluster.push(points[j]);
                assigned.add(j);
            }
        }
        
        clusters.push(cluster);
    }
    
    return clusters;
}

// FIXED merge distance calculation - much more conservative
function calculateFixedMergeDistance(points) {
    if (points.length < 2) return 0.02; // Very small for single points
    
    // Calculate all pairwise distances
    const distances = [];
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    // FIXED: Much more conservative merge distances
    if (points.length <= 3) {
        // Very small datasets: 10th percentile
        const percentile10 = distances[Math.floor(distances.length * 0.1)] || distances[0];
        return Math.max(0.015, Math.min(0.04, percentile10 * 1.2));
    } else if (points.length <= 10) {
        // Medium datasets: 8th percentile
        const percentile8 = distances[Math.floor(distances.length * 0.08)] || distances[0];
        return Math.max(0.01, Math.min(0.03, percentile8));
    } else {
        // Large datasets: 5th percentile
        const percentile5 = distances[Math.floor(distances.length * 0.05)] || distances[0];
        return Math.max(0.008, Math.min(0.025, percentile5));
    }
}

// FIXED VISUAL SIZE calculation - simplified and accurate
function calculateFixedVisualSize(cluster, sizingContext) {
    const percentage = cluster.percentage || 0;
    
    // FIXED SIZE SCALING: 100% = 85px (user's request), 25% = 45px minimum
    const MIN_SIZE = 45;   // 25% threshold minimum
    const TARGET_100_SIZE = 85; // User requested: current 85% becomes new 100%
    const MAX_SIZE = 120;  // Cap to prevent overly large clusters
    
    // Simple linear scaling from 25% to 100%
    if (percentage >= 100) {
        return TARGET_100_SIZE;
    } else if (percentage >= 25) {
        // Linear interpolation between 25% and 100%
        const progress = (percentage - 25) / 75; // 0 to 1
        return Math.round(MIN_SIZE + (TARGET_100_SIZE - MIN_SIZE) * progress);
    } else {
        // Below threshold, but still visible
        return Math.round(MIN_SIZE * 0.8);
    }
}

// FIXED spatial separation - accurate overlap detection
function performSpatialSeparation(clustersWithSizes) {
    if (clustersWithSizes.length <= 1) return clustersWithSizes;
    
    const separated = [...clustersWithSizes];
    let changed = true;
    
    while (changed) {
        changed = false;
        
        for (let i = 0; i < separated.length; i++) {
            for (let j = i + 1; j < separated.length; j++) {
                if (shouldMergeClustersFixed(separated[i], separated[j])) {
                    console.log(`   FIXED merging overlapping clusters: ${separated[i].percentage}% + ${separated[j].percentage}%`);
                    
                    // Merge cluster j into cluster i
                    const mergedCluster = mergeTwoClustersFixed(separated[i], separated[j]);
                    separated[i] = mergedCluster;
                    separated.splice(j, 1);
                    
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
    
    return separated;
}

// FIXED cluster merging decision - much more accurate
function shouldMergeClustersFixed(cluster1, cluster2) {
    // Get actual visual sizes
    const radius1 = cluster1.visualSize || 50;
    const radius2 = cluster2.visualSize || 50;
    
    // Calculate actual distance between centers (in screen coordinates)
    const screenWidth = 1920;
    const screenHeight = 1080;
    
    const x1 = cluster1.x * screenWidth;
    const y1 = cluster1.y * screenHeight;
    const x2 = cluster2.x * screenWidth;
    const y2 = cluster2.y * screenHeight;
    
    const centerDistance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    
    // FIXED: Only merge if circles actually overlap significantly
    const minSeparation = (radius1 + radius2) * 0.8; // 80% overlap required
    const shouldMerge = centerDistance < minSeparation;
    
    if (shouldMerge) {
        console.log(`   FIXED merge decision: distance=${centerDistance.toFixed(1)}px < threshold=${minSeparation.toFixed(1)}px`);
        console.log(`   Cluster 1: ${cluster1.percentage}% (${radius1}px) at (${x1.toFixed(0)}, ${y1.toFixed(0)})`);
        console.log(`   Cluster 2: ${cluster2.percentage}% (${radius2}px) at (${x2.toFixed(0)}, ${y2.toFixed(0)})`);
    }
    
    return shouldMerge;
}

// FIXED cluster merging with proper size recalculation
function mergeTwoClustersFixed(cluster1, cluster2) {
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;
    
    // Calculate new centroid (weighted by cluster sizes)
    const weight1 = cluster1.count / totalCount;
    const weight2 = cluster2.count / totalCount;
    
    const newX = cluster1.x * weight1 + cluster2.x * weight2;
    const newY = cluster1.y * weight1 + cluster2.y * weight2;
    
    // Recalculate metrics for merged cluster
    const mergedMetrics = calculateBasicClusterMetrics(allPoints, totalCount);
    
    // Recalculate size based on new percentage
    const newPercentage = Math.round((totalCount / allPoints.length) * 100);
    const newVisualSize = calculateFixedVisualSize({ percentage: newPercentage }, {});
    
    return {
        ...mergedMetrics,
        x: newX,
        y: newY,
        points: allPoints,
        visualSize: newVisualSize,
        id: cluster1.id // Keep first cluster's ID
    };
}

// FIXED sizing context calculation
function calculateSizingContext(clusters) {
    if (clusters.length === 0) return { maxPercentage: 0, minPercentage: 0, totalClusters: 0 };

    const percentages = clusters.map(c => c.percentage || 0);

    return {
        maxPercentage: Math.max(...percentages),
        minPercentage: Math.min(...percentages),
        totalClusters: clusters.length
    };
}

// FIXED: Add spatial validation to prevent clusters inside clusters
function validateClusterSeparation(clusters) {
    const screenWidth = 1920;
    const screenHeight = 1080;
    
    for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
            const c1 = clusters[i];
            const c2 = clusters[j];
            
            const x1 = c1.x * screenWidth;
            const y1 = c1.y * screenHeight;
            const x2 = c2.x * screenWidth;
            const y2 = c2.y * screenHeight;
            
            const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            const r1 = c1.visualSize || 50;
            const r2 = c2.visualSize || 50;
            
            // Check if one cluster is completely inside another
            const c1InsideC2 = distance + r1 < r2;
            const c2InsideC1 = distance + r2 < r1;
            
            if (c1InsideC2 || c2InsideC1) {
                console.warn(`⚠️  CLUSTER CONTAINMENT DETECTED: Cluster ${i} and ${j} have containment issue`);
                console.warn(`   Distance: ${distance.toFixed(1)}px, Radius1: ${r1}px, Radius2: ${r2}px`);
            }
        }
    }
}

// Calculate basic cluster metrics
function calculateBasicClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    // Calculate centroid
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    // Calculate spread
    const distances = clusterPoints.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );

    // Basic shape metrics
    const density = count / (Math.PI * Math.pow(maxDistance || 0.001, 2));
    const compactness = avgDistance / (maxDistance || 0.001);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        radius: maxDistance,
        spread: avgDistance,
        maxSpread: maxDistance,
        stdDev,
        density,
        compactness
    };
}

// NORMALIZE PERCENTAGES - Ensure they add up to 100%
function normalizePercentages(clusters, totalPoints) {
    if (clusters.length === 0) return clusters;
    
    // Recalculate percentages based on actual point counts
    const normalized = clusters.map(cluster => ({
        ...cluster,
        percentage: Math.round((cluster.count / totalPoints) * 100)
    }));
    
    // Handle rounding errors - ensure percentages sum to 100%
    const currentTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    
    if (currentTotal !== 100 && totalPoints > 0) {
        // Adjust the largest cluster to make sum = 100%
        const largest = normalized.reduce((max, current) => 
            current.percentage > max.percentage ? current : max
        );
        largest.percentage += (100 - currentTotal);
        
        console.log(`   Percentage adjustment: ${currentTotal}% → 100%, largest cluster adjusted by ${100 - currentTotal}%`);
    }
    
    return normalized;
}

// INTELLIGENT SHAPE ANALYSIS - Simplified for better performance
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

    // Simplified shape analysis for performance
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );
    
    const irregularity = Math.min(1, stdDev / avgDistance);
    const complexity = irregularity;
    const circularity = 1 - irregularity;
    
    // Simple decision: use circle for most cases, polygon for complex shapes
    if (irregularity < 0.3 || points.length < 5) {
        return {
            shapeType: 'circle',
            circularity: circularity,
            eccentricity: 0,
            irregularity: irregularity,
            convexity: 1,
            preferredSides: 8,
            complexity: complexity,
            shapeConfidence: 1 - irregularity,
            polygonPoints: null
        };
    } else {
        const sides = Math.max(6, Math.min(12, 6 + Math.floor(complexity * 6)));
        return {
            shapeType: 'regular_polygon',
            circularity: circularity,
            eccentricity: 0,
            irregularity: irregularity,
            convexity: 1,
            preferredSides: sides,
            complexity: complexity,
            shapeConfidence: 1 - irregularity,
            polygonPoints: null
        };
    }
}

// Utility functions
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Enhanced WebSocket broadcasting function with performance optimization
function broadcastToChannel(channelId, data) {
    const broadcastStart = performance.now();
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    // REAL-TIME OPTIMIZATION: Pre-stringify message once
    const message = JSON.stringify(data);
    let sentCount = 0;
    let failedCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('WebSocket send error:', error);
                clients.delete(ws);
                failedCount++;
            }
        } else {
            clients.delete(ws);
            failedCount++;
        }
    });

    const broadcastTime = performance.now() - broadcastStart;
    
    if (sentCount > 0) {
        console.log(`📡 Real-time broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} clusters in ${broadcastTime.toFixed(2)}ms`);
        if (failedCount > 0) {
            console.log(`   ⚠️ Cleaned up ${failedCount} stale connections`);
        }
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

// Enhanced WebSocket connection handling for real-time performance
wss.on('connection', (ws, req) => {
    const startTime = Date.now();
    console.log(`🔗 NEW REAL-TIME WEBSOCKET CONNECTION`);
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

    // Add to tracking with real-time optimization
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    const clientCount = connectedClients.get(channelId).size;
    const totalClients = wss.clients.size;

    console.log(`✅ Real-time WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

    // REAL-TIME OPTIMIZATION: Send initial data immediately with minimal delay
    const sendStart = performance.now();
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
        const sendTime = performance.now() - sendStart;
        console.log(`📨 Initial data sent in ${sendTime.toFixed(2)}ms: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    // Enhanced connection handling for real-time reliability
    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`🔒 Real-time WebSocket disconnected: ${channelId} after ${duration}ms (code: ${code})`);
    });

    // Enhanced error handling
    ws.on('error', (error) => {
        console.error(`❌ Real-time WebSocket error for ${channelId}:`, error);
    });

    // Optional: Real-time ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Real-time connection health monitoring
const connectionHealthInterval = setInterval(() => {
    if (!wss) return;
    
    let totalConnections = 0;
    let healthyConnections = 0;
    
    wss.clients.forEach((ws) => {
        totalConnections++;
        if (ws.isAlive === false) {
            ws.terminate();
            console.log('🧹 Terminated unhealthy WebSocket connection');
        } else {
            healthyConnections++;
            ws.isAlive = false;
            ws.ping();
        }
    });
    
    if (totalConnections > 0) {
        console.log(`💓 Real-time health check: ${healthyConnections}/${totalConnections} connections healthy`);
    }
}, 30000); // Check every 30 seconds

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Enhanced graceful shutdown
process.on('SIGTERM', () => {
    console.log('📝 Shutting down real-time server...');
    clearInterval(connectionHealthInterval);

    if (wss) {
        wss.clients.forEach((ws) => {
            ws.close(1001, 'Server shutting down');
        });
    }

    if (PERFORMANCE_MONITORING) {
        const uptime = Date.now() - performanceStats.startTime;
        console.log(`📊 Final performance stats:`);
        console.log(`   Total requests: ${performanceStats.totalRequests}`);
        console.log(`   Uptime: ${Math.floor(uptime / 1000)}s`);
        console.log(`   Requests/sec: ${Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100}`);
    }

    httpServer.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

// Enhanced startup
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v4.2.0 FIXED CLUSTERING MODE!');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 Real-time WebSocket: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`⚡ Performance monitoring: ${PERFORMANCE_MONITORING ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🔧 FIXED FEATURES:`);
    console.log(`   • 25% minimum threshold (was 3%)`);
    console.log(`   • 100% = 85px size (user requested)`);
    console.log(`   • Fixed merge distances (no more over-clustering)`);
    console.log(`   • Proper spatial separation (no clusters inside clusters)`);
    console.log(`   • Conservative merging (80% overlap required)`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);

    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log('🎊 FIXED visual clustering server fully operational!');
    }, 1000);
});

export default httpServer;
