// frontend/heatmap.js - Precise area-based clustering with accurate coverage representation
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3;
        this.MIN_RADIUS = 80; // Much larger minimum for readability
        this.MAX_RADIUS = 160; // Larger maximum for better coverage

        this.resize();
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

    updateClusters(newClusters) {
        // Process clusters with better area representation
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .map(cluster => this.processClusterArea(cluster))
            .sort((a, b) => b.percentage - a.percentage);

        this.render();
    }

    processClusterArea(cluster) {
        // Calculate actual coverage area based on click density and spread
        const baseArea = this.MIN_RADIUS + (cluster.percentage * 2.5);
        const densityFactor = cluster.density ? Math.sqrt(cluster.density) : 1;
        const spreadRadius = cluster.radius || 0.05;

        // Calculate effective radius representing true coverage
        const effectiveRadius = Math.max(
            this.MIN_RADIUS,
            Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
        );

        return {
            ...cluster,
            effectiveRadius,
            needsPolygon: this.shouldUsePolygon(cluster)
        };
    }

    shouldUsePolygon(cluster) {
        // Use polygon for high-density clusters or those with specific patterns
        return cluster.density > 3 || cluster.count > 8 || (cluster.radius && cluster.radius < 0.03);
    }

    render() {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render from lowest to highest percentage (highest on top)
        const reversedClusters = [...this.clusters].reverse();

        reversedClusters.forEach((cluster, index) => {
            const isTop = index === reversedClusters.length - 1;
            this.renderAreaCluster(cluster, W, H, isTop);
        });
    }

    renderAreaCluster(cluster, W, H, isTop) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;
        const radius = cluster.effectiveRadius;

        this.ctx.save();

        // Color scheme: purple base, cyan for top
        let fillColor, borderColor;
        if (isTop) {
            fillColor = 'rgba(0, 255, 255, 0.2)';
            borderColor = 'rgba(0, 255, 255, 0.8)';
        } else if (percentage >= 15) {
            fillColor = 'rgba(147, 51, 234, 0.25)';
            borderColor = 'rgba(147, 51, 234, 0.9)';
        } else {
            fillColor = 'rgba(147, 51, 234, 0.2)';
            borderColor = 'rgba(147, 51, 234, 0.7)';
        }

        if (cluster.needsPolygon) {
            this.renderPolygonArea(cx, cy, radius, fillColor, borderColor, percentage);
        } else {
            this.renderCircularArea(cx, cy, radius, fillColor, borderColor, percentage);
        }

        // Enhanced percentage text with better visibility
        this.renderPercentageText(cx, cy, percentage, radius, isTop);

        this.ctx.restore();
    }

    renderCircularArea(cx, cy, radius, fillColor, borderColor, percentage) {
        // Main area fill
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Clean border
        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        // Inner highlight for depth
        this.ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius - 6, 0, 2 * Math.PI);
        this.ctx.stroke();
    }

    renderPolygonArea(cx, cy, radius, fillColor, borderColor, percentage) {
        // Create irregular polygon to represent actual click area
        const sides = 6 + Math.floor(percentage / 10); // More sides for higher percentages
        const time = Date.now() * 0.001;

        this.ctx.beginPath();

        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            // Add variation but keep it reasonable for coverage accuracy
            const variation = Math.sin(angle * 2 + time * 0.5) * 0.15;
            const currentRadius = radius * (0.9 + variation);
            const x = cx + Math.cos(angle) * currentRadius;
            const y = cy + Math.sin(angle) * currentRadius;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        this.ctx.closePath();

        // Fill and stroke
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
    }

    renderPercentageText(cx, cy, percentage, radius, isTop) {
        // Larger text for better readability
        const fontSize = Math.max(24, Math.min(40, radius * 0.35));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Strong text shadow for visibility
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;

        // Main text color
        this.ctx.fillStyle = isTop ? '#ffffff' : '#ffffff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        // Reset shadow
        this.ctx.shadowBlur = 0;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;

        // Add subtle outline for extra visibility
        this.ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.8)' : 'rgba(147, 51, 234, 0.8)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeText(`${percentage}%`, cx, cy);
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
        this.render();
    }

    destroy() {
        // Clean up if needed
    }
}

// Legacy compatibility
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = blobs.map(blob => ({
        x: blob.x,
        y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        isTop: blob.isTop,
        density: blob.density || 1,
        radius: blob.radius || 0.05
    }));
    renderer.updateClusters(clusters);
}