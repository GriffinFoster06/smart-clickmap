// Draw dynamic “bubble” clusters
export function drawBubbles(ctx, blobs, totalClicks, maxIndex) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!totalClicks) return;

    blobs.forEach((b, i) => {
        const cx = b.x * W, cy = b.y * H;
        const r = 20 + Math.sqrt(b.count) * 10;  // tune for desired size
        const isMax = (i === maxIndex);

        // fill
        ctx.fillStyle = isMax
            ? 'rgba(0,255,0,0.25)'    // green for top
            : 'rgba(128,64,255,0.25)';// purple for others
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        // outline
        ctx.lineWidth = 2;
        ctx.strokeStyle = isMax ? 'rgb(0,255,0)' : 'white';
        ctx.stroke();

        // label
        const pct = Math.round((b.count / totalClicks) * 100);
        ctx.font = `${Math.max(12, r * 0.5)}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${pct}%`, cx, cy);
    });
}
