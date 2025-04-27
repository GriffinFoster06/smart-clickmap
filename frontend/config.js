const EBS = 'https://smart-clickmap-backend.onrender.com';
const s = document.getElementById('status');

function post(path) {
    fetch(EBS + path, { method: 'POST' })
        .then(r => r.text())
        .then(t => s.textContent = 'Status: ' + t)
        .catch(() => s.textContent = 'Status: error');
}

document.getElementById('start').onclick = () => post('/start');
document.getElementById('stop').onclick = () => post('/stop');
document.getElementById('reset').onclick = () => post('/reset');
