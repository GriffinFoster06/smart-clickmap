export function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

export function getClusterRadius(clicks) {
    const n = clicks.length;
    if (n === 0) return 0.05;

    let avgDist = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            avgDist += distance(clicks[i], clicks[j]);
        }
    }
    avgDist /= (n * (n - 1) / 2);

    // Base it on average distance between clicks
    if (avgDist < 0.05) return 0.01;  // Tight cluster
    if (avgDist < 0.1) return 0.02;
    if (avgDist < 0.2) return 0.03;
    return 0.05;  // Very spread out
}

export function clusterClicks(points, radius) {
    if (points.length === 0) return [];

    const blobs = [];
    points.forEach(p => {
        let found = false;
        for (const b of blobs) {
            if (distance(p, b) < radius) {
                b.count++;
                b.x = (b.x * (b.count - 1) + p.x) / b.count;
                b.y = (b.y * (b.count - 1) + p.y) / b.count;
                found = true;
                break;
            }
        }
        if (!found) blobs.push({ x: p.x, y: p.y, count: 1 });
    });

    return blobs;
}
