/* cluster.js – pixel-overlap merging with center cluster */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10) {
    if (!points.length) return [];

    const CANVAS_W = 1920, CANVAS_H = 1080;
    const clusters = [];

    // 1️⃣ Initial proximity-based clustering
    points.forEach(p => {
        let best = null, bestD2 = eps * eps;
        for (const c of clusters) {
            const dx = p.x - c.x, dy = p.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = c; }
        }
        if (best) {
            best.w++;
            best.x += (p.x - best.x) / best.w;
            best.y += (p.y - best.y) / best.w;
        } else {
            clusters.push({ x: p.x, y: p.y, w: 1 });
        }
    });

    const total = points.length;
    const MIN_R = 12, MAX_R = 60, K = 8;

    // 2️⃣ Compute radius and canvas position
    let pixels = clusters.map(c => {
        const pct = (c.w / total) * 100;
        const r = Math.min(MAX_R, MIN_R + Math.log2(c.w + 1) * K);
        return {
            x: c.x, y: c.y, w: c.w, pct, r,
            cx: c.x * CANVAS_W,
            cy: c.y * CANVAS_H
        };
    }).filter(c => c.pct >= minPct && c.r >= 8);

    // 3️⃣ Pixel-overlap merge: replace overlapping pairs with center cluster
    const merged = [];
    const visited = new Set();

    for (let i = 0; i < pixels.length; i++) {
        if (visited.has(i)) continue;

        const base = pixels[i];
        const overlaps = [base];
        visited.add(i);

        for (let j = i + 1; j < pixels.length; j++) {
            if (visited.has(j)) continue;
            const other = pixels[j];
            const dx = base.cx - other.cx, dy = base.cy - other.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < base.r + other.r) {
                overlaps.push(other);
                visited.add(j);
            }
        }

        // Merge into center of mass
        let wx = 0, wy = 0, totalW = 0;
        overlaps.forEach(c => {
            wx += c.x * c.w;
            wy += c.y * c.w;
            totalW += c.w;
        });
        const mx = wx / totalW, my = wy / totalW;
        const pct = (totalW / total) * 100;
        const r = Math.min(MAX_R, MIN_R + Math.log2(totalW + 1) * K);

        merged.push({ x: mx, y: my, w: totalW, pct, r });
    }

    return merged
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}
