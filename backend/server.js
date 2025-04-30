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
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Add CORS preflight
app.options('*', cors());

app.use(express.json());

// ─── Request Logging Middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
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
    const sanitized = raw
        .toLowerCase()
        .trim()
        .replace(/^\/?api\//, '')
        .replace(/\/.*$/, '')     // remove anything after first slash
        .replace(/\/$/, '')       // remove trailing slash
        .replace(/[^a-z0-9_-]/g, ''); // only allow safe chars
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

// Whitelist middleware for API
app.use('/api/:channel', (req, res, next) => {
    const raw = req.params.channel;
    const ch = sanitizeChannel(raw);
    console.log('API request:', {
        raw,
        sanitized: ch,
        whitelisted: WL.includes(ch),
        url: req.url,
        method: req.method
    });

    if (!WL.includes(ch)) {
        return res.status(404).json({
            error: 'channel disabled',
            debug: process.env.NODE_ENV === 'development' ? {
                received: raw,
                sanitized: ch,
                whitelist: WL
            } : undefined
        });
    }
    req.params.channel = ch;
    next();
});

// Whitelist middleware for page routes
app.use('/:channel([^./]+)', (req, res, next) => {
    const raw = req.params.channel;
    const ch = sanitizeChannel(raw);
    if (!WL.includes(ch)) {
        return res.status(404).send('Channel not found');
    }
    req.params.channel = ch;
    next();
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

// [Previous code sections remain unchanged: Config API, Smart Gaussian Clustering, etc.]

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

