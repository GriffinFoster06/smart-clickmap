/* room.js – Interactive viewer page
 *
 * - Shows embedded stream with a canvas overlay
 * - Viewers click directly on the canvas
 * - Clicks are sent to the server via WebSocket
 * - Recomputes & displays clusters every 300ms
 */

import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

// Initialize canvas context
initCanvas();

// Get roomId from URL
const room = getRoomId();

// Allow config overrides via query params
const params = new URLSearchParams(window.location.search);
const minPct = Number(params.get('minPct')) || 5;
const maxClusters = Number(params.get('maxClusters')) || 10;

// Track state
let active = true;
const clicks = [];

// Redraw clusters periodically
setInterval(() => {
    if (active) {
        const clusters = clusterize(clicks, 0.03, minPct, maxClusters);
        drawClusters(clusters);
    }
}, 300);

(async () => {
    // Load stored clicks + active status
    const [saved, status] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(res => res.json()),
        fetch(`/api/active/${room}`).then(res => res.json())
    ]);

    clicks.push(...saved);
    active = status.active;

    // Connect to WebSocket
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

    // Handle viewer clicks
    const canvas = document.getElementById('heat');
    canvas.addEventListener('click', (e) => {
        if (!active) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        ws.send(JSON.stringify({ type: 'click', x, y }));
        clicks.push({ x, y });
    });
})();
