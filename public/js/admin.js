/* admin.js – one-dot logic, persistent STOP, unique count, advanced config */

import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();
const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

// Sync inputs
document.getElementById('cfgPct').value = minPct;
document.getElementById('cfgMax').value = maxClusters;
document.getElementById('cfgRate').value = refreshMs;

let active = true;
const users = new Map();  // Map<userId, {x,y}>

const clickEl = document.getElementById('clicks');
const uniqEl = document.getElementById('unique');
const stateEl = document.getElementById('state');

// Draw clusters
function redraw() {
    drawClusters(clusterize([...users.values()], 0.03, minPct, maxClusters));
}

// Periodic redraw
setInterval(() => { if (active) redraw(); }, refreshMs);

// Initial load
(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);

    saved.forEach(c => {
        // only take clicks with a userId
        if (c.userId) users.set(c.userId, { x: c.x, y: c.y });
    });

    active = act.active;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    stateEl.style.color = active ? 'lime' : 'orange';

    clickEl.textContent = `${users.size} unique`;
    uniqEl.textContent = `${users.size} unique`;
    redraw();
})();

// WebSocket for live updates
const ws = socketFor(room, room);
ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'active') {
        active = msg.active;
        stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
        stateEl.style.color = active ? 'lime' : 'orange';
        if (!active) clearHeat();
        return;
    }
    if (!active) return;

    if (msg.type === 'click') {
        // only accept clicks with a userId
        users.set(msg.userId, { x: msg.x, y: msg.y });
        clickEl.textContent = `${users.size} unique`;
        uniqEl.textContent = `${users.size} unique`;
        redraw();
    }
    if (msg.type === 'reset') {
        users.clear();
        clickEl.textContent = '0 unique';
        uniqEl.textContent = '0 unique';
        clearHeat();
    }
};

// Control buttons
document.getElementById('start').onclick = () => {
    ws.send(JSON.stringify({ type: 'active', active: true }));
    stateEl.textContent = 'RUNNING';
    stateEl.style.color = 'lime';
};
document.getElementById('stop').onclick = () => {
    ws.send(JSON.stringify({ type: 'active', active: false }));
    stateEl.textContent = 'PAUSED';
    stateEl.style.color = 'orange';
};
document.getElementById('reset').onclick = () => {
    ws.send(JSON.stringify({ type: 'reset' }));
};

// Advanced config & launch
document.getElementById('applyCfg').onclick = () => {
    const pct = Number(document.getElementById('cfgPct').value) || 5;
    const mx = Number(document.getElementById('cfgMax').value) || 10;
    const rt = Number(document.getElementById('cfgRate').value) || 2000;
    const q = new URLSearchParams({ minPct: pct, maxClusters: mx, refreshMs: rt });

    localStorage.setItem('clickmapCfg', q.toString());
    location.search = q.toString();
};
document.getElementById('openViewer').onclick = () => {
    const cfg = localStorage.getItem('clickmapCfg');
    window.open(`/room/${room}` + (cfg ? `?${cfg}` : ''), '_blank');
};
document.getElementById('openOverlay').onclick = () => {
    const cfg = localStorage.getItem('clickmapCfg');
    window.open(`/overlay/${room}` + (cfg ? `?${cfg}` : ''), '_blank');
};
