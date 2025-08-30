// frontend/config.js
const EBS = 'https://smart-clickmap-backend.onrender.com';
const POLL_MS = 1000;

let HeatmapRenderer = null; // loaded dynamically, root-safe
let renderer = null;

let channel = null;        // what we will actually use for polling
let channelSource = null;  // 'query','storage','twitch'
let pollTimer = null;
let running = false;

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const els = {
    status: $('#status'),
    statusText: $('#status-text'),
    previewStatus: $('#preview-status'),
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
    miniCanvas: $('#mini-canvas'),
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
    els.previewStatus.textContent = isRunning ? 'Live' : 'Stopped';
    els.previewStatus.classList.toggle('live', isRunning);
    els.previewStatus.classList.toggle('stopped', !isRunning);

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

// ---------- Root-safe import for heatmap.js ----------
async function ensureRenderer() {
    if (!HeatmapRenderer) {
        // import heatmap.js relative to THIS file (works in Twitch root asset host)
        const mod = await import(new URL('./heatmap.js', import.meta.url));
        HeatmapRenderer = mod.HeatmapRenderer;
    }
    if (!renderer && els.miniCanvas) {
        renderer = new HeatmapRenderer(els.miniCanvas);

        // 🔑 Preview should show ALL clusters (even <3%)
        renderer.setThreshold(0);
        renderer.updateClusters([]); // paint once so it's not blank

        // Make sure initial layout is respected
        renderer.resize();
        // One more resize on next tick in case layout just changed
        setTimeout(() => renderer && renderer.resize(), 0);

        try {
            const ro = new ResizeObserver(() => renderer.resize());
            ro.observe(els.miniCanvas.parentElement || els.miniCanvas);
        } catch {
            window.addEventListener('resize', () => renderer.resize());
        }
    }
    return renderer;
}

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
    if (Array.isArray(raw.clusters)) return { clusters: raw.clusters, width: raw.width, height: raw.height };
    if (Array.isArray(raw.blobs)) return { clusters: raw.blobs, width: raw.width, height: raw.height };
    if (Array.isArray(raw.data)) return { clusters: raw.data, width: raw.width, height: raw.height };
    return { clusters: [raw] };
}

function normalizeClustersForPreview(payload, canvasW, canvasH) {
    const { clusters, width, height } = payload;

    const mapped = clusters.map((c) => ({
        x: ('x' in c) ? coerceNumber(c.x, 0) : 0,
        y: ('y' in c) ? coerceNumber(c.y, 0) : 0,
        percentage: coerceNumber(c.percentage ?? c.pct, 0),
        count: coerceNumber(c.count, 1),
        density: coerceNumber(c.density, 1),
        radius: coerceNumber(c.radius, 0.05),
        id: c.id
    }));

    const maxX = mapped.reduce((m, c) => Math.max(m, c.x), 0);
    const maxY = mapped.reduce((m, c) => Math.max(m, c.y), 0);

    let W = width || (maxX > 1 ? maxX : 1);
    let H = height || (maxY > 1 ? maxY : 1);

    if (W <= 1 && H <= 1) return mapped; // already normalized

    if (W < 2 && canvasW) W = canvasW;
    if (H < 2 && canvasH) H = canvasH;

    return mapped.map(c => ({
        ...c,
        x: W ? Math.min(1, Math.max(0, c.x / W)) : c.x,
        y: H ? Math.min(1, Math.max(0, c.y / H)) : c.y
    }));
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
            // Empty is ambiguous; try next variant before giving up
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

    const canvasW = (els.miniCanvas?.clientWidth) || 320;
    const canvasH = (els.miniCanvas?.clientHeight) || 180;

    // First try the “channel=” path; fall back to “login=” and “id=”
    const result = await fetchHeatmapWithFallbacks(channel);
    if (!result) {
        setServerUp(false);
        setError('Connection error. Retrying...');
        return;
    }

    const { payload } = result;
    const clusters = normalizeClustersForPreview(payload, canvasW, canvasH);

    await ensureRenderer();

    // helpful debug: see exactly what preview receives
    console.debug('[preview→renderer]', clusters.map(c => ({
        x: +c.x.toFixed(3), y: +c.y.toFixed(3), pct: c.percentage
    })));

    renderer?.updateClusters(clusters);

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
        // fallback prompt for quick testing in root-only hosting
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
        await ensureRenderer();
        renderer?.updateClusters([]);
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
    await ensureRenderer(); // build preview renderer immediately
});
