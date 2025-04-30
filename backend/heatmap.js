export function drawBlobs(ctx, blobs, cfg) {
    ctx.save();
    blobs.forEach(b => {
        const cx = b.x * ctx.canvas.width;
        const cy = b.y * ctx.canvas.height;
        const r = cfg.radiusBase + Math.sqrt(b.pct) * cfg.radiusScale;
        if (b.pct < cfg.displayThreshold && !b.isTop) return;

        // radial gradient fill
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, b.isTop ? cfg.topColor : cfg.blobColor);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();

        // outline circle
        ctx.lineWidth = cfg.strokeWidth;
        ctx.strokeStyle = cfg.strokeColor;
        ctx.stroke();

        // percentage text with outline
        const fs = Math.max(cfg.minFontSize, r * cfg.fontScale);
        ctx.font = `${fs}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.lineWidth = cfg.textStrokeWidth;
        ctx.strokeStyle = cfg.textStrokeColor;
        ctx.strokeText(`${b.pct}%`, cx, cy);

        ctx.fillStyle = cfg.textColor;
        ctx.fillText(`${b.pct}%`, cx, cy);
    });
    ctx.restore();
}
