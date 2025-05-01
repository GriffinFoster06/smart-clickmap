/* admin.js – Streamer control panel logic
 *
 * - Displays live cluster view of their stream
 * - Buttons for start, stop (pause), and reset
 * - Displays click count and pause status
 * - Supports config override (minPct + maxClusters)
 */

import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Set up canvas
initCanvas();

// Get room from URL
const room = getRoomId();

// Configurable via query params
const params = new URLSearchParams(window.location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

// UI elements
const clickEl = document.getElementById('clicks');
const stateEl = document.getElementById('state');

// Internal state
let active = true;
const clicks = [];

/** Redraw clusters periodically */
function recompute() {
    const clusters = clusterize(clicks, 0.03, minPct, maxClusters);
    drawClusters(clusters);
}
setInterval(() => { if (active) recompute(); }, 300);

(async () => {
    // Load from backend
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);
    clicks.push(...saved);
    active = status.active;
    clickEl.textContent = `${clicks.length} clicks`;
    stateEl.textContent = active ? 'RUNNING' : 'PAUSED';
    recompute();

    // WebSocket setup
    const ws = socketFor(room, room);
    ws.onmessage = (e) => {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch {
            return;
        }

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

    // Hook up controls
    document.getElementById('start').onclick = () => {
        ws.send(JSON.stringify({ type: 'start' }));
    };
    document.getElementById('stop').onclick = () => {
        ws.send(JSON.stringify({ type: 'stop' }));
    };
    document.getElementById('reset').onclick = () => {
        ws.send(JSON.stringify({ type: 'reset' }));
    };
})();

// Handle advanced config override
document.getElementById('applyCfg').onclick = () => {
    const pct = document.getElementById('cfgPct').value || minPct;
    const mx = document.getElementById('cfgMax').value || maxClusters;
    const qp = new URLSearchParams();
    qp.set('minPct', pct);
    qp.set('maxClusters', mx);
    window.location.search = qp.toString(); // reload with new config
};
