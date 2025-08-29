// frontend/overlay/heatmap.js - Standalone heatmap renderer for OBS overlay
export function drawBlobs(ctx, blobs) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!blobs || blobs.length === 0) return;

    // Filter blobs to only show those above 3% threshold
    const visibleBlobs = blobs.filter(blob => (blob.pct || blob.percentage || 0) >= 3);

    // Sort by percentage, lowest first (so highest renders on top)
    const sortedBlobs = visibleBlobs
        .sort((a, b) => (a.pct || a.percentage || 0) - (b.pct || b.percentage || 0));

    sortedBlobs.forEach((blob, index) => {
        const cx = blob.x * W;
        const cy = blob.y * H;
        const percentage = blob.pct || blob.percentage || 0;
        const isTop = blob.isTop || index === sortedBlobs.length - 1;

        // Dynamic radius based on percentage
        const baseRadius = Math.max(25, Math.min(80, 30 + Math.sqrt(percentage) * 4));

        ctx.save();

        // Main semi-transparent circle - purple or cyan
        const fillColor = isTop
            ? `rgba(0, 255, 255, 0.35)` // Cyan for top cluster
            : `rgba(147, 51, 234, 0.3)`; // Purple for others

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Border for definition
        const borderColor = isTop
            ? `rgba(0, 255, 255, 0.6)`
            : `rgba(147, 51, 234, 0.5)`;

        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner glow for HUD effect
        const innerGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.6);
        innerGradient.addColorStop(0, isTop ? 'rgba(0, 255, 255, 0.15)' : 'rgba(147, 51, 234, 0.15)');
        innerGradient.addColorStop(1, 'transparent');

        ctx.fillStyle = innerGradient;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * 0.6, 0, 2 * Math.PI);
        ctx.fill();

        // Bold percentage text
        const fontSize = Math.max(14, Math.min(22, baseRadius * 0.5));
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Text shadow for readability
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillText(`${percentage}%`, cx + 1, cy + 1);

        // Main text - white or light color
        ctx.fillStyle = isTop ? '#ffffff' : '#e0e7ff';
        ctx.fillText(`${percentage}%`, cx, cy);

        ctx.restore();
    });
}