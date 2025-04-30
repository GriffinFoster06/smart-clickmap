import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createClient as createRedisClient } from 'redis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Validate Required Environment Variables ──────────────────────────────
if (!process.env.WHITELIST) {
    console.error('WHITELIST not defined');
    process.exit(1);
}
if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET not defined');
    process.exit(1);
}

// ─── Security & Parsing ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Add this right after the Security & Parsing section
// ─── Request Logger ────────────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[Request] ${req.method} ${req.originalUrl}`);
    console.log(`[Headers] ${JSON.stringify(req.headers, null, 2)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    next();
});


// ─── Rate Limiter for Clicks ─────────────────────────────────────────────
const clickLimiter = rateLimit({
    windowMs: 1000,
    max: 1,
    keyGenerator: req => req.headers.authorization || req.ip,
    message: { error: 'Too many clicks; slow down.' }
});

// ─── Redis or In-Memory Setup ──────────────────────────────────────────────
let redis, useRedis = false;
if (process.env.REDIS_URL) {
    try {
        redis = createRedisClient({ url: process.env.REDIS_URL });
        await redis.connect();
        useRedis = true;
        console.log('✅ Connected to Redis');
    } catch (err) {
        console.error('❌ Redis connect failed, using memory store:', err);
        global.memoryClicks = new Map();
    }
} else {
    global.memoryClicks = new Map();
    console.log('ℹ️  Using in-memory store');
}
const CLICK_TTL = parseInt(process.env.CLICK_TTL_SECONDS) || 900;

// ─── Config Defaults ──────────────────────────────────────────────────────
function defaultConfig() {
    return {
        blobColor: 'rgba(128,64,255,0.25)',
        topColor: 'rgba(0,255,0,0.25)',
        strokeColor: '#fff',
        strokeWidth: 2,
        textColor: '#fff',
        textStrokeColor: '#000',
        textStrokeWidth: 3,
        radiusBase: 10,
        radiusScale: 4,
        minFontSize: 14,
        fontScale: 0.6,
        displayThreshold: 5
    };
}
const configStore = new Map();

// ─── Whitelist Setup ──────────────────────────────────────────────────────
const WL = process.env.WHITELIST.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0); // Remove empty entries

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('[Whitelist Debug]');
console.log('Raw ENV:', process.env.WHITELIST);
console.log('Split Result:', process.env.WHITELIST.split(','));
console.log('Processed WL:', WL);
console.log('WL Length:', WL.length);
console.log('WL Contents:', WL.map(w => `"${w}"`).join(', '));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Sanitization helper with debug output
function sanitizeChannel(raw) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[sanitizeChannel Debug]');
    console.log('Input:', JSON.stringify(raw));

    const steps = {
        lowercase: raw.toLowerCase(),
        trimmed: raw.toLowerCase().trim(),
        noApiPrefix: raw.toLowerCase().trim().replace(/^\/?api\//, ''),
        alphanumeric: raw.toLowerCase().trim()
            .replace(/^\/?api\//, '')
            .replace(/[^a-z0-9_-]/g, ''),
        final: raw.toLowerCase().trim()
            .replace(/^\/?api\//, '')
            .replace(/[^a-z0-9_-]/g, '')
            .replace(/\/$/, '')
    };

    console.log('Processing Steps:');
    Object.entries(steps).forEach(([step, result]) => {
        console.log(`${step}: ${JSON.stringify(result)}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return steps.final;
}

// Whitelist middleware for API with detailed debugging
app.use('/api/:channel', (req, res, next) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[API Middleware Debug]');
    console.log('Original URL:', req.originalUrl);
    console.log('Method:', req.method);
    console.log('Raw Channel Param:', JSON.stringify(req.params.channel));

    const raw = req.params.channel;
    const ch = sanitizeChannel(raw);

    console.log('Sanitized Channel:', JSON.stringify(ch));
    console.log('Current Whitelist:', WL);
    console.log('Includes Check:', WL.includes(ch));

    // Check each whitelist entry
    WL.forEach((entry, i) => {
        console.log(`WL[${i}] "${entry}" === "${ch}":`, entry === ch);
        if (entry !== ch) {
            console.log('Character codes:');
            console.log('Entry:', Array.from(entry).map(c => c.charCodeAt(0)));
            console.log('Ch:', Array.from(ch).map(c => c.charCodeAt(0)));
        }
    });

    if (!WL.includes(ch)) {
        console.error('Channel Access Denied:', ch);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return res.status(404).json({ error: 'channel disabled' });
    }

    console.log('Channel Access Granted:', ch);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    req.params.channel = ch;
    next();
});

// Whitelist middleware for page routes with detailed debugging
app.use('/:channel([^/]+)', (req, res, next) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Page Middleware Debug]');
    console.log('Original URL:', req.originalUrl);
    console.log('Method:', req.method);
    console.log('Raw Channel Param:', JSON.stringify(req.params.channel));

    const raw = req.params.channel;
    const ch = sanitizeChannel(raw);

    console.log('Sanitized Channel:', JSON.stringify(ch));
    console.log('Current Whitelist:', WL);
    console.log('Includes Check:', WL.includes(ch));

    // Check each whitelist entry
    WL.forEach((entry, i) => {
        console.log(`WL[${i}] "${entry}" === "${ch}":`, entry === ch);
        if (entry !== ch) {
            console.log('Character codes:');
            console.log('Entry:', Array.from(entry).map(c => c.charCodeAt(0)));
            console.log('Ch:', Array.from(ch).map(c => c.charCodeAt(0)));
        }
    });

    if (!WL.includes(ch)) {
        console.error('Channel Access Denied:', ch);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return res.status(404).send('channel disabled');
    }

    console.log('Channel Access Granted:', ch);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    req.params.channel = ch;
    next();
});








// ─── Static & HTML Routes ─────────────────────────────────────────────────
// Serve static files from the backend directory
app.use(express.static(path.join(__dirname)));

// Specific routes for overlay and control
app.get('/:channel/overlay', (req, res) => {
    console.log(`[Static Route] Serving overlay.html for channel: ${req.params.channel}`);
    res.sendFile(path.join(__dirname, 'overlay.html'));
});

app.get('/:channel/control', (req, res) => {
    console.log(`[Static Route] Serving control.html for channel: ${req.params.channel}`);
    res.sendFile(path.join(__dirname, 'control.html'));
});

// General route for viewer
app.get('/:channel', (req, res) => {
    console.log(`[Static Route] Serving viewer.html for channel: ${req.params.channel}`);
    res.sendFile(path.join(__dirname, 'viewer.html'));
});



// ─── Join: Issue Viewer JWT ────────────────────────────────────────────────
app.get('/api/:channel/join', (req, res) => {
    const ch = req.params.channel;
    try {
        const token = jwt.sign({ channel: ch }, process.env.JWT_SECRET, { expiresIn: '2h' });
        res.json({ token });
    } catch (err) {
        console.error('Token gen error:', err);
        res.status(500).json({ error: 'failed to generate token' });
    }
});

// ─── Config API ────────────────────────────────────────────────────────────
app.get('/api/:channel/config', (req, res) => {
    const ch = req.params.channel;
    if (!configStore.has(ch)) configStore.set(ch, defaultConfig());
    res.json(configStore.get(ch));
});
app.post('/api/:channel/config', (req, res) => {
    const ch = req.params.channel;
    if (req.query.key !== process.env[`${ch.toUpperCase()}_KEY`]) {
        return res.status(403).json({ error: 'unauthorized' });
    }
    configStore.set(ch, { ...defaultConfig(), ...req.body });
    res.json(configStore.get(ch));
});

// ─── Smart Gaussian Clustering ─────────────────────────────────────────────
const GAUSS = [
    [0.0625, 0.125, 0.0625],
    [0.125, 0.25, 0.125],
    [0.0625, 0.125, 0.0625]
];
const GRID = 100;
const gridIndex = (x, y) => y * GRID + x;

function buildHeatGrid(points) {
    const grid = new Float32Array(GRID * GRID);
    points.forEach(p => {
        const gx = Math.floor(p.x * GRID),
            gy = Math.floor(p.y * GRID);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const ix = gx + dx, iy = gy + dy;
                if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID) continue;
                grid[gridIndex(ix, iy)] += GAUSS[dy + 1][dx + 1];
            }
        }
    });
    return grid;
}

function extractBlobs(grid, cfg) {
    const raw = [];
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            const v = grid[gridIndex(x, y)];
            if (v > 0) raw.push({ x: (x + 0.5) / GRID, y: (y + 0.5) / GRID, v });
        }
    }
    raw.sort((a, b) => b.v - a.v);
    const topV = raw[0]?.v || 1;
    return raw
        .filter((b, i) => (b.v / topV * 100) >= cfg.displayThreshold || i === 0)
        .map((b, i) => ({
            x: b.x,
            y: b.y,
            pct: Math.round((b.v / topV) * 100),
            isTop: i === 0
        }));
}

// ─── Click Storage Helpers ────────────────────────────────────────────────
async function storeClick(ch, token, x, y) {
    const key = `click:${ch}:${token}`;
    const data = JSON.stringify({ x, y, t: Date.now() });
    if (useRedis) {
        await redis.set(key, data, { EX: CLICK_TTL });
    } else {
        global.memoryClicks.set(key, data);
        setTimeout(() => global.memoryClicks.delete(key), CLICK_TTL * 1000);
    }
}

async function fetchPoints(ch) {
    let entries = [];
    if (useRedis) {
        const keys = await redis.keys(`click:${ch}:*`);
        entries = await Promise.all(keys.map(k => redis.get(k)));
    } else {
        entries = [...global.memoryClicks.entries()]
            .filter(([k]) => k.startsWith(`click:${ch}:`))
            .map(([, v]) => v);
    }
    const cutoff = Date.now() - CLICK_TTL * 1000;
    return entries
        .map(r => JSON.parse(r))
        .filter(o => o.t >= cutoff)
        .map(o => ({ x: o.x, y: o.y }));
}

// ─── Viewer Click API ─────────────────────────────────────────────────────
app.post('/api/:channel/click', clickLimiter, async (req, res) => {
    const ch = req.params.channel;
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.channel !== ch) throw new Error('channel mismatch');
    } catch {
        return res.status(401).json({ error: 'invalid token' });
    }
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') {
        return res.status(400).json({ error: 'invalid coords' });
    }
    try {
        await storeClick(ch, token, x, y);
        res.json({ status: 'OK' });
    } catch (e) {
        console.error('storeClick error', e);
        res.status(500).json({ error: 'storage failure' });
    }
});

// ─── Heatmap API ──────────────────────────────────────────────────────────
app.get('/api/:channel/heatmap', async (req, res) => {
    const ch = req.params.channel;
    const pts = await fetchPoints(ch);
    const total = pts.length;
    const cfg = configStore.get(ch) || defaultConfig();
    if (!total) return res.json({ blobs: [], totalClicks: 0 });
    const grid = buildHeatGrid(pts);
    const blobs = extractBlobs(grid, cfg);
    res.json({ blobs, totalClicks: total });
});

// ─── Control API ──────────────────────────────────────────────────────────
['start', 'stop', 'reset'].forEach(act => {
    app.post(`/api/:channel/${act}`, async (req, res) => {
        const ch = req.params.channel;
        if (req.query.key !== process.env[`${ch.toUpperCase()}_KEY`]) {
            return res.status(403).json({ error: 'unauthorized' });
        }
        if (act === 'reset') {
            if (useRedis) {
                const keys = await redis.keys(`click:${ch}:*`);
                await Promise.all(keys.map(k => redis.del(k)));
            } else {
                [...global.memoryClicks.keys()]
                    .filter(k => k.startsWith(`click:${ch}:`))
                    .forEach(k => global.memoryClicks.delete(k));
            }
        }
        res.json({ status: 'OK' });
    });
});

// ─── Launch ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`ClickMap backend listening on ${PORT}`));
