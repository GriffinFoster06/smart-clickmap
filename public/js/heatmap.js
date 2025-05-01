/* heatmap.js  – canvas renderer for smart clusters */
let canvas, ctx;

export function initCanvas() {
    canvas = document.getElementById('heat');
    if (!canvas) throw new Error('❌ <canvas id="heat"> not found');
    ctx = canvas.getContext('2d');
    return ctx;
}

/** Draw one cluster */
function drawCluster({ x, y, radius, pct, isTop }) {
    const cx = canvas.width * x;
    const cy = canvas.height * y;

    // fill glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, 'rgba(255,80,0,0.55)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();

    // stroke ring
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.strokeStyle = isTop ? 'rgb(255,255,255)' : 'rgb(0,255,0)';
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.stroke();

    // percentage label
    ctx.font = `${Math.max(14, radius * 0.6)}px sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct.toFixed(0)}%`, cx, cy);
}

/** Main render */
export function drawClusters(clusters) {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    clusters.forEach((c, i) => drawCluster({ ...c, isTop: i === 0 }));
}

/** Convenience */
export function clearHeat() {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
