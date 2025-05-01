/* cluster.js – clean spatial merge: combine only if circles touch */
export function clusterize(points, cfg) {
    const { eps, minPct, maxN, minR, maxR, k } = cfg;
    if (!points.length) return [];

    // 1. Seed: group nearby points (distance < eps)
    const seeds = [];
    for (const p of points) {
        let best = null, bestD2 = eps * eps;
        for (const c of seeds) {
            const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
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

    // 2. Compute radius
    const radius = w => Math.min(maxR, minR + Math.log2(w + 1) * k);
    seeds.forEach(c => c.r = radius(c.w));

    // 3. Merge clusters only if circles touch
    let merged = [...seeds];
    let changed = true;

    while (changed) {
        changed = false;
        const result = [];

        while (merged.length) {
            const a = merged.pop();
            let mergedA = false;

            for (let i = merged.length - 1; i >= 0; i--) {
                const b = merged[i];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const d = Math.hypot(dx, dy);

                if (d < a.r + b.r) {
                    // Merge a and b
                    const total = a.w + b.w;
                    const nx = (a.x * a.w + b.x * b.w) / total;
                    const ny = (a.y * a.w + b.y * b.w) / total;
                    const nw = total;
                    merged.push({ x: nx, y: ny, w: nw, r: radius(nw) });
                    merged.splice(i, 1);
                    mergedA = true;
                    changed = true;
                    break;
                }
            }

            if (!mergedA) {
                result.push(a);
            }
        }

        merged = result;
    }

    // 4. Final format
    const total = points.length;
    return merged
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
