/* cluster.js – smart, dynamic, grid-less clustering */
export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];
    const total = points.length;
    const clusters = [];

    // 1️⃣  Merge by proximity (DBSCAN-lite)
    points.forEach(p => {
        let best = null, bestD2 = eps * eps;
        for (const c of clusters) {
            const dx = p.x - c.x, dy = p.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = c; }
        }
        if (best) {
            best.w++;
            best.x += (p.x - best.x) / best.w;
            best.y += (p.y - best.y) / best.w;
        } else {
            clusters.push({ ...pt, count: 1 });
        }
    });

    // 2️⃣  Compute stats & radius
    const MIN_R = 12, MAX_R = 64, K = 8;
    clusters.forEach(c => {
        c.pct = (c.w / total) * 100;
        c.r = Math.min(MAX_R, MIN_R + Math.log2(c.w + 1) * K);
    });

    // 3️⃣  Filter, sort, limit
    return clusters
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}

/** Maps click count to visual radius */
function radiusForWeight(w) {
    const MIN = 12, MAX = 64, SCALE = 8;
    return Math.min(MAX, MIN + Math.log2(w + 1) * SCALE);
}
