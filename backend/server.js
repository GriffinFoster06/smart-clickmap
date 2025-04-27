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
let grid, clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    grid = new Float32Array(GRID * GRID).fill(0);
    clicks = new Map();  // Map userId → {x, y}
}

const K = [
    [0.0625, 0.125, 0.0625],
    [0.125, 0.25, 0.125],
    [0.0625, 0.125, 0.0625]
];

function idx(x, y) {
    return y * GRID + x;
}

let isRunning = false;

// Core logic: add heat at (x,y)
function addHeat(x, y, mult = 1) {
    const cx = Math.floor(x * GRID);
    const cy = Math.floor(y * GRID);
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const gx = cx + dx;
            const gy = cy + dy;
            if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
            if (useRedis)
                redis.incrByFloat(`g:${idx(gx, gy)}`, K[dy + 1][dx + 1] * mult);
            else
                grid[idx(gx, gy)] += K[dy + 1][dx + 1] * mult;
        }
    }
}

// Handle user click
async function acceptClick(userId, x, y) {
    if (!isRunning) return false;

    if (useRedis) {
        const prev = await redis.hGetAll(`click:${userId}`);
        if (prev.x && prev.y) {
            // Remove previous click heat
            addHeat(parseFloat(prev.x), parseFloat(prev.y), -1);
        }
        // Store new click
        await redis.hSet(`click:${userId}`, { x, y });
        addHeat(x, y, +1);
    } else {
        if (clicks.has(userId)) {
            const prev = clicks.get(userId);
            addHeat(prev.x, prev.y, -1);
        }
        clicks.set(userId, { x, y });
        addHeat(x, y, +1);
    }
    return true;
}

// Readout grid
async function snapshot() {
    if (useRedis) {
        const raw = await redis.mGet(
            Array.from({ length: GRID * GRID }, (_, i) => `g:${i}`)
        );
        return raw.map(v => Number(v || 0));
    }
    return Array.from(grid);
}

// Clear all
function clearAll() {
    if (useRedis) {
        const keys = Array.from({ length: GRID * GRID }, (_, i) => `g:${i}`);
        redis.del(keys);
        redis.flushAll(); // resets all clicks and cells
    } else {
        grid.fill(0);
        clicks.clear();
    }
}

// ----- Web Server -----
const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Viewer click
app.post('/click', (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });
        acceptClick(payload.user_id, x, y);
        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'jwt' });
    }
});

// Broadcaster commands
app.post('/start', (_, res) => {
    isRunning = true;
    clearAll();
    res.send('started');
});

app.post('/stop', (_, res) => {
    isRunning = false;
    res.send('stopped');
});

app.post('/reset', (_, res) => {
    clearAll();
    res.send('reset');
});

// Health check
app.get('/health', (_, res) => res.send('ok'));

// Viewer fetch heatmap
app.get('/heatmap', async (req, res) => {
    const data = await snapshot();
    // find max heat spot
    let max = -Infinity, maxi = 0;
    data.forEach((v, i) => { if (v > max) { max = v; maxi = i; } });
    res.json({ type: 'heatmap', running: isRunning, data, grid: GRID, maxIndex: maxi });
});

app.get('/stats', async (req, res) => {
    const data = await snapshot();
    const clickCount = data.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);
    const userCount = useRedis ? await redis.sCard('clicks') : clicks.size;
    const blobCount = clickCount;  // Approximate each cell as a blob (simple for now)
    res.json({ clicks: clickCount, users: userCount, blobs: blobCount });
});


const server = app.listen(PORT, () => console.log('EBS on', PORT));