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
    clicks = new Map(); // Map<channelId, Map<userId, {x,y,timestamp}>>
}

// --- Per-channel running state ---
const isRunningByChannel = new Map(); // Map<channelId, boolean>
const connectedClients = new Map();   // Map<channelId, Set<ws>>

function getRunning(channelId) {
    return !!isRunningByChannel.get(channelId);
}
function setRunning(channelId, value) {
    isRunningByChannel.set(channelId, !!value);
}
async function clearChannelStorage(channelId) {
    if (!channelId) return;
    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);
        if (keys.length > 0) await redis.del(keys);
    } else {
        clicks.delete(channelId);
    }
}
function resolveChannelIdFromReq(req) {
    // Try query params first (?channel= / ?login= / ?id=)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const qp = url.searchParams;
    const qChan = qp.get('channel') || qp.get('login') || qp.get('id');
    if (qChan) return qChan;

    // Fallback to JWT (for POST /click or when auth header present)
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    if (auth) {
        try {
            const payload = jwt.verify(auth, SECRET, { algorithms: ['HS256'] });
            return payload.channel_id || null;
        } catch { }
    }
    return null;
}

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

// ---------- Clustering ----------
class PreciseClusterer {
    constructor(points) {
        this.points = points.map((p, i) => ({ ...p, id: i, visited: false, cluster: -1 }));
    }
    calculatePreciseEps() {
        const n = this.points.length;
        if (n < 3) return 0.04;
        const k = Math.max(2, Math.min(6, Math.floor(n * 0.12)));
        const distances = [];
        this.points.forEach(point => {
            const dists = this.points
                .filter(p => p.id !== point.id)
                .map(p => this.distance(point, p))
                .sort((a, b) => a - b)
                .slice(0, k);
            if (dists.length > 0) distances.push(dists[dists.length - 1]);
        });
        distances.sort((a, b) => a - b);
        const percentile = Math.floor(distances.length * 0.6);
        const optimal = distances[percentile] || 0.04;
        return Math.max(0.025, Math.min(0.08, optimal));
    }
    distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    getNeighbors(point, eps) { return this.points.filter(p => p.id !== point.id && this.distance(point, p) <= eps); }
    calculateClusterMetrics(clusterPoints) {
        if (clusterPoints.length === 0) return { spread: 0, density: 0, centroid: { x: 0, y: 0 } };
        const centroid = {
            x: clusterPoints.reduce((s, p) => s + p.x, 0) / clusterPoints.length,
            y: clusterPoints.reduce((s, p) => s + p.y, 0) / clusterPoints.length
        };
        const distances = clusterPoints.map(p => this.distance(p, centroid));
        const avgDistance = distances.reduce((s, d) => s + d, 0) / distances.length;
        const maxDistance = Math.max(...distances);
        const area = Math.PI * maxDistance * maxDistance;
        const density = clusterPoints.length / (area || 0.001);
        return {
            centroid,
            spread: avgDistance,
            maxSpread: maxDistance,
            density,
            compactness: avgDistance / (maxDistance || 0.001)
        };
    }
    expandCluster(point, neighbors, clusterId, eps, minPts) {
        point.cluster = clusterId;
        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (!neighbor.visited) {
                neighbor.visited = true;
                const newNeighbors = this.getNeighbors(neighbor, eps);
                if (newNeighbors.length >= minPts) {
                    neighbors.push(...newNeighbors.filter(n => !neighbors.some(e => e.id === n.id)));
                }
            }
            if (neighbor.cluster === -1 || neighbor.cluster === undefined) {
                neighbor.cluster = clusterId;
            }
        }
    }
    cluster() {
        if (this.points.length === 0) return [];
        const eps = this.calculatePreciseEps();
        const minPts = Math.max(1, Math.floor(this.points.length * 0.08));
        let clusterId = 0;
        this.points.forEach(point => {
            if (point.visited) return;
            point.visited = true;
            const neighbors = this.getNeighbors(point, eps);
            if (neighbors.length < minPts) {
                point.cluster = -1;
            } else {
                this.expandCluster(point, neighbors, clusterId, eps, minPts);
                clusterId++;
            }
        });
        const clusterMap = new Map();
        this.points.forEach(point => {
            if (point.cluster >= 0) {
                if (!clusterMap.has(point.cluster)) clusterMap.set(point.cluster, []);
                clusterMap.get(point.cluster).push(point);
            }
        });
        const result = [];
        clusterMap.forEach((clusterPoints, id) => {
            const metrics = this.calculateClusterMetrics(clusterPoints);
            result.push({
                x: metrics.centroid.x,
                y: metrics.centroid.y,
                count: clusterPoints.length,
                density: metrics.density,
                spread: metrics.spread,
                maxSpread: metrics.maxSpread,
                compactness: metrics.compactness,
                radius: Math.max(0.02, metrics.maxSpread),
                points: clusterPoints,
                clusterId: id
            });
        });
        const individuals = this.points.filter(p => p.cluster === -1);
        individuals.forEach((point, idx) => {
            result.push({
                x: point.x,
                y: point.y,
                count: 1,
                density: 10,
                spread: 0.01,
                maxSpread: 0.02,
                compactness: 1,
                radius: 0.025,
                points: [point],
                clusterId: `individual_${idx}`
            });
        });
        return result.sort((a, b) => b.count - a.count);
    }
}

// ---------- WS broadcast ----------
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients) return;
    const message = JSON.stringify(data);
    clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            try { ws.send(message); }
            catch (err) {
                console.error('WebSocket send error:', err);
                clients.delete(ws);
            }
        }
    });
}

// ---------- Routes ----------
app.post('/click', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });

        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x > 1 || y < 0 || y > 1) {
            return res.status(400).json({ error: 'invalid coordinates' });
        }

        // Gate by per-channel running state
        if (!getRunning(channelId)) {
            return res.status(202).json({ ignored: true, reason: 'channel_stopped' });
        }

        const clickData = { x, y, timestamp: Date.now() };
        if (useRedis) {
            await redis.hSet(`click:${channelId}:${uid}`, clickData);
        } else {
            if (!clicks.has(channelId)) clicks.set(channelId, new Map());
            clicks.get(channelId).set(uid, clickData);
        }

        const updatedData = await getHeatmapData(channelId, 3);
        broadcastToChannel(channelId, updatedData);
        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'invalid token' });
    }
});

// Start/stop/reset are now channel-aware
app.post('/start', async (req, res) => {
    const channelId = resolveChannelIdFromReq(req);
    if (!channelId) return res.status(400).json({ error: 'missing channel' });

    setRunning(channelId, true);
    await clearChannelStorage(channelId);

    broadcastToChannel(channelId, { running: true, clusters: [], totalClicks: 0, uniqueUsers: 0, coverage: 0 });
    res.json({ status: 'started', running: true, channel: channelId });
});

app.post('/stop', async (req, res) => {
    const channelId = resolveChannelIdFromReq(req);
    if (!channelId) return res.status(400).json({ error: 'missing channel' });

    setRunning(channelId, false);

    const data = await getHeatmapData(channelId, 3);
    data.running = false;
    broadcastToChannel(channelId, data);

    res.json({ status: 'stopped', running: false, channel: channelId });
});

app.post('/reset', async (req, res) => {
    const channelId = resolveChannelIdFromReq(req);
    if (!channelId) return res.status(400).json({ error: 'missing channel' });

    await clearChannelStorage(channelId);

    broadcastToChannel(channelId, { running: getRunning(channelId), clusters: [], totalClicks: 0, uniqueUsers: 0, coverage: 0 });
    res.json({ status: 'reset', channel: channelId });
});

// Heatmap now reflects per-channel running state
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const requestedThreshold = parseInt(req.query.threshold) || 3;

    if (!channelId) {
        return res.json({
            running: false,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: requestedThreshold
        });
    }

    const data = await getHeatmapData(channelId, requestedThreshold);
    data.running = getRunning(channelId);
    res.json(data);
});

app.get('/health', (_, res) => res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '2.3.0',
    clustering: 'precise'
}));

// ---------- Heatmap helper ----------
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
            running: getRunning(channelId),
            clusters: [],
            totalClicks: 0,
            uniqueUsers: userCount,
            coverage: 0,
            threshold: requestedThreshold
        };
    }

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
        running: getRunning(channelId),
        clusters: formattedClusters,
        totalClicks: points.length,
        uniqueUsers: userCount,
        coverage,
        threshold: requestedThreshold
    };
}

// ---------- HTTP + WS Server ----------
const server = createServer(app);

// Accept ANY path and parse the channel from either /ws/<id> or ?channel=<id>
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let channelId = url.searchParams.get('channel');
    if (!channelId) {
        const parts = url.pathname.split('/').filter(Boolean); // e.g. ["ws","167556274"]
        if (parts[0]) {
            // support /ws/<id> or /<id>
            if (parts[0] === 'ws' && parts[1]) channelId = parts[1];
            else if (parts[0] && !parts[1]) channelId = parts[0]; // bare "/<id>"
        }
    }

    if (!channelId) {
        ws.close(1008, 'Channel ID required');
        return;
    }

    if (!connectedClients.has(channelId)) connectedClients.set(channelId, new Set());
    connectedClients.get(channelId).add(ws);

    console.log(`📡 WebSocket client connected to channel: ${channelId}`);

    getHeatmapData(channelId, 3).then(data => {
        if (ws.readyState === ws.OPEN) {
            data.running = getRunning(channelId);
            ws.send(JSON.stringify(data));
        }
    });

    // Keep-alive pings to satisfy proxies
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
    console.log('🚀 Precise ClickMap EBS v2.3.0 running on port', PORT);
    console.log('📊 Redis:', useRedis ? 'enabled' : 'disabled');
    console.log('🎯 Enhanced precision clustering for close-together clicks');
});

export default server;
