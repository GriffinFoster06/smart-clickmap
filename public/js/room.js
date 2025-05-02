import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();

const savedCfg = localStorage.getItem('clickmapCfg');
if (savedCfg) history.replaceState(null, '', `?${savedCfg}`);

const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

// Unique user ID per viewer (localStorage-persistent)
const userId = localStorage.getItem('clickmapUserId') || crypto.randomUUID();
localStorage.setItem('clickmapUserId', userId);

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

        if (msg.type === 'click') {
            // replace existing click from same user
            clicks.push({ x: msg.x, y: msg.y });
        }
        if (msg.type === 'reset') {
            clicks.length = 0;
            clearHeat();
        }
    };

    const canvas = document.getElementById('heat');
    canvas.addEventListener('click', e => {
        if (!active) return;
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        ws.send(JSON.stringify({ type: 'click', x, y, userId }));
    });
})();
