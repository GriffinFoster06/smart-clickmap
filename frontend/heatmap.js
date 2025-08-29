// frontend/heatmap.js - Adaptive rendering with circles and organic polygons
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3;

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
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage);

        this.render();
    }

    render() {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render each cluster with adaptive shape
        this.clusters.forEach((cluster) => {
            this.renderAdaptiveShape(cluster, W, H);
        });
    }

    renderAdaptiveShape(cluster, W, H) {
        // Determine if this cluster should be a circle or polygon
        const shouldUsePolygon = this.shouldUsePolygonShape(cluster);

        if (shouldUsePolygon && cluster.points && cluster.points.length > 2) {
            this.renderPolygonShape(cluster, W, H);
        } else {
            this.renderCircleShape(cluster, W, H);
        }
    }

    shouldUsePolygonShape(cluster) {
        // Use polygon for irregular/spread out clusters
        if (!cluster.spread || !cluster.confidence || !cluster.points) return false;

        // Criteria for polygon rendering:
        // 1. Low confidence (spread out points)
        // 2. High spread relative to cluster size
        // 3. Sufficient points to form meaningful shape
        // 4. Not too large (giant clusters stay circular)

        const hasSpread = cluster.spread > 0.03;
        const lowConfidence = cluster.confidence < 0.7;
        const sufficientPoints = cluster.points && cluster.points.length >= 3;
        const notTooLarge = cluster.percentage < 40;
        const mediumSize = cluster.count >= 3 && cluster.count <= 15;

        return hasSpread && (lowConfidence || mediumSize) && sufficientPoints && notTooLarge;
    }

    renderCircleShape(cluster, W, H) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;

        // Precise sizing for circular clusters
        let baseRadius;
        if (cluster.count === 1) {
            baseRadius = 28;
        } else if (cluster.count <= 3) {
            baseRadius = Math.max(32, 35 + (percentage * 0.8));
        } else {
            baseRadius = Math.max(35, Math.min(65, 38 + (percentage * 1.0)));
        }

        if (cluster.confidence) {
            baseRadius *= (0.9 + (cluster.confidence * 0.2));
        }

        this.ctx.save();

        // Clean circular background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Clean white border
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.lineWidth = baseRadius < 35 ? 2 : 2.5;
        this.ctx.stroke();

        // Inner highlight for depth
        if (baseRadius > 30) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, baseRadius - 3, 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        this.renderClusterText(cx, cy, percentage, baseRadius);
        this.ctx.restore();
    }

    renderPolygonShape(cluster, W, H) {
        const points = cluster.points.map(p => ({
            x: p.x * W,
            y: p.y * H
        }));

        // Create convex hull or organic boundary
        const hull = this.calculateConvexHull(points);
        const smoothedHull = this.smoothPolygon(hull);

        // Add padding to the hull
        const padding = Math.max(20, Math.min(40, 25 + (cluster.percentage * 0.5)));
        const paddedHull = this.expandPolygon(smoothedHull, padding);

        this.ctx.save();

        // Render polygon background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.beginPath();
        paddedHull.forEach((point, index) => {
            if (index === 0) {
                this.ctx.moveTo(point.x, point.y);
            } else {
                this.ctx.lineTo(point.x, point.y);
            }
        });
        this.ctx.closePath();
        this.ctx.fill();

        // Polygon border
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();

        // Inner highlight
        const innerHull = this.expandPolygon(smoothedHull, padding - 4);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        innerHull.forEach((point, index) => {
            if (index === 0) {
                this.ctx.moveTo(point.x, point.y);
            } else {
                this.ctx.lineTo(point.x, point.y);
            }
        });
        this.ctx.closePath();
        this.ctx.stroke();

        // Center text at cluster centroid
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const avgRadius = padding;

        this.renderClusterText(cx, cy, cluster.percentage, avgRadius);
        this.ctx.restore();
    }

    renderClusterText(cx, cy, percentage, baseRadius) {
        const fontSize = Math.max(14, Math.min(22, baseRadius * 0.45));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text shadow
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillText(`${percentage}%`, cx + 1, cy + 1);

        // Main text
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(`${percentage}%`, cx, cy);
    }

    calculateConvexHull(points) {
        if (points.length <= 3) return points;

        // Graham scan for convex hull
        const p0 = points.reduce((min, p) => p.y < min.y || (p.y === min.y && p.x < min.x) ? p : min);

        const sorted = points
            .filter(p => p !== p0)
            .sort((a, b) => {
                const angleA = Math.atan2(a.y - p0.y, a.x - p0.x);
                const angleB = Math.atan2(b.y - p0.y, b.x - p0.x);
                return angleA - angleB;
            });

        const hull = [p0];
        for (const p of sorted) {
            while (hull.length > 1 && this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
                hull.pop();
            }
            hull.push(p);
        }

        return hull;
    }

    crossProduct(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    smoothPolygon(points) {
        if (points.length < 3) return points;

        // Simple smoothing by averaging adjacent points
        const smoothed = [];
        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];

            smoothed.push({
                x: (prev.x + curr.x * 2 + next.x) / 4,
                y: (prev.y + curr.y * 2 + next.y) / 4
            });
        }

        return smoothed;
    }

    expandPolygon(points, padding) {
        if (points.length < 3) return points;

        const expanded = [];
        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];

            // Calculate normal vector pointing outward
            const edge1 = { x: curr.x - prev.x, y: curr.y - prev.y };
            const edge2 = { x: next.x - curr.x, y: next.y - curr.y };

            const normal1 = { x: -edge1.y, y: edge1.x };
            const normal2 = { x: -edge2.y, y: edge2.x };

            // Normalize
            const len1 = Math.hypot(normal1.x, normal1.y);
            const len2 = Math.hypot(normal2.x, normal2.y);

            if (len1 > 0) { normal1.x /= len1; normal1.y /= len1; }
            if (len2 > 0) { normal2.x /= len2; normal2.y /= len2; }

            // Average normal
            const avgNormal = {
                x: (normal1.x + normal2.x) / 2,
                y: (normal1.y + normal2.y) / 2
            };

            const avgLen = Math.hypot(avgNormal.x, avgNormal.y);
            if (avgLen > 0) {
                avgNormal.x /= avgLen;
                avgNormal.y /= avgLen;
            }

            expanded.push({
                x: curr.x + avgNormal.x * padding,
                y: curr.y + avgNormal.y * padding
            });
        }

        return expanded;
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
        isTop: blob.isTop
    }));
    renderer.updateClusters(clusters);
}