import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const backend = location.origin;
const player = document.getElementById('player');
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d');
let running = true;

// Ensure player element exists before setting its source
if (player) {
    player.src = `https://player.twitch.tv/?channel=${chan}&parent=${location.hostname}`;
} else {
    console.error('Player element not found.');
}

// Set canvas dimensions and account for high-DPI displays
function setCanvasDimensions() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
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

// Click event listener
document.addEventListener('click', event => {
    if (!running) return;

    if (!player) {
        console.error('Player element not found.');
        return;
    }

    const rect = player.getBoundingClientRect();
    if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
    ) {
        return;
    }

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
