import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();
const urlParams = new URLSearchParams(location.search);
const minPct = Number(urlParams.get('minPct')) || 5;
const maxClusters = Number(urlParams.get('maxClusters')) || 10;

let active = true;
const clicks = [];

function recompute() { drawClusters(clusterize(clicks, minPct, maxClusters)); }

/* periodic recompute – keeps clusters fresh */
setInterval(() => { if (active) recompute(); }, 300);

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved);
    active = act.active;
    recompute();

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        try { var m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; return; }
        if (!active) return;

        if (m.type === 'click') { clicks.push({ x: m.x, y: m.y }); }
        if (m.type === 'reset') { clicks.length = 0; clearHeat(); }
    };
})();
