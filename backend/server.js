import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((_, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ─── static files ────────────────────────────────────────────
// serve frontend files at root, and again under "/:channel"
const pub = path.resolve(__dirname, '../frontend');
app.use('/:channel', express.static(pub));
app.use(express.static(pub));

// ─── whitelist middleware ────────────────────────────────────
const WHITELIST = (process.env.WHITELIST || 'phummylw').split(',').map(s => s.trim().toLowerCase());
function checkChannel(req, res, next) {
    const ch = (req.params.channel || '').toLowerCase();
    if (WHITELIST.includes(ch)) return next();
    res.status(404).send('Channel disabled');
}

// ─── in-memory click store ───────────────────────────────────
const store = new Map(); // channel → Map(uid → {x,y})
function clicksOf(channel) {
    if (!store.has(channel)) store.set(channel, new Map());
    return store.get(channel);
}

// ─── clustering helpers ──────────────────────────────────────
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function clusterRadius(total, avgDist) {
    if (total < 50) return 0.05;
    if (avgDist < 0.05) return 0.01;
    if (avgDist < 0.10) return 0.02;
    if (avgDist < 0.20) return 0.03;
    return 0.05;
}
function cluster(points, radius) {
    const blobs = [];
    for (const p of points) {
        let b = blobs.find(o => dist(o, p) < radius);
        if (!b) { b = { x: p.x, y: p.y, count: 0 }; blobs.push(b); }
        b.x = (b.x * b.count + p.x) / (b.count + 1);
        b.y = (b.y * b.count + p.y) / (b.count + 1);
        b.count += 1;
    }
    return blobs;
}

// ─── viewer API ──────────────────────────────────────────────
app.post('/api/:channel/click', checkChannel, (req, res) => {
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).end();
    const uid = req.headers['x-uid'] || req.ip;
    clicksOf(req.params.channel).set(uid, { x, y });
    res.sendStatus(200);
});

app.get('/api/:channel/heatmap', checkChannel, (req, res) => {
    const pts = Array.from(clicksOf(req.params.channel).values());
    const total = pts.length;
    if (!total) return res.json({ blobs: [], total });

    // compute average pairwise distance
    let sum = 0;
    for (let i = 0; i < total; i++)
        for (let j = i + 1; j < total; j++)
            sum += dist(pts[i], pts[j]);
    const avgDist = sum / ((total * (total - 1) / 2) || 1);

    // cluster and filter
    let blobs = cluster(pts, clusterRadius(total, avgDist))
        .map(b => ({ ...b, pct: Math.round((b.count / total) * 100) }))
        .filter((b, i) => b.pct >= 5 || i === 0)
        .sort((a, b) => b.pct - a.pct);
    if (blobs.length) blobs[0].isTop = true;

    res.json({ blobs, total });
});

// ─── control endpoints ───────────────────────────────────────
const auth = (req, res, next) => {
    const key = req.query.key || '';
    const envKey = process.env[req.params.channel.toUpperCase() + '_KEY'] || '';
    if (key === envKey) return next();
    res.status(401).send('Bad key');
};

app.post('/api/:channel/reset', checkChannel, auth, (req, res) => {
    clicksOf(req.params.channel).clear();
    res.send('OK');
});

app.post('/api/:channel/start', checkChannel, auth, (_, res) => res.send('OK'));
app.post('/api/:channel/stop', checkChannel, auth, (_, res) => res.send('OK'));

// ─── HTML fallback (if any) ──────────────────────────────────
// You already serve static under /:channel, so no need for explicit HTML routes.

// ─── launch ──────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('ClickMap backend listening on', PORT));
