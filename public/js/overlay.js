import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();
const qp = new URLSearchParams(location.search);

const cfg = {
    minPct: +qp.get('minPct') || 5,
    maxN: +qp.get('maxClusters') || 10,
    minR: +qp.get('minR') || 12,
    k: +qp.get('scaleFactor') || 8,
    maxR: 64,
    topColor: 'lime', clusterColor: 'white', topStroke: 3, otherStroke: 2, fontScale: .55
};

let active = true;
const clicks = [];

setInterval(() => { if (active) render(clusterize(clicks, cfg), cfg); }, 300);

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved); active = act.active;
    render(clusterize(clicks, cfg), cfg);

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'active') { active = msg.active; if (!active) clear(); return; }
        if (!active) return;
        if (msg.type === 'click') clicks.push({ x: msg.x, y: msg.y });
        if (msg.type === 'reset') { clicks.length = 0; clear(); }
    };
})();
