/* heatmap.js – Ex-Machina-style rendering (soft glow, clean labels) */
let canvas, ctx;

/*  INIT  */
export function initCanvas() {
    canvas = document.getElementById('heat');
    if (!canvas) throw new Error('❌ heatmap.js: <canvas id="heat"> missing');
    ctx = canvas.getContext('2d');
}

/*  INTERNAL HELPERS  */
const VIOLET_FILL = 'rgba(128, 80, 255, 0.25)';   // default cluster fill
const GREEN_FILL = 'rgba(  0,255,128, 0.25)';    // top cluster fill

function drawOne(c, isTop) {
    const cx = canvas.width * c.x;
    const cy = canvas.height * c.y;
    const r = c.r;

    // 1️⃣  Soft-fill glow (shadowBlur = subtle)
    ctx.save();
    ctx.fillStyle = isTop ? GREEN_FILL : VIOLET_FILL;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = r * 0.6;              // proportional blur
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();

    // 2️⃣  Clean outer ring
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.strokeStyle = 'white';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();

    // 3️⃣  Percentage label
    ctx.font = `bold ${Math.max(14, r * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillText(`${c.pct.toFixed(0)}%`, cx, cy);
}

/*  PUBLIC API  */
export function drawClusters(arr) {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* draw non-top clusters first so top glows above everything */
    if (arr.length > 1) arr.slice(1).forEach(c => drawOne(c, false));
    if (arr.length) drawOne(arr[0], true);
}

export function clearHeat() {
    if (!ctx) initCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
