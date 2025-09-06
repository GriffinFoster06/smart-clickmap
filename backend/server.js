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
        version: '3.3.1',
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

// Get current heatmap data with FIXED clustering
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

// FIXED CLUSTERING ALGORITHM - Handles small datasets properly
function processClicksIntoAdvancedClusters(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧮 FIXED clustering: ${points.length} points, ${threshold}% threshold`);

    // For small datasets (< 5 points), treat each click as its own cluster
    if (points.length < 5) {
        console.log(`   Using simple mode for ${points.length} points`);
        return points.map((point, index) => {
            const percentage = Math.round(100 / points.length);
            return {
                id: index,
                x: point.x,
                y: point.y,
                count: 1,
                percentage: percentage,
                radius: 60, // Fixed visual size
                spread: 0.05,
                maxSpread: 0.05,
                stdDev: 0,
                density: 1,
                compactness: 1,
                area: 0.01,
                complexity: 0,
                eccentricity: 0,
                irregularity: 0,
                convexity: 1,
                preferredSides: 8,
                isTop: index === 0, // First click is "top"
                isSplit: false
            };
        });
    }

    // For larger datasets, use improved clustering logic
    const rawClusters = performImprovedDensityBasedClustering(points);
    
    // Calculate comprehensive metrics for each cluster
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster,
            isTop: false
        };
    });

    // Filter by threshold
    const filteredClusters = enrichedClusters.filter(c => c.percentage >= threshold);

    // Smart cluster splitting for oversized clusters
    const splitClusters = [];
    for (const cluster of filteredClusters) {
        const splits = smartClusterSplitting(cluster);
        splitClusters.push(...splits);
    }

    // Sort and mark top cluster
    splitClusters.sort((a, b) => b.percentage - a.percentage);
    if (splitClusters.length > 0) {
        splitClusters[0].isTop = true;
    }

    console.log(`✅ FIXED clustering result: ${rawClusters.length} raw → ${filteredClusters.length} filtered → ${splitClusters.length} final`);

    return splitClusters;
}

// IMPROVED density-based clustering with better handling of small datasets
function performImprovedDensityBasedClustering(points) {
    const clusters = [];
    const visited = new Set();
    const noise = new Set();

    const totalPoints = points.length;
    const adaptiveEps = calculateAdaptiveEps(points);
    
    // FIXED: More reasonable minPts for small datasets
    let minPts;
    if (totalPoints <= 2) {
        minPts = 1; // Single points form clusters
    } else if (totalPoints <= 5) {
        minPts = 2; // Pairs can form clusters
    } else {
        minPts = Math.max(2, Math.floor(totalPoints * 0.03)); // 3% minimum for larger sets
    }

    console.log(`   IMPROVED clustering params: eps=${adaptiveEps.toFixed(4)}, minPts=${minPts}`);

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;

        visited.add(i);
        const neighbors = findNeighbors(points, i, adaptiveEps);

        if (neighbors.length < minPts) {
            // FIXED: For small datasets, treat isolated points as single-point clusters
            if (totalPoints <= 5) {
                clusters.push([points[i]]);
                console.log(`   Created single-point cluster for point ${i}`);
            } else {
                noise.add(i);
            }
        } else {
            const cluster = [];
            expandCluster(points, i, neighbors, cluster, visited, adaptiveEps, minPts);
            if (cluster.length > 0) {
                clusters.push(cluster);
            }
        }
    }

    console.log(`   IMPROVED result: ${clusters.length} clusters, ${noise.size} noise points`);
    return clusters;
}

// Calculate adaptive epsilon based on k-distance
function calculateAdaptiveEps(points) {
    if (points.length < 4) return 0.15;

    const k = Math.max(3, Math.floor(Math.sqrt(points.length)));
    const distances = [];

    for (let i = 0; i < points.length; i++) {
        const pointDistances = [];
        for (let j = 0; j < points.length; j++) {
            if (i !== j) {
                const dist = euclideanDistance(points[i], points[j]);
                pointDistances.push(dist);
            }
        }
        pointDistances.sort((a, b) => a - b);
        if (pointDistances.length >= k) {
            distances.push(pointDistances[k - 1]);
        }
    }

    distances.sort((a, b) => a - b);
    
    // Use elbow method approximation
    const percentile = Math.floor(distances.length * 0.7);
    return distances[percentile] || 0.1;
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

// Calculate comprehensive cluster metrics
function calculateClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    // Calculate centroid
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    // Calculate spatial metrics
    const spatialMetrics = calculateSpatialMetrics(clusterPoints, centroidX, centroidY);

    // Calculate shape complexity
    const shapeMetrics = calculateShapeComplexity(clusterPoints);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        ...spatialMetrics,
        ...shapeMetrics
    };
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

// Calculate shape complexity for adaptive rendering
function calculateShapeComplexity(points) {
    if (points.length < 3) {
        return {
            complexity: 0,
            eccentricity: 0,
            irregularity: 0,
            preferredSides: 8
        };
    }

    // Calculate convex hull and compare to actual distribution
    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = calculateBoundingArea(points);

    const convexity = hullArea / (boundingArea || 0.001);
    const irregularity = 1 - convexity;

    // Calculate eccentricity (elongation)
    const eccentricity = calculateEccentricity(points);

    // Determine preferred number of sides for polygon rendering
    const complexity = irregularity * 0.6 + eccentricity * 0.4;
    const preferredSides = Math.round(8 + complexity * 8); // 8-16 sides

    return {
        complexity,
        eccentricity,
        irregularity,
        convexity,
        preferredSides: Math.max(6, Math.min(20, preferredSides))
    };
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
        const avgSize = points.length / validClusters.length;
        const rebalanced = rebalanceClusters(validClusters, avgSize);
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

// Estimate visual size for splitting decisions
function calculateEstimatedVisualSize(cluster) {
    const baseSize = 80; // Base minimum size
    const volumeSize = cluster.percentage * 3; // Size from click volume
    const spatialSize = cluster.radius * 300; // Size from spatial spread
    const densityMultiplier = Math.sqrt(cluster.density || 1);

    return baseSize + volumeSize + spatialSize * densityMultiplier;
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
    console.log('🚀 ClickMap EBS v3.3.1 FIXED CLUSTERING - Single Clicks Work!');
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
        console.log('🎉 FIXED clustering server fully operational - single clicks work!');
    }, 1000);
});

export default httpServer;
