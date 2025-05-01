import { getRoomId, socketFor } from './util.js';
import { initCanvas, drawClusters, clearHeat } from './heatmap.js';
import { clusterize } from './cluster.js';

initCanvas();
const room = getRoomId();
let active = true;
const allClicks = [];    // local cache

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    allClicks.push(...saved);
    active = act.active;
    drawClusters(clusterize(allClicks));

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        const m = JSON.parse(e.data);

        if (m.type === 'active') { active = m.active; if (!active) clearHeat(); return; }
        if (!active) return;

        if (m.type === 'click') {
            allClicks.push({ x: m.x, y: m.y });
            drawClusters(clusterize(allClicks));
        }
        if (m.type === 'reset') {
            allClicks.length = 0;
            clearHeat();
        }
    };
})();
