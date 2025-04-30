const chan = location.pathname.split('/')[1];
const key = new URLSearchParams(location.search).get('key');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const reset = document.getElementById('reset');
const status = document.getElementById('status');

async function callAPI(ep) {
    const res = await fetch(`/api/${chan}/${ep}?key=${key}`, { method: 'POST' });
    return res.ok ? 'OK' : `Error ${res.status}`;
}

start.onclick = async () => {
    status.textContent = 'Status: ' + await callAPI('start');
};
stop.onclick = async () => {
    status.textContent = 'Status: ' + await callAPI('stop');
};
reset.onclick = async () => {
    status.textContent = 'Status: ' + await callAPI('reset');
};

// load config into UI
async function loadCfg() {
    const cfg = await fetch(`/api/${chan}/config?key=${key}`).then(r => r.json());
    document.getElementById('blobColor').value = cfg.blobColor;
    document.getElementById('topColor').value = cfg.topColor;
    document.getElementById('displayThreshold').value = cfg.displayThreshold;
}
loadCfg();

document.getElementById('saveCfg').onclick = async () => {
    const newCfg = {
        blobColor: document.getElementById('blobColor').value,
        topColor: document.getElementById('topColor').value,
        displayThreshold: Number(document.getElementById('displayThreshold').value)
    };
    const res = await fetch(`/api/${chan}/config?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCfg)
    });
    alert(res.ok ? 'Settings saved' : 'Save failed: ' + res.status);
};
