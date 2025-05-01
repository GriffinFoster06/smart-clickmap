/* admin.js – power panel with live stats + config redirect */
import { getRoomId, socketFor } from './util.js';
import { boot, render, clear } from './heatmap.js';
import { clusterize } from './cluster.js';

boot();
const room = getRoomId();
const qp = new URLSearchParams(location.search);
const cfg = {
    eps: +qp.get('mergeRadius') || 0.03,
    minPct: +qp.get('minPct') || 5,
    maxN: +qp.get('maxClusters') || 10,
    minR: 12, k: 8, topColor: 'lime', clusterColor: 'white', topStroke: 3, otherStroke: 2, fontScale: .55
};
let active = true; const clicks = [];

const clickEl = document.getElementById('clicks'), stateEl = document.getElementById('state');
const draw = () => render(clusterize(clicks, cfg), cfg);
setInterval(() => { if (active) draw(); }, 300);

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved); active = act.active;
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    draw();

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; stateEl.textContent = active ? 'RUNNING' : 'PAUSED'; if (!active) clear(); return; }
        if (!active) return;
        if (m.type === 'click') { clicks.push({ x: m.x, y: m.y }); clickEl.textContent = `${clicks.length} clicks`; }
        if (m.type === 'reset') { clicks.length = 0; clickEl.textContent = '0 clicks'; clear(); }
    };

    document.getElementById('start').onclick = () => ws.send('{"type":"start"}');
    document.getElementById('stop').onclick = () => ws.send('{"type":"stop"}');
    document.getElementById('reset').onclick = () => ws.send('{"type":"reset"}');
})();

document.getElementById('applyCfg').onclick = () => {
    const q = new URLSearchParams();
    q.set('minPct', document.getElementById('cfgPct').value || cfg.minPct);
    q.set('maxClusters', document.getElementById('cfgMax').value || cfg.maxN);
    q.set('mergeRadius', document.getElementById('cfgMerge').value || cfg.eps);
    location.search = q.toString();
};
