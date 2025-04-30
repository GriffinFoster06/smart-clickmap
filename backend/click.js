import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const backend = location.origin;
const player = document.getElementById('player');
player.src = `https://player.twitch.tv/?channel=${chan}&parent=${location.hostname}`;

const canvas = document.getElementById('heat'); const ctx = canvas.getContext('2d');
let running = true;

canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;

function poll() {
    fetch(`/api/${chan}/heatmap`).then(r => r.json()).then(d => {
        running = d.running;
        drawBlobs(ctx, d.blobs);
    });
}
setInterval(poll, 1000);

document.addEventListener('click', ev => {
    if (!running) return;
    const rect = player.getBoundingClientRect();
    if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) return;
    const x = (ev.clientX - rect.left) / rect.width, y = (ev.clientY - rect.top) / rect.height;
    fetch(`/api/${chan}/click`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x, y }) });
});
