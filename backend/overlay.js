import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const heat = document.getElementById('heat');
const ctx = heat.getContext('2d');

(async function loop() {
    const d = await fetch(`/api/${chan}/heatmap`).then(r => r.json());
    ctx.clearRect(0, 0, heat.width, heat.height);
    if (d.blobs.length) drawBlobs(ctx, d.blobs, await fetch(`/api/${chan}/config`).then(r => r.json()));
    setTimeout(loop, 1000);
})();
