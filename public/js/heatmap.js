/* heatmap.js – smooth glow, no flicker */
let cv, ctx; export function boot() {
    cv = document.getElementById('heat'); ctx = cv.getContext('2d');
}
const fillOther = 'rgba(150,120,255,0.3)', fillTop = 'rgba(0,255,140,0.35)';
export function render(arr, cfg) {
    if (!ctx) boot(); ctx.clearRect(0, 0, cv.width, cv.height);
    arr.forEach((c, i) => {
        const cx = cv.width * c.x, cy = cv.height * c.y, r = c.r;
        const fill = i ? fillOther : fillTop;
        ctx.save(); ctx.shadowBlur = r * .6; ctx.shadowColor = fill;
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.fill(); ctx.restore();
        ctx.lineWidth = i ? cfg.otherStroke : cfg.topStroke;
        ctx.strokeStyle = i ? cfg.clusterColor : cfg.topColor;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.stroke();
        ctx.font = `bold ${Math.max(14, r * cfg.fontScale)}px sans-serif`;
        ctx.fillStyle = 'white'; ctx.shadowColor = 'black'; ctx.shadowBlur = 4;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.pct.toFixed(0) + '%', cx, cy);
    });
}
export function clear() { if (!ctx) boot(); ctx.clearRect(0, 0, cv.width, cv.height); }
