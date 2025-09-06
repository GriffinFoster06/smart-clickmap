// frontend/overlay/heatmap.js - Standalone HUD-style heatmap renderer
// Matches main extension visual theme with purple/cyan colors

export function drawBlobs(ctx, blobs) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!blobs || blobs.length === 0) return;

    // Filter to match main extension threshold
    const visibleBlobs = blobs.filter(blob => (blob.pct || blob.percentage || 0) >= 3);

    // Sort by percentage, lowest first (so highest renders on top)
    const sortedBlobs = visibleBlobs
        .sort((a, b) => (a.pct || a.percentage || 0) - (b.pct || b.percentage || 0));

    sortedBlobs.forEach((blob, index) => {
        const cx = blob.x * W;
        const cy = blob.y * H;
        const percentage = blob.pct || blob.percentage || 0;
        const isTop = blob.isTop || index === sortedBlobs.length - 1;

        // Match main extension radius calculation
        const baseRadius = Math.max(80, Math.min(160, 80 + (percentage * 2.5)));
        const densityFactor = blob.density ? Math.sqrt(blob.density) : 1;
        const spreadRadius = blob.radius || 0.05;
        const radius = Math.max(80, Math.min(160, baseRadius * densityFactor + (spreadRadius * 200)));

        ctx.save();

        // Main fill - match main extension colors exactly
        let fillColor, borderColor;
        if (isTop) {
            fillColor = 'rgba(0, 255, 255, 0.2)';
            borderColor = 'rgba(0, 255, 255, 0.85)';
        } else if (percentage >= 15) {
            fillColor = 'rgba(147, 51, 234, 0.25)';
            borderColor = 'rgba(147, 51, 234, 0.9)';
        } else {
            fillColor = 'rgba(147, 51, 234, 0.2)';
            borderColor = 'rgba(147, 51, 234, 0.7)';
        }

        // Main area
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fill();

        // Primary border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Inner ring effect (matching main extension)
        ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 6, 0, 2 * Math.PI);
        ctx.stroke();

        // Percentage text with matching styling
        const fontSize = Math.max(22, Math.min(40, radius * 0.35));
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Strong shadow for readability (matching main extension)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Main text - white
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${percentage}%`, cx, cy);

        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Text outline for definition
        ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeText(`${percentage}%`, cx, cy);

        ctx.restore();
    });
}

// Legacy compatibility wrapper
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.canvas.style.pointerEvents = 'none';
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    updateClusters(clusters) {
        const blobs = (clusters || []).map(cluster => ({
            x: cluster.x,
            y: cluster.y,
            percentage: cluster.percentage,
            pct: cluster.percentage,
            density: cluster.density,
            radius: cluster.radius,
            count: cluster.count,
            isTop: cluster.isTop
        }));
        
        drawBlobs(this.ctx, blobs);
    }

    destroy() {
        // Cleanup if needed
    }
}
