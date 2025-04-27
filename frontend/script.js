import { drawBubbles } from './heatmap.js';

const EBS = 'https://smart-clickmap-backend.onrender.com';
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d');
let authToken = '', running = false;

function setVisible(v) {
    canvas.style.display = v ? 'block' : 'none';
}

async function poll() {
    try {
        const res = await fetch(`${EBS}/heatmap`);
        const { type, blobs, totalClicks, maxIndex, running: r } = await res.json();
        if (type !== 'heatmap') return;
        running = r;
        setVisible(running);
        drawBubbles(ctx, blobs, totalClicks, maxIndex);
    } catch (e) {
        console.error('Polling error', e);
    }
}

Twitch.ext.onAuthorized(auth => {
    authToken = auth.token;
    poll();
    setInterval(poll, 1000);
});

canvas.addEventListener('click', ev => {
    if (!running || !authToken) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    fetch(`${EBS}/click`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ x, y })
    }).catch(console.error);
});
