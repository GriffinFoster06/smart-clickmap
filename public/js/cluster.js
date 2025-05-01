/* cluster.js – simple overlap merge: one replaces two */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    // ---- 1. Start: one cluster per point
    const clusters = points.map(p => ({ x: p.x, y: p.y, w: 1 }));

    // radius helper
    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);

    // ---- 2. Repeatedly merge any overlapping pair
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist < radius(a.w) + radius(b.w)) {
                    // overlap ⇒ merge into new cluster
                    const w = a.w + b.w;
                    const x = (a.x * a.w + b.x * b.w) / w;
                    const y = (a.y * a.w + b.y * b.w) / w;
                    clusters.splice(j, 1);
                    clusters.splice(i, 1, { x, y, w });
                    changed = true;
                    break outer; // restart outer loops
                }
            }
        }
    }

    // ---- 3. Final stats / filter / sort / limit
    const total = points.length;
    const output = clusters.map(c => ({
        ...c,
        pct: (c.w / total) * 100,
        r: radius(c.w)
    }))
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);

    return output;
}
