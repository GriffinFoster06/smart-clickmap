/* cluster.js  – organic, grid-less click clustering */
export function clusterize(clicks, mergeRadius = 0.03) {
    const clusters = [];

    clicks.forEach(({ x, y }) => {
        // find nearest cluster within mergeRadius
        let nearest = null;
        let minD2 = mergeRadius * mergeRadius;

        for (const c of clusters) {
            const dx = x - c.x;
            const dy = y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2) { minD2 = d2; nearest = c; }
        }

        if (nearest) {
            // merge: incremental centroid update
            nearest.count += 1;
            nearest.x += (x - nearest.x) / nearest.count;
            nearest.y += (y - nearest.y) / nearest.count;
        } else {
            clusters.push({ x, y, count: 1 });
        }
    });

    // total for %
    const total = clicks.length || 1;

    // radius scaling constants
    const MIN_R = 12;
    const MAX_R = 60;
    const K = 7;          // scaling factor for log

    // finalize props & prune small blobs
    return clusters
        .map(c => ({
            ...c,
            pct: (c.count / total) * 100,
            radius: Math.min(MAX_R, MIN_R + Math.log2(c.count + 1) * K)
        }))
        .filter(c => c.radius >= 8)          // prune invisibles
        .sort((a, b) => b.count - a.count);  // top first
}
