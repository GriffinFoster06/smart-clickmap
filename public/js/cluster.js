/* cluster.js – cluster-by-points then merge overlapping clusters */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];
    const total = points.length;
    const rawClusters = [];

    // 1️⃣ First-pass point clustering
    points.forEach(p => {
        let nearest = null, bestD2 = eps * eps;
        for (const c of rawClusters) {
            const dx = p.x - c.x, dy = p.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                nearest = c;
            }
        }
        if (nearest) {
            nearest.w++;
            nearest.x += (p.x - nearest.x) / nearest.w;
            nearest.y += (p.y - nearest.y) / nearest.w;
        } else {
            rawClusters.push({ x: p.x, y: p.y, w: 1 });
        }
    });

    // 2️⃣ Merge overlapping clusters (distance < sum of radii)
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < rawClusters.length; i++) {
            for (let j = i + 1; j < rawClusters.length; j++) {
                const a = rawClusters[i], b = rawClusters[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                const ra = radiusForWeight(a.w);
                const rb = radiusForWeight(b.w);

                if (dist < (ra + rb)) {
                    const totalW = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / totalW;
                    a.y = (a.y * a.w + b.y * b.w) / totalW;
                    a.w = totalW;
                    rawClusters.splice(j, 1);
                    changed = true;
                    break outer;
                }
            }
        }
    }

    // 3️⃣ Finalize clusters
    const clusters = rawClusters.map(c => ({
        x: c.x,
        y: c.y,
        w: c.w,
        pct: (c.w / total) * 100,
        r: radiusForWeight(c.w)
    }));

    return clusters
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}

function radiusForWeight(w) {
    const MIN_R = 12, MAX_R = 64, K = 8;
    return Math.min(MAX_R, MIN_R + Math.log2(w + 1) * K);
}
