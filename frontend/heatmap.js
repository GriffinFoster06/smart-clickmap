/**
 * Ex Machina Style Heatmap Renderer
 * Replicates the exact visual style from the reference image
 */

export class ExMachinaRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', {
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });

        // Ex Machina color scheme (matching reference image)
        this.colors = {
            topCluster: {
                outline: '#00FFFF',    // Cyan for highest percentage
                glow: '#00FFFF',
                text: '#FFFFFF'
            },
            normalCluster: {
                outline: '#9D4EDD',    // Purple for other clusters
                glow: '#9D4EDD',
                text: '#FFFFFF'
            },
            background: 'transparent'
        };

        this.setupCanvas();
    }

    setupCanvas() {
        // High DPI support
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        // Enable high quality rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    /**
     * Main render function - draws clusters exactly like Ex Machina
     */
    renderClusters(clusters) {
        this.clearCanvas();

        if (!clusters || clusters.length === 0) {
            return;
        }

        // Sort clusters by percentage (render lower percentages first)
        const sortedClusters = [...clusters].sort((a, b) => a.percentage - b.percentage);

        // Render each cluster
        sortedClusters.forEach(cluster => {
            this.renderCluster(cluster);
        });
    }

    /**
     * Render a single cluster with Ex Machina styling
     */
    renderCluster(cluster) {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        // Convert to pixel coordinates
        const pixelPolygon = cluster.polygon.map(point => ({
            x: point.x * W,
            y: point.y * H
        }));

        const centroid = {
            x: cluster.centroid.x * W,
            y: cluster.centroid.y * H
        };

        // Determine if this is the top cluster
        const isTopCluster = cluster.isTop || cluster.rank === 1;
        const colors = isTopCluster ? this.colors.topCluster : this.colors.normalCluster;

        // Draw glow effect first
        this.drawGlow(pixelPolygon, colors, isTopCluster);

        // Draw the polygon outline
        this.drawPolygonOutline(pixelPolygon, colors, isTopCluster);

        // Draw percentage label
        this.drawPercentageLabel(centroid, cluster.percentage, colors, isTopCluster);
    }

    /**
     * Draw subtle glow effect around polygon
     */
    drawGlow(pixelPolygon, colors, isTopCluster) {
        this.ctx.save();

        const glowSize = isTopCluster ? 15 : 10;
        const glowAlpha = isTopCluster ? 0.3 : 0.2;

        // Create multiple glow layers
        for (let i = 3; i >= 1; i--) {
            this.ctx.shadowColor = colors.glow + Math.floor(glowAlpha * 255 / i).toString(16).padStart(2, '0');
            this.ctx.shadowBlur = glowSize * i * 0.5;
            this.ctx.strokeStyle = 'transparent';
            this.ctx.lineWidth = 1;

            this.drawPolygonPath(pixelPolygon);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Draw polygon outline exactly like Ex Machina
     */
    drawPolygonOutline(pixelPolygon, colors, isTopCluster) {
        this.ctx.save();

        // Line properties matching reference image
        this.ctx.strokeStyle = colors.outline;
        this.ctx.lineWidth = isTopCluster ? 4 : 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Very subtle fill for depth
        this.ctx.fillStyle = colors.outline + '10'; // 10 = 6% alpha in hex

        this.drawPolygonPath(pixelPolygon);

        // Fill first, then stroke for crisp edges
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    /**
     * Draw percentage label exactly like Ex Machina
     */
    drawPercentageLabel(centroid, percentage, colors, isTopCluster) {
        this.ctx.save();

        // Font sizing based on percentage and importance
        const fontSize = isTopCluster ? 28 : 24;
        const text = `${percentage}%`;

        // Font setup - bold and clean like reference
        this.ctx.font = `bold ${fontSize}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text stroke for readability (like reference image)
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.lineWidth = 4;
        this.ctx.strokeText(text, centroid.x, centroid.y);

        // Main text fill
        this.ctx.fillStyle = colors.text;
        this.ctx.fillText(text, centroid.x, centroid.y);

        this.ctx.restore();
    }

    /**
     * Draw polygon path helper
     */
    drawPolygonPath(pixelPolygon) {
        if (pixelPolygon.length === 0) return;

        this.ctx.beginPath();
        this.ctx.moveTo(pixelPolygon[0].x, pixelPolygon[0].y);

        for (let i = 1; i < pixelPolygon.length; i++) {
            this.ctx.lineTo(pixelPolygon[i].x, pixelPolygon[i].y);
        }

        this.ctx.closePath();
    }

    /**
     * Clear canvas
     */
    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Handle canvas resize
     */
    handleResize() {
        this.setupCanvas();
    }
}

/**
 * DBSCAN-based clustering for organic polygon shapes
 */
export class ExMachinaClusterer {
    constructor(options = {}) {
        this.options = {
            epsilon: 0.08,        // Distance threshold for clustering
            minPts: 3,           // Minimum points per cluster
            maxClusters: 8,      // Maximum clusters to show
            minPercentage: 8,    // Minimum 8% to show cluster
            ...options
        };
    }

    /**
     * Main clustering function - creates Ex Machina style polygon clusters
     */
    clusterPoints(rawClicks) {
        if (!rawClicks || rawClicks.length === 0) {
            return [];
        }

        // Remove duplicate users (keep latest click per user)
        const uniqueClicks = this.deduplicateClicks(rawClicks);

        if (uniqueClicks.length < this.options.minPts) {
            return uniqueClicks.length > 0 ? [this.createSingleCluster(uniqueClicks)] : [];
        }

        // Apply DBSCAN clustering
        const dbscanResult = this.dbscan(uniqueClicks);

        // Convert DBSCAN clusters to polygon clusters
        const polygonClusters = this.createPolygonClusters(dbscanResult, uniqueClicks);

        // Filter and rank clusters
        return this.filterAndRankClusters(polygonClusters, uniqueClicks.length);
    }

    /**
     * Remove duplicate clicks (one per user)
     */
    deduplicateClicks(clicks) {
        const userMap = new Map();

        clicks.forEach(click => {
            if (!click.userId) return;

            const existing = userMap.get(click.userId);
            if (!existing || (click.timestamp && click.timestamp > existing.timestamp)) {
                userMap.set(click.userId, click);
            }
        });

        return Array.from(userMap.values());
    }

    /**
     * DBSCAN algorithm implementation
     */
    dbscan(points) {
        const clusters = [];
        const visited = new Set();
        const noise = [];

        points.forEach((point, index) => {
            if (visited.has(index)) return;

            visited.add(index);
            const neighbors = this.getNeighbors(points, index);

            if (neighbors.length < this.options.minPts) {
                noise.push({ point, index });
            } else {
                const cluster = [];
                this.expandCluster(points, index, neighbors, cluster, visited);
                clusters.push(cluster);
            }
        });

        return { clusters, noise };
    }

    /**
     * Find neighbors within epsilon distance
     */
    getNeighbors(points, pointIndex) {
        const neighbors = [];
        const currentPoint = points[pointIndex];

        points.forEach((point, index) => {
            if (index !== pointIndex) {
                const distance = this.euclideanDistance(currentPoint, point);
                if (distance <= this.options.epsilon) {
                    neighbors.push(index);
                }
            }
        });

        return neighbors;
    }

    /**
     * Expand cluster by adding density-reachable points
     */
    expandCluster(points, pointIndex, neighbors, cluster, visited) {
        cluster.push({ point: points[pointIndex], index: pointIndex });

        for (let i = 0; i < neighbors.length; i++) {
            const neighborIndex = neighbors[i];

            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                const neighborNeighbors = this.getNeighbors(points, neighborIndex);

                if (neighborNeighbors.length >= this.options.minPts) {
                    neighbors.push(...neighborNeighbors.filter(n => !neighbors.includes(n)));
                }
            }

            // Add to cluster if not already in any cluster
            if (!cluster.some(c => c.index === neighborIndex)) {
                cluster.push({ point: points[neighborIndex], index: neighborIndex });
            }
        }
    }

    /**
     * Create polygon clusters from DBSCAN result
     */
    createPolygonClusters(dbscanResult, allPoints) {
        const totalPoints = allPoints.length;

        return dbscanResult.clusters.map((cluster, index) => {
            const clusterPoints = cluster.map(c => c.point);
            const polygon = this.createPolygonBoundary(clusterPoints);
            const centroid = this.calculateCentroid(clusterPoints);
            const percentage = Math.round((cluster.length / totalPoints) * 100);

            return {
                id: `cluster_${index}`,
                points: clusterPoints,
                polygon: polygon,
                centroid: centroid,
                count: cluster.length,
                percentage: percentage,
                isTop: false,
                rank: null
            };
        });
    }

    /**
     * Create organic polygon boundary around points
     */
    createPolygonBoundary(points) {
        if (points.length < 3) {
            // Too few points - create small polygon around center
            const center = this.calculateCentroid(points);
            return this.createRegularPolygon(center, 0.04, 8);
        }

        // Use concave hull for organic boundaries
        const hull = this.concaveHull(points);
        return hull.length >= 3 ? this.smoothPolygon(hull) : this.convexHull(points);
    }

    /**
     * Simple concave hull algorithm
     */
    concaveHull(points) {
        // Start with convex hull
        const convexHull = this.convexHull(points);

        if (points.length <= 6) {
            return convexHull; // Too few points for concave hull
        }

        // Try to create more natural boundaries by adding interior points
        const result = [...convexHull];

        // For each edge, check if there are interior points that should be included
        for (let i = 0; i < convexHull.length; i++) {
            const current = convexHull[i];
            const next = convexHull[(i + 1) % convexHull.length];

            // Find points that are close to this edge but not on the hull
            const edgePoints = points.filter(p =>
                !convexHull.includes(p) &&
                this.distanceToLineSegment(p, current, next) < 0.03
            );

            if (edgePoints.length > 0) {
                // Add the closest point to make the boundary more organic
                const closest = edgePoints.reduce((min, p) =>
                    this.distanceToLineSegment(p, current, next) < this.distanceToLineSegment(min, current, next) ? p : min
                );

                result.splice(i + 1, 0, closest);
            }
        }

        return result;
    }

    /**
     * Convex hull using Graham scan
     */
    convexHull(points) {
        if (points.length < 3) return points;

        // Find the bottom-most point
        let start = points.reduce((lowest, point) =>
            point.y < lowest.y || (point.y === lowest.y && point.x < lowest.x) ? point : lowest
        );

        // Sort by polar angle
        const sorted = points
            .filter(p => p !== start)
            .sort((a, b) => {
                const angleA = Math.atan2(a.y - start.y, a.x - start.x);
                const angleB = Math.atan2(b.y - start.y, b.x - start.x);
                return angleA - angleB;
            });

        // Graham scan
        const hull = [start];

        for (const point of sorted) {
            while (hull.length >= 2) {
                const orientation = this.cross(
                    hull[hull.length - 2],
                    hull[hull.length - 1],
                    point
                );
                if (orientation <= 0) {
                    hull.pop();
                } else {
                    break;
                }
            }
            hull.push(point);
        }

        return hull;
    }

    /**
     * Cross product for orientation test
     */
    cross(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    /**
     * Distance from point to line segment
     */
    distanceToLineSegment(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;

        if (lenSq === 0) {
            return Math.sqrt(A * A + B * B);
        }

        const param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = lineStart.x;
            yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x;
            yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }

        const dx = point.x - xx;
        const dy = point.y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Smooth polygon by averaging adjacent points
     */
    smoothPolygon(polygon) {
        if (polygon.length < 4) return polygon;

        const smoothed = [];
        const smoothingFactor = 0.2; // How much to smooth

        for (let i = 0; i < polygon.length; i++) {
            const prev = polygon[(i - 1 + polygon.length) % polygon.length];
            const curr = polygon[i];
            const next = polygon[(i + 1) % polygon.length];

            // Average with neighbors for smoothing
            smoothed.push({
                x: curr.x * (1 - smoothingFactor) + (prev.x + next.x) * smoothingFactor * 0.5,
                y: curr.y * (1 - smoothingFactor) + (prev.y + next.y) * smoothingFactor * 0.5
            });
        }

        return smoothed;
    }

    /**
     * Create regular polygon (fallback for small clusters)
     */
    createRegularPolygon(center, radius, sides) {
        const polygon = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * 2 * Math.PI;
            polygon.push({
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
            });
        }
        return polygon;
    }

    /**
     * Create single cluster for few points
     */
    createSingleCluster(points) {
        const centroid = this.calculateCentroid(points);
        const polygon = this.createRegularPolygon(centroid, 0.05, 8);

        return {
            id: 'single_cluster',
            points: points,
            polygon: polygon,
            centroid: centroid,
            count: points.length,
            percentage: 100,
            isTop: true,
            rank: 1
        };
    }

    /**
     * Calculate centroid of points
     */
    calculateCentroid(points) {
        if (points.length === 0) return { x: 0.5, y: 0.5 };

        const sum = points.reduce((acc, p) => ({
            x: acc.x + p.x,
            y: acc.y + p.y
        }), { x: 0, y: 0 });

        return {
            x: sum.x / points.length,
            y: sum.y / points.length
        };
    }

    /**
     * Filter clusters by minimum percentage and rank them
     */
    filterAndRankClusters(clusters, totalPoints) {
        // Filter by minimum percentage
        const significantClusters = clusters.filter(cluster =>
            cluster.percentage >= this.options.minPercentage
        );

        // Sort by percentage
        significantClusters.sort((a, b) => b.percentage - a.percentage);

        // Limit number of clusters
        const finalClusters = significantClusters.slice(0, this.options.maxClusters);

        // Mark top cluster and assign ranks
        finalClusters.forEach((cluster, index) => {
            cluster.rank = index + 1;
            cluster.isTop = index === 0;
        });

        return finalClusters;
    }

    /**
     * Euclidean distance between two points
     */
    euclideanDistance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

// Legacy export for backward compatibility
export function drawBlobs(ctx, blobs) {
    const renderer = new ExMachinaRenderer(ctx.canvas);
    renderer.renderClusters(blobs);
}