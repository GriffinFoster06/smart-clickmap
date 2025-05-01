/* cluster.js – robust, iterative merge: never-overlap clusters */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    /* ---- 1. Seed clusters by proximity ----------------------------------- */
    const seeds = [];
    points.forEach(p => {
        let best = null, bestD2 = eps * eps;
        for (const c of seeds) {
            const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = c; }
        }
        if (best) {
            best.w++;
            best.x += (p.x - best.x) / best.w;
            best.y += (p.y - best.y) / best.w;
        } else {
            seeds.push({ x: p.x, y: p.y, w: 1 });
        }
    });

    /* constants for visual radius */
    const MIN_R = 12, MAX_R = 64, K = 8;
    const total = points.length;

    /* helper to compute render radius */
    const radiusFor = w => Math.min(MAX_R, MIN_R + Math.log2(w + 1) * K);

    /* ---- 2. Iterative merge until no overlaps ---------------------------- */
    let merged = seeds;
    let changed = true;
    while (changed) {
        changed = false;
        const next = [];
        while (merged.length) {
            const base = merged.pop();
            let bx = base.x, by = base.y, bw = base.w;

            for (let i = merged.length - 1; i >= 0; i--) {
                const other = merged[i];
                const rSum = radiusFor(bw) + radiusFor(other.w);
                const dx = bx - other.x, dy = by - other.y, d = Math.hypot(dx, dy);

                if (d < rSum * 0.85) {           // 0.85 factor to add buffer
                    // merge 'other' into 'base'
                    bw += other.w;
                    bx += (other.x - bx) * (other.w / bw);
                    by += (other.y - by) * (other.w / bw);
                    merged.splice(i, 1);
                    changed = true;
                }
            }
            next.push({ x: bx, y: by, w: bw });
        }
        merged = next;
    }

    /* ---- 3. Final stats / filter / sort ---------------------------------- */
    const clusters = merged.map(c => ({
        ...c,
        pct: (c.w / total) * 100,
        r: radiusFor(c.w)
    })).filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);

    return clusters;
}
