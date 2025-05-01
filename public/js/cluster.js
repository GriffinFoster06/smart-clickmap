/* cluster.js – Accurate visual cluster merging with radius tracking */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const total = points.length;
    const clusters = [];

    // Step 1: Group nearby points into initial clusters
    points.forEach(p => {
        let nearest = null;
        let bestDist2 = eps * eps;

        for (const c of clusters) {
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestDist2) {
                bestDist2 = d2;
                nearest = c;
            }
        }

        if (nearest) {
            nearest.w += 1;
            nearest.x += (p.x - nearest.x) / nearest.w;
            nearest.y += (p.y - nearest.y) / nearest.w;
            nearest.r = radiusForWeight(nearest.w); // update radius
        } else {
            clusters.push({
                x: p.x,
                y: p.y,
                w: 1,
                r: radiusForWeight(1)
            });
        }
    });

    // Step 2: Merge overlapping clusters (distance < ra + rb)
    let changed = true;
    while (changed) {
        changed = false;

        outer: for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i];
                const b = clusters[j];

                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < a.r + b.r) {
                    // Merge b into a
                    const totalW = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / totalW;
                    a.y = (a.y * a.w + b.y * b.w) / totalW;
                    a.w = totalW;
                    a.r = radiusForWeight(a.w); // update radius

                    clusters.splice(j, 1); // remove b
                    changed = true;
                    break outer;
                }
            }
        }
    }

    // Step 3: Finalize clusters with pct and clean structure
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

/** Convert weight (click count) to visual radius */
function radiusForWeight(w) {
    const MIN_RADIUS = 12;
    const MAX_RADIUS = 64;
    const SCALE = 8;
    return Math.min(MAX_RADIUS, MIN_RADIUS + Math.log2(w + 1) * SCALE);
}
