const EBS = 'https://smart-clickmap-backend.onrender.com';
const clicksEl = document.getElementById('clicks');
const usersEl = document.getElementById('users');
const blobsEl = document.getElementById('blobs');
const miniCtx = document.getElementById('mini').getContext('2d');
const W = 240, H = 135;

function drawMini(blobs, maxIndex) {
    miniCtx.clearRect(0, 0, W, H);
    blobs.forEach((b, i) => {
        const cx = b.x * W;
        const cy = b.y * H;
        const r = 10 + Math.sqrt(b.count) * 3;
        miniCtx.fillStyle = (i === maxIndex)
            ? 'rgba(0,255,0,0.25)'
            : 'rgba(128,64,255,0.25)';
        miniCtx.beginPath();
        miniCtx.arc(cx, cy, r, 0, 2 * Math.PI);
        miniCtx.fill();
        miniCtx.lineWidth = 2;
        miniCtx.strokeStyle = (i === maxIndex) ? 'rgb(0,255,0)' : 'white';
        miniCtx.stroke();
    });
}

async function poll() {
    try {
        const res = await fetch(`${EBS}/heatmap`);
        const { blobs, totalClicks, maxIndex } = await res.json();
        clicksEl.textContent = `${totalClicks} clicks`;
        usersEl.textContent = `${totalClicks} users`;
        blobsEl.textContent = `${blobs.length} blobs`;
        drawMini(blobs, maxIndex);
    } catch (e) {
        console.error(e);
    }
}

setInterval(poll, 1000);
poll();

document.getElementById('restart').onclick = async () => {
    await fetch(`${EBS}/reset`, { method: 'POST' });
    poll();
};
