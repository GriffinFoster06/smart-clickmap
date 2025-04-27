import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';

const PORT = process.env.PORT || 8080;
const GRID = Number(process.env.GRID_SIZE) || 100;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// ----- Storage --------------------------------------------------
const useRedis = !!process.env.REDIS_URL;
let grid, clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    grid = new Float32Array(GRID * GRID).fill(0);
    clicks = new Set();
}

// Gaussian kernel 3×3
const K = [
    [0.0625, 0.125, 0.0625],
    [0.125, 0.25, 0.125],
    [0.0625, 0.125, 0.0625]
];

function idx(x, y) { return y * GRID + x; }

// ----- State flags ---------------------------------------------
let isRunning = false;   // controlled by /start /stop

// ----- Helpers --------------------------------------------------
async function acceptClick(userId, x, y) {
    if (!isRunning) return false;

    if (useRedis) {
        const hit = await redis.sIsMember('clicks', userId);
        if (hit) return false;
        await redis.sAdd('clicks', userId);
    } else {
        if (clicks.has(userId)) return false;
        clicks.add(userId);
    }

    const cx = Math.floor(x * GRID);
    const cy = Math.floor(y * GRID);
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const gx = cx + dx;
            const gy = cy + dy;
            if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) continue;
            if (useRedis) {
                await redis.incrByFloat(`g:${idx(gx, gy)}`, K[dy + 1][dx + 1]);
            } else {
                grid[idx(gx, gy)] += K[dy + 1][dx + 1];
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

function clearAll() {
    if (useRedis) {
        const keys = Array.from({ length: GRID * GRID }, (_, i) => `g:${i}`);
        redis.del(keys);
        redis.del('clicks');
    } else {
        grid.fill(0);
        clicks.clear();
    }
}

// ----- Web / WS -------------------------------------------------
const app = express();
app.use(cors({ origin: '*' }));      // ← Added CORS properly here
app.use(express.json());

// JWT verify JUST FOR VIEWER CLICK ENDPOINT (leave config routes open)
app.post('/click', (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'coords' });
        }
        acceptClick(payload.user_id, x, y);
        return res.sendStatus(200);
    } catch (e) {
        return res.status(401).json({ error: 'jwt' });
    }
});

// ---- INSECURE broadcaster routes -------------------------------
app.post('/start', (_, res) => { isRunning = true; res.send('started'); });
app.post('/stop', (_, res) => { isRunning = false; res.send('stopped'); });
app.post('/reset', (_, res) => { clearAll(); res.send('reset'); });

app.get('/health', (_, res) => res.send('ok'));

const server = app.listen(PORT, () => console.log('EBS on', PORT));

const wss = new WebSocketServer({ server, path: '/ws' });
setInterval(async () => {
    const data = await snapshot();
    const payload = JSON.stringify({ type: 'heatmap', running: isRunning, data, grid: GRID });
    wss.clients.forEach(c => c.readyState === 1 && c.send(payload));
}, 250);
