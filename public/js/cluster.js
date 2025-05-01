/* cluster.js – robust, overlap‐free, smoothed clustering */
export function clusterize(points, cfg) {
    const { eps, minPct, maxN, minR, k } = cfg;
    if (!points.length) return [];

    // 1️⃣ Seed clusters by proximity (eps)
    const seeds = [];
    for (const p of points) {
        let best = null, bestD2 = eps * eps;
        for (const c of seeds) {
            const dx = p.x - c.x, dy = p.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = c;
            }
        }
        if (best) {
            best.w++;
            best.x += (p.x - best.x) / best.w;
            best.y += (p.y - best.y) / best.w;
        } else {
            seeds.push({ x: p.x, y: p.y, w: 1 });
        }
    }

    // radius function
    const radiusFor = w => Math.min(cfg.maxR, minR + Math.log2(w + 1) * k);

    // 2️⃣ Iterative merge until no overlaps
    let list = seeds;
    let merged, again = true;
    while (again) {
        again = false;
        merged = [];
        while (list.length) {
            let base = list.pop();
            let bx = base.x, by = base.y, bw = base.w;
            for (let i = list.length - 1; i >= 0; i--) {
                const other = list[i];
                const dx = bx - other.x, dy = by - other.y;
                const dist = Math.hypot(dx, dy);
                const sumR = radiusFor(bw) + radiusFor(other.w);
                if (dist < sumR * 0.6) {  // only merge if circles truly overlap
                    // merge other into base
                    bw += other.w;
                    bx += (other.x - bx) * (other.w / bw);
                    by += (other.y - by) * (other.w / bw);
                    list.splice(i, 1);
                    again = true;
                }
            }
            merged.push({ x: bx, y: by, w: bw });
        }
        list = merged;
    }

    // 3️⃣ Finalize stats, filter, sort, limit
    const total = points.length;
    return list
        .map(c => ({
            x: c.x,
            y: c.y,
            w: c.w,
            pct: (c.w / total) * 100,
            r: radiusFor(c.w)
        }))
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}
