// frontend/heatmap.js - HUD-style clickmap visualization
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.animationId = null;
        this.PERCENTAGE_THRESHOLD = 3; // Only show clusters above 3%

        this.resize();
    }

    updateClusters(newClusters) {
        // Filter clusters to only show those above threshold
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage); // Sort by percentage, highest first

        this.render();
    }

    render() {
        const W = this.canvas.width;
        const H = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render clusters from lowest to highest percentage (so highest renders on top)
        const reversedClusters = [...this.clusters].reverse();

        reversedClusters.forEach((cluster, index) => {
            this.renderHudCluster(cluster, W, H, index === reversedClusters.length - 1);
        });
    }

    renderHudCluster(cluster, W, H, isTop) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;

        // Dynamic radius based on percentage (but not too large)
        const baseRadius = Math.max(25, Math.min(80, 30 + Math.sqrt(percentage) * 4));

        // Create semi-transparent circle/blob
        this.ctx.save();

        // Main circle fill - purple tinted, cyan for highest
        const fillColor = isTop
            ? `rgba(0, 255, 255, 0.35)` // Cyan for highest
            : `rgba(147, 51, 234, 0.3)`; // Purple for others

        // Draw main circle
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Add subtle border for definition
        const borderColor = isTop
            ? `rgba(0, 255, 255, 0.6)`
            : `rgba(147, 51, 234, 0.5)`;

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Add subtle inner glow for HUD effect
        const innerGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.6);
        innerGradient.addColorStop(0, isTop ? 'rgba(0, 255, 255, 0.15)' : 'rgba(147, 51, 234, 0.15)');
        innerGradient.addColorStop(1, 'transparent');

        this.ctx.fillStyle = innerGradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 0.6, 0, 2 * Math.PI);
        this.ctx.fill();

        // Draw percentage text - bold and high contrast
        const fontSize = Math.max(14, Math.min(22, baseRadius * 0.5));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text shadow for better readability against background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillText(`${percentage}%`, cx + 1, cy + 1);

        // Main text - white or light purple/cyan
        this.ctx.fillStyle = isTop ? '#ffffff' : '#e0e7ff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        this.ctx.restore();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        this.ctx.scale(dpr, dpr);
        this.render();
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
        this.render();
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    }
}

// Legacy compatibility function for existing code
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = blobs.map(blob => ({
        x: blob.x,
        y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        isTop: blob.isTop
    }));
    renderer.updateClusters(clusters);
}