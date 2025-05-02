// server.js – one-click-per-user logic
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

const MAX_STORED_CLICKS = 5000;
const streamers = JSON.parse(await fs.readFile('streamers.json', 'utf8'));

console.log("✅ Loaded streamers.json:");
console.log(Object.entries(streamers).map(([u, s]) => `${u} → ${s.roomId}`));

function roomExists(roomId) {
    return Object.values(streamers).some(s => s.roomId === roomId);
}
const ACTIVE_KEY = roomId => `active:${roomId}`;

// Redis & Express
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

// WebSocket session state
const sockets = new Map(); // roomId → Set<ws>
const active = new Map();  // roomId → boolean
const userClicks = new Map(); // roomId → Map<userId → {x,y}>

// Public pages
['overlay', 'room'].forEach(page => {
    app.get(`/${page}/:roomId`, (req, res) => {
        const { roomId } = req.params;
        if (!roomExists(roomId)) return res.status(404).send('Unknown room');
        res.sendFile(path.resolve(`public/${page}.html`));
    });
});

// Admin & login
app.get('/admin/:roomId', (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).send('Unknown room');
    if (req.session?.roomId === roomId) {
        return res.sendFile(path.resolve('public/admin.html'));
    }
    res.sendFile(path.resolve('public/login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const record = streamers[username];
    if (!record) return res.status(403).send('Bad credentials');
    const ok = await bcrypt.compare(password, record.passwordHash);
    if (!ok) return res.status(403).send('Bad credentials');

    req.session.roomId = record.roomId;
    await redis.set(ACTIVE_KEY(record.roomId), '1');
    res.redirect(`/admin/${record.roomId}`);
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// API: clicks per user
app.get('/api/clicks/:roomId', async (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).json([]);
    const map = userClicks.get(roomId);
    if (!map) return res.json([]);
    res.json([...map.values()]);
});

app.get('/api/active/:roomId', async (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).json({ active: false });
    const val = await redis.get(ACTIVE_KEY(roomId));
    res.json({ active: val !== '0' });
});

// WebSocket handling
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

    if (!userClicks.has(roomId)) userClicks.set(roomId, new Map());

    ws.on('message', async raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'active') {
            const a = msg.active;
            await redis.set(ACTIVE_KEY(roomId), a ? '1' : '0');
            active.set(roomId, a);
            for (const c of sockets.get(roomId)) {
                if (c.readyState === c.OPEN) {
                    c.send(JSON.stringify({ type: 'active', active: a }));
                }
            }
            return;
        }

        if (msg.type === 'reset') {
            userClicks.get(roomId)?.clear();
            for (const c of sockets.get(roomId)) {
                if (c.readyState === c.OPEN) c.send(JSON.stringify(msg));
            }
            return;
        }

        if (msg.type === 'click') {
            if (!active.get(roomId)) return;
            if (!msg.userId) return;

            userClicks.get(roomId).set(msg.userId, { x: msg.x, y: msg.y });

            // broadcast update
            for (const c of sockets.get(roomId)) {
                if (c.readyState === c.OPEN) c.send(JSON.stringify(msg));
            }
        }
    });

    ws.on('close', () => sockets.get(roomId)?.delete(ws));
});

// Static last
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('✅ Server up on', PORT));
