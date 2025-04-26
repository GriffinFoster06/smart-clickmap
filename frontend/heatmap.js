export function drawHeat(ctx, grid, size) {
    const w = ctx.canvas.width / size;
    const h = ctx.canvas.height / size;
    // find max for normalisation
    const max = Math.max(...grid);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (max === 0) return;
    grid.forEach((v, i) => {
        if (!v) return;
        const alpha = v / max;
        const x = (i % size) * w;
        const y = Math.floor(i / size) * h;
        ctx.fillStyle = `rgba(255,0,0,${alpha})`;
        ctx.fillRect(x, y, w, h);
    });
}
