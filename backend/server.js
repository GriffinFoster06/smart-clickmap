import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

const useRedis = !!process.env.REDIS_URL;
let clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    clicks = new Map(); // channelId → Map(userId → { x, y, timestamp })
}

let isRunning = false;

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

// Enhanced clustering algorithm - density-based with adaptive parameters
class DensityClusterer {
    constructor(points) {
        this.points = points.map((p, i) => ({ ...p, id: i, visited: false, cluster: -1 }));
        this.clusters = [];
    }

    // Calculate optimal epsilon based on k-distance graph
    calculateOptimalEps() {
        const n = this.points.length;
        if (n < 4) return 0.05;

        const k = Math.max(3, Math.min(10, Math.floor(n * 0.1))); // Adaptive k
        const distances = [];

        this.points.forEach(point => {
            const dists = this.points
                .filter(p => p.id !== point.id)
                .map(p => this.distance(point, p))
                .sort((a, b) => a - b)
                .slice(0, k);
            distances.push(dists[dists.length - 1]);
        });

        distances.sort((a, b) => a - b);

        // Find the "elbow" in the k-distance graph
        let maxChange = 0;
        let optimalEps = distances[Math.floor(distances.length * 0.8)];

        for (let i = 1; i < distances.length - 1; i++) {
            const change = distances[i + 1] - distances[i - 1];
            if (change > maxChange) {
                maxChange = change;
                optimalEps = distances[i];
            }
        }

        return Math.max(0.02, Math.min(0.15, optimalEps));
    }

    distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getNeighbors(point, eps) {
        return this.points.filter(p =>
            p.id !== point.id && this.distance(point, p) <= eps
        );
    }

    cluster() {
        if (this.points.length === 0) return [];

        const eps = this.calculateOptimalEps();
        const minPts = Math.max(2, Math.floor(this.points.length * 0.05)); // Dynamic minPts

        let clusterId = 0;

        this.points.forEach(point => {
            if (point.visited) return;

            point.visited = true;
            const neighbors = this.getNeighbors(point, eps);

            if (neighbors.length < minPts) {
                point.cluster = -1; // Noise
            } else {
                this.expandCluster(point, neighbors, clusterId, eps, minPts);
                clusterId++;
            }
        });

        // Convert to cluster format
        const clusterMap = new Map();
        this.points.forEach(point => {
            if (point.cluster >= 0) {
                if (!clusterMap.has(point.cluster)) {
                    clusterMap.set(point.cluster, []);
                }
                clusterMap.get(point.cluster).push(point);
            }
        });

        // Calculate weighted centers and sizes
        const result = [];
        clusterMap.forEach(clusterPoints => {
            const totalWeight = clusterPoints.length;
            const centroid = {
                x: clusterPoints.reduce((sum, p) => sum + p.x, 0) / totalWeight,
                y: clusterPoints.reduce((sum, p) => sum + p.y, 0) / totalWeight,
                count: totalWeight,
                density: totalWeight / (Math.PI * eps * eps), // Density metric
                radius: eps,
                points: clusterPoints
            };
            result.push(centroid);
        });

        // Add significant isolated points as micro-clusters
        const noise = this.points.filter(p => p.cluster === -1);
        noise.forEach(point => {
            result.push({
                x: point.x,
                y: point.y,
                count: 1,
                density: 1,
                radius: eps * 0.5,
                points: [point]
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

// Click handling with improved data structure
app.post('/click', (req, res) => {
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
            redis.hSet(`click:${channelId}:${uid}`, clickData);
        } else {
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(uid, clickData);
        }

        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'invalid token' });
    }
});

// Broadcaster controls
app.post('/start', async (req, res) => {
    isRunning = true;
    // Clear old data when starting fresh
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }
    res.json({ status: 'started' });
});

app.post('/stop', (_, res) => {
    isRunning = false;
    res.json({ status: 'stopped' });
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
    res.json({ status: 'reset' });
});

// Enhanced heatmap endpoint with better data processing
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    if (!channelId) {
        return res.json({
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0
        });
    }

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
        return res.json({
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0
        });
    }

    // Use enhanced clustering
    const clusterer = new DensityClusterer(points);
    const clusters = clusterer.cluster();

    // Calculate coverage (percentage of screen area with activity)
    const coverage = Math.min(100, (clusters.length * 5)); // Rough estimate

    // Format clusters for frontend with enhanced data
    const formattedClusters = clusters.map((cluster, index) => ({
        id: index,
        x: cluster.x,
        y: cluster.y,
        count: cluster.count,
        percentage: Math.round((cluster.count / points.length) * 100),
        density: cluster.density,
        radius: cluster.radius,
        isTop: index === 0,
        intensity: Math.min(1, cluster.count / Math.max(1, points.length * 0.1))
    }));

    res.json({
        running: isRunning,
        clusters: formattedClusters,
        totalClicks: points.length,
        uniqueUsers: userCount,
        coverage: Math.round(coverage)
    });
});

app.get('/health', (_, res) => res.json({
    status: 'ok',
    running: isRunning,
    timestamp: Date.now()
}));

const server = app.listen(PORT, () => {
    console.log(`🚀 Smart ClickMap EBS running on port ${PORT}`);
    console.log(`📊 Redis: ${useRedis ? 'enabled' : 'disabled'}`);
});