// frontend/config.js
const EBS = 'https://smart-clickmap-backend.onrender.com';
const POLL_MS = 1000;

let channel = null;        // what we will actually use for polling
let channelSource = null;  // 'query','storage','twitch'
let pollTimer = null;
let running = false;

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const els = {
    status: $('#status'),
    statusText: $('#status-text'),
    totalClicks: $('#total-clicks'),
    uniqueUsers: $('#unique-users'),
    clusterCount: $('#cluster-count'),
    coverage: $('#coverage'),
    lastUpdate: $('#last-update'),
    error: $('#error'),
    startBtn: $('#start-btn'),
    stopBtn: $('#stop-btn'),
    resetBtn: $('#reset-btn'),
    serverStatus: $('#server-status'),
    overlayStatus: $('#overlay-status'),
    thresholdVal: $('#threshold-value'),
};

// Add a small channel badge in the status row so you can see what we’re using
(function addChannelBadge() {
    const badge = document.createElement('span');
    badge.id = 'channel-badge';
    badge.style.cssText = 'margin-left:auto;font-size:12px;color:#aaa;font-family:SFMono-Regular,Consolas,monospace;';
    badge.textContent = '(channel: —)';
    const container = document.querySelector('.status-section .status-indicator');
    if (container) container.appendChild(badge);
})();

function updateChannelBadge() {
    const b = $('#channel-badge');
    if (!b) return;
    if (channel) b.textContent = `(channel: ${channel} • ${channelSource || 'unknown'})`;
    else b.textContent = '(channel: —)';
}

// ---------- UI helpers ----------
function setRunningState(isRunning) {
    running = isRunning;
    els.status.classList.toggle('running', isRunning);
    els.status.classList.toggle('stopped', !isRunning);
    els.statusText.textContent = isRunning ? 'Running' : 'Stopped';
    els.startBtn.disabled = isRunning;
    els.stopBtn.disabled = !isRunning;
}

function setServerUp(up) {
    els.serverStatus.textContent = up ? 'Connected' : 'Disconnected';
    els.serverStatus.style.color = up ? '#4ade80' : '#ef4444';
}

function setOverlayUp(up) {
    els.overlayStatus.textContent = up ? 'Ready' : 'Unavailable';
    els.overlayStatus.style.color = up ? '#4ade80' : '#ef4444';
}

function setError(msg) {
    if (!msg) { els.error.style.display = 'none'; return; }
    els.error.textContent = msg;
    els.error.style.display = 'block';
}

const coerceNumber = (n, f = 0) => {
    const x = typeof n === 'string' ? parseFloat(n) : n;
    return Number.isFinite(x) ? x : f;
};
const fmtPercent = (n) => (n == null || isNaN(n)) ? '-' : `${Math.round(n)}%`;

// ---------- Channel resolution ----------
function getQueryChannel() {
    const q = new URLSearchParams(location.search);
    return q.get('channel') || q.get('c') || q.get('login'); // accept /?login=ljvke too
}
function setChannel(ch, src) {
    if (!ch) return;
    channel = String(ch);
    channelSource = src;
    localStorage.setItem('clickmap.channel', channel);
    updateChannelBadge();
}
function initChannel() {
    // Priority: query param > localStorage > Twitch auth
    const qp = getQueryChannel();
    if (qp) { setChannel(qp, 'query'); return; }

    const stored = localStorage.getItem('clickmap.channel');
    if (stored) { setChannel(stored, 'storage'); return; }

    // Twitch helper (numeric broadcaster ID usually)
    try {
        if (window.Twitch && window.Twitch.ext) {
            window.Twitch.ext.onAuthorized((auth) => {
                if (auth?.channelId) {
                    setChannel(auth.channelId, 'twitch');
                }
            });
        }
    } catch (e) {
        console.warn('[channel] Twitch.ext not available', e);
    }
}

// ---------- Payload normalization ----------
function normalizePayload(raw) {
    if (!raw) return { clusters: [] };
    if (Array.isArray(raw)) return { clusters: raw };
    if (Array.isArray(raw.clusters)) return { clusters: raw.clusters };
    if (Array.isArray(raw.blobs)) return { clusters: raw.blobs };
    if (Array.isArray(raw.data)) return { clusters: raw.data };
    return { clusters: [raw] };
}

function extractStats(raw, clusters) {
    const total = coerceNumber(raw?.totals?.clicks ?? raw?.totalClicks, NaN);
    const users = coerceNumber(raw?.totals?.users ?? raw?.uniqueUsers, NaN);
    const coverage = coerceNumber(raw?.coverage, NaN);
    const fallbackCoverage = clusters.length ? Math.max(...clusters.map(c => coerceNumber(c.percentage, 0))) : 0;
    return {
        totalClicks: Number.isFinite(total) ? total : clusters.reduce((a, c) => a + (c.count || 0), 0),
        users: Number.isFinite(users) ? users : NaN,
        coverage: Number.isFinite(coverage) ? coverage : fallbackCoverage
    };
}

// ---------- Polling with smart fallback keys ----------
async function fetchHeatmapWithFallbacks(chan) {
    const base = `${EBS}/heatmap`;
    const tries = [
        `${base}?channel=${encodeURIComponent(chan)}`,
        `${base}?login=${encodeURIComponent(chan)}`,
        `${base}?id=${encodeURIComponent(chan)}`
    ];

    for (let i = 0; i < tries.length; i++) {
        const url = tries[i];
        try {
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) { console.warn('[poll] HTTP', resp.status, url); continue; }
            const json = await resp.json();
            const payload = normalizePayload(json);
            const clusters = payload.clusters || [];
            if (clusters.length > 0) {
                console.log('[poll] using', url, `(${clusters.length} clusters)`);
                return { url, payload };
            }
            console.log('[poll] empty clusters from', url);
            if (i === tries.length - 1) return { url, payload }; // last try, return anyway
        } catch (e) {
            console.warn('[poll] failed', url, e);
        }
    }
    return null;
}

async function pollOnce() {
    if (!channel) { console.warn('[poll] No channel resolved yet'); return; }

    const result = await fetchHeatmapWithFallbacks(channel);
    if (!result) {
        setServerUp(false);
        setError('Connection error. Retrying...');
        return;
    }

    const { payload } = result;
    const clusters = payload.clusters || [];

    const stats = extractStats(payload, clusters);
    els.totalClicks.textContent = Number.isFinite(stats.totalClicks) ? stats.totalClicks : '-';
    els.uniqueUsers.textContent = Number.isFinite(stats.users) ? stats.users : '-';
    els.clusterCount.textContent = clusters.length;
    els.coverage.textContent = fmtPercent(stats.coverage);
    els.lastUpdate.textContent = new Date().toLocaleTimeString();

    setServerUp(true);
    setError('');
}

function startPolling() {
    if (pollTimer) return;
    pollOnce(); // immediate
    pollTimer = setInterval(pollOnce, POLL_MS);
}
function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------- Buttons ----------
async function onStart() {
    const qp = getQueryChannel();
    if (qp && qp !== channel) setChannel(qp, 'query');
    if (!channel) {
        const entered = prompt('Enter channel (login or broadcaster ID):', 'ljvke');
        if (entered) setChannel(entered, 'prompt');
    }
    setRunningState(true);
    startPolling();
}
async function onStop() { setRunningState(false); stopPolling(); }
async function onReset() {
    try {
        const url = `${EBS}/reset?channel=${encodeURIComponent(channel || '')}`;
        const resp = await fetch(url, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        els.totalClicks.textContent = '0';
        els.clusterCount.textContent = '0';
        els.coverage.textContent = '0%';
        els.lastUpdate.textContent = new Date().toLocaleTimeString();
        setError('');
    } catch (e) {
        console.warn('Reset failed', e);
        setError('Reset failed. Check console for details.');
    }
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
    els.startBtn?.addEventListener('click', onStart);
    els.stopBtn?.addEventListener('click', onStop);
    els.resetBtn?.addEventListener('click', onReset);

    setRunningState(false);
    setOverlayUp(true);
    els.thresholdVal.textContent = '3%';

    initChannel();
    updateChannelBadge();
});
