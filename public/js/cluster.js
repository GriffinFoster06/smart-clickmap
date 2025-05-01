/* cluster.js – no merging at all */
export function clusterize(points, cfg) {
    const { minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);

    // Just assign each click as its own "cluster" with w = 1
    const clusters = points.map(p => ({
        x: p.x,
        y: p.y,
        w: 1
    }));

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
