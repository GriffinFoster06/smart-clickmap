/* overlay.js – OBS browser source overlay
 *
 * - Connects to the server via WebSocket
 * - Receives live clicks and reset events
 * - Dynamically recomputes and renders clusters every 300ms
 * - Fully passive (pointer-events: none)
 */

import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

// Initialize canvas context
initCanvas();

// Extract roomId from URL
const room = getRoomId();

// Allow config overrides via query params
const params = new URLSearchParams(window.location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

// Track live state
let active = true;
const clicks = [];

// Recalculate and redraw every 300ms
setInterval(() => {
    if (active) {
        const clusters = clusterize(clicks, 0.03, minPct, maxClusters);
        drawClusters(clusters);
    }
}, 300);

(async () => {
    // Load initial state
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);

    clicks.push(...saved);
    active = status.active;

    // WebSocket: live updates
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
    };
})();
