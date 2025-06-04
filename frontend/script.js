import { drawBlobs } from './heatmap.js';

let authToken = '';
let running = false;
let blobs = [];
const ctx = document.getElementById('heat').getContext('2d');
const EBS = 'https://smart-clickmap-backend.onrender.com';

function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`${EBS}/heatmap`);
            const data = await res.json();
            running = data.running;
            blobs = data.blobs || [];
            drawBlobs(ctx, blobs);
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
    if (!running || !authToken) return; // 🔥 Only block sending clicks, NOT drawing

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
    }).catch(console.error);
});
