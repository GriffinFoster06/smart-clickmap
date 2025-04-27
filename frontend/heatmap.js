// Draw “bubble” clusters instead of red heat cells.
// • Every grid-cell with heat > 0 is rendered as a circle.
// • Circle radius ∝ sqrt(heat) so area grows with clicks.
// • Most-clicked cell (maxIndex) is drawn in green.
// • %-share label drawn inside each bubble.

export function drawHeat(ctx, grid, size, maxIndex) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const cellW = W / size;
    const cellH = H / size;

    // clear
    ctx.clearRect(0, 0, W, H);

    // find totals
    const total = grid.reduce((a, b) => a + b, 0);
    if (!total) return;                 // nothing to draw

    const maxVal = Math.max(...grid);

    grid.forEach((v, i) => {
        if (!v) return;
        const cx = (i % size) * cellW + cellW / 2;
        const cy = Math.floor(i / size) * cellH + cellH / 2;

        // radius: base 12 px plus scale
        const r = 12 + Math.sqrt(v) * 2;

        const isMax = (i === maxIndex);

        // fill colour
        ctx.fillStyle = isMax
            ? 'rgba(0,255,0,0.25)'          // green blob
            : 'rgba(128,64,255,0.25)';      // purple blob

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fill();

        // outline
        ctx.lineWidth = 2;
        ctx.strokeStyle = isMax ? 'rgb(0,255,0)' : 'white';
        ctx.stroke();

        // % label
        const pct = Math.round((v / total) * 100);
        ctx.font = `${Math.max(12, r * 0.75)}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${pct}%`, cx, cy);
    });
}
