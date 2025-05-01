// server.js  – production-ready click-map backend with safe JSON + pause/resume
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'redis';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

// ───────────────────────────────────────────────────
// Config & helpers

const MAX_STORED_CLICKS = 5000;
const streamers = JSON.parse(await fs.readFile('streamers.json', 'utf8'));

console.log("✅ Loaded streamers.json:");
console.log(Object.entries(streamers).map(([u, s]) => `${u} → ${s.roomId}`));

function roomExists(roomId) {
    return Object.values(streamers).some(s => s.roomId === roomId);
}
const ACTIVE_KEY = roomId => `active:${roomId}`;

// ───────────────────────────────────────────────────
// Redis & Express setup

const redis = Redis.createClient({ url: process.env.REDIS_URL });
await redis.connect();

const app = express();
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// ───────────────────────────────────────────────────
// Dynamic routes (must come before static)

// Overlay & Viewer
['overlay', 'room'].forEach(page => {
    app.get(`/${page}/:roomId`, (req, res) => {
        const { roomId } = req.params;
        if (!roomExists(roomId)) return res.status(404).send('Unknown room');
        res.sendFile(path.resolve(`public/${page}.html`));
    });
});

// Admin (with login)
app.get('/admin/:roomId', (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).send('Unknown room');
    if (req.session?.roomId === roomId) {
        return res.sendFile(path.resolve('public/admin.html'));
    }
    res.sendFile(path.resolve('public/login.html'));
});

// Login & Logout
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const record = streamers[username];
    if (!record) return res.status(403).send('Bad credentials');
    const ok = await bcrypt.compare(password, record.passwordHash);
    if (!ok) return res.status(403).send('Bad credentials');

    req.session.roomId = record.roomId;
    await redis.set(ACTIVE_KEY(record.roomId), '1'); // ensure active
    res.redirect(`/admin/${record.roomId}`);
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// API: clicks & active flag
app.get('/api/clicks/:roomId', async (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).json([]);
    const raw = await redis.lRange(`clicks:${roomId}`, 0, -1);
    res.json(raw.map(JSON.parse));
});

app.get('/api/active/:roomId', async (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).json({ active: false });
    const val = await redis.get(ACTIVE_KEY(roomId));
    res.json({ active: val !== '0' });
});

// WebSocket: persistence + pause/resume
const sockets = new Map(); // roomId → Set<ws>
const active = new Map(); // roomId → boolean

wss.on('connection', ws => {
    const roomId = ws.protocol;
    if (!roomExists(roomId)) return ws.close(1008, 'Unknown room');

    (async () => {
        const a = (await redis.get(ACTIVE_KEY(roomId))) !== '0';
        active.set(roomId, a);
        ws.send(JSON.stringify({ type: 'active', active: a }));
    })();

    if (!sockets.has(roomId)) sockets.set(roomId, new Set());
    sockets.get(roomId).add(ws);

    ws.on('message', async raw => {
        let msg;
        try { msg = JSON.parse(raw); }
        catch { return; } // ignore non-JSON

        // Start / Stop
        if (msg.type === 'start' || msg.type === 'stop') {
            const a = msg.type === 'start';
            await redis.set(ACTIVE_KEY(roomId), a ? '1' : '0');
            active.set(roomId, a);
            // broadcast new active state
            for (const c of sockets.get(roomId)) {
                if (c.readyState === c.OPEN) {
                    c.send(JSON.stringify({ type: 'active', active: a }));
                }
            }
            return;
        }

        // Reset
        if (msg.type === 'reset') {
            await redis.del(`clicks:${roomId}`);
            for (const c of sockets.get(roomId)) {
                if (c.readyState === c.OPEN) c.send(JSON.stringify(msg));
            }
            return;
        }

        // Click
        if (msg.type === 'click') {
            if (!active.get(roomId)) return; // ignore if paused
            await redis.rPush(`clicks:${roomId}`, JSON.stringify(msg));
            await redis.lTrim(`clicks:${roomId}`, -MAX_STORED_CLICKS, -1);
        }

        // Broadcast click
        for (const c of sockets.get(roomId)) {
            if (c.readyState === c.OPEN) c.send(JSON.stringify(msg));
        }
    });

    ws.on('close', () => sockets.get(roomId)?.delete(ws));
});

// ───────────────────────────────────────────────────
// Static files last

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('✅ Server up on', PORT));
