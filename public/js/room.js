import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();
const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

let active = true;
const clicks = [];

const recompute = () => drawClusters(clusterize(clicks, minPct, maxClusters));
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

    document.getElementById('heat').addEventListener('click', e => {
        if (!active) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        ws.send(JSON.stringify({ type: 'click', x, y }));
        clicks.push({ x, y });
    });
})();
