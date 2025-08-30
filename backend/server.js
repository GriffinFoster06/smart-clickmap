import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

const useRedis = !!process.env.REDIS_URL;
let clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    clicks = new Map();
}

let isRunning = false;
const connectedClients = new Map();

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Enhanced precise clustering algorithm
class PreciseClusterer {
    constructor(points) {
        this.points = points.map((p, i) => ({ ...p, id: i, visited: false, cluster: -1 }));
    }

    calculatePreciseEps() {
        const n = this.points.length;
        if (n < 3) return 0.04; // Smaller default for precision

        // More precise epsilon calculation for close-together clicks
        const k = Math.max(2, Math.min(6, Math.floor(n * 0.12))); // Higher ratio for precision
        const distances = [];

        this.points.forEach(point => {
            const dists = this.points
                .filter(p => p.id !== point.id)
                .map(p => this.distance(point, p))
                .sort((a, b) => a - b)
                .slice(0, k);
            if (dists.length > 0) {
                distances.push(dists[dists.length - 1]);
            }
        });

        distances.sort((a, b) => a - b);

        // More conservative epsilon for better precision
        const percentile = Math.floor(distances.length * 0.6); // Lower percentile
        let optimalEps = distances[percentile] || 0.04;

        // Tighter range for more precise clustering
        return Math.max(0.025, Math.min(0.08, optimalEps));
    }

    distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getNeighbors(point, eps) {
        return this.points.filter(p =>
            p.id !== point.id && this.distance(point, p) <= eps
        );
    }

    calculateClusterMetrics(clusterPoints) {
        if (clusterPoints.length === 0) return { spread: 0, density: 0, centroid: { x: 0, y: 0 } };

        // Calculate centroid
        const centroid = {
            x: clusterPoints.reduce((sum, p) => sum + p.x, 0) / clusterPoints.length,
            y: clusterPoints.reduce((sum, p) => sum + p.y, 0) / clusterPoints.length
        };

        // Calculate spread (how dispersed the clicks are)
        const distances = clusterPoints.map(p => this.distance(p, centroid));
        const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
        const maxDistance = Math.max(...distances);

        // Calculate density (clicks per area)
        const area = Math.PI * maxDistance * maxDistance;
        const density = clusterPoints.length / (area || 0.001);

        return {
            centroid,
            spread: avgDistance,
            maxSpread: maxDistance,
            density,
            compactness: avgDistance / (maxDistance || 0.001) // How compact vs spread out
        };
    }

    cluster() {
        if (this.points.length === 0) return [];

        const eps = this.calculatePreciseEps();
        // More aggressive minPts for precision - don't group tiny clusters too much
        const minPts = Math.max(1, Math.floor(this.points.length * 0.08));

        let clusterId = 0;

        this.points.forEach(point => {
            if (point.visited) return;

            point.visited = true;
            const neighbors = this.getNeighbors(point, eps);

            if (neighbors.length < minPts) {
                point.cluster = -1; // Keep as individual point
            } else {
                this.expandCluster(point, neighbors, clusterId, eps, minPts);
                clusterId++;
            }
        });

        // Process clusters with detailed metrics
        const clusterMap = new Map();
        this.points.forEach(point => {
            if (point.cluster >= 0) {
                if (!clusterMap.has(point.cluster)) {
                    clusterMap.set(point.cluster, []);
                }
                clusterMap.get(point.cluster).push(point);
            }
        });

        const result = [];
        clusterMap.forEach((clusterPoints, clusterId) => {
            const metrics = this.calculateClusterMetrics(clusterPoints);

            result.push({
                x: metrics.centroid.x,
                y: metrics.centroid.y,
                count: clusterPoints.length,
                density: metrics.density,
                spread: metrics.spread,
                maxSpread: metrics.maxSpread,
                compactness: metrics.compactness,
                radius: Math.max(0.02, metrics.maxSpread), // Actual coverage radius
                points: clusterPoints,
                clusterId
            });
        });

        // Handle individual clicks (noise) as micro-clusters for precision
        const individualClicks = this.points.filter(p => p.cluster === -1);
        individualClicks.forEach((point, index) => {
            result.push({
                x: point.x,
                y: point.y,
                count: 1,
                density: 10, // High density for individual precise clicks
                spread: 0.01,
                maxSpread: 0.02,
                compactness: 1,
                radius: 0.025,
                points: [point],
                clusterId: `individual_${index}`
            });
        });

        return result.sort((a, b) => b.count - a.count);
    }

    expandCluster(point, neighbors, clusterId, eps, minPts) {
        point.cluster = clusterId;

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];

            if (!neighbor.visited) {
                neighbor.visited = true;
                const newNeighbors = this.getNeighbors(neighbor, eps);
                if (newNeighbors.length >= minPts) {
                    neighbors.push(...newNeighbors.filter(n =>
                        !neighbors.some(existing => existing.id === n.id)
                    ));
                }
            }

            if (neighbor.cluster === -1 || neighbor.cluster === undefined) {
                neighbor.cluster = clusterId;
            }
        }
    }
}

// WebSocket broadcast function
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (clients) {
        const message = JSON.stringify(data);
        clients.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.send(message);
                } catch (error) {
                    console.error('WebSocket send error:', error);
                    clients.delete(ws);
                }
            }
        });
    }
}

// Enhanced click handling with running state check and instant broadcast
app.post('/click', async (req, res) => {
    try {
        // CHECK IF SYSTEM IS RUNNING FIRST!
        if (!isRunning) {
            return res.status(423).json({ error: 'system is stopped' }); // 423 = Locked
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            return res.status(400).json({ error: 'invalid coordinates' });
        }

        const clickData = { x, y, timestamp: Date.now() };

        if (useRedis) {
            await redis.hSet(`click:${channelId}:${uid}`, clickData);
        } else {
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(uid, clickData);
        }

        // INSTANT UPDATE with precise clustering
        const updatedData = await getHeatmapData(channelId, 3);
        broadcastToChannel(channelId, updatedData);

        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'invalid token' });
    }
});

// Broadcaster controls with improved state management
app.post('/start', async (req, res) => {
    isRunning = true;

    // Clear all existing data
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }

    // Broadcast fresh start to all channels
    connectedClients.forEach((clients, channelId) => {
        broadcastToChannel(channelId, {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: 3,
            message: 'ClickMap started - fresh session!'
        });
    });

    console.log('🎯 ClickMap started - ready for clicks!');
    res.json({ status: 'started', running: true, message: 'System is now accepting clicks' });
});

app.post('/stop', async (req, res) => {
    isRunning = false;

    // Broadcast final results to all channels
    const broadcasts = [];
    connectedClients.forEach(async (clients, channelId) => {
        const data = await getHeatmapData(channelId, 3);
        data.running = false;
        data.message = 'ClickMap stopped - final results shown';
        broadcastToChannel(channelId, data);
        broadcasts.push(channelId);
    });

    console.log(`🛑 ClickMap stopped - final results sent to ${broadcasts.length} channels`);
    res.json({
        status: 'stopped',
        running: false,
        channelsNotified: broadcasts.length,
        message: 'System stopped - no longer accepting clicks'
    });
});

app.post('/reset', async (req, res) => {
    // Clear all data but maintain current running state
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }

    // Broadcast reset to all channels
    connectedClients.forEach((clients, channelId) => {
        broadcastToChannel(channelId, {
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: 3,
            message: `Data reset - system is ${isRunning ? 'running' : 'stopped'}`
        });
    });

    console.log(`🔄 ClickMap data reset - system is ${isRunning ? 'running' : 'stopped'}`);
    res.json({
        status: 'reset',
        running: isRunning,
        message: `Data cleared - system ${isRunning ? 'accepting' : 'not accepting'} clicks`
    });
});

// Helper function with enhanced clustering
async function getHeatmapData(channelId, requestedThreshold = 3) {
    let points = [];
    let userCount = 0;

    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);
        userCount = keys.length;
        for (const k of keys) {
            const data = await redis.hGetAll(k);
            if (data.x && data.y) {
                points.push({
                    x: parseFloat(data.x),
                    y: parseFloat(data.y),
                    timestamp: parseInt(data.timestamp) || Date.now()
                });
            }
        }
    } else {
        const channelClicks = clicks.get(channelId);
        if (channelClicks) {
            userCount = channelClicks.size;
            points = Array.from(channelClicks.values());
        }
    }

    if (points.length === 0) {
        return {
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: requestedThreshold
        };
    }

    // Use precise clustering
    const clusterer = new PreciseClusterer(points);
    const rawClusters = clusterer.cluster();

    const formattedClusters = rawClusters
        .map((cluster, index) => ({
            id: index,
            x: cluster.x,
            y: cluster.y,
            count: cluster.count,
            percentage: Math.round((cluster.count / points.length) * 100),
            density: cluster.density,
            spread: cluster.spread,
            compactness: cluster.compactness,
            radius: cluster.radius,
            isTop: false
        }))
        .filter(cluster => cluster.percentage >= requestedThreshold)
        .sort((a, b) => b.percentage - a.percentage);

    if (formattedClusters.length > 0) {
        formattedClusters[0].isTop = true;
    }

    const coverage = Math.min(100, Math.round((formattedClusters.length / Math.max(1, points.length * 0.1)) * 100));

    return {
        running: isRunning,
        clusters: formattedClusters,
        totalClicks: points.length,
        uniqueUsers: userCount,
        coverage,
        threshold: requestedThreshold
    };
}

// Regular HTTP endpoint
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const requestedThreshold = parseInt(req.query.threshold) || 3;

    if (!channelId) {
        return res.json({
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: requestedThreshold
        });
    }

    const data = await getHeatmapData(channelId, requestedThreshold);
    res.json(data);
});

app.get('/health', (_, res) => res.json({
    status: 'ok',
    running: isRunning,
    timestamp: Date.now(),
    version: '2.2.0',
    clustering: 'precise'
}));

// Create HTTP server
const server = createServer(app);

// WebSocket server for instant updates
const wss = new WebSocketServer({
    server,
    path: '/ws'
});

wss.on('connection', (ws, req) => {
    // Parse robustly
    const url = new URL(req.url, `http://${req.headers.host}`);
    let channelId = url.searchParams.get('channel');

    // Also support /ws/<id> style
    if (!channelId) {
        const parts = url.pathname.split('/').filter(Boolean); // e.g. ["ws","167556274"]
        if (parts[0] === 'ws' && parts[1]) channelId = parts[1];
    }

    if (!channelId) {
        ws.close(1008, 'Channel ID required'); // policy violation (1008) is clearer than 1000
        return;
    }

    // Track client
    if (!connectedClients.has(channelId)) connectedClients.set(channelId, new Set());
    connectedClients.get(channelId).add(ws);

    console.log(`📡 WebSocket client connected to channel: ${channelId}`);

    // Send initial snapshot
    getHeatmapData(channelId, 3).then(data => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    });

    // Optional: keep-alive to survive proxies
    const interval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            try { ws.ping(); } catch { }
        }
    }, 30000);

    ws.on('close', () => {
        clearInterval(interval);
        const set = connectedClients.get(channelId);
        if (set) {
            set.delete(ws);
            if (set.size === 0) connectedClients.delete(channelId);
        }
        console.log(`📡 WebSocket client disconnected from: ${channelId}`);
    });
});


server.listen(PORT, () => {
    console.log('🚀 Precise ClickMap EBS v2.2.0 running on port', PORT);
    console.log('📊 Redis:', useRedis ? 'enabled' : 'disabled');
    console.log('🎯 Enhanced precision clustering for close-together clicks');
});

export default server;