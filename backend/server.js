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

// Enhanced clustering algorithm for precise target separation
class PreciseClusterer {
    constructor(points) {
        this.points = points.map((p, i) => ({ ...p, id: i, visited: false, cluster: -1 }));
        this.clusters = [];
    }

    // Calculate adaptive epsilon based on local density patterns
    calculateAdaptiveEps() {
        const n = this.points.length;
        if (n < 3) return 0.08; // Larger threshold for very few points

        // Calculate distances to nearest neighbors
        const nearestDistances = [];
        this.points.forEach(point => {
            const distances = this.points
                .filter(p => p.id !== point.id)
                .map(p => this.distance(point, p))
                .sort((a, b) => a - b);

            // Get distance to 2nd nearest neighbor (more stable than 1st)
            if (distances.length >= 2) {
                nearestDistances.push(distances[1]);
            }
        });

        nearestDistances.sort((a, b) => a - b);

        // Use a more conservative approach - smaller clusters
        const medianDistance = nearestDistances[Math.floor(nearestDistances.length / 2)] || 0.05;

        // Cap the epsilon to maintain distinct targets
        return Math.max(0.025, Math.min(0.08, medianDistance * 0.8));
    }

    distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // Use a grid-based pre-clustering to maintain target separation
    gridPreCluster() {
        const GRID_SIZE = 20; // 20x20 grid
        const grid = new Map();

        this.points.forEach(point => {
            const gridX = Math.floor(point.x * GRID_SIZE);
            const gridY = Math.floor(point.y * GRID_SIZE);
            const key = `${gridX},${gridY}`;

            if (!grid.has(key)) {
                grid.set(key, []);
            }
            grid.get(key).push(point);
        });

        // Process each grid cell separately to maintain locality
        const preClusters = [];
        grid.forEach(cellPoints => {
            if (cellPoints.length === 1) {
                preClusters.push({
                    points: cellPoints,
                    center: cellPoints[0]
                });
            } else {
                // For multiple points in same cell, use very tight clustering
                const tightClusters = this.tightCluster(cellPoints);
                preClusters.push(...tightClusters);
            }
        });

        return preClusters;
    }

    tightCluster(points) {
        if (points.length <= 1) {
            return points.map(p => ({ points: [p], center: p }));
        }

        const eps = 0.035; // Very tight clustering within grid cells
        const minPts = Math.max(2, Math.floor(points.length * 0.3));

        let clusterId = 0;
        points.forEach(p => { p.visited = false; p.cluster = -1; });

        points.forEach(point => {
            if (point.visited) return;

            point.visited = true;
            const neighbors = this.getNeighbors(point, points, eps);

            if (neighbors.length < minPts) {
                point.cluster = -1; // Keep as individual point
            } else {
                this.expandCluster(point, neighbors, points, clusterId, eps, minPts);
                clusterId++;
            }
        });

        // Convert to cluster format
        const clusterMap = new Map();
        points.forEach(point => {
            const id = point.cluster >= 0 ? point.cluster : `noise_${point.id}`;
            if (!clusterMap.has(id)) {
                clusterMap.set(id, []);
            }
            clusterMap.get(id).push(point);
        });

        const result = [];
        clusterMap.forEach(clusterPoints => {
            const center = {
                x: clusterPoints.reduce((sum, p) => sum + p.x, 0) / clusterPoints.length,
                y: clusterPoints.reduce((sum, p) => sum + p.y, 0) / clusterPoints.length
            };
            result.push({ points: clusterPoints, center });
        });

        return result;
    }

    getNeighbors(point, points, eps) {
        return points.filter(p =>
            p.id !== point.id && this.distance(point, p) <= eps
        );
    }

    expandCluster(point, neighbors, points, clusterId, eps, minPts) {
        point.cluster = clusterId;

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];

            if (!neighbor.visited) {
                neighbor.visited = true;
                const newNeighbors = this.getNeighbors(neighbor, points, eps);
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

    // Main clustering method with enhanced precision
    cluster() {
        if (this.points.length === 0) return [];

        // Use grid pre-clustering for better target separation
        const preClusters = this.gridPreCluster();

        const result = preClusters.map(preCluster => {
            const points = preCluster.points;
            return {
                x: preCluster.center.x,
                y: preCluster.center.y,
                count: points.length,
                density: points.length,
                radius: this.calculateClusterRadius(points.length),
                points: points,
                // Add spread metric to identify tight vs loose clusters
                spread: this.calculateSpread(points)
            };
        });

        // Sort by count, but prioritize tighter clusters for same count
        return result.sort((a, b) => {
            if (a.count !== b.count) return b.count - a.count;
            return a.spread - b.spread; // Tighter clusters first
        });
    }

    calculateSpread(points) {
        if (points.length <= 1) return 0;

        const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

        const avgDistance = points.reduce((sum, p) => {
            return sum + this.distance(p, { x: centerX, y: centerY });
        }, 0) / points.length;

        return avgDistance;
    }

    calculateClusterRadius(count) {
        // Smaller base radius to keep targets distinct
        return Math.max(0.02, Math.min(0.06, 0.025 + (count * 0.008)));
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

// Enhanced click handling with instant broadcast
app.post('/click', async (req, res) => {
    try {
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

// Broadcaster controls
app.post('/start', async (req, res) => {
    isRunning = true;
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }

    connectedClients.forEach((clients, channelId) => {
        broadcastToChannel(channelId, { running: true, clusters: [], totalClicks: 0, uniqueUsers: 0 });
    });

    res.json({ status: 'started', running: true });
});

app.post('/stop', async (_, res) => {
    isRunning = false;

    connectedClients.forEach((clients, channelId) => {
        const data = getHeatmapData(channelId, 3);
        data.running = false;
        broadcastToChannel(channelId, data);
    });

    res.json({ status: 'stopped', running: false });
});

app.post('/reset', async (req, res) => {
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }

    connectedClients.forEach((clients, channelId) => {
        broadcastToChannel(channelId, { running: isRunning, clusters: [], totalClicks: 0, uniqueUsers: 0 });
    });

    res.json({ status: 'reset' });
});

// Enhanced heatmap data generation with precise clustering
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

    // Use precise clustering algorithm
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
            radius: cluster.radius,
            spread: cluster.spread,
            isTop: false,
            // Add confidence metric - tighter clusters are more confident targets
            confidence: Math.max(0.1, Math.min(1.0, 1.0 - (cluster.spread * 10)))
        }))
        .filter(cluster => cluster.percentage >= requestedThreshold)
        .sort((a, b) => {
            // Sort by percentage first, then by confidence for same percentage
            if (a.percentage !== b.percentage) return b.percentage - a.percentage;
            return b.confidence - a.confidence;
        });

    if (formattedClusters.length > 0) {
        formattedClusters[0].isTop = true;
    }

    const coverage = Math.min(100, Math.round((formattedClusters.length / Math.max(1, points.length * 0.15)) * 100));

    return {
        running: isRunning,
        clusters: formattedClusters,
        totalClicks: points.length,
        uniqueUsers: userCount,
        coverage,
        threshold: requestedThreshold,
        algorithm: 'precise-grid-clustering'
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
    clustering: 'precise-grid-based',
    features: [
        'websocket-realtime',
        'grid-clustering',
        'target-separation',
        'confidence-scoring'
    ]
}));

// Create HTTP server and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({
    server,
    path: '/ws'
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');
    const channelId = pathParts[pathParts.length - 1];

    if (!channelId || channelId === 'ws') {
        ws.close(1000, 'Channel ID required');
        return;
    }

    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    console.log(`📡 WebSocket client connected to channel: ${channelId}`);

    getHeatmapData(channelId, 3).then(data => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });

    ws.on('close', () => {
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`📡 WebSocket client disconnected from: ${channelId}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

server.listen(PORT, () => {
    console.log('🚀 Enhanced ClickMap EBS v2.2.0 running on port', PORT);
    console.log('📊 Redis:', useRedis ? 'enabled' : 'disabled');
    console.log('📡 WebSocket server enabled');
    console.log('🎯 Precise grid-based clustering (20x20 grid)');
    console.log('🔍 Enhanced target separation for close interactions');
    console.log('📈 Confidence scoring for cluster quality');
});

export default server;