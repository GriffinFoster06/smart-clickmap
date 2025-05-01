import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

// Initialize canvas context
initCanvas();

// Get roomId from URL
const room = getRoomId();

// Allow config overrides via query params
const params = new URLSearchParams(window.location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

// Track state
let active = true;
const clicks = [];

const recompute = () => drawClusters(clusterize(clicks, minPct, maxClusters));
setInterval(() => { if (active) recompute(); }, 300);

(async () => {
    // Load stored clicks + active status
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);

    clicks.push(...saved);
    active = act.active;
    recompute();

    // Connect to WebSocket
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
