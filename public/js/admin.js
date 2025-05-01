/* admin.js – admin panel with configs & dynamic clustering */
import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Set up canvas
initCanvas();

// Get room from URL
const room = getRoomId();
const params = new URLSearchParams(location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

let active = true;
const clicks = [];

const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

// Recompute every 300ms
function recompute() {
    drawClusters(clusterize(clicks, 0.03, minPct, maxClusters));
}
setInterval(() => { if (active) recompute(); }, 300);

(async () => {
    // Load from backend
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);
    clicks.push(...saved);
    active = status.active; // Fixed incorrect variable 'act' to 'status'
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';

    // Call recompute instead of the undefined render function
    recompute();

    // WebSocket setup
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

// Advanced config panel toggles via query params
document.getElementById('applyCfg').onclick = () => {
    const pct = document.getElementById('cfgPct').value || minPct;
    const mx = document.getElementById('cfgMax').value || maxClusters;
    const q = new URLSearchParams();
    q.set('minPct', pct);
    q.set('maxClusters', mx);
    location.search = q.toString();
};
