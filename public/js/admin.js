/* admin.js – power panel with fixed “Apply & Reload” */
import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();

// Read config from URL
const qp = new URLSearchParams(location.search);
const cfg = {
    eps: parseFloat(qp.get('mergeRadius')) || 0.03,
    minPct: parseFloat(qp.get('minPct')) || 5,
    maxN: parseInt(qp.get('maxClusters')) || 10,
    minR: 12,    // visual minimum radius
    k: 8,     // scaling factor for radius
    maxR: 64,
    topColor: 'lime',
    clusterColor: 'white',
    topStroke: 3,
    otherStroke: 2,
    fontScale: 0.55
};

let active = true;
const clicks = [];

const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

// Periodic redraw
setInterval(() => { if (active) render(clusterize(clicks, cfg), cfg); }, 300);

// Initial load
(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);

    clicks.push(...saved);
    active = act.active;
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    render(clusterize(clicks, cfg), cfg);

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }

        if (m.type === 'active') {
            active = m.active;
            stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
            if (!active) clear();
            return;
        }
        if (!active) return;

        if (m.type === 'click') {
            clicks.push({ x: m.x, y: m.y });
            clickEl.textContent = `${clicks.length} clicks`;
        }
        if (m.type === 'reset') {
            clicks.length = 0;
            clickEl.textContent = '0 clicks';
            clear();
        }
    };

    document.getElementById('start').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
    document.getElementById('stop').onclick = () => ws.send(JSON.stringify({ type: 'stop' }));
    document.getElementById('reset').onclick = () => ws.send(JSON.stringify({ type: 'reset' }));
})();

// Fixed Apply & Reload
document.getElementById('applyCfg').onclick = () => {
    const params = new URLSearchParams(window.location.search);
    params.set('minPct', document.getElementById('cfgPct').value);
    params.set('maxClusters', document.getElementById('cfgMax').value);
    params.set('mergeRadius', document.getElementById('cfgMerge').value);
    window.location.search = params.toString();  // reloads, preserves path
};

