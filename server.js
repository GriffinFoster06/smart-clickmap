// server.js
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'redis';
import { v4 as uuid } from 'uuid';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });
const redis = Redis.createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Serve static frontend
app.use(express.static('public'));

// Landing or redirect
app.get('/', (_, res) => res.redirect('/new'));

// Generate new room
app.get('/new', async (_, res) => {
    const roomId = uuid();
    await redis.sAdd('rooms', roomId);
    res.json({
        overlay: `https://${process.env.BASE_DOMAIN}/overlay/${roomId}`,
        admin: `https://${process.env.BASE_DOMAIN}/admin/${roomId}`,
        viewer: `https://${process.env.BASE_DOMAIN}/room/${roomId}`
    });
});

// Serve the three page‐types:
for (const page of ['overlay', 'admin', 'room']) {
    app.get(`/${page}/:roomId`, (req, res) => {
        res.sendFile(path.resolve(`public/${page}.html`));
    });
}

// WebSocket rooms
const rooms = new Map(); // roomId ⇒ Set<ws>

wss.on('connection', (ws, req) => {
    // path = /ws/<roomId>
    const parts = req.url.split('/');
    const roomId = parts.at(-1);
    // validate room
    if (!roomId || !(await redis.sIsMember('rooms', roomId))) {
        ws.close(1008, 'Invalid room');
        return;
    }
    // join room
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);

    ws.on('message', async raw => {
        const msg = JSON.parse(raw);
        // persist stats
        if (msg.type === 'click')
            await redis.hIncrBy(`stats:${roomId}`, 'clicks', 1);

        // broadcast to others in same room
        for (const client of rooms.get(roomId)) {
            if (client !== ws && client.readyState === client.OPEN)
                client.send(raw);
        }
    });

    ws.on('close', () => {
        rooms.get(roomId)?.delete(ws);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`✅ Listening on ${PORT}`);
});
