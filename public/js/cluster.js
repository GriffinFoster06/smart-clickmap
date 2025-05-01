/* cluster.js – deterministic overlap merge only */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);

    const clusters = [];
    points.forEach(p => {
        let merged = false;
        for (const c of clusters) {
            const dist = Math.hypot(p.x - c.x, p.y - c.y);
            if (dist < radius(1) + radius(c.w)) {  // 1 click vs existing cluster
                // add click to this cluster (re-weight)
                c.x = (c.x * c.w + p.x) / (c.w + 1);
                c.y = (c.y * c.w + p.y) / (c.w + 1);
                c.w += 1;
                merged = true;
                break;
            }
        }
        if (!merged) clusters.push({ x: p.x, y: p.y, w: 1 });
    });

    // now merge clusters if their circles overlap
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                if (dist < radius(a.w) + radius(b.w)) {
                    // combine a & b → a, delete b
                    const w = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / w;
                    a.y = (a.y * a.w + b.y * b.w) / w;
                    a.w = w;
                    clusters.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            if (changed) break;               // restart loops
        }
    }

    const total = points.length;
    return clusters
        .map(c => ({
            x: c.x,
            y: c.y,
            w: c.w,
            pct: (c.w / total) * 100,
            r: radius(c.w)
        }))
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}
