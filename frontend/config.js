const EBS = 'https://smart-clickmap-backend.onrender.com';

const mini = document.getElementById('mini').getContext('2d');
const clicksEl = document.getElementById('clicks');
const usersEl = document.getElementById('users');
const blobsEl = document.getElementById('blobs');

function drawMini(blobs, maxIndex) {
    mini.clearRect(0, 0, 240, 135);
    blobs.forEach((b, i) => {
        mini.fillStyle = (i === maxIndex) ? 'rgba(0,255,0,0.4)' : 'rgba(128,64,255,0.4)';
        mini.beginPath();
        mini.arc(b.cx * 240, b.cy * 135, b.r, 0, 2 * Math.PI);
        mini.fill();
    });
}

async function poll() {
    try {
        const res = await fetch(`${EBS}/heatmap`);
        const { data, grid, maxIndex } = await res.json();   // grid is still full array
        const totalClicks = data.reduce((a, b) => a + b, 0);
        const blobCount = data.filter(v => v > 0).length;
        // users ≈ clicks (one per viewer)
        clicksEl.textContent = `${totalClicks} clicks`;
        usersEl.textContent = `${totalClicks} users`;
        blobsEl.textContent = `${blobCount} blobs`;

        // Build simple blob list for tiny preview (optional)
        const blobs = [];
        data.forEach((v, i) => {
            if (!v) return;
            const cx = (i % grid) / grid;
            const cy = Math.floor(i / grid) / grid;
            const r = 4 + Math.sqrt(v);   // scale preview radius
            blobs.push({ cx, cy, r });
        });
        drawMini(blobs, maxIndex);
    } catch (e) { console.error(e); }
}

setInterval(poll, 1000);

document.getElementById('restart').onclick = async () => {
    await fetch(`${EBS}/reset`, { method: 'POST' });
    await fetch(`${EBS}/start`, { method: 'POST' });
};
