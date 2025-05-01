import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Set up canvas
initCanvas();

// Get room from URL
const room = getRoomId();
let active = true;
const allClicks = [];

const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

const render = () => drawClusters(clusterize(allClicks));

(async () => {
    // Load from backend
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);
    allClicks.push(...saved);
    active = act.active;
    clickEl.textContent = `${allClicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    recompute();

    // WebSocket setup
    const ws = socketFor(room, room);
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'active') { active = m.active; stateEl.textContent = active ? 'RUNNING' : 'PAUSED'; return; }
        if (!active) return;

        if (m.type === 'click') { allClicks.push({ x: m.x, y: m.y }); clickEl.textContent = `${allClicks.length} clicks`; render(); }
        if (m.type === 'reset') { allClicks.length = 0; clickEl.textContent = '0 clicks'; clearHeat(); }
    };

    document.getElementById('start').onclick = () => ws.send('{"type":"start"}');
    document.getElementById('stop').onclick = () => ws.send('{"type":"stop"}');
    document.getElementById('reset').onclick = () => ws.send('{"type":"reset"}');
})();
