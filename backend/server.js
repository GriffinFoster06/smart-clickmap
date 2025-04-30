import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ───────────────────────────────────────────── basics */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((_, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* ───────────────────────────────────── in-memory store */
const store = new Map();                     // channel → Map(uid → {x,y})
const clicksOf = ch => { if (!store.has(ch)) store.set(ch, new Map()); return store.get(ch); };

/* ────────────────────────────────────────── whitelist */
const WL = (process.env.WHITELIST || 'phummylw').split(',').map(s => s.trim().toLowerCase());

app.use('/:channel', (req, res, next) => {
    if (!WL.includes(req.params.channel.toLowerCase())) return res.status(404).send('channel disabled');
    next();
});

app.use('/api/:channel', (req, res, next) => {
    if (!WL.includes(req.params.channel.toLowerCase())) return res.status(404).send('channel disabled');
    next();
});

/* ─────────────────────────────────── static frontend */
const pub = path.resolve(__dirname, '../frontend');
app.use(express.static(pub));

app.get('/:channel', (r, s) => s.sendFile(path.join(pub, 'viewer.html')));
app.get('/:channel/overlay', (r, s) => s.sendFile(path.join(pub, 'overlay.html')));
app.get('/:channel/control', (r, s) => s.sendFile(path.join(pub, 'control.html')));

/* ────────────────────────────────── helper functions */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function radiusFor(total, avg) {
    if (total < 50) return 0.05;
    if (avg < 0.05) return 0.01;
    if (avg < 0.10) return 0.02;
    if (avg < 0.20) return 0.03;
    return 0.05;
}

function cluster(pts, r) {
    const blobs = [];
    for (const p of pts) {
        let b = blobs.find(o => dist(o, p) < r);
        if (!b) { b = { x: p.x, y: p.y, count: 0 }; blobs.push(b); }
        b.x = (b.x * b.count + p.x) / (b.count + 1);
        b.y = (b.y * b.count + p.y) / (b.count + 1);
        b.count++;
    }
    return blobs;
}

/* ───────────────────────────────── viewer API */
app.post('/api/:channel/click', (req, res) => {
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).end();
    const uid = req.headers['x-uid'] || req.ip;
    clicksOf(req.params.channel).set(uid, { x, y });
    res.sendStatus(200);
});

app.get('/api/:channel/heatmap', (req, res) => {
    const points = Array.from(clicksOf(req.params.channel).values());
    const total = points.length;
    if (!total) return res.json({ blobs: [], total: 0 });

    let avg = 0;
    for (let i = 0; i < total; i++)
        for (let j = i + 1; j < total; j++)
            avg += dist(points[i], points[j]);
    avg /= (total * (total - 1) / 2) || 1;

    let blobs = cluster(points, radiusFor(total, avg))
        .map(b => ({ ...b, pct: Math.round(b.count / total * 100) }))
        .filter((b, i) => b.pct >= 5 || i === 0)
        .sort((a, b) => b.pct - a.pct).reverse();

    if (blobs.length) blobs[0].isTop = true;
    res.json({ blobs, totalClicks: total });
});

/* ───────────────────────────────── control (key auth) */
const auth = (req, res, next) => {
    const chan = req.params.channel.toUpperCase();
    if ((req.query.key || '') === process.env[`${chan}_KEY`]) return next();
    res.status(401).end();
};

app.post('/api/:channel/reset', auth, (req, res) => {
    clicksOf(req.params.channel).clear();
    res.send('OK');
});
app.post('/api/:channel/start', auth, (req, res) => res.send('OK'));
app.post('/api/:channel/stop', auth, (req, res) => res.send('OK'));

/* ───────────────────────────────────────────────────── */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('ClickMap backend on', PORT));
