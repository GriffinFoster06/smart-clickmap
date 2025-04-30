import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

/* ---------- Config ---------- */
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

/* ---------- In-memory state per channel ---------- */
const clicks = new Map();           // chan  → Map<userId,{x,y}>
const running = new Map();          // chan  → true / false

/* ---------- Helpers ---------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function cluster(pts, r) {
    const blobs = [];
    pts.forEach(p => {
        let b = blobs.find(b => dist(b, p) < r);
        if (!b) { b = { x: p.x, y: p.y, count: 0 }; blobs.push(b); }
        b.x = (b.x * b.count + p.x) / (b.count + 1);
        b.y = (b.y * b.count + p.y) / (b.count + 1);
        b.count++;
    });
    return blobs;
}

/* ---------- Express ---------- */
const app = express();
app.use(cors({ origin: /\.phummylw\.com$/i, credentials: true }));
app.use(express.json());

app.get('/health', (_, res) => res.send('ok'));

/* Viewer click ------------- */
app.post('/click/:chan', (req, res) => {
    const chan = req.params.chan.toLowerCase();
    if (!running.get(chan)) return res.sendStatus(409);
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') return res.sendStatus(400);
    const uid = req.ip;           // anonymous; replace with real session later
    if (!clicks.has(chan)) clicks.set(chan, new Map());
    clicks.get(chan).set(uid, { x, y });
    res.sendStatus(200);
});

/* Control panel auth (Twitch OAuth → JWT) ---------- */
app.post('/auth', express.urlencoded({ extended: false }), (req, res) => {
    // Minimal: accept any POST with ?channel= & ?user=
    const { channel, user } = req.body;
    const token = jwt.sign({ channel, user, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token });
});

/* Control actions ---------- */
app.post('/:action(start|stop|reset)/:chan', (req, res) => {
    const chan = req.params.chan.toLowerCase();
    const action = req.params.action;
    if (action === 'reset') clicks.set(chan, new Map());
    if (action === 'start') running.set(chan, true);
    if (action === 'stop') running.set(chan, false);
    res.send('ok');
});

/* Heatmap ---------- */
app.get('/heatmap/:chan', (req, res) => {
    const chan = req.params.chan.toLowerCase();
    const pts = [...(clicks.get(chan)?.values() || [])];
    const total = pts.length;
    if (total === 0) return res.json({ blobs: [], total, running: !!running.get(chan) });
    const radius = Math.max(0.01, 0.05 / Math.sqrt(total));
    let blobs = cluster(pts, radius).sort((a, b) => b.count - a.count);
    blobs = blobs
        .map((b, i) => ({ x: b.x, y: b.y, pct: Math.round(b.count / total * 100), isTop: i === 0 }))
        .filter(b => b.pct >= 5 || b.isTop);
    res.json({ blobs, total, running: !!running.get(chan) });
});

/* ---------- WebSocket broadcast ---------- */
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setInterval(() => {
    for (const [chan, map] of clicks) {
        const pts = [...map.values()];
        if (!pts.length) continue;
        const total = pts.length;
        const radius = Math.max(0.01, 0.05 / Math.sqrt(total));
        let blobs = cluster(pts, radius).sort((a, b) => b.count - a.count)
            .map((b, i) => ({ x: b.x, y: b.y, pct: Math.round(b.count / total * 100), isTop: i === 0 }))
            .filter(b => b.pct >= 5 || b.isTop);
        const msg = JSON.stringify({ chan, blobs, running: !!running.get(chan) });
        wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
    }
}, 1000);

server.listen(PORT, () => console.log('API on', PORT));
