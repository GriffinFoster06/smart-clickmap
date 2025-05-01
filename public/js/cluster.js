/* cluster.js – deterministic overlap merge only */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);
    const seeds = points.map(p => ({ x: p.x, y: p.y, w: 1 }));

    const merged = [];

    for (const c of seeds) {
        let mergedInto = false;
        for (const o of merged) {
            const dx = c.x - o.x, dy = c.y - o.y;
            const dist = Math.hypot(dx, dy);
            if (dist < radius(c.w) + radius(o.w)) {
                // merge into o
                const total = o.w + c.w;
                o.x = (o.x * o.w + c.x * c.w) / total;
                o.y = (o.y * o.w + c.y * c.w) / total;
                o.w = total;
                mergedInto = true;
                break;
            }
        }
        if (!mergedInto) merged.push({ ...c });
    }

    const total = points.length;

    return merged.map(c => ({
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
