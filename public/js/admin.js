import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();

/* defaults */
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

/* helpers */
const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');
const redraw = () => render(clusterize(clicks, cfg), cfg);

/* periodic */
setInterval(() => { if (active) redraw(); }, 300);

/* initial data */
(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved);
    active = act.active;
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    redraw();

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'active') {
            active = msg.active;
            stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
            if (!active) clear();
            return;
        }
        if (!active) return;

        if (msg.type === 'click') {
            clicks.push({ x: msg.x, y: msg.y });
            clickEl.textContent = `${clicks.length} clicks`;
        }
        if (msg.type === 'reset') {
            clicks.length = 0;
            clickEl.textContent = '0 clicks';
            clear();
        }
    };

    document.getElementById('start').onclick = () => ws.send('{"type":"start"}');
    document.getElementById('stop').onclick = () => ws.send('{"type":"stop"}');
    document.getElementById('reset').onclick = () => ws.send('{"type":"reset"}');
})();

/* live Apply (no refresh) */
document.getElementById('applyCfg').onclick = () => {
    cfg.minPct = +document.getElementById('cfgPct').value || cfg.minPct;
    cfg.maxN = +document.getElementById('cfgMax').value || cfg.maxN;
    cfg.minR = +document.getElementById('cfgMinR').value || cfg.minR;
    cfg.k = +document.getElementById('cfgK').value || cfg.k;
    redraw();

    /* keep URL in sync for sharing without reload */
    const u = new URL(location.href);
    u.searchParams.set('minPct', cfg.minPct);
    u.searchParams.set('maxClusters', cfg.maxN);
    u.searchParams.set('minR', cfg.minR);
    u.searchParams.set('scaleFactor', cfg.k);
    history.replaceState({}, '', u);
};
