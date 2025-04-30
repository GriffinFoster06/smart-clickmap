export async function getHeatmapData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching heatmap data:', error);
        return [];
    }
}

export function drawBlobs(ctx, blobs) {
    if (!Array.isArray(blobs)) {
        console.error('Invalid blobs data');
        return;
    }

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    blobs.forEach(b => {
        const cx = b.x * ctx.canvas.width, cy = b.y * ctx.canvas.height;
        const r = 10 + Math.sqrt(b.pct) * 4;
        ctx.fillStyle = b.isTop ? 'rgba(0,255,0,.25)' : 'rgba(128,64,255,.25)';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = b.isTop ? '#0f0' : '#fff'; ctx.stroke();
        ctx.font = `${Math.max(14, r * .6)}px sans-serif`; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${b.pct}%`, cx, cy);
    });
}
