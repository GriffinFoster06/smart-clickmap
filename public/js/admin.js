import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();

let cfg = {
    minPct: 5,
    maxN: 10,
    minR: 12,
    k: 8,
    maxR: 64,
    topColor: 'lime',
    clusterColor: 'white',
    topStroke: 3,
    otherStroke: 2,
    fontScale: 0.55
};

const clicks = [];
let active = true;

const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

function updateAndRender() {
    render(clusterize(clicks, cfg), cfg);
}

setInterval(() => {
    if (active) updateAndRender();
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
    updateAndRender();

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
            clicks.push({ x: m.x, y: m.y });d
            clickEl.textContent = `${clicks.length} clicks`;
        }

        if (m.type === 'reset') {
            clicks.length = 0;
            clickEl.textContent = '0 clicks';
            clear();
        }
    };

    document.getElementById('start').onclick = () => ws.send('{"type":"start"}');
    document.getElementById('stop').onclick = () => ws.send('{"type":"stop"}');
    document.getElementById('reset').onclick = () => ws.send('{"type":"reset"}');
})();

// 🚀 Apply without reload
document.getElementById('applyCfg').onclick = () => {
    cfg.minPct = parseFloat(document.getElementById('cfgPct').value) || cfg.minPct;
    cfg.maxN = parseInt(document.getElementById('cfgMax').value) || cfg.maxN;
    cfg.minR = parseFloat(document.getElementById('cfgMinR').value) || cfg.minR;
    cfg.k = parseFloat(document.getElementById('cfgK').value) || cfg.k;
    updateAndRender();

    // Optional: reflect new config in URL for sharing/debugging
    const url = new URL(window.location.href);
    url.searchParams.set('minPct', cfg.minPct);
    url.searchParams.set('maxClusters', cfg.maxN);
    url.searchParams.set('minR', cfg.minR);
    url.searchParams.set('scaleFactor', cfg.k);
    window.history.replaceState({}, '', url);
};
