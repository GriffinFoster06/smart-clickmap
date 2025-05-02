import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();

// Pull config from localStorage if set by admin
const stored = localStorage.getItem('clickmapCfg');
if (stored) history.replaceState(null, '', `?${stored}`);

const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

let active = true;
const clicks = [];
let userId = null;

// 🧠 Generate persistent device fingerprint using FingerprintJS
const fpPromise = window.FingerprintJS?.load();
(async () => {
    const fp = await fpPromise;
    const result = await fp.get();
    userId = result.visitorId;

    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved);
    active = act.active;
    canvas.style.cursor = active ? 'pointer' : 'not-allowed';
})();

const canvas = document.getElementById('heat');
canvas.addEventListener('click', e => {
    if (!active || !userId) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    ws.send(JSON.stringify({ type: 'click', x, y, userId }));
});

setInterval(() => {
    if (active) drawClusters(clusterize(clicks, 0.03, minPct, maxClusters));
}, refreshMs);

const ws = socketFor(room, room);
ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'active') {
        active = msg.active;
        canvas.style.cursor = active ? 'pointer' : 'not-allowed';
        if (!active) clearHeat();
        return;
    }
    if (!active) return;

    if (msg.type === 'click') {
        clicks.push({ x: msg.x, y: msg.y });
    }
    if (msg.type === 'reset') {
        clicks.length = 0;
        clearHeat();
    }
};
