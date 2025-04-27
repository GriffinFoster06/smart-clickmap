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
    clicks = new Map();  // userId → {x, y}
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

app.post('/click', (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });

        if (useRedis) {
            redis.hSet(`click:${payload.user_id}`, { x, y });
        } else {
            clicks.set(payload.user_id, { x, y });
        }
        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'jwt' });
    }
});

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

// ---- Dynamic Clustering
function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function clusterClicks(points, radius = 0.05) {
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

// Utility functions

function getClusterRadius(clickCount) {
    if (clickCount < 50) return 0.05;    // 5% map dimension for small groups
    if (clickCount < 500) return 0.03;   // 3% for medium groups
    if (clickCount < 2000) return 0.02;  // 2% for large groups
    return 0.01;                         // 1% for massive crowds
}

// /heatmap route
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

    const radius = getClusterRadius(totalClicks);
    let blobs = clusterClicks(pts, radius);

    // 🔥 Fallback: if somehow no blobs but there are clicks, create 1 blob per click
    if (blobs.length === 0 && pts.length > 0) {
        blobs = pts.map(p => ({ x: p.x, y: p.y, count: 1 }));
    }

    blobs.sort((a, b) => b.count - a.count);

    const payload = blobs.map((b, i) => ({
        x: b.x,
        y: b.y,
        pct: Math.round((b.count / totalClicks) * 100),
        isTop: i === 0
    }));

    res.json({ running: isRunning, blobs: payload, totalClicks });
});


const server = app.listen(PORT, () => console.log('EBS on', PORT));
