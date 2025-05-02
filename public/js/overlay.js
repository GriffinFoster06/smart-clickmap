import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();

// ⬇️ Pull from localStorage (if set)
const stored = localStorage.getItem('clickmapCfg');
if (stored) history.replaceState(null, '', `?${stored}`);

const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

let active = true;
const clicks = [];

setInterval(() => {
    if (active) drawClusters(clusterize(clicks, 0.03, minPct, maxClusters));
}, refreshMs);

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved);
    active = act.active;

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'active') {
            active = msg.active;
            if (!active) clearHeat();
            return;
        }
        if (!active) return;

        if (msg.type === 'click') clicks.push({ x: msg.x, y: msg.y });
        if (msg.type === 'reset') { clicks.length = 0; clearHeat(); }
    };
})();
