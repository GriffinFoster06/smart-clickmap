const EBS = 'https://smart-clickmap-backend.onrender.com';

const clicksEl = document.getElementById('clicks');
const usersEl = document.getElementById('users');
const blobsEl = document.getElementById('blobs');

async function poll() {
    try {
        const res = await fetch(`${EBS}/heatmap`);
        const { blobs, totalClicks } = await res.json();
        clicksEl.textContent = `${totalClicks} clicks`;
        usersEl.textContent = `${totalClicks} users`;
        blobsEl.textContent = `${blobs.length} blobs`;
    } catch (e) {
        console.error(e);
    }
}

setInterval(poll, 1000);

document.getElementById('restart').onclick = async () => {
    await fetch(`${EBS}/reset`, { method: 'POST' });
    await fetch(`${EBS}/start`, { method: 'POST' });
};
