import { drawHeat } from './heatmap.js';

let authToken = '';
let channelId = '';
let clicked = false;
const ctx = document.getElementById('heat').getContext('2d');

// Called automatically when Twitch authorizes the user
Twitch.ext.onAuthorized(auth => {
    authToken = auth.token;
    channelId = auth.channelId;

    // Connect to your backend WebSocket
    const ws = new WebSocket(`wss://smart-clickmap-backend.onrender.com/ws`);

    ws.onmessage = event => {
        const { type, data, grid } = JSON.parse(event.data);
        if (type === 'heatmap') {
            drawHeat(ctx, data, grid);
        }
    };
});

// Capture the user's first click
document.addEventListener('click', event => {
    if (clicked || !authToken) return; // Allow only one click per user

    const rect = document.body.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    fetch('https://smart-clickmap-backend.onrender.com/click', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ x, y })
    }).then(() => {
        clicked = true; // Disable further clicks
    }).catch(err => {
        console.error('Error sending click:', err);
    });
});
