/* cluster.js – simple overlap merge (dist < (r1 + r2) * 0.6) */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);

    // Seed clusters: one per click
    const clusters = points.map(p => ({ x: p.x, y: p.y, w: 1 }));

    // Keep merging while any two clusters overlap (60 % buffer)
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist < (radius(a.w) + radius(b.w)) * 0.6) {
                    // merge b into a
                    const w = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / w;
                    a.y = (a.y * a.w + b.y * b.w) / w;
                    a.w = w;
                    clusters.splice(j, 1);
                    merged = true;
                    break;
                }
            }
            if (merged) break; // restart outer loop after merge
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
