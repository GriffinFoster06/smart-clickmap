import { getRoomId, socketFor } from '/js/util.js';
import { initCanvas, drawClusters, clearHeat } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

initCanvas();
const room = getRoomId();
let active = true;
const allClicks = [];

const toScreenClusters = () => drawClusters(clusterize(allClicks));

(async () => {
    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    allClicks.push(...saved);
    active = act.active;
    toScreenClusters();

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'active') { active = m.active; if (!active) clearHeat(); return; }
        if (!active) return;

        if (m.type === 'click') { allClicks.push({ x: m.x, y: m.y }); toScreenClusters(); }
        if (m.type === 'reset') { allClicks.length = 0; clearHeat(); }
    };

    // click capture
    const canvas = document.getElementById('heat');
    canvas.addEventListener('click', e => {
        if (!active) return;
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        ws.send(JSON.stringify({ type: 'click', x, y }));
        allClicks.push({ x, y }); toScreenClusters();
    });
})();
