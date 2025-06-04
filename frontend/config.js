const EBS = 'https://smart-clickmap-backend.onrender.com';

const clicksEl = document.getElementById('clicks');
const usersEl = document.getElementById('users');
const blobsEl = document.getElementById('blobs');
let channelId = null;
Twitch.ext.onAuthorized(auth => {
    channelId = auth.channelId;
    setInterval(poll, 1000);
});

async function poll() {
    if (!channelId) return;
    try {
        const res = await fetch(`${EBS}/heatmap?channel=${channelId}`);
        const { blobs, totalClicks } = await res.json();
        clicksEl.textContent = `${totalClicks} clicks`;
        usersEl.textContent = `${totalClicks} users`;
        blobsEl.textContent = `${blobs.length} blobs`;
    } catch (e) {
        console.error(e);
    }
}

document.getElementById('start').onclick = async () => {
    await fetch(`${EBS}/start`, { method: 'POST' });
};

document.getElementById('stop').onclick = async () => {
    await fetch(`${EBS}/stop`, { method: 'POST' });
};

document.getElementById('reset').onclick = async () => {
    await fetch(`${EBS}/reset`, { method: 'POST' });
};
