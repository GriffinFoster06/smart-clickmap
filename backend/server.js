import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------- basic setup ---------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((_, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* ---------- in-memory click store ---------- */
const store = new Map();              // channel → Map(userId → {x,y})

function getClicks(channel) {
    if (!store.has(channel)) store.set(channel, new Map());
    return store.get(channel);
}

/* ---------- helpers ---------- */
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

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
        let b = blobs.find(o => distance(o, p) < radius);
        if (!b) { b = { x: p.x, y: p.y, count: 0 }; blobs.push(b); }
        b.x = (b.x * b.count + p.x) / (b.count + 1);
        b.y = (b.y * b.count + p.y) / (b.count + 1);
        b.count += 1;
    }
    return blobs;
}

/* ---------- static pages ---------- */
const pub = path.resolve(__dirname, '../frontend');
app.use(express.static(pub));

/* ---------- middleware: whitelist ---------- */
const WHITELIST = (process.env.WHITELIST || 'phummylw,dougdoug')
    .split(',').map(s => s.trim().toLowerCase());
app.use('/:channel', (req, res, next) => {
    if (!WHITELIST.includes(req.params.channel.toLowerCase())) {
        return res.status(404).send('Channel not enabled');
    }
    next();
});

/* ---------- HTML routes ---------- */
app.get('/:channel', (req, res) => res.sendFile(path.join(pub, 'viewer.html')));
app.get('/:channel/overlay', (req, res) => res.sendFile(path.join(pub, 'overlay.html')));
app.get('/:channel/control', (req, res) => res.sendFile(path.join(pub, 'control.html')));

/* ---------- API ---------- */
const SECRET = process.env.JWT_SECRET || 'dummy';   // used *only* to tokenise user clicks if needed

app.post('/api/:channel/click', (req, res) => {
    const { x, y } = req.body;
    const uid = req.headers['x-uid'] || req.ip;       // simple anon identity
    const map = getClicks(req.params.channel);
    map.set(uid, { x, y });
    res.sendStatus(200);
});

app.get('/api/:channel/heatmap', (req, res) => {
    const map = getClicks(req.params.channel);
    const points = Array.from(map.values());
    const total = points.length;
    if (!total) return res.json({ blobs: [], total });

    /* adaptive radius */
    let avg = 0;
    for (let i = 0; i < total; i++)
        for (let j = i + 1; j < total; j++)
            avg += distance(points[i], points[j]);
    avg /= (total * (total - 1) / 2) || 1;

    const blobs = cluster(points, clusterRadius(total, avg))
        .map(b => ({ ...b, pct: Math.round((b.count / total) * 100) }))
        .filter((b, i, arr) => b.pct >= 5 || i === 0)      // ≥5 % or top blob
        .sort((a, b) => b.pct - a.pct);
    if (blobs.length) blobs[0].isTop = true;
    res.json({ blobs, total });
});

/* ---------- control endpoints (key in query) ---------- */
function chkKey(req, res, next) {
    const chan = req.params.channel;
    if ((req.query.key || '') === (process.env[chan.toUpperCase() + '_KEY'] || '')) return next();
    res.status(401).send('Bad key');
}

app.post('/api/:channel/reset', chkKey, (r, s) => { getClicks(r.params.channel).clear(); s.send('OK'); });
app.post('/api/:channel/start', chkKey, (r, s) => s.send('OK'));   // no-op (clicks already enabled)
app.post('/api/:channel/stop', chkKey, (r, s) => s.send('OK'));   // viewer JS honours stop

/* ---------- listen ---------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('ClickMap backend on', PORT));
