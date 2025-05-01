/* cluster.js – stable, overlap-free, smoothed clustering */
export function clusterize(raw, cfg) {
    const { eps, minPct, maxN } = cfg;
    if (!raw.length) return [];

    // --- 1. initial seeds
    const seeds = [];
    raw.forEach(p => {
        let best = null, bestD2 = eps * eps;
        for (const c of seeds) {
            const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = c; }
        }
        if (best) {
            best.w++; best.x += (p.x - best.x) / best.w; best.y += (p.y - best.y) / best.w;
        } else seeds.push({ x: p.x, y: p.y, w: 1 });
    });

    // --- 2. iterative merge until no overlaps
    const R = w => cfg.minR + Math.log2(w + 1) * cfg.k;
    let changed = true, list = seeds;
    while (changed) {
        changed = false; const next = [];
        while (list.length) {
            const base = list.pop(); let { x, y, w } = base;
            for (let i = list.length - 1; i >= 0; i--) {
                const o = list[i], dx = x - o.x, dy = y - o.y;
                if (dx * dx + dy * dy < Math.pow(R(w) + R(o.w), 2) * 0.8) {
                    // merge
                    w += o.w; x += (o.x - x) * o.w / w; y += (o.y - y) * o.w / w;
                    list.splice(i, 1); changed = true;
                }
            }
            next.push({ x, y, w });
        }
        list = next;
    }

    // --- 3. final stats / filter / sort
    const total = raw.length;
    return list.map(c => ({
        ...c,
        pct: (c.w / total) * 100,
        r: R(c.w)
    }))
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}
