/* room.js – one-dot-per-user, persistent STOP, no coordinate fallback */

import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();

// sync config from admin
const storedCfg = localStorage.getItem('clickmapCfg');
if (storedCfg) history.replaceState(null, '', `?${storedCfg}`);

const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

// get persistent device/user ID (FingerprintJS or localStorage fallback)
let userId = localStorage.getItem('clickmapUserId');
if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('clickmapUserId', userId);
}

let active = true;
const users = new Map();  // userId → {x,y}

const canvas = document.getElementById('heat');
canvas.addEventListener('click', e => {
    if (!active) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    ws.send(JSON.stringify({ type: 'click', x, y, userId }));
});

// draw loop
setInterval(() => {
    if (active) drawClusters(clusterize([...users.values()], 0.03, minPct, maxClusters));
}, refreshMs);

const ws = socketFor(room, room);

// initial load
(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    saved.forEach(c => {
        if (c.userId) users.set(c.userId, { x: c.x, y: c.y });
    });
    active = act.active;
    canvas.style.cursor = active ? 'pointer' : 'not-allowed';
})();

// live updates
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
        users.set(msg.userId, { x: msg.x, y: msg.y });
    }
    if (msg.type === 'reset') {
        users.clear();
        clearHeat();
    }
};
