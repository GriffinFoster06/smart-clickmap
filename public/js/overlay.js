import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Initialize canvas context
initCanvas();

// Extract roomId from URL
const room = getRoomId();
const urlParams = new URLSearchParams(location.search);
const minPct = Number(urlParams.get('minPct')) || 5;
const maxClusters = Number(urlParams.get('maxClusters')) || 10;

// Track live state
let active = true;
const clicks = [];

function recompute() { drawClusters(clusterize(clicks, minPct, maxClusters)); }

/* periodic recompute – keeps clusters fresh */
setInterval(() => { if (active) recompute(); }, 300);

(async () => {
    // Load initial state
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);

    clicks.push(...saved);
    active = act.active;
    drawClusters(clusterize(clicks, 0.03, minPct, maxClusters));

    // WebSocket: live updates
    const ws = socketFor(room, room);
    ws.onmessage = e => {
        try { var m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; return; }
        if (!active) return;

        if (msg.type === 'click') clicks.push({ x: msg.x, y: msg.y });
        if (msg.type === 'reset') clicks.length = 0, clearHeat();
    };
})();
