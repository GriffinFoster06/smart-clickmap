/* cluster.js – deterministic overlap merge */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    /* helper: visual radius from weight */
    const rad = w => Math.min(maxR, minR + Math.log2(w + 1) * k);

    /* 0️⃣ seed: one cluster per point */
    const seeds = points.map(p => ({ x: p.x, y: p.y, w: 1 }));

    /* 1️⃣ merge seeds by strict overlap — single pass, largest first */
    seeds.sort((a, b) => b.w - a.w);            // heavy first
    const out = [];

    seeds.forEach(c => {
        // try to merge with an existing cluster in 'out'
        for (const o of out) {
            const dx = c.x - o.x, dy = c.y - o.y;
            const dist = Math.hypot(dx, dy);
            if (dist < rad(c.w) + rad(o.w)) {
                // merge into 'o', weighted centroid
                o.w += c.w;
                o.x += (c.x - o.x) * (c.w / o.w);
                o.y += (c.y - o.y) * (c.w / o.w);
                return;
            }
        }
        // no overlap with any existing cluster
        out.push({ ...c });
    });

    /* 2️⃣ finalize stats */
    const total = points.length;
    const clusters = out
        .map(c => ({
            x: c.x,
            y: c.y,
            w: c.w,
            pct: (c.w / total) * 100,
            r: rad(c.w)
        }))
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);

    return clusters;
}
