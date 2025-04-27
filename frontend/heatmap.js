export function drawHeat(ctx, grid, size, maxIndex) {
    const w = ctx.canvas.width / size;
    const h = ctx.canvas.height / size;
    const max = Math.max(...grid);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (max === 0) return;

    const blobs = [];
    grid.forEach((v, i) => {
        if (!v) return;
        blobs.push({ value: v, index: i });
    });

    blobs.forEach(blob => {
        const alpha = blob.value / max;
        const x = (blob.index % size) * w + w / 2;
        const y = Math.floor(blob.index / size) * h + h / 2;
        const radius = Math.max(20, 40 * alpha);

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);

        if (blob.index === maxIndex) {
            ctx.fillStyle = 'rgba(0,255,0,0.3)';  // Green fill for most clicked
            ctx.strokeStyle = 'lime';
        } else {
            ctx.fillStyle = 'rgba(100,100,255,0.2)';  // Purple/blue fill
            ctx.strokeStyle = 'white';
        }

        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();

        // Draw % text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const percent = Math.round((blob.value / max) * 100);
        ctx.fillText(`${percent}%`, x, y);
    });
}
