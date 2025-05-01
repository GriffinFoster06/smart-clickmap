<<<<<<< HEAD
﻿/* overlay.js – OBS browser source overlay
 *
 * - Connects to the server via WebSocket
 * - Receives live clicks and reset events
 * - Dynamically recomputes and renders clusters every 300ms
 * - Fully passive (pointer-events: none)
 */

import { getRoomId, socketFor } from './util.js';
=======
﻿import { getRoomId, socketFor } from './util.js';
>>>>>>> parent of 163a9b1 (full overhaul)
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Initialize canvas context
initCanvas();

// Extract roomId from URL
const room = getRoomId();
<<<<<<< HEAD

// Allow config overrides via query params
const params = new URLSearchParams(window.location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;
=======
const urlParams = new URLSearchParams(location.search);
const minPct = Number(urlParams.get('minPct')) || 5;
const maxClusters = Number(urlParams.get('maxClusters')) || 10;
>>>>>>> parent of 163a9b1 (full overhaul)

// Track live state
let active = true;
const clicks = [];

<<<<<<< HEAD
// Recalculate and redraw every 300ms
setInterval(() => {
    if (active) {
        const clusters = clusterize(clicks, 0.03, minPct, maxClusters);
        drawClusters(clusters);
    }
}, 300);
=======
function recompute() { drawClusters(clusterize(clicks, minPct, maxClusters)); }

/* periodic recompute – keeps clusters fresh */
setInterval(() => { if (active) recompute(); }, 300);
>>>>>>> parent of 163a9b1 (full overhaul)

(async () => {
    // Load initial state
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);
<<<<<<< HEAD
=======
    clicks.push(...saved);
    active = act.active;
    recompute();
>>>>>>> parent of 163a9b1 (full overhaul)

    clicks.push(...saved);
    active = status.active;

    // WebSocket: live updates
    const ws = socketFor(room, room);
<<<<<<< HEAD
    ws.onmessage = (e) => {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch {
            return;
        }

        if (msg.type === 'active') {
            active = msg.active;
            if (!active) clearHeat();
            return;
        }

        if (!active) return;

        if (msg.type === 'click') {
            clicks.push({ x: msg.x, y: msg.y });
        }

        if (msg.type === 'reset') {
            clicks.length = 0;
            clearHeat();
        }
=======
    ws.onmessage = e => {
        try { var m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; return; }
        if (!active) return;

        if (m.type === 'click') { clicks.push({ x: m.x, y: m.y }); }
        if (m.type === 'reset') { clicks.length = 0; clearHeat(); }
>>>>>>> parent of 163a9b1 (full overhaul)
    };
})();
