import { drawBlobs } from './heatmap.js';
const chan = location.pathname.split('/')[1], ctx = document.getElementById('heat').getContext('2d');
setInterval(() => fetch(`/api/${chan}/heatmap`).then(r => r.json()).then(d => drawBlobs(ctx, d.blobs)), 1000);
