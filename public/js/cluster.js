/* cluster.js – clustering with visual overlap prevention */
export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const total = points.length;
    const clusters = [];

    // 1️⃣ Group nearby points into clusters
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
            clusters.push({ x: p.x, y: p.y, w: 1 });
        }
    });

    // 2️⃣ Add stats (pct, radius)
    const MIN_R = 12, MAX_R = 60, K = 8;
    clusters.forEach(c => {
        c.pct = (c.w / total) * 100;
        c.r = Math.min(MAX_R, MIN_R + Math.log2(c.w + 1) * K);
    });

    // 3️⃣ Filter by percentage
    let result = clusters.filter(c => c.pct >= minPct && c.r >= 8);
    result.sort((a, b) => b.w - a.w); // largest first

    // 4️⃣ Overlap prevention
    const placed = [];
    for (const c of result) {
        const cx = c.x, cy = c.y, r = c.r / 1920; // normalize radius
        let overlaps = false;
        for (const other of placed) {
            const dx = cx - other.x, dy = cy - other.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < (r + other.r) * 1.1) { overlaps = true; break; }
        }
        if (!overlaps) placed.push(c);
        if (placed.length >= maxN) break;
    }

    return placed;
}
