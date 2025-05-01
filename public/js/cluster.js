/* cluster.js – Prevents runaway cluster growth by locking merge radius */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const total = points.length;
    const clusters = [];

    // Step 1: First-pass point-to-cluster grouping (simple DBSCAN)
    points.forEach(p => {
        let nearest = null;
        let bestDist2 = eps * eps;

        for (const c of clusters) {
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                nearest = c;
            }
        }

        if (nearest) {
            nearest.w += 1;
            nearest.x += (p.x - nearest.x) / nearest.w;
            nearest.y += (p.y - nearest.y) / nearest.w;
        } else {
            clusters.push({ x: p.x, y: p.y, w: 1 });
        }
    });

    // Step 2: Merge overlapping clusters using original radius (locked)
    // Each cluster tracks its fixed merge radius
    clusters.forEach(c => c.r = radiusForWeight(c.w));

    let changed = true;
    while (changed) {
        changed = false;

        outer: for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i];
                const b = clusters[j];

                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Use fixed (pre-merge) radii to check overlap
                if (dist < a.r + b.r) {
                    // Merge b into a
                    const totalW = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / totalW;
                    a.y = (a.y * a.w + b.y * b.w) / totalW;
                    a.w = totalW;

                    // Lock radius to the average of original radii
                    a.r = (a.r * a.w + b.r * b.w) / totalW;

                    clusters.splice(j, 1); // remove b
                    changed = true;
                    break outer;
                }
            }
        }
    }

    // Step 3: Add final properties and filter
    const result = clusters.map(c => ({
        x: c.x,
        y: c.y,
        w: c.w,
        r: c.r,
        pct: (c.w / total) * 100
    }));

    return result
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}

/** Maps click count to visual radius */
function radiusForWeight(w) {
    const MIN = 12, MAX = 64, SCALE = 8;
    return Math.min(MAX, MIN + Math.log2(w + 1) * SCALE);
}
