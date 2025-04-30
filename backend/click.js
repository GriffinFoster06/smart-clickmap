import { drawBlobs } from '/heatmap.js';

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
    try {
        const res = await fetch(`/api/${chan}/join`);
        if (!res.ok) {
            console.error('Failed to join:', res.status);
            return null;
        }
        const { token } = await res.json();
        localStorage.setItem('clickmap_token', token);
        return token;
    } catch (error) {
        console.error('Error joining:', error);
        return null;
    }
}

async function getToken() {
    const storedToken = localStorage.getItem('clickmap_token');
    if (storedToken) return storedToken;

    return await join();
}

const tokenPromise = getToken();

// burst animation
overlay.addEventListener('click', async e => {
    try {
        const token = await tokenPromise;
        if (!token) {
            console.error('No authentication token available');
            return;
        }

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
        const res = await fetch(`/api/${chan}/click`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ x: xNorm, y: yNorm })
        });

        if (!res.ok) {
            console.error('Click failed:', await res.text());
        }
    } catch (error) {
        console.error('Error sending click:', error);
    }
});

// fetch heatmap
async function fetchLoop() {
    try {
        const res = await fetch(`/api/${chan}/heatmap`);
        if (!res.ok) {
            console.error('Failed to fetch heatmap:', res.status);
            setTimeout(fetchLoop, 1000);
            return;
        }

        const data = await res.json();
        latestBlobs = data.blobs || [];
        setTimeout(fetchLoop, 1000);
    } catch (error) {
        console.error('Error fetching heatmap:', error);
        setTimeout(fetchLoop, 1000);
    }
}

// render
async function renderLoop() {
    try {
        ctx.clearRect(0, 0, heat.width, heat.height);
        const res = await fetch(`/api/${chan}/config`);
        if (!res.ok) {
            console.error('Failed to fetch config:', res.status);
            requestAnimationFrame(renderLoop);
            return;
        }

        const cfg = await res.json();
        drawBlobs(ctx, latestBlobs, cfg);
    } catch (error) {
        console.error('Error rendering heatmap:', error);
    }

    requestAnimationFrame(renderLoop);
}

fetchLoop();
renderLoop();
// Ensure the server serves JavaScript files with the correct MIME type
// Add the following configuration to your server setup to fix the MIME type issue:

// Example for an Express.js server
const express = require('express');
const path = require('path');
const app = express();

// Serve static files with correct MIME types
app.use('/backend', express.static(path.join(__dirname, 'backend'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
