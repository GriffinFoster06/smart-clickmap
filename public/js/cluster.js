/* cluster.js – smart, dynamic, grid-less clustering */

export function clusterize(clicks, minPct = 5, maxClusters = 10) {
    if (!clicks.length) return [];

    /* 1️⃣  distance-based clustering */
    const MERGE_R = 0.03;                 // 3 % of screen diag
    const clusters = [];

    clicks.forEach(pt => {
        let best = null; let bestD2 = MERGE_R * MERGE_R;
        for (const c of clusters) {
            const dx = pt.x - c.x;
            const dy = pt.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = c; }
        }
        if (best) {
            best.count += 1;
            best.x += (pt.x - best.x) / best.count;
            best.y += (pt.y - best.y) / best.count;
        } else {
            clusters.push({ ...pt, count: 1 });
        }
    });

    /* 2️⃣  compute stats */
    const total = clicks.length;
    const MIN_R = 12, MAX_R = 60, K = 7;

    clusters.forEach(c => {
        c.pct = (c.count / total) * 100;
        c.radius = Math.min(MAX_R, MIN_R + Math.log2(c.count + 1) * K);
    });

    /* 3️⃣  filter + sort */
    return clusters
        .filter(c => c.pct >= minPct && c.radius >= 8)
        .sort((a, b) => b.count - a.count)
        .slice(0, maxClusters);
}

/** Maps click count to visual radius */
function radiusForWeight(w) {
    const MIN = 12, MAX = 64, SCALE = 8;
    return Math.min(MAX, MIN + Math.log2(w + 1) * SCALE);
}
