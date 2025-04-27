import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const PORT = process.env.PORT || 8080;
const RADIUS = Number(process.env.CLUSTER_RADIUS) || 0.05; // 5% distance
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// In-memory store: userId → { x, y }
const clicks = new Map();
let isRunning = true;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Record or update a viewer click
app.post('/click', (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        if (!isRunning) return res.status(403).json({ error: 'not-running' });
        if (typeof x !== 'number' || typeof y !== 'number')
            return res.status(400).json({ error: 'coords' });
        clicks.set(payload.user_id, { x, y });
        return res.sendStatus(200);
    } catch {
        return res.status(401).json({ error: 'jwt' });
    }
});

// Reset everything
app.post('/reset', (_, res) => {
    clicks.clear();
    isRunning = true;
    res.send('reset');
});

// Optional start endpoint
app.post('/start', (_, res) => {
    isRunning = true;
    res.send('started');
});

// Health check
app.get('/health', (_, res) => res.send('ok'));

// Simple clustering: group clicks if within RADIUS
function clusterClicks(clicksMap, radius) {
    const clusters = [];
    for (const { x, y } of clicksMap.values()) {
        let placed = false;
        for (const c of clusters) {
            const dx = x - c.x, dy = y - c.y;
            if (Math.hypot(dx, dy) <= radius) {
                // merge into existing cluster
                const newCount = c.count + 1;
                c.x = (c.x * c.count + x) / newCount;
                c.y = (c.y * c.count + y) / newCount;
                c.count = newCount;
                placed = true;
                break;
            }
        }
        if (!placed) {
            clusters.push({ x, y, count: 1 });
        }
    }
    return clusters;
}

// Return dynamic blobs
app.get('/heatmap', (req, res) => {
    const clusters = clusterClicks(clicks, RADIUS);
    const totalClicks = clicks.size;
    let maxIndex = -1, maxCount = 0;
    clusters.forEach((c, i) => {
        if (c.count > maxCount) { maxCount = c.count; maxIndex = i; }
    });
    res.json({
        type: 'heatmap',
        running: isRunning,
        blobs: clusters,
        totalClicks,
        maxIndex
    });
});

app.listen(PORT, () => console.log(`EBS listening on ${PORT}`));