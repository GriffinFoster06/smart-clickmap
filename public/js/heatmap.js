/* heatmap.js – Visual rendering of clustered click data
 *
 * Draws clusters on an HTML canvas using:
 * - Soft glow fill
 * - White outline ring
 * - Optional green highlight for top cluster
 * - Bold, centered % label with shadow
 */

let canvas, ctx;

/** Initialize canvas and context */
export function initCanvas() {
    canvas = document.getElementById('heat');
    if (!canvas) {
        throw new Error('❌ heatmap.js: <canvas id="heat"> not found');
    }
    ctx = canvas.getContext('2d');
}

/** Clear the entire canvas */
export function clearHeat() {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** Draw a single cluster (circle + glow + label) */
function drawOneCluster(cluster, isTop) {
    const cx = canvas.width * cluster.x;
    const cy = canvas.height * cluster.y;
    const radius = cluster.r;

    // 1️⃣ Soft shadow glow
    ctx.save();
    ctx.fillStyle = isTop
        ? 'rgba(0,255,128,0.25)'     // Green fill for top
        : 'rgba(128,80,255,0.25)';   // Violet fill for others
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = radius * 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // 2️⃣ Outer stroke ring
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.strokeStyle = 'white';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // 3️⃣ Label (%)
    ctx.font = `bold ${Math.max(14, radius * 0.55)}px sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillText(`${cluster.pct.toFixed(0)}%`, cx, cy);
}

/** Draw all clusters on the canvas */
export function drawClusters(clusters) {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (clusters.length > 1) {
        clusters.slice(1).forEach(c => drawOneCluster(c, false));
    }
    if (clusters.length >= 1) {
        drawOneCluster(clusters[0], true); // top cluster
    }
}
