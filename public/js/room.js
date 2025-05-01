/* room.js – viewer page with dynamic clustering + click send */
import { getRoomId, socketFor } from '/js/util.js';
import { boot, render, clear } from '/js/heatmap.js';
import { clusterize } from '/js/cluster.js';

boot();
const room = getRoomId();
const qp = new URLSearchParams(location.search);
const cfg = {
    eps: +qp.get('mergeRadius') || 0.03,
    minPct: +qp.get('minPct') || 5,
    maxN: +qp.get('maxClusters') || 10,
    minR: 12, k: 8, topColor: 'lime', clusterColor: 'white', topStroke: 3, otherStroke: 2, fontScale: 0.55
};

let active = true; const clicks = [];
setInterval(() => { if (active) render(clusterize(clicks, cfg), cfg); }, 300);

(async () => {
    const user = room.replace(/^room-/, '');
    document.getElementById('stream').src =
        `https://player.twitch.tv/?channel=${user}&parent=${location.hostname}&muted=true`;

    const [saved, act] = await Promise.all([
        fetch(`/api/clicks/${room}`).then(r => r.json()),
        fetch(`/api/active/${room}`).then(r => r.json())
    ]);
    clicks.push(...saved); active = act.active;
    render(clusterize(clicks, cfg), cfg);

    const ws = socketFor(room, room);
    ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'active') { active = m.active; if (!active) clear(); return; }
        if (!active) return;
        if (m.type === 'click') clicks.push({ x: m.x, y: m.y });
        if (m.type === 'reset') { clicks.length = 0; clear(); }
    };

    // send clicks
    document.getElementById('heat').addEventListener('click', ev => {
        if (!active) return;
        const r = ev.currentTarget.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        ws.send(JSON.stringify({ type: 'click', x, y })); clicks.push({ x, y });
    });
})();
