// server.js – scalable, Redis-backed, one-dot-per-viewer

import express from 'express';
import session from 'express-session';
import Redis from 'redis';
import RedisStoreCreator from 'connect-redis';
import bcrypt from 'bcrypt';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

/* ─────────────────────────────────────────────────── */
/* 0.  CONFIG & HELPERS */

const MAX_USERS_PER_ROOM = 100_000;  // hard cap safety
const streamers = JSON.parse(await fs.readFile('streamers.json', 'utf8'));
function roomExists(id) { return Object.values(streamers).some(s => s.roomId === id); }
const ACTIVE_KEY = id => `active:${id}`;
const CLICK_HASH = id => `userClicks:${id}`;   // Redis hash  userId → JSON

/* ─────────────────────────────────────────────────── */
/* 1.  REDIS  (one client for commands, one for pub/sub) */

const redis = Redis.createClient({ url: process.env.REDIS_URL });
await redis.connect();

const sub = redis.duplicate();
await sub.connect();

/* ─────────────────────────────────────────────────── */
/* 2.  EXPRESS  */

const RedisStore = RedisStoreCreator(session);

const app = express();
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });

app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new RedisStore({ client: redis }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

/* ─────────────────────────────────────────────────── */
/* 3.  DYNAMIC PAGES */

['overlay', 'room'].forEach(p => {
    app.get(`/${p}/:roomId`, (req, res) => {
        const { roomId } = req.params;
        if (!roomExists(roomId)) return res.status(404).send('Unknown room');
        res.sendFile(path.resolve(`public/${p}.html`));
    });
});

/* admin & login (unchanged) */
app.get('/admin/:roomId', (req, res) => {
    const { roomId } = req.params;
    if (!roomExists(roomId)) return res.status(404).send('Unknown room');
    if (req.session?.roomId === roomId) return res.sendFile(path.resolve('public/admin.html'));
    res.sendFile(path.resolve('public/login.html'));
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const rec = streamers[username];
    if (!rec || !(await bcrypt.compare(password, rec.passwordHash))) return res.status(403).send('Bad creds');
    req.session.roomId = rec.roomId;
    await redis.set(ACTIVE_KEY(rec.roomId), '1');
    res.redirect(`/admin/${rec.roomId}`);
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

/* ─────────────────────────────────────────────────── */
/* 4.  REST  API  */

app.get('/api/active/:roomId', async (req, res) => {
    if (!roomExists(req.params.roomId)) return res.status(404).json({ active: false });
    res.json({ active: (await redis.get(ACTIVE_KEY(req.params.roomId))) !== '0' });
});
app.get('/api/clicks/:roomId', async (req, res) => {
    if (!roomExists(req.params.roomId)) return res.status(404).json([]);
    const hash = await redis.hGetAll(CLICK_HASH(req.params.roomId));
    res.json(Object.values(hash).map(JSON.parse));
});

/* ─────────────────────────────────────────────────── */
/* 5.  WEBSOCKET  */

const sockets = new Map();                // roomId → Set<ws>

sub.pSubscribe('room:*', (msg, channel) => {
    const roomId = channel.split(':')[1];
    const set = sockets.get(roomId);
    if (set) for (const c of set) if (c.readyState === c.OPEN) c.send(msg);
});

wss.on('connection', (ws, req) => {
    const roomId = ws.protocol;
    if (!roomExists(roomId)) return ws.close(1008, 'Unknown room');

    /* track socket set */
    if (!sockets.has(roomId)) sockets.set(roomId, new Set());
    sockets.get(roomId).add(ws);

    /* initial active flag */
    (async () => {
        const a = (await redis.get(ACTIVE_KEY(roomId))) !== '0';
        ws.send(JSON.stringify({ type: 'active', active: a }));
    })();

    /* heartbeat to avoid stale sockets */
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', async raw => {
        let m; try { m = JSON.parse(raw); } catch { return; }

        /* START / STOP */
        if (m.type === 'active') {
            await redis.set(ACTIVE_KEY(roomId), m.active ? '1' : '0');
            await redis.publish(`room:${roomId}`, JSON.stringify({ type: 'active', active: m.active }));
            return;
        }

        /* RESET */
        if (m.type === 'reset') {
            await redis.del(CLICK_HASH(roomId));
            await redis.publish(`room:${roomId}`, JSON.stringify({ type: 'reset' }));
            return;
        }

        /* CLICK  –– NEW strict checks */
        if (m.type === 'click') {
            /* room must be active */
            const isActive = (await redis.get(ACTIVE_KEY(roomId))) !== '0';
            if (!isActive) return;

            /* rate-limit */
            const key = `rl:${roomId}:${m.userId}`;
            const n = await redis.incr(key);
            if (n === 1) await redis.expire(key, 1);
            if (n > 10) return;

            /* store / replace by userId */
            await redis.hSet(CLICK_HASH(roomId), m.userId, JSON.stringify({ x: m.x, y: m.y, userId: m.userId }));
            await redis.publish(`room:${roomId}`, JSON.stringify(m));
        }
    });

    ws.on('close', () => sockets.get(roomId)?.delete(ws));
});

/* periodic dead-socket cleanup */
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false; ws.ping();
    });
}, 30_000);

/* ─────────────────────────────────────────────────── */
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('✅ Server on', PORT));
