// drawBlobs(ctx, blobs)
// blobs = [{ x, y, pct, isTop }]

export function drawBlobs(ctx, blobs) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    blobs.forEach(b => {
        const cx = b.x * W;
        const cy = b.y * H;
        const r = 20 + b.pct;  // Radius grows with percentage

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
