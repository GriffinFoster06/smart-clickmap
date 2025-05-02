// server.js – scalable, Redis-backed, one-dot-per-viewer, START/STOP persists

import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import connectRedis from 'connect-redis';          // ⬅️ correct import
import bcrypt from 'bcrypt';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

/* ───── Config / Helpers ───────────────────────────── */
const MAX_USERS_PER_ROOM = 100_000;
const streamers = JSON.parse(await fs.readFile('streamers.json', 'utf8'));
const roomExists = id => Object.values(streamers).some(s => s.roomId === id);
const ACTIVE_KEY = id => `active:${id}`;
const CLICK_HASH = id => `userClicks:${id}`;

/* ───── Redis Clients ──────────────────────────────── */
const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const redisPubSub = redisClient.duplicate();
await redisPubSub.connect();

/* ───── Express + Redis Session Store ─────────────── */
const RedisStore = connectRedis(session);

const app = express();
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });

app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

/* ───── Dynamic Pages (room / overlay) ────────────── */
['overlay', 'room'].forEach(page => {
    app.get(`/${page}/:roomId`, (req, res) => {
        if (!roomExists(req.params.roomId)) return res.status(404).send('Unknown room');
        res.sendFile(path.resolve(`public/${page}.html`));
    });
});

/* ───── Admin & Login ─────────────────────────────── */
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
    const rec = streamers[username];
    if (!rec || !(await bcrypt.compare(password, rec.passwordHash))) {
        return res.status(403).send('Bad credentials');
    }
    req.session.roomId = rec.roomId;
    await redisClient.set(ACTIVE_KEY(rec.roomId), '1');   // default RUNNING
    res.redirect(`/admin/${rec.roomId}`);
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

/* ───── REST API (active + clicks) ────────────────── */
app.get('/api/active/:roomId', async (req, res) => {
    if (!roomExists(req.params.roomId)) return res.status(404).json({ active: false });
    const active = (await redisClient.get(ACTIVE_KEY(req.params.roomId))) !== '0';
    res.json({ active });
});

app.get('/api/clicks/:roomId', async (req, res) => {
    if (!roomExists(req.params.roomId)) return res.status(404).json([]);
    const hash = await redisClient.hGetAll(CLICK_HASH(req.params.roomId));
    res.json(Object.values(hash).map(JSON.parse));
});

/* ───── WebSocket Setup ───────────────────────────── */
const sockets = new Map();                  // roomId → Set<ws>

redisPubSub.pSubscribe('room:*', (msg, chan) => {
    const roomId = chan.split(':')[1];
    const set = sockets.get(roomId);
    if (set) for (const c of set) if (c.readyState === c.OPEN) c.send(msg);
});

wss.on('connection', ws => {
    const roomId = ws.protocol;
    if (!roomExists(roomId)) return ws.close(1008, 'Unknown room');

    /* register socket */
    if (!sockets.has(roomId)) sockets.set(roomId, new Set());
    sockets.get(roomId).add(ws);

    /* send current active state */
    (async () => {
        const a = (await redisClient.get(ACTIVE_KEY(roomId))) !== '0';
        ws.send(JSON.stringify({ type: 'active', active: a }));
    })();

    /* heartbeat */
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', async raw => {
        let m; try { m = JSON.parse(raw); } catch { return; }

        /* START / STOP */
        if (m.type === 'active') {
            await redisClient.set(ACTIVE_KEY(roomId), m.active ? '1' : '0');
            await redisClient.publish(`room:${roomId}`, JSON.stringify({ type: 'active', active: m.active }));
            return;
        }

        /* RESET */
        if (m.type === 'reset') {
            await redisClient.del(CLICK_HASH(roomId));
            await redisClient.publish(`room:${roomId}`, JSON.stringify({ type: 'reset' }));
            return;
        }

        /* CLICK (one dot per user) */
        if (m.type === 'click') {
            const isActive = (await redisClient.get(ACTIVE_KEY(roomId))) !== '0';
            if (!isActive) return;

            // rate-limit 10 clicks/s
            const rlKey = `rl:${roomId}:${m.userId}`;
            const n = await redisClient.incr(rlKey);
            if (n === 1) await redisClient.expire(rlKey, 1);
            if (n > 10) return;

            const count = await redisClient.hLen(CLICK_HASH(roomId));
            if (count >= MAX_USERS_PER_ROOM && !(await redisClient.hExists(CLICK_HASH(roomId), m.userId))) return;

            await redisClient.hSet(CLICK_HASH(roomId), m.userId, JSON.stringify({ x: m.x, y: m.y, userId: m.userId }));
            await redisClient.publish(`room:${roomId}`, JSON.stringify(m));
        }
    });

    ws.on('close', () => sockets.get(roomId)?.delete(ws));
});

/* cleanup dead sockets every 30 s */
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false; ws.ping();
    });
}, 30_000);

/* ───── Static ────────────────────────────────────── */
app.use(express.static('public'));

/* ───── Start Server ─────────────────────────────── */
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('✅ Server listening on', PORT));
