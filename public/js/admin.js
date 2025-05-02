import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();
const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
const refreshMs = Number(params.get('refreshMs')) || 2000;

// Sync form with URL
document.getElementById('cfgPct').value = minPct;
document.getElementById('cfgMax').value = maxClusters;
document.getElementById('cfgRate').value = refreshMs;

let active = true;
const clicks = [];

const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

// Recompute periodically
function recompute() {
    drawClusters(clusterize(clicks, 0.03, minPct, maxClusters));
}
setInterval(() => { if (active) recompute(); }, refreshMs);

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved);
    active = act.active;
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    recompute();

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'active') {
            active = msg.active;
            stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
            if (!active) clearHeat();
            return;
        }
        if (!active) return;

        if (msg.type === 'click') {
            clicks.push({ x: msg.x, y: msg.y });
            clickEl.textContent = `${clicks.length} clicks`;
            recompute();
        }

        if (msg.type === 'reset') {
            clicks.length = 0;
            clickEl.textContent = '0 clicks';
            clearHeat();
        }
    };

    document.getElementById('start').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
    document.getElementById('stop').onclick = () => ws.send(JSON.stringify({ type: 'stop' }));
    document.getElementById('reset').onclick = () => ws.send(JSON.stringify({ type: 'reset' }));
})();

// Apply + Launch
document.getElementById('applyCfg').onclick = () => {
    const pct = document.getElementById('cfgPct').value || 5;
    const mx = document.getElementById('cfgMax').value || 10;
    const rt = document.getElementById('cfgRate').value || 2000;
    const q = new URLSearchParams();
    q.set('minPct', pct);
    q.set('maxClusters', mx);
    q.set('refreshMs', rt);
    location.search = q.toString(); // reload
};

document.getElementById('openViewer').onclick = () => {
    const pct = document.getElementById('cfgPct').value || 5;
    const mx = document.getElementById('cfgMax').value || 10;
    const rt = document.getElementById('cfgRate').value || 2000;
    const url = `/room/${room}?minPct=${pct}&maxClusters=${mx}&refreshMs=${rt}`;
    window.open(url, '_blank');
};

document.getElementById('openOverlay').onclick = () => {
    const pct = document.getElementById('cfgPct').value || 5;
    const mx = document.getElementById('cfgMax').value || 10;
    const rt = document.getElementById('cfgRate').value || 2000;
    const url = `/overlay/${room}?minPct=${pct}&maxClusters=${mx}&refreshMs=${rt}`;
    window.open(url, '_blank');
};
