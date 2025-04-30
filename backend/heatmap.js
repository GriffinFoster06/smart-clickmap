export async function getHeatmapData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching heatmap data:', error.message);
        return null; // Return null to indicate failure
    }
}

export function drawBlobs(ctx, blobs) {
    if (!Array.isArray(blobs)) {
        console.error('Invalid blobs data: Expected an array');
        return;
    }

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    blobs.forEach(blob => {
        if (!isValidBlob(blob)) {
            console.warn('Skipping invalid blob:', blob);
            return;
        }

        const { x, y, pct, isTop } = blob;
        const cx = x * ctx.canvas.width;
        const cy = y * ctx.canvas.height;
        const r = 10 + Math.sqrt(pct) * 4;

        drawBlob(ctx, cx, cy, r, isTop);
        drawBlobText(ctx, cx, cy, r, pct);
    });
}

function isValidBlob(blob) {
    return (
        typeof blob.x === 'number' &&
        typeof blob.y === 'number' &&
        typeof blob.pct === 'number' &&
        typeof blob.isTop === 'boolean'
    );
}

function drawBlob(ctx, cx, cy, r, isTop) {
    ctx.fillStyle = isTop ? 'rgba(0,255,0,.25)' : 'rgba(128,64,255,.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = isTop ? '#0f0' : '#fff';
    ctx.stroke();
}

function drawBlobText(ctx, cx, cy, r, pct) {
    ctx.font = `${Math.max(14, r * 0.6)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, cx, cy);
}
