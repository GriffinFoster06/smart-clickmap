<<<<<<< HEAD
/* room.js – Interactive viewer page
 *
 * - Shows embedded stream with a canvas overlay
 * - Viewers click directly on the canvas
 * - Clicks are sent to the server via WebSocket
 * - Recomputes & displays clusters every 300ms
 */

=======
>>>>>>> parent of 163a9b1 (full overhaul)
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

<<<<<<< HEAD
// Redraw clusters periodically
setInterval(() => {
    if (active) {
        const clusters = clusterize(clicks, 0.03, minPct, maxClusters);
        drawClusters(clusters);
    }
}, 300);
=======
const recompute = () => drawClusters(clusterize(clicks, minPct, maxClusters));
setInterval(() => { if (active) recompute(); }, 300);
>>>>>>> parent of 163a9b1 (full overhaul)

(async () => {
    // Load stored clicks + active status
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

    // Connect to WebSocket
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
    };

    // Handle viewer clicks
    const canvas = document.getElementById('heat');
    canvas.addEventListener('click', (e) => {
        if (!active) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

=======
    ws.onmessage = e => {
        try { var m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; return; }
        if (!active) return;

        if (m.type === 'click') { clicks.push({ x: m.x, y: m.y }); }
        if (m.type === 'reset') { clicks.length = 0; clearHeat(); }
    };

    document.getElementById('heat').addEventListener('click', e => {
        if (!active) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
>>>>>>> parent of 163a9b1 (full overhaul)
        ws.send(JSON.stringify({ type: 'click', x, y }));
        clicks.push({ x, y });
    });
})();
