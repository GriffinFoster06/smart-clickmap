const chan = location.pathname.split('/')[1], qs = new URLSearchParams(location.search);
const key = qs.get('key') || ''; const stats = document.getElementById('stats');
function call(ep) { return fetch(`/api/${chan}/${ep}?key=${key}`, { method: 'POST' }); }
document.getElementById('start').onclick = () => call('start');
document.getElementById('stop').onclick = () => call('stop');
document.getElementById('reset').onclick = () => call('reset');
setInterval(() => fetch(`/api/${chan}/heatmap`).then(r => r.json()).then(d => {
    stats.textContent = `${d.totalClicks} clicks | ${d.blobs.length} blobs`;
}), 1000);
