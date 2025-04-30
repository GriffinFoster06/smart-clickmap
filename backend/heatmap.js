export function drawBlobs(ctx, blobs) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    blobs.forEach(b => {
        const cx = b.x * W, cy = b.y * H, r = 10 + Math.sqrt(b.pct) * 4;
        ctx.fillStyle = b.isTop ? 'rgba(0,255,0,0.25)' : 'rgba(128,64,255,0.25)';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = b.isTop ? '#0f0' : '#fff'; ctx.stroke();
        ctx.font = `${Math.max(14, r * 0.6)}px sans-serif`;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${b.pct}%`, cx, cy);
    });
}
