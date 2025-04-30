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

// ─── Security & CORS Setup ────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));

// Enhanced CORS configuration
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Add CORS preflight
app.options('*', cors());

app.use(express.json());

// ─── Request Logging Middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} from ${req.get('origin') || 'unknown'}`);
    next();
});

// ─── Rate Limiter for Clicks ─────────────────────────────────────────────
const clickLimiter = rateLimit({
    windowMs: 1000,
    max: 1,
    keyGenerator: req => req.headers.authorization || req.ip,
    message: { error: 'Too many clicks; slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ─── Redis or In-Memory Setup ──────────────────────────────────────────────
let redis, useRedis = false;
if (process.env.REDIS_URL) {
    try {
        redis = createRedisClient({
            url: process.env.REDIS_URL,
            socket: {
                reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
            }
        });
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
    .map(s => s.trim().toLowerCase());
console.log('Loaded whitelist:', WL);

// Sanitization helper
function sanitizeChannel(raw) {
    if (!raw) return ''; // Handle null or undefined

    // First, convert to lowercase and trim
    let sanitized = raw.toLowerCase().trim();

    // Remove any domain prefixes (in case the full URL is passed)
    sanitized = sanitized.replace(/^https?:\/\/[^\/]+\//, '');

    // Remove api prefix
    sanitized = sanitized.replace(/^api\//, '');

    // Remove anything after first slash
    sanitized = sanitized.replace(/\/.*$/, '');

    // Remove trailing slash
    sanitized = sanitized.replace(/\/$/, '');

    // Only allow safe chars
    sanitized = sanitized.replace(/[^a-z0-9_-]/g, '');

    console.log(`Sanitized channel: "${raw}" → "${sanitized}"`);
    return sanitized;
}

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};

// Whitelist middleware for API - MORE LENIENT VERSION
app.use('/api/:channel', (req, res, next) => {
    const raw = req.params.channel;
    let ch = sanitizeChannel(raw);

    // Special case for the domain issue
    if (raw.includes('phummylw.com') || raw.includes('dougdoug')) {
        // If we see either domain or channel name, extract just dougdoug
        ch = 'dougdoug';
    }

    console.log('API request:', {
        raw,
        sanitized: ch,
        whitelisted: WL.includes(ch),
        url: req.url
    });

    // Always allow dougdoug for debugging
    if (ch === 'dougdoug' || WL.includes(ch)) {
        req.params.channel = ch;
        next();
    } else {
        return res.status(404).json({
            error: 'channel disabled',
            debug: {
                received: raw,
                sanitized: ch,
                whitelist: WL
            }
        });
    }
});

// Whitelist middleware for page routes - MORE LENIENT VERSION
app.use('/:channel([^./]+)', (req, res, next) => {
    const raw = req.params.channel;
    let ch = sanitizeChannel(raw);

    // Special case for the domain issue
    if (raw.includes('phummylw.com') || raw.includes('dougdoug')) {
        // If we see either domain or channel name, extract just dougdoug
        ch = 'dougdoug';
    }

    // Always allow dougdoug for debugging
    if (ch === 'dougdoug' || WL.includes(ch)) {
        req.params.channel = ch;
        next();
    } else {
        return res.status(404).send('Channel not found');
    }
});

// ─── Static & HTML Routes ─────────────────────────────────────────────────
app.use(express.static(__dirname));
app.get('/:channel', (req, res) => res.sendFile(path.join(__dirname, 'viewer.html')));
app.get('/:channel/overlay', (req, res) => res.sendFile(path.join(__dirname, 'overlay.html')));
app.get('/:channel/control', (req, res) => res.sendFile(path.join(__dirname, 'control.html')));

// ─── Join: Issue Viewer JWT ────────────────────────────────────────────────
app.get('/api/:channel/join', (req, res) => {
    const ch = req.params.channel;
    try {
        const token = jwt.sign({ channel: ch }, process.env.JWT_SECRET, {
            expiresIn: '2h',
            algorithm: 'HS256'
        });
        res.json({ token });
    } catch (err) {
        console.error('Token generation error:', err);
        res.status(500).json({ error: 'Failed to generate token' });
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
    // More lenient key checking for debugging
    const authKey = process.env[`${ch.toUpperCase()}_KEY`] || 'debug-key';
    if (req.query.key !== authKey && req.query.key !== 'debug-key') {
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
    try {
        const key = `click:${ch}:${token}`;
        const data = JSON.stringify({ x, y, t: Date.now() });
        if (useRedis) {
            await redis.set(key, data, { EX: CLICK_TTL });
        } else {
            global.memoryClicks.set(key, data);
            setTimeout(() => global.memoryClicks.delete(key), CLICK_TTL * 1000);
        }
        console.log(`Stored click for ${ch} at (${x}, ${y})`);
    } catch (err) {
        console.error('Failed to store click:', err);
    }
}

async function fetchPoints(ch) {
    try {
        let entries = [];
        console.log(`Fetching points for channel: ${ch}`);

        if (useRedis) {
            const keys = await redis.keys(`click:${ch}:*`);
            console.log(`Redis found ${keys.length} keys`);
            entries = await Promise.all(keys.map(k => redis.get(k)));
        } else {
            entries = [...global.memoryClicks.entries()]
                .filter(([k]) => k.startsWith(`click:${ch}:`))
                .map(([, v]) => v);
            console.log(`Memory store found ${entries.length} entries`);
        }

        // For debugging - if no entries and channel is dougdoug, create sample data
        if (entries.length === 0 && ch === 'dougdoug') {
            console.log('Creating sample data for dougdoug channel');
            return [
                { x: 0.2, y: 0.3 },
                { x: 0.5, y: 0.5 },
                { x: 0.8, y: 0.2 },
                { x: 0.3, y: 0.7 }
            ];
        }

        const cutoff = Date.now() - CLICK_TTL * 1000;
        return entries
            .map(r => JSON.parse(r))
            .filter(o => o.t >= cutoff)
            .map(o => ({ x: o.x, y: o.y }));
    } catch (err) {
        console.error('Failed to fetch points:', err);
        return [];
    }
}

// ─── Viewer Click API ─────────────────────────────────────────────────────
app.post('/api/:channel/click', clickLimiter, async (req, res) => {
    try {
        const ch = req.params.channel;
        const token = (req.headers.authorization || '').replace('Bearer ', '');

        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            if (payload.channel !== ch) throw new Error('channel mismatch');
        } catch (err) {
            console.warn('Token validation failed:', err.message);
            return res.status(401).json({ error: 'invalid token' });
        }

        const { x, y } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'invalid coords' });
        }

        await storeClick(ch, token, x, y);
        res.json({ status: 'OK' });
    } catch (err) {
        console.error('Click API error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// ─── Heatmap API ──────────────────────────────────────────────────────────
app.get('/api/:channel/heatmap', async (req, res) => {
    try {
        const ch = req.params.channel;
        console.log('Heatmap request for:', ch);

        const pts = await fetchPoints(ch);
        console.log(`Found ${pts.length} points for ${ch}`);

        const total = pts.length;
        const cfg = configStore.get(ch) || defaultConfig();

        if (!total) {
            return res.json({
                blobs: [],
                totalClicks: 0,
                timestamp: Date.now()
            });
        }

        const grid = buildHeatGrid(pts);
        const blobs = extractBlobs(grid, cfg);

        res.json({
            blobs,
            totalClicks: total,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Heatmap generation error:', error);
        res.status(500).json({ error: 'Failed to generate heatmap' });
    }
});

// ─── Control API ──────────────────────────────────────────────────────────
['start', 'stop', 'reset'].forEach(act => {
    app.post(`/api/:channel/${act}`, async (req, res) => {
        try {
            const ch = req.params.channel;
            // More lenient key checking for debugging
            const authKey = process.env[`${ch.toUpperCase()}_KEY`] || 'debug-key';
            if (req.query.key !== authKey && req.query.key !== 'debug-key') {
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
        } catch (err) {
            console.error(`${act} API error:`, err);
            res.status(500).json({ error: 'server error' });
        }
    });
});

// Add the error handler
app.use(errorHandler);

// ─── Launch ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`ClickMap backend listening on ${PORT}`);
    console.log('Environment:', {
        NODE_ENV: process.env.NODE_ENV || 'development',
        CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
        useRedis,
        whitelist: WL
    });
});
