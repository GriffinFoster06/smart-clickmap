import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { getClusterRadius, clusterClicks } from './clusterUtils.js';

const PORT = process.env.PORT || 8080;
const GRID = Number(process.env.GRID_SIZE) || 100;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

const useRedis = !!process.env.REDIS_URL;
let clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    clicks = new Map();  // userId → { x, y }
}

let isRunning = false;

// --- Standard app setup ---
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

// --- Click Handling ---
app.post('/click', (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });

        if (useRedis) {
            redis.hSet(`click:${channelId}:${uid}`, { x, y });
        } else {
            if (!clicks.has(channelId)) clicks.set(channelId, new Map());
            clicks.get(channelId).set(uid, { x, y });
        }

        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'jwt' });
    }
});

// --- Broadcaster controls ---
app.post('/start', (_, res) => {
    isRunning = true;
    if (!useRedis) clicks.clear();
    res.send('started');
});

app.post('/stop', (_, res) => {
    isRunning = false;
    res.send('stopped');
});

app.post('/reset', (_, res) => {
    if (!useRedis) clicks.clear();
    res.send('reset');
});

app.get('/health', (_, res) => res.send('ok'));

// --- Clustering Utilities (imported from clusterUtils.js) ---

// --- /heatmap dynamic clustering ---
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    if (!channelId) {
        return res.json({ running: isRunning, blobs: [], totalClicks: 0 });
    }

    let pts = [];

    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);
        for (const k of keys) {
            const { x, y } = await redis.hGetAll(k);
            pts.push({ x: parseFloat(x), y: parseFloat(y) });
        }
    } else {
        if (clicks.has(channelId)) {
            pts = Array.from(clicks.get(channelId).values());
        }
    }

    const totalClicks = pts.length;

    if (totalClicks === 0) {
        return res.json({ running: isRunning, blobs: [], totalClicks: 0 });
    }

    const radius = getClusterRadius(pts);
    let blobs = clusterClicks(pts, radius);

    if (blobs.length === 0 && pts.length > 0) {
        blobs = pts.map(p => ({ x: p.x, y: p.y, count: 1 }));
    }

    blobs.sort((a, b) => b.count - a.count);

    const payload = blobs
        .map((b, i) => ({
            x: b.x,
            y: b.y,
            pct: Math.round((b.count / totalClicks) * 100),
            isTop: i === 0
        }))
        .filter(b => b.pct >= 5 || b.isTop);

    res.json({ running: isRunning, blobs: payload, totalClicks });
});

// --- WebSocket server (if needed) ---
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => console.log('EBS on', PORT));
}

export default app;
