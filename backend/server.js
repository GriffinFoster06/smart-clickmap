import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;

// In-memory click store: channel → Map<userId,{x,y}>
const store = new Map();

// Utility: Euclidean distance
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Cluster points by simple radius grouping
function cluster(points, radius) {
  const blobs = [];
  points.forEach(p => {
    let hit = blobs.find(b => distance(p, b) < radius);
    if (!hit) {
      hit = { x: p.x, y: p.y, count: 0 };
      blobs.push(hit);
    }
    hit.x = (hit.x * hit.count + p.x) / (hit.count + 1);
    hit.y = (hit.y * hit.count + p.y) / (hit.count + 1);
    hit.count += 1;
  });
  return blobs;
}

const app = express();
// Allow static site origins
app.use(cors({ origin: [/\.phummylw\.com$/i] }));
app.use(express.json());

// Health check
app.get('/health', (_, res) => res.send('ok'));

// Receive a click: POST /click/:chan  { x:number, y:number }
app.post('/click/:chan', (req, res) => {
  const chan = req.params.chan.toLowerCase();
  const { x, y } = req.body;
  if (typeof x !== 'number' || typeof y !== 'number') return res.sendStatus(400);

  // Identify user by IP+UA (for better privacy later replace with OAuth)
  const uid = req.ip + (req.headers['user-agent']||'');

  if (!store.has(chan)) store.set(chan, new Map());
  store.get(chan).set(uid, { x, y });
  res.sendStatus(200);
});

// Control endpoints: /start, /stop, /reset
app.post('/:action(start|stop|reset)/:chan', (req, res) => {
  const { action, chan } = req.params;
  if (action === 'reset') store.set(chan.toLowerCase(), new Map());
  // start/stop are stateless for viewer code
  res.send(`${action} ok`);
});

// Heatmap data: GET /heatmap/:chan → { blobs:[{x,y,pct,isTop}], total }
app.get('/heatmap/:chan', (req, res) => {
  const chan = req.params.chan.toLowerCase();
  const clicks = [...(store.get(chan)?.values()||[])];
  const total = clicks.length;
  if (total === 0) return res.json({ blobs: [], total });

  // adaptive radius: shrink as more clicks
  const radius = Math.max(0.01, 0.05 / Math.sqrt(total));
  let blobs = cluster(clicks, radius);
  blobs.sort((a, b) => b.count - a.count);

  const payload = blobs
    .map((b, i) => ({
      x: b.x, y: b.y,
      pct: Math.round((b.count/total)*100),
      isTop: i===0
    }))
    .filter(b => b.pct >= 5 || b.isTop);

  res.json({ blobs: payload, total });
});

// Optional WebSocket broadcast for low-latency updates
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
setInterval(() => {
  for (const [chan, map] of store) {
    const clicks = [...map.values()];
    const total = clicks.length;
    if (!total) continue;
    const radius = Math.max(0.01, 0.05 / Math.sqrt(total));
    let blobs = cluster(clicks, radius).sort((a,b)=>b.count-a.count);
    const data = {
      chan,
      blobs: blobs
        .map((b,i)=>({
          x:b.x, y:b.y,
          pct: Math.round((b.count/total)*100),
          isTop: i===0
        }))
        .filter(b=>b.pct>=5||b.isTop)
    };
    const msg = JSON.stringify(data);
    wss.clients.forEach(c=> c.readyState===1 && c.send(msg));
  }
}, 1000);

server.listen(PORT, ()=> console.log(`API listening on ${PORT}`));
