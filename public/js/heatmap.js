/* heatmap.js – renderer for cluster objects */
let canvas, ctx;
export function initCanvas() {
    canvas = document.getElementById('heat');
    if (!canvas) throw new Error('❌ <canvas id="heat"> missing');
    ctx = canvas.getContext('2d');
}

function strokeColor(isTop) { return isTop ? 'rgb(0,255,0)' : 'rgb(255,255,255)'; }

function drawCluster(c, isTop) {
    const cx = canvas.width * c.x;
    const cy = canvas.height * c.y;

    /* fill glow */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.radius);
    g.addColorStop(0, 'rgba(255,120,0,0.55)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, c.radius, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();

    /* stroke */
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.strokeStyle = strokeColor(isTop);
    ctx.beginPath(); ctx.arc(cx, cy, c.radius, 0, 2 * Math.PI); ctx.stroke();

    /* text */
    ctx.font = `${Math.max(14, c.radius * 0.6)}px sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillText(`${c.pct.toFixed(0)}%`, cx, cy);
}

export function drawClusters(arr) {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    arr.forEach((c, i) => drawCluster(c, i === 0));
}

export function clearHeat() {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
