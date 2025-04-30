import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const player = document.getElementById('player');
const heat = document.getElementById('heat');
const burst = document.getElementById('burst');
const overlay = document.getElementById('overlay');
const ctx = heat.getContext('2d');
const bctx = burst.getContext('2d');

let latestBlobs = [];

// size elements
[heat, burst, overlay].forEach(el => {
    el.style.width = '100%';
    el.style.height = '100%';
});

// load player
player.src = `https://player.twitch.tv/?channel=${chan}&parent=${location.hostname}`;

// join to get token
async function join() {
    const res = await fetch(`/api/${chan}/join`);
    const { token } = await res.json();
    localStorage.setItem('clickmap_token', token);
    return token;
}
const token = localStorage.getItem('clickmap_token') || await join();

// burst animation
overlay.addEventListener('click', async e => {
    const rect = overlay.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;

    // burst
    let alpha = 1;
    (function fade(cx, cy) {
        bctx.clearRect(0, 0, burst.width, burst.height);
        if (alpha <= 0) return;
        bctx.globalAlpha = alpha;
        bctx.beginPath();
        bctx.arc(cx, cy, 20 + (1 - alpha) * 30, 0, 2 * Math.PI);
        bctx.strokeStyle = 'yellow';
        bctx.lineWidth = 3;
        bctx.stroke();
        alpha -= 0.05;
        requestAnimationFrame(() => fade(cx, cy));
    })(e.clientX - rect.left, e.clientY - rect.top);

    // send click
    await fetch(`/api/${chan}/click`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ x: xNorm, y: yNorm })
    });
});

// fetch heatmap
async function fetchLoop() {
    const res = await fetch(`/api/${chan}/heatmap`);
    const data = await res.json();
    latestBlobs = data.blobs || [];
    setTimeout(fetchLoop, 1000);
}

// render
async function renderLoop() {
    ctx.clearRect(0, 0, heat.width, heat.height);
    const cfg = await fetch(`/api/${chan}/config`).then(r => r.json());
    drawBlobs(ctx, latestBlobs, cfg);
    requestAnimationFrame(renderLoop);
}

fetchLoop();
renderLoop();
