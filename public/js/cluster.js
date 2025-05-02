/* cluster.js – smart, grid-less clustering with overlap merging */

export function clusterize(points, eps = 0.03, minPct = 5, maxN = 10, doMerge = true) {
    if (!points.length) return [];
    const total = points.length;
    const clusters = [];

    // 1️⃣ Merge nearby points into clusters
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

    // 2️⃣ Compute radius and percent
    const MIN_R = 12, MAX_R = 64, K = 8;
    clusters.forEach(c => {
        c.pct = (c.w / total) * 100;
        c.r = Math.min(MAX_R, MIN_R + Math.log2(c.w + 1) * K);
    });

    // 3️⃣ Merge overlapping blobs if enabled
    if (doMerge) mergeOverlappingClusters(clusters);

    // 4️⃣ Filter, sort, limit
    return clusters
        .filter(c => c.pct >= minPct && c.r >= 8)
        .sort((a, b) => b.w - a.w)
        .slice(0, maxN);
}

// 🔁 Merge overlapping clusters
function mergeOverlappingClusters(clusters) {
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist < a.r + b.r) {
                    // Merge b into a
                    const total = a.w + b.w;
                    a.x = (a.x * a.w + b.x * b.w) / total;
                    a.y = (a.y * a.w + b.y * b.w) / total;
                    a.w += b.w;
                    a.pct += b.pct;
                    a.r = Math.min(64, 12 + Math.log2(a.w + 1) * 8);
                    clusters.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
}
