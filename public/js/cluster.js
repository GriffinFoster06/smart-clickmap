/* cluster.js – Smart clustering with visual overlap merging
 *
 * Turns raw clicks into clusters:
 * 1. DBSCAN-style point grouping
 * 2. Merge visually overlapping clusters
 * 3. Compute radius and percentages
 */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const total = points.length;
    const rawClusters = [];

    // 1️⃣ First-pass point-to-cluster grouping
    points.forEach(point => {
        let nearest = null;
        let bestDist2 = eps * eps;

        for (const c of rawClusters) {
            const dx = point.x - c.x;
            const dy = point.y - c.y;
            const dist2 = dx * dx + dy * dy;

            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                nearest = c;
            }
        }

        if (nearest) {
            nearest.w += 1;
            nearest.x += (point.x - nearest.x) / nearest.w;
            nearest.y += (point.y - nearest.y) / nearest.w;
        } else {
            rawClusters.push({ x: point.x, y: point.y, w: 1 });
        }
    });

    // 2️⃣ Second-pass: merge overlapping clusters (based on visual radius)
    let changed = true;
    while (changed) {
        changed = false;

        outer: for (let i = 0; i < rawClusters.length; i++) {
            for (let j = i + 1; j < rawClusters.length; j++) {
                const a = rawClusters[i];
                const b = rawClusters[j];

                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                const ra = radiusForWeight(a.w);
                const rb = radiusForWeight(b.w);

                if (distance < ra + rb) {
                    const totalWeight = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / totalWeight;
                    a.y = (a.y * a.w + b.y * b.w) / totalWeight;
                    a.w = totalWeight;

                    rawClusters.splice(j, 1);
                    changed = true;
                    break outer;
                }
            }
        }
    }

    // 3️⃣ Finalize: add radius and % info
    const clusters = rawClusters.map(c => ({
        x: c.x,
        y: c.y,
        w: c.w,
        pct: (c.w / total) * 100,
        r: radiusForWeight(c.w)
    }));

    // 4️⃣ Filter and return sorted top-N clusters
    return clusters
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}

function radiusForWeight(w) {
    const MIN_RADIUS = 12;
    const MAX_RADIUS = 64;
    const SCALE = 8;
    return Math.min(MAX_RADIUS, MIN_RADIUS + Math.log2(w + 1) * SCALE);
}
