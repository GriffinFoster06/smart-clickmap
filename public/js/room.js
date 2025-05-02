import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();

/* pull config from admin */
const cfg = localStorage.getItem('clickmapCfg');
if (cfg) history.replaceState(null, '', `?${cfg}`);

const p = new URLSearchParams(location.search);
const minPct = +p.get('minPct') || 5;
const maxCls = +p.get('maxClusters') || 10;
const refreshMs = +p.get('refreshMs') || 2000;

/* persistent device ID (FingerprintJS already loaded by CDN) */
const fp = await window.FingerprintJS.load();
const { visitorId: userId } = await fp.get();

let active = true;
const userMap = new Map();        // userId → {x,y}

const canvas = document.getElementById('heat');
canvas.addEventListener('click', e => {
    if (!active) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    ws.send(JSON.stringify({ type: 'click', x, y, userId }));
});

const ws = socketFor(room, room);

/* draw loop */
const drawLoop = () =>
    drawClusters(clusterize([...userMap.values()], 0.03, minPct, maxCls));
setInterval(() => { if (active) drawLoop(); }, refreshMs);

/* initial state */
const [saved, act] = await Promise.all([
    fetch(`/api/clicks/${room}`).then(r => r.json()),
    fetch(`/api/active/${room}`).then(r => r.json())
]);
saved.forEach(c => userMap.set(c.userId ?? `${c.x},${c.y}`, c));
active = act.active;
canvas.style.cursor = active ? 'pointer' : 'not-allowed';
drawLoop();

/* ws messages */
ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'active') {
        active = msg.active;
        canvas.style.cursor = active ? 'pointer' : 'not-allowed';
        if (!active) clearHeat();
        return;
    }
    if (!active) return;

    if (msg.type === 'click') {
        userMap.set(msg.userId, { x: msg.x, y: msg.y });
    }
    if (msg.type === 'reset') {
        userMap.clear(); clearHeat();
    }
};
