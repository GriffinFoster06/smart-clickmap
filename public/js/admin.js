/* admin.js – cleaned admin panel with working Apply */
import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();
const qp = new URLSearchParams(location.search);

const cfg = {
    minPct: parseFloat(qp.get('minPct')) || 5,
    maxN: parseInt(qp.get('maxClusters')) || 10,
    minR: parseFloat(qp.get('minR')) || 12,
    k: parseFloat(qp.get('scaleFactor')) || 8,
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

setInterval(() => {
    if (active) render(clusterize(clicks, cfg), cfg);
}, 300);

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

// Apply button → updates query string, reloads admin page
document.getElementById('applyCfg').onclick = () => {
    const q = new URLSearchParams();
    q.set('minPct', document.getElementById('cfgPct').value);
    q.set('maxClusters', document.getElementById('cfgMax').value);
    q.set('minR', document.getElementById('cfgMinR').value);
    q.set('scaleFactor', document.getElementById('cfgK').value);
    window.location.search = '?' + q.toString();
};
