import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const backend = location.origin;
const player = document.getElementById('player');
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d');
let running = true;

// Create overlay element for click handling
const overlay = document.createElement('div');
overlay.id = 'click-overlay';
overlay.style.position = 'absolute';
overlay.style.top = '0';
overlay.style.left = '0';
overlay.style.width = '100%';
overlay.style.height = '100%';
overlay.style.zIndex = '10';
overlay.style.cursor = running ? 'pointer' : 'default';

// Ensure player element exists before setting its source and appending overlay
if (player) {
    player.src = `https://player.twitch.tv/?channel=${chan}&parent=${location.hostname}`;
    player.parentNode.style.position = 'relative';
    player.parentNode.appendChild(overlay);
} else {
    console.error('Player element not found.');
}

// Set canvas dimensions and account for high-DPI displays
function setCanvasDimensions() {
    const dpr = window.devicePixelRatio || 1;

    // If player exists, match canvas dimensions to player
    if (player) {
        const rect = player.getBoundingClientRect();
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
    }

    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    // Update overlay dimensions to match player
    if (player && overlay) {
        const rect = player.getBoundingClientRect();
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
    }
}
setCanvasDimensions();
window.addEventListener('resize', setCanvasDimensions);

// Polling function to fetch heatmap data
function poll() {
    fetch(`/api/${chan}/heatmap`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data && typeof data.running === 'boolean' && Array.isArray(data.blobs)) {
                running = data.running;
                overlay.style.cursor = running ? 'pointer' : 'default';
                drawBlobs(ctx, data.blobs);
            } else {
                console.warn('Invalid data format received from API:', data);
            }
        })
        .catch(error => {
            console.error('Error fetching heatmap data:', error.message);
        });
}
const intervalId = setInterval(poll, 1000);

// Cleanup interval on page unload
window.addEventListener('beforeunload', () => {
    clearInterval(intervalId);
});

// Click event listener on overlay instead of document
overlay.addEventListener('click', event => {
    if (!running) return;

    if (!player) {
        console.error('Player element not found.');
        return;
    }

    const rect = player.getBoundingClientRect();
    // Normalize coordinates relative to the player dimensions
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    fetch(`/api/${chan}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
    }).catch(error => {
        console.error('Error sending click data:', error.message);
    });
});
