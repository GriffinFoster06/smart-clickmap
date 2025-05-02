/* admin.js – synced config, LIVE start/stop, unique-viewer counter  */
import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();
const p = new URLSearchParams(location.search);
const minPct = +p.get('minPct') || 5;
const maxCls = +p.get('maxClusters') || 10;
const rate = +p.get('refreshMs') || 2000;

/* ------------------------------------------------------------------ */
/* sync UI inputs */
document.getElementById('cfgPct').value = minPct;
document.getElementById('cfgMax').value = maxCls;
document.getElementById('cfgRate').value = rate;

/* ------------------------------------------------------------------ */
let active = true;
const userClicks = new Map();  // userId → {x,y}
const clickEl = document.getElementById('clicks');
const uniqEl = document.getElementById('unique');
const stateEl = document.getElementById('state');

const redraw = () =>
    drawClusters(
        clusterize([...userClicks.values()], 0.03, minPct, maxCls)
    );

/* periodic refresh */
setInterval(() => { if (active) redraw(); }, rate);

/* ------------------------------------------------------------------ */
/* initial fetch */
(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    saved.forEach(c => userClicks.set(`${c.x},${c.y}`, c)); // key doesn't matter
    active = act.active;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    stateEl.style.color = active ? 'lime' : 'orange';
    clickEl.textContent = `${userClicks.size} unique`;
    uniqEl.textContent = `${userClicks.size} unique`;
    redraw();
})();

/* ------------------------------------------------------------------ */
/* WebSocket */
const ws = socketFor(room, room);

ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }

    if (m.type === 'active') {
        active = m.active;
        stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
        stateEl.style.color = active ? 'lime' : 'orange';
        if (!active) clearHeat();
        return;
    }

    if (!active) return;

    if (m.type === 'click') {
        userClicks.set(m.userId, { x: m.x, y: m.y });
        clickEl.textContent = `${userClicks.size} unique`;
        uniqEl.textContent = `${userClicks.size} unique`;
        redraw();
    }

    if (m.type === 'reset') {
        userClicks.clear();
        clickEl.textContent = '0 unique';
        uniqEl.textContent = '0 unique';
        clearHeat();
    }
};

/* ------------------------------------------------------------------ */
/* START / STOP / RESET buttons  –  now send "active" message */
document.getElementById('start').onclick = () => {
    ws.send(JSON.stringify({ type: 'active', active: true }));
    // optimistic UI
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

/* ------------------------------------------------------------------ */
/* CONFIG → reload + broadcast to overlay/viewer */
document.getElementById('applyCfg').onclick = () => {
    const pct = document.getElementById('cfgPct').value || 5;
    const mx = document.getElementById('cfgMax').value || 10;
    const rt = document.getElementById('cfgRate').value || 2000;
    const q = new URLSearchParams({ minPct: pct, maxClusters: mx, refreshMs: rt });
    localStorage.setItem('clickmapCfg', q.toString());
    location.search = q.toString();            // reload admin
};

document.getElementById('openViewer').onclick = () => {
    const cfg = localStorage.getItem('clickmapCfg');
    window.open(`/room/${room}` + (cfg ? `?${cfg}` : ''), '_blank');
};
document.getElementById('openOverlay').onclick = () => {
    const cfg = localStorage.getItem('clickmapCfg');
    window.open(`/overlay/${room}` + (cfg ? `?${cfg}` : ''), '_blank');
};
