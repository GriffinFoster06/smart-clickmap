const EBS = 'https://smart-clickmap-backend.onrender.com';

async function refreshStats() {
    try {
        const res = await fetch(`${EBS}/stats`);
        const { clicks, users, blobs } = await res.json();
        document.getElementById('clicks').textContent = `Clicks: ${clicks}`;
        document.getElementById('users').textContent = `Users: ${users}`;
        document.getElementById('blobs').textContent = `Blobs: ${blobs}`;
    } catch (e) {
        console.error('Failed to fetch stats', e);
    }
}

async function restartMap() {
    try {
        await fetch(`${EBS}/reset`, { method: 'POST' });
        await refreshStats();
    } catch (e) {
        console.error('Failed to reset map', e);
    }
}

document.getElementById('restart').onclick = restartMap;

// Poll stats every 2 seconds
setInterval(refreshStats, 2000);

refreshStats();
