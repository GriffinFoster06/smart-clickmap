/**
 * OBS Overlay Heatmap Renderer - Ex Machina Style
 * Lightweight version for OBS Browser Source integration
 */

export class OBSHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', {
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });

        // Ex Machina colors for OBS overlay
        this.colors = {
            topCluster: '#00FFFF',    // Cyan for top cluster
            normalCluster: '#9D4EDD', // Purple for other clusters
            textColor: '#FFFFFF',     // White text
            textStroke: '#000000'     // Black text stroke
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

        // High quality rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    /**
     * Main render function for clusters
     */
    renderClusters(clusters) {
        this.clearCanvas();

        if (!clusters || clusters.length === 0) {
            return;
        }

        // Sort clusters by percentage (render smaller ones first)
        const sortedClusters = [...clusters].sort((a, b) => a.percentage - b.percentage);

        // Render each cluster
        sortedClusters.forEach(cluster => {
            this.renderCluster(cluster);
        });
    }

    /**
     * Render a single cluster
     */
    renderCluster(cluster) {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        // Convert polygon to pixel coordinates
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
        const outlineColor = isTopCluster ? this.colors.topCluster : this.colors.normalCluster;

        // Draw cluster with Ex Machina styling
        this.drawClusterOutline(pixelPolygon, outlineColor, isTopCluster);
        this.drawPercentageLabel(centroid, cluster.percentage, isTopCluster);
    }

    /**
     * Draw cluster outline
     */
    drawClusterOutline(pixelPolygon, color, isTopCluster) {
        this.ctx.save();

        // Subtle glow effect
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = isTopCluster ? 12 : 8;

        // Outline
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = isTopCluster ? 4 : 3;

        // Very subtle fill
        this.ctx.fillStyle = color + '10'; // Low alpha

        this.drawPolygonPath(pixelPolygon);

        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    /**
     * Draw percentage label
     */
    drawPercentageLabel(centroid, percentage, isTopCluster) {
        this.ctx.save();

        const fontSize = isTopCluster ? 28 : 24;
        const text = `${percentage}%`;

        // Font setup
        this.ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text stroke for readability
        this.ctx.strokeStyle = this.colors.textStroke;
        this.ctx.lineWidth = 4;
        this.ctx.strokeText(text, centroid.x, centroid.y);

        // Main text
        this.ctx.fillStyle = this.colors.textColor;
        this.ctx.fillText(text, centroid.x, centroid.y);

        this.ctx.restore();
    }

    /**
     * Draw polygon path
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
 * Simple DBSCAN clustering for OBS overlay
 */
export class OBSClusterer {
    constructor() {
        this.options = {
            epsilon: 0.08,
            minPts: 3,
            maxClusters: 8,
            minPercentage: 8
        };
    }

    /**
     * Cluster raw click points into polygons
     */
    clusterPoints(rawClicks) {
        if (!rawClicks || rawClicks.length === 0) {
            return [];
        }

        // Remove duplicate users (keep one click per user)
        const uniqueClicks = this.deduplicateClicks(rawClicks);

        if (uniqueClicks.length < this.options.minPts) {
            return uniqueClicks.length > 0 ? [this.createSingleCluster(uniqueClicks)] : [];
        }

        // Apply DBSCAN
        const dbscanResult = this.dbscan(uniqueClicks);

        // Convert to polygon clusters
        const polygonClusters = this.createPolygonClusters(dbscanResult, uniqueClicks);

        return this.filterAndRankClusters(polygonClusters);
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
     * Simple DBSCAN implementation
     */
    dbscan(points) {
        const clusters = [];
        const visited = new Set();

        points.forEach((point, index) => {
            if (visited.has(index)) return;

            visited.add(index);
            const neighbors = this.getNeighbors(points, index);

            if (neighbors.length >= this.options.minPts) {
                const cluster = [];
                this.expandCluster(points, index, neighbors, cluster, visited);
                if (cluster.length > 0) {
                    clusters.push(cluster);
                }
            }
        });

        return { clusters };
    }

    /**
     * Get neighbors within epsilon distance
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
     * Expand cluster
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

            if (!cluster.some(c => c.index === neighborIndex)) {
                cluster.push({ point: points[neighborIndex], index: neighborIndex });
            }
        }
    }

    /**
     * Create polygon clusters
     */
    createPolygonClusters(dbscanResult, allPoints) {
        const totalPoints = allPoints.length;

        return dbscanResult.clusters.map((cluster, index) => {
            const clusterPoints = cluster.map(c => c.point);
            const polygon = this.createPolygonBoundary(clusterPoints);
            const centroid = this.calculateCentroid(clusterPoints);
            const percentage = Math.round((cluster.length / totalPoints) * 100);

            return {
                id: `obs_cluster_${index}`,
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
     * Create polygon boundary around points
     */
    createPolygonBoundary(points) {
        if (points.length < 3) {
            const center = this.calculateCentroid(points);
            return this.createCirclePolygon(center, 0.04, 8);
        }

        // Simple convex hull
        const hull = this.convexHull(points);
        return hull.length >= 3 ? hull : this.createCirclePolygon(this.calculateCentroid(points), 0.05, 8);
    }

    /**
     * Simple convex hull
     */
    convexHull(points) {
        if (points.length < 3) return points;

        // Find leftmost point
        let start = points.reduce((lowest, point) =>
            point.x < lowest.x || (point.x === lowest.x && point.y < lowest.y) ? point : lowest
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
     * Cross product for orientation
     */
    cross(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    /**
     * Create circle polygon (fallback)
     */
    createCirclePolygon(center, radius, segments) {
        const polygon = [];
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
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
        const polygon = this.createCirclePolygon(centroid, 0.05, 8);

        return {
            id: 'obs_single',
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
     * Calculate centroid
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
     * Filter and rank clusters
     */
    filterAndRankClusters(clusters) {
        // Filter by minimum percentage
        const filtered = clusters.filter(cluster =>
            cluster.percentage >= this.options.minPercentage
        );

        // Sort by percentage
        filtered.sort((a, b) => b.percentage - a.percentage);

        // Limit and rank
        const final = filtered.slice(0, this.options.maxClusters);

        final.forEach((cluster, index) => {
            cluster.rank = index + 1;
            cluster.isTop = index === 0;
        });

        return final;
    }

    /**
     * Euclidean distance
     */
    euclideanDistance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

// Legacy compatibility function for old drawBlobs calls
export function drawBlobs(ctx, blobs) {
    // Convert old blob format to new cluster format if needed
    if (blobs && blobs.length > 0) {
        const renderer = new OBSHeatmapRenderer(ctx.canvas);

        // Convert old blobs to new format
        const clusters = blobs.map((blob, index) => ({
            id: `legacy_${index}`,
            points: [{ x: blob.x, y: blob.y }],
            polygon: createLegacyPolygon(blob),
            centroid: { x: blob.x, y: blob.y },
            count: blob.count || 1,
            percentage: blob.pct || 0,
            isTop: blob.isTop || false,
            rank: blob.rank || null
        }));

        renderer.renderClusters(clusters);
    }
}

// Helper function for legacy blob conversion
function createLegacyPolygon(blob) {
    const radius = Math.max(0.03, Math.sqrt(blob.pct || 1) * 0.008);
    const segments = 8;
    const polygon = [];

    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        polygon.push({
            x: blob.x + Math.cos(angle) * radius,
            y: blob.y + Math.sin(angle) * radius
        });
    }

    return polygon;
}