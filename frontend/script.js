import { drawHeat } from './heatmap.js';

let authToken = '', clicked = false, running = false;
const ctx = document.getElementById('heat').getContext('2d');
const EBS = 'https://smart-clickmap-backend.onrender.com';    // ✅ Your backend

function setOverlayVisible(v) {
    ctx.canvas.style.display = v ? 'block' : 'none';
}

// Every 1000 ms, fetch updated heatmap
function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`${EBS}/heatmap`);
            const { type, data, grid, running: r } = await res.json();
            if (type !== 'heatmap') return;
            running = r;
            setOverlayVisible(running);
            drawHeat(ctx, data, grid);
        } catch (e) {
            console.error('Polling failed:', e);
        }
    }, 1000);
}

Twitch.ext.onAuthorized(auth => {
    authToken = auth.token;
    startPolling();
});

document.addEventListener('click', ev => {
    if (!running || clicked || !authToken) return;
    const rect = document.body.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    fetch(`${EBS}/click`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ x, y })
    }).then(() => { clicked = true; });
});
