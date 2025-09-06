import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Advanced game state with spatial indexing
const gameState = {
    running: false,
    clicks: new Map(), // channelId → Map(userId → { x, y, timestamp })
    spatialIndex: new Map(), // channelId → spatial grid for fast clustering
    lastUpdate: Date.now()
};

const connectedClients = new Map();
const app = express();

// CORS and middleware setup (keeping existing)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// ==================== ADVANCED CLUSTERING ALGORITHMS ====================

class IntelligentClusterer {
    constructor() {
        this.minClusterSize = 2;  // Minimum clicks to form a cluster
        this.maxClusterRadius = 0.15;  // Maximum 15% of screen
        this.epsilonBase = 0.08;  // Base distance for DBSCAN-style clustering
        this.densityWeight = 0.4;
        this.countWeight = 0.6;
    }

    // Main clustering function with multiple algorithms
    clusterPoints(points, threshold = 3) {
        if (points.length === 0) return [];

        console.log(`🧠 Intelligent clustering: ${points.length} points, ${threshold}% threshold`);

        // Step 1: DBSCAN-style clustering for natural groups
        const naturalClusters = this.dbscanClustering(points);
        console.log(`📊 Found ${naturalClusters.length} natural clusters`);

        // Step 2: Analyze and enhance each cluster
        const enhancedClusters = naturalClusters.map((cluster, idx) => 
            this.enhanceCluster(cluster, idx, points.length)
        );

        // Step 3: Filter by threshold and add metadata
        const filteredClusters = enhancedClusters
            .filter(c => c.percentage >= threshold)
            .map((c, idx) => ({ ...c, id: idx }));

        // Step 4: Size optimization and splitting
        const optimizedClusters = this.optimizeClusters(filteredClusters);

        // Step 5: Sort and mark top cluster
        optimizedClusters.sort((a, b) => b.percentage - a.percentage);
        if (optimizedClusters.length > 0) {
            optimizedClusters[0].isTop = true;
        }

        console.log(`✨ Final result: ${optimizedClusters.length} optimized clusters`);
        return optimizedClusters;
    }

    // DBSCAN-style clustering for natural grouping
    dbscanClustering(points) {
        const visited = new Set();
        const clusters = [];
        
        for (let i = 0; i < points.length; i++) {
            if (visited.has(i)) continue;
            
            const neighbors = this.findNeighbors(points, i, this.epsilonBase);
            
            if (neighbors.length < this.minClusterSize) {
                visited.add(i);
                continue;
            }

            // Start a new cluster
            const cluster = [];
            const queue = [...neighbors];
            
            while (queue.length > 0) {
                const pointIdx = queue.shift();
                if (visited.has(pointIdx)) continue;
                
                visited.add(pointIdx);
                cluster.push(points[pointIdx]);
                
                const newNeighbors = this.findNeighbors(points, pointIdx, this.epsilonBase);
                if (newNeighbors.length >= this.minClusterSize) {
                    queue.push(...newNeighbors.filter(n => !visited.has(n)));
                }
            }
            
            if (cluster.length >= this.minClusterSize) {
                clusters.push(cluster);
            }
        }
        
        return clusters;
    }

    findNeighbors(points, centerIdx, epsilon) {
        const center = points[centerIdx];
        const neighbors = [];
        
        for (let i = 0; i < points.length; i++) {
            if (i === centerIdx) continue;
            
            const dist = this.euclideanDistance(center, points[i]);
            if (dist <= epsilon) {
                neighbors.push(i);
            }
        }
        
        return neighbors;
    }

    euclideanDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Enhanced cluster analysis
    enhanceCluster(clusterPoints, clusterIdx, totalPoints) {
        const centroid = this.calculateCentroid(clusterPoints);
        const stats = this.calculateClusterStats(clusterPoints, centroid);
        const shape = this.generateClusterShape(clusterPoints, centroid, stats);
        const sizing = this.calculateIntelligentSize(clusterPoints, stats, totalPoints);

        return {
            id: clusterIdx,
            x: centroid.x,
            y: centroid.y,
            count: clusterPoints.length,
            percentage: Math.round((clusterPoints.length / totalPoints) * 100),
            
            // Spatial properties
            radius: stats.radius,
            spread: stats.spread,
            density: stats.density,
            compactness: stats.compactness,
            eccentricity: stats.eccentricity,
            
            // Size calculation
            visualSize: sizing.visualSize,
            shouldSplit: sizing.shouldSplit,
            
            // Shape data
            shape: shape,
            isRegular: shape.isRegular,
            
            // Enhancement flags
            isTop: false
        };
    }

    calculateCentroid(points) {
        const sum = points.reduce((acc, p) => ({
            x: acc.x + p.x,
            y: acc.y + p.y
        }), { x: 0, y: 0 });
        
        return {
            x: sum.x / points.length,
            y: sum.y / points.length
        };
    }

    calculateClusterStats(points, centroid) {
        // Calculate distances from centroid
        const distances = points.map(p => this.euclideanDistance(p, centroid));
        const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
        const maxDistance = Math.max(...distances);
        const minDistance = Math.min(...distances);
        
        // Density calculation (points per unit area)
        const area = Math.PI * maxDistance * maxDistance;
        const density = points.length / Math.max(area, 0.001);
        
        // Compactness (how tightly packed)
        const compactness = avgDistance / Math.max(maxDistance, 0.001);
        
        // Eccentricity (how elongated vs circular)
        const eccentricity = this.calculateEccentricity(points, centroid);
        
        return {
            radius: maxDistance,
            spread: avgDistance,
            minRadius: minDistance,
            density: density * 1000, // Scale for readability
            compactness,
            eccentricity
        };
    }

    calculateEccentricity(points, centroid) {
        // Calculate moments to determine elongation
        let m20 = 0, m02 = 0, m11 = 0;
        
        for (const point of points) {
            const dx = point.x - centroid.x;
            const dy = point.y - centroid.y;
            m20 += dx * dx;
            m02 += dy * dy;
            m11 += dx * dy;
        }
        
        m20 /= points.length;
        m02 /= points.length;
        m11 /= points.length;
        
        // Calculate eigenvalues of covariance matrix
        const trace = m20 + m02;
        const det = m20 * m02 - m11 * m11;
        const lambda1 = (trace + Math.sqrt(trace * trace - 4 * det)) / 2;
        const lambda2 = (trace - Math.sqrt(trace * trace - 4 * det)) / 2;
        
        // Eccentricity from eigenvalues
        if (lambda1 <= 0 || lambda2 <= 0) return 0;
        return Math.sqrt(1 - Math.min(lambda1, lambda2) / Math.max(lambda1, lambda2));
    }

    // Intelligent size calculation
    calculateIntelligentSize(clusterPoints, stats, totalPoints) {
        const clickCount = clusterPoints.length;
        const percentage = (clickCount / totalPoints) * 100;
        
        // Base size from activity level (percentage is primary factor)
        const activityFactor = Math.sqrt(percentage / 100); // 0 to 1
        
        // Spatial factor from actual spread
        const spatialFactor = Math.min(1, stats.radius * 5); // Normalize radius influence
        
        // Density factor (high density = more prominent)
        const densityFactor = Math.min(2, Math.sqrt(stats.density / 10));
        
        // Combined calculation with weights
        const baseSize = 40; // Minimum readable size
        const maxSize = 300; // Maximum before splitting
        
        const calculatedSize = baseSize + 
            (activityFactor * 120) +           // Primary: activity level
            (spatialFactor * 60) +             // Secondary: spatial extent  
            (densityFactor * 40);              // Tertiary: density bonus
        
        const finalSize = Math.max(baseSize, Math.min(maxSize, calculatedSize));
        
        // Determine if cluster should be split
        const shouldSplit = (
            finalSize >= maxSize || 
            stats.radius > this.maxClusterRadius ||
            (clickCount > 20 && stats.eccentricity > 0.7)
        );
        
        console.log(`📏 Size calc: ${clickCount} clicks (${percentage.toFixed(1)}%) → ${finalSize.toFixed(0)}px ${shouldSplit ? '[SPLIT]' : ''}`);
        
        return {
            visualSize: finalSize,
            shouldSplit,
            breakdown: {
                base: baseSize,
                activity: activityFactor * 120,
                spatial: spatialFactor * 60,
                density: densityFactor * 40
            }
        };
    }

    // Generate dynamic shapes
    generateClusterShape(points, centroid, stats) {
        // Determine if shape should be regular or irregular
        const isRegular = stats.compactness > 0.6 && stats.eccentricity < 0.4;
        
        if (isRegular) {
            // Regular polygon
            const sides = Math.max(6, Math.min(12, 6 + Math.floor(stats.density / 5)));
            return {
                type: 'polygon',
                isRegular: true,
                sides,
                wobbleFactor: 0.05 + stats.eccentricity * 0.1
            };
        } else {
            // Irregular shape following point distribution
            const hullPoints = this.convexHull(points);
            return {
                type: 'hull',
                isRegular: false,
                points: hullPoints,
                smoothing: 0.3 + stats.compactness * 0.4
            };
        }
    }

    // Convex hull calculation (Graham scan)
    convexHull(points) {
        if (points.length < 3) return points;
        
        // Find bottom-most point (or left-most in case of tie)
        let start = points.reduce((lowest, p) => 
            p.y < lowest.y || (p.y === lowest.y && p.x < lowest.x) ? p : lowest
        );
        
        // Sort points by polar angle with respect to start point
        const sorted = points
            .filter(p => p !== start)
            .sort((a, b) => {
                const angleA = Math.atan2(a.y - start.y, a.x - start.x);
                const angleB = Math.atan2(b.y - start.y, b.x - start.x);
                return angleA - angleB;
            });
        
        const hull = [start];
        
        for (const point of sorted) {
            // Remove points that would create a right turn
            while (hull.length > 1 && this.crossProduct(
                hull[hull.length - 2], 
                hull[hull.length - 1], 
                point
            ) <= 0) {
                hull.pop();
            }
            hull.push(point);
        }
        
        return hull;
    }

    crossProduct(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    // Cluster optimization and splitting
    optimizeClusters(clusters) {
        const optimized = [];
        
        for (const cluster of clusters) {
            if (cluster.shouldSplit && cluster.count > 4) {
                // Split large clusters
                const subClusters = this.splitCluster(cluster);
                optimized.push(...subClusters);
            } else {
                optimized.push(cluster);
            }
        }
        
        return optimized;
    }

    splitCluster(cluster) {
        // Simple split for now - could be enhanced with k-means
        const subClusters = [];
        
        // For now, just create two smaller clusters
        // In a full implementation, you'd re-run clustering on the cluster's points
        const halfCount = Math.ceil(cluster.count / 2);
        
        subClusters.push({
            ...cluster,
            count: halfCount,
            percentage: Math.round((halfCount / cluster.count) * cluster.percentage),
            visualSize: cluster.visualSize * 0.7,
            id: `${cluster.id}a`
        });
        
        subClusters.push({
            ...cluster,
            x: cluster.x + 0.05, // Offset slightly
            y: cluster.y + 0.05,
            count: cluster.count - halfCount,
            percentage: Math.round(((cluster.count - halfCount) / cluster.count) * cluster.percentage),
            visualSize: cluster.visualSize * 0.7,
            id: `${cluster.id}b`
        });
        
        return subClusters;
    }
}

// Global clusterer instance
const clusterer = new IntelligentClusterer();

// ==================== ENDPOINTS (keeping existing structure) ====================

app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '4.0.0-intelligent',
        uptime: process.uptime(),
        clustering: {
            algorithm: 'DBSCAN + Enhanced Analysis',
            features: ['dynamic_sizing', 'shape_analysis', 'auto_splitting'],
            version: '1.0.0'
        },
        websocket: {
            enabled: !!wss,
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size
        },
        game_data: {
            total_channels: gameState.clicks.size,
            total_clicks: Array.from(gameState.clicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
        }
    });
});

app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');
    try {
        gameState.running = true;
        gameState.clicks.clear();
        gameState.spatialIndex.clear();
        gameState.lastUpdate = Date.now();

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
            error: 'Failed to start session'
        });
    }
});

app.post('/stop', (req, res) => {
    console.log('⏹️ STOP endpoint called');
    try {
        gameState.running = false;
        gameState.lastUpdate = Date.now();

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
            error: 'Failed to stop session'
        });
    }
});

app.post('/reset', (req, res) => {
    console.log('🗑️ RESET endpoint called');
    try {
        gameState.clicks.clear();
        gameState.spatialIndex.clear();
        gameState.lastUpdate = Date.now();

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
            error: 'Failed to reset data'
        });
    }
});

app.post('/click', (req, res) => {
    console.log('🖱️ CLICK endpoint called');
    try {
        if (!gameState.running) {
            return res.status(400).json({
                success: false,
                error: 'Game not running'
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
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
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)})`);

        // Get updated data and broadcast
        const updatedData = getCurrentHeatmapData(channelId);
        broadcastToChannel(channelId, updatedData);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0
        });

    } catch (error) {
        console.error('❌ Click error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token or request'
        });
    }
});

app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%`);

    try {
        const data = getCurrentHeatmapData(channelId, threshold);
        console.log(`✅ Heatmap: ${data.totalClicks} clicks → ${data.clusters.length} intelligent clusters`);
        res.json(data);
    } catch (error) {
        console.error('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data'
        });
    }
});

// ==================== INTELLIGENT DATA PROCESSING ====================

function getCurrentHeatmapData(channelId, threshold = 3) {
    // Aggregate all channels or specific channel
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        gameState.clicks.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = clusterer.clusterPoints(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 15),
            threshold,
            lastUpdate: gameState.lastUpdate,
            algorithm: 'intelligent-v4'
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
            lastUpdate: gameState.lastUpdate,
            algorithm: 'intelligent-v4'
        };
    }

    const points = Array.from(channelClicks.values());
    const clusters = clusterer.clusterPoints(points, threshold);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 15),
        threshold,
        lastUpdate: gameState.lastUpdate,
        algorithm: 'intelligent-v4'
    };
}

// ==================== WEBSOCKET AND SERVER (keeping existing) ====================

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
        console.log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} intelligent clusters`);
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

// Create server and WebSocket setup (keeping existing implementation)
const httpServer = createServer(app);
let wss;

try {
    wss = new WebSocketServer({
        server: httpServer,
        perMessageDeflate: false,
        clientTracking: true
    });
} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// WebSocket handling (keeping existing implementation but updating logs)
httpServer.on('upgrade', (request, socket, head) => {
    if (request.url && request.url.startsWith('/ws/')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws, req) => {
    const startTime = Date.now();
    let channelId = null;
    
    if (req.url) {
        const match = req.url.match(/\/ws\/([^?&\/]+)/);
        if (match) {
            channelId = match[1];
        }
    }

    if (!channelId) {
        ws.close(1008, 'Channel ID required: /ws/CHANNEL_ID');
        return;
    }

    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    console.log(`🔗 WebSocket connected: Channel ${channelId} (Intelligent Clustering v4.0)`);

    // Send initial data
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    ws.on('close', () => {
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
    });

    const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (pingError) {
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

// Error handling and startup
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('SIGTERM', () => {
    console.log('📝 Graceful shutdown...');
    connectedClients.forEach((clients) => {
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
    console.log('🚀 INTELLIGENT CLICKMAP EBS v4.0.0');
    console.log('🧠 Features: DBSCAN Clustering + Dynamic Sizing + Shape Analysis');
    console.log(`📡 Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
});

export default httpServer;
