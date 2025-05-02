/* cluster.js – smart clustering with soft overlap + opacity fading */
export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const total = points.length;
    const clusters = [];

    // 1️⃣ Group nearby points
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

    // 2️⃣ Compute pct and radius
    const MIN_R = 12, MAX_R = 60, K = 8;
    clusters.forEach(c => {
        c.pct = (c.w / total) * 100;
        c.r = Math.min(MAX_R, MIN_R + Math.log2(c.w + 1) * K);
    });

    // 3️⃣ Filter by percentage + sort
    const sorted = clusters
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w);

    // 4️⃣ Allow partial overlap with opacity fade
    const placed = [];
    for (const c of sorted) {
        let alpha = 1;
        for (const other of placed) {
            const dx = c.x - other.x, dy = c.y - other.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < (c.r + other.r) / 1920 * 1.1) {
                alpha *= 0.6; // reduce visibility if overlapping
            }
        }
        c.opacity = alpha;
        placed.push(c);
        if (placed.length >= maxN) break;
    }

    return placed;
}
