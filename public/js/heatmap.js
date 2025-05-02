/* heatmap.js – Ex-Machina-style with soft overlap opacity */
let canvas, ctx;

/* Init */
export function initCanvas() {
    canvas = document.getElementById('heat');
    if (!canvas) throw new Error('❌ heatmap.js: <canvas id="heat"> missing');
    ctx = canvas.getContext('2d');
}

/* Draw one cluster */
function drawOne(c, isTop) {
    const cx = canvas.width * c.x;
    const cy = canvas.height * c.y;
    const r = c.r;
    const alpha = c.opacity ?? 1;

    const fillColor = isTop
        ? `rgba(0,255,128,${0.25 * alpha})`
        : `rgba(128,80,255,${0.25 * alpha})`;

    // 1️⃣ Glow
    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = r * 0.6;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.28); ctx.fill();
    ctx.restore();

    // 2️⃣ Ring
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.strokeStyle = 'white';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.28); ctx.stroke();

    // 3️⃣ Label
    ctx.font = `bold ${Math.max(14, r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillText(`${c.pct.toFixed(0)}%`, cx, cy);
}

/* Public API */
export function drawClusters(arr) {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    arr.forEach((c, i) => drawOne(c, i === 0));
}

export function clearHeat() {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
