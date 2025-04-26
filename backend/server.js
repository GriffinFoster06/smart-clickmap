import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import Redis from 'redis';

const PORT = process.env.PORT || 8080;
const GRID = Number(process.env.GRID_SIZE) || 100;
const SECRET = Buffer.from(process.env.TWITCH_SECRET, 'base64');   // decode once

// ----- storage --------------------------------------------------
const useRedis = !!process.env.REDIS_URL;
let grid, clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    grid = new Float32Array(GRID * GRID).fill(0);
    clicks = new Set();                      // one-click-per-viewer
}

// Gaussian kernel (3×3, sigma≈1)
const K = [
    [0.0625, 0.125, 0.0625],
    [0.125, 0.25, 0.125],
    [0.0625, 0.125, 0.0625]
];

// ----- helper ---------------------------------------------------
function index(x, y) { return y * GRID + x; }

async function registerClick(userId, x, y) {
    if (useRedis) {
        const clicked = await redis.sIsMember('clicks', userId);
        if (clicked) return false;
        await redis.sAdd('clicks', userId);
        const cx = Math.floor(x * GRID);
        const cy = Math.floor(y * GRID);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const gx = cx + dx;
                const gy = cy + dy;
                if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
                await redis.incrByFloat(`g:${index(gx, gy)}`, K[dy + 1][dx + 1]);
            }
        }
    } else {
        if (clicks.has(userId)) return false;
        clicks.add(userId);
        const cx = Math.floor(x * GRID);
        const cy = Math.floor(y * GRID);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const gx = cx + dx;
                const gy = cy + dy;
                if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
                grid[index(gx, gy)] += K[dy + 1][dx + 1];
            }
        }
    }
    return true;
}

async function snapshot() {
    if (useRedis) {
        const raw = await redis.mGet(
            Array.from({ length: GRID * GRID }, (_, i) => `g:${i}`)
        );
        return raw.map(v => Number(v || 0));
    }
    return Array.from(grid);
}

// ----- web / ws -------------------------------------------------
const app = express();
app.use(express.json());

function verify(req, res, next) {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        req.twitch = payload;
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'JWT invalid' });
    }
}

app.post('/click', verify, async (req, res) => {
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') {
        return res.status(400).json({ error: 'Bad coordinates' });
    }
    const accepted = await registerClick(req.twitch.user_id, x, y);
    return res.json({ accepted });
});

app.get('/health', (_, res) => res.send('ok'));

const server = app.listen(PORT, () =>
    console.log(`EBS listening on :${PORT}`));

const wss = new WebSocketServer({ server, path: '/ws' });

setInterval(async () => {
    const data = await snapshot();
    const payload = JSON.stringify({ type: 'heatmap', data, grid: GRID });
    wss.clients.forEach(c => c.readyState === 1 && c.send(payload));
}, 250);   // 4 FPS updates
