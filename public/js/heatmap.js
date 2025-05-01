const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d');

function drawDot(x, y, size = 20) {
    const cx = canvas.width * x;
    const cy = canvas.height * y;

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
    gradient.addColorStop(0, 'rgba(255,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(255,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, 2 * Math.PI);
    ctx.fill();
}

function clearHeat() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Optional advanced blobs renderer
function drawBlobs(ctx, blobs) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    blobs.forEach(b => {
        const cx = b.x * W;
        const cy = b.y * H;
        const r = 10 + Math.sqrt(b.pct) * 4;

        ctx.fillStyle = b.isTop
            ? 'rgba(0,255,0,0.25)'
            : 'rgba(128,64,255,0.25)';

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = b.isTop ? 'rgb(0,255,0)' : 'white';
        ctx.stroke();

        ctx.font = `${Math.max(14, r * 0.6)}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${b.pct}%`, cx, cy);
    });
}

// Export all 3
export { drawDot, clearHeat, drawBlobs };
