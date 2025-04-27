import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';

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
        const uid = payload.user_id || payload.opaque_user_id;  // 🔥 FIX HERE

        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });

        if (useRedis) {
            redis.hSet(`click:${uid}`, { x, y });
        } else {
            clicks.set(uid, { x, y });
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

// --- Clustering Utilities ---
function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function getClusterRadius(clicks) {
    const n = clicks.length;
    if (n === 0) return 0.05;

    let avgDist = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            avgDist += distance(clicks[i], clicks[j]);
        }
    }
    avgDist /= (n * (n - 1) / 2);

    // Base it on average distance between clicks
    if (avgDist < 0.05) return 0.01;  // Tight cluster
    if (avgDist < 0.1) return 0.02;
    if (avgDist < 0.2) return 0.03;
    return 0.05;  // Very spread out
}

function clusterClicks(points, radius) {
    if (points.length === 0) return [];

    const blobs = [];
    points.forEach(p => {
        let found = false;
        for (const b of blobs) {
            if (distance(p, b) < radius) {
                b.count++;
                b.x = (b.x * (b.count - 1) + p.x) / b.count;
                b.y = (b.y * (b.count - 1) + p.y) / b.count;
                found = true;
                break;
            }
        }
        if (!found) blobs.push({ x: p.x, y: p.y, count: 1 });
    });

    return blobs;
}

// --- /heatmap dynamic clustering ---
app.get('/heatmap', async (req, res) => {
    let pts = [];
    if (useRedis) {
        const keys = await redis.keys('click:*');
        for (const k of keys) {
            const { x, y } = await redis.hGetAll(k);
            pts.push({ x: parseFloat(x), y: parseFloat(y) });
        }
    } else {
        pts = Array.from(clicks.values());
    }

    const totalClicks = pts.length;

    if (totalClicks === 0) {
        return res.json({ running: isRunning, blobs: [], totalClicks: 0 });
    }

    const radius = getClusterRadius(pts);
    let blobs = clusterClicks(pts, radius);

    // 🔥 Fallback if somehow no blobs
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
        .filter(b => b.pct >= 5 || b.isTop);  // 🔥 Only show blobs ≥5% or top blob always


    res.json({ running: isRunning, blobs: payload, totalClicks });
});

// --- WebSocket server (if needed) ---
const server = app.listen(PORT, () => console.log('EBS on', PORT));