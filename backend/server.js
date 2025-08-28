import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const GRID = Number(process.env.GRID_SIZE) || 100;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

const useRedis = !!process.env.REDIS_URL;
let clicks;
let redis;
let activeChannels = new Map(); // channelId -> { users: Set, lastActivity: Date }

if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    clicks = new Map();  // channelId -> Map(userId -> { x, y, timestamp })
}

let isRunning = false;
let settings = {
    fadeTime: 60000, // 1 minute
    minClusterSize: 3,
    maxClusters: 10,
    heatmapIntensity: 0.8
};

// --- Enhanced app setup ---
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// --- WebSocket handling ---
const clients = new Map(); // channelId -> Set of ws connections

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channelId = url.searchParams.get('channel');

    if (!channelId) {
        ws.close(1008, 'Channel ID required');
        return;
    }

    if (!clients.has(channelId)) {
        clients.set(channelId, new Set());
    }
    clients.get(channelId).add(ws);

    ws.on('close', () => {
        if (clients.has(channelId)) {
            clients.get(channelId).delete(ws);
            if (clients.get(channelId).size === 0) {
                clients.delete(channelId);
            }
        }
    });

    ws.on('error', console.error);
});

function broadcastToChannel(channelId, data) {
    if (clients.has(channelId)) {
        const message = JSON.stringify(data);
        clients.get(channelId).forEach(ws => {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            }
        });
    }
}

// --- Enhanced Click Handling ---
app.post('/click', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;
        const timestamp = Date.now();

        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });

        if (x < 0 || x > 1 || y < 0 || y > 1)
            return res.status(400).json({ error: 'coords out of bounds' });

        if (!isRunning)
            return res.status(400).json({ error: 'not running' });

        // Track active users
        if (!activeChannels.has(channelId)) {
            activeChannels.set(channelId, { users: new Set(), lastActivity: new Date() });
        }
        activeChannels.get(channelId).users.add(uid);
        activeChannels.get(channelId).lastActivity = new Date();

        const clickData = { x, y, timestamp, uid };

        if (useRedis) {
            await redis.hSet(`click:${channelId}:${uid}`, clickData);
            await redis.expire(`click:${channelId}:${uid}`, Math.ceil(settings.fadeTime / 1000));
        } else {
            if (!clicks.has(channelId)) clicks.set(channelId, new Map());
            clicks.get(channelId).set(uid, clickData);
        }

        // Broadcast real-time click to connected clients
        broadcastToChannel(channelId, {
            type: 'click',
            data: { x, y, uid, timestamp }
        });

        return res.sendStatus(200);
    } catch (e) {
        console.error('Click error:', e);
        return res.status(401).json({ error: 'jwt' });
    }
});

// --- Enhanced Broadcaster controls ---
app.post('/start', (req, res) => {
    isRunning = true;
    if (!useRedis) {
        clicks.clear();
        activeChannels.clear();
    }

    // Broadcast to all clients
    clients.forEach((channelClients, channelId) => {
        broadcastToChannel(channelId, {
            type: 'status',
            data: { running: true }
        });
    });

    res.json({ running: true, message: 'started' });
});

app.post('/stop', (req, res) => {
    isRunning = false;

    // Broadcast to all clients
    clients.forEach((channelClients, channelId) => {
        broadcastToChannel(channelId, {
            type: 'status',
            data: { running: false }
        });
    });

    res.json({ running: false, message: 'stopped' });
});

app.post('/reset', async (req, res) => {
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
        activeChannels.clear();
    }

    // Broadcast reset to all clients
    clients.forEach((channelClients, channelId) => {
        broadcastToChannel(channelId, {
            type: 'reset',
            data: {}
        });
    });

    res.json({ message: 'reset complete' });
});

// --- Settings endpoint ---
app.put('/settings', (req, res) => {
    const { fadeTime, minClusterSize, maxClusters, heatmapIntensity } = req.body;

    if (fadeTime && fadeTime > 0) settings.fadeTime = fadeTime;
    if (minClusterSize && minClusterSize > 0) settings.minClusterSize = minClusterSize;
    if (maxClusters && maxClusters > 0) settings.maxClusters = maxClusters;
    if (heatmapIntensity && heatmapIntensity >= 0 && heatmapIntensity <= 1) {
        settings.heatmapIntensity = heatmapIntensity;
    }

    res.json(settings);
});

app.get('/settings', (req, res) => {
    res.json(settings);
});

app.get('/health', (_, res) => res.json({ status: 'ok', running: isRunning }));

// --- Enhanced Clustering Utilities ---
function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function getClusterRadius(clicks) {
    const n = clicks.length;
    if (n === 0) return 0.05;
    if (n === 1) return 0.03;

    // Calculate average distance between all points
    let totalDistance = 0;
    let pairs = 0;

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            totalDistance += distance(clicks[i], clicks[j]);
            pairs++;
        }
    }

    const avgDistance = totalDistance / pairs;

    // Dynamic radius based on density
    if (avgDistance < 0.1) return 0.025; // Very tight
    if (avgDistance < 0.2) return 0.035; // Tight
    if (avgDistance < 0.4) return 0.05;  // Normal
    return 0.07; // Spread out
}

function enhancedClusterClicks(points, radius, minSize = 3) {
    if (points.length === 0) return [];

    const clusters = [];
    const processed = new Set();

    points.forEach((point, i) => {
        if (processed.has(i)) return;

        const cluster = {
            x: point.x,
            y: point.y,
            count: 1,
            points: [point],
            recency: 1 - (Date.now() - point.timestamp) / settings.fadeTime
        };

        // Find nearby points
        for (let j = i + 1; j < points.length; j++) {
            if (processed.has(j)) continue;

            if (distance(point, points[j]) < radius) {
                const recency = 1 - (Date.now() - points[j].timestamp) / settings.fadeTime;

                // Weighted average for cluster center
                cluster.x = (cluster.x * cluster.count + points[j].x) / (cluster.count + 1);
                cluster.y = (cluster.y * cluster.count + points[j].y) / (cluster.count + 1);
                cluster.count++;
                cluster.points.push(points[j]);
                cluster.recency += recency;
                processed.add(j);
            }
        }

        cluster.recency /= cluster.count; // Average recency

        // Only add clusters that meet minimum size or are very recent
        if (cluster.count >= minSize || cluster.recency > 0.8) {
            clusters.push(cluster);
        }

        processed.add(i);
    });

    // Sort by count and recency
    clusters.sort((a, b) => {
        const scoreA = a.count * 0.7 + a.recency * 0.3;
        const scoreB = b.count * 0.7 + b.recency * 0.3;
        return scoreB - scoreA;
    });

    return clusters.slice(0, settings.maxClusters);
}

// --- Enhanced /heatmap endpoint ---
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;

    if (!channelId) {
        return res.json({
            running: isRunning,
            blobs: [],
            totalClicks: 0,
            uniqueUsers: 0,
            settings
        });
    }

    let pts = [];
    const now = Date.now();

    try {
        if (useRedis) {
            const keys = await redis.keys(`click:${channelId}:*`);
            for (const key of keys) {
                const data = await redis.hGetAll(key);
                if (data.x && data.y) {
                    const timestamp = parseInt(data.timestamp) || now;
                    if (now - timestamp < settings.fadeTime) {
                        pts.push({
                            x: parseFloat(data.x),
                            y: parseFloat(data.y),
                            timestamp,
                            uid: data.uid
                        });
                    }
                }
            }
        } else {
            if (clicks.has(channelId)) {
                for (const [uid, clickData] of clicks.get(channelId)) {
                    if (now - clickData.timestamp < settings.fadeTime) {
                        pts.push({ ...clickData, uid });
                    }
                }
            }
        }

        // Clean up old clicks
        if (!useRedis) {
            pts = pts.filter(p => now - p.timestamp < settings.fadeTime);
            if (clicks.has(channelId)) {
                for (const [uid, clickData] of clicks.get(channelId)) {
                    if (now - clickData.timestamp >= settings.fadeTime) {
                        clicks.get(channelId).delete(uid);
                    }
                }
            }
        }

        const totalClicks = pts.length;
        const uniqueUsers = new Set(pts.map(p => p.uid)).size;

        if (totalClicks === 0) {
            return res.json({
                running: isRunning,
                blobs: [],
                totalClicks: 0,
                uniqueUsers: 0,
                settings
            });
        }

        const radius = getClusterRadius(pts);
        let clusters = enhancedClusterClicks(pts, radius, settings.minClusterSize);

        const blobs = clusters.map((cluster, i) => ({
            x: cluster.x,
            y: cluster.y,
            count: cluster.count,
            pct: Math.round((cluster.count / totalClicks) * 100),
            intensity: Math.min(1, cluster.count / 10),
            recency: cluster.recency,
            isTop: i === 0,
            rank: i + 1
        }));

        res.json({
            running: isRunning,
            blobs,
            totalClicks,
            uniqueUsers,
            settings,
            timestamp: now
        });

    } catch (error) {
        console.error('Heatmap error:', error);
        res.status(500).json({ error: 'Failed to generate heatmap' });
    }
});

// --- Statistics endpoint ---
app.get('/stats/:channelId', (req, res) => {
    const { channelId } = req.params;
    const channelData = activeChannels.get(channelId);

    res.json({
        activeUsers: channelData ? channelData.users.size : 0,
        lastActivity: channelData ? channelData.lastActivity : null,
        isRunning
    });
});

// Cleanup old channel data periodically
setInterval(() => {
    const cutoff = Date.now() - 300000; // 5 minutes
    for (const [channelId, data] of activeChannels) {
        if (data.lastActivity.getTime() < cutoff) {
            activeChannels.delete(channelId);
        }
    }
}, 60000); // Run every minute

server.listen(PORT, () => {
    console.log(`🚀 Smart ClickMap EBS running on port ${PORT}`);
    console.log(`📊 Redis: ${useRedis ? 'Enabled' : 'Disabled (In-memory)'}`);
    console.log(`⚡ WebSocket: Enabled`);
});