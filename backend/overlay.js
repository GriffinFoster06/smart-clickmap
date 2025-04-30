import { drawBlobs } from '/heatmap.js';

const chan = location.pathname.split('/')[1];
const heat = document.getElementById('heat');
const ctx = heat.getContext('2d');

async function fetchConfig() {
    try {
        const res = await fetch(`/api/${chan}/config`);
        if (!res.ok) {
            console.error('Failed to load config:', res.status);
            return null;
        }
        return await res.json();
    } catch (error) {
        console.error('Error loading config:', error);
        return null;
    }
}

async function fetchHeatmap() {
    try {
        const res = await fetch(`/api/${chan}/heatmap`);
        if (!res.ok) {
            console.error('Failed to load heatmap:', res.status);
            return { blobs: [] };
        }
        return await res.json();
    } catch (error) {
        console.error('Error loading heatmap:', error);
        return { blobs: [] };
    }
}

async function loop() {
    try {
        ctx.clearRect(0, 0, heat.width, heat.height);

        const data = await fetchHeatmap();
        const cfg = await fetchConfig();

        if (data?.blobs?.length && cfg) {
            drawBlobs(ctx, data.blobs, cfg);
        }
    } catch (error) {
        console.error('Error in render loop:', error);
    }

    setTimeout(loop, 1000);
}

loop();
