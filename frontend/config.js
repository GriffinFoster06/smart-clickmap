// frontend/config.js
import { HeatmapRenderer } from './heatmap.js';

const EBS = 'https://smart-clickmap-backend.onrender.com';
const POLL_MS = 1000;

let channel = null;
let pollTimer = null;
let running = false;
let renderer = null;
let haveAnnouncedChannel = false;

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
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

// ===== UI helpers =====
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
    if (!msg) {
        els.error.style.display = 'none';
    } else {
        els.error.textContent = msg;
        els.error.style.display = 'block';
    }
}

function fmtPercent(n) {
    if (n == null || isNaN(n)) return '-';
    return `${Math.round(n)}%`;
}

function ensureRenderer() {
    if (renderer) return renderer;
    if (!els.miniCanvas) {
        console.warn('mini-canvas not found');
        return null;
    }
    renderer = new HeatmapRenderer(els.miniCanvas);

    // Keep the preview responsive even if the container resizes later
    try {
        const ro = new ResizeObserver(() => renderer.resize());
        ro.observe(els.miniCanvas.parentElement || els.miniCanvas);
    } catch (e) {
        window.addEventListener('resize', () => renderer.resize());
    }

    return renderer;
}

// ===== Channel resolution (robust) =====
function getQueryChannel() {
    const qp = new URLSearchParams(location.search);
    return qp.get('channel') || qp.get('c');
}

function setChannel(ch) {
    if (!ch) return;
    channel = String(ch);
    if (!haveAnnouncedChannel) {
        console.log('[config] Using channel:', channel);
        haveAnnouncedChannel = true;
    }
}

function initTwitchAuthFallback() {
    // If Twitch helper is present, use it to resolve channelId
    try {
        if (window.Twitch && window.Twitch.ext) {
            window.Twitch.ext.onAuthorized((auth) => {
                // auth.channelId is the broadcaster ID. Your backend must accept this as "channel",
                // or you should translate it to the broadcaster login on the server.
                if (auth?.channelId) {
                    setChannel(auth.channelId);
                }
            });
        }
    } catch (e) {
        console.warn('Twitch.ext not available:', e);
    }
}

// ===== Data shape & normalization =====
function coerceNumber(n, fallback = 0) {
    const x = typeof n === 'string' ? parseFloat(n) : n;
    return Number.isFinite(x) ? x : fallback;
}

// Accepts many shapes and returns: { clusters:[{x,y,percentage,count,density,radius}], width?, height? }
function normalizePayload(raw) {
    if (!raw) return { clusters: [] };

    // If server returns an array directly
    if (Array.isArray(raw)) {
        return { clusters: raw };
    }

    // Common keys
    if (Array.isArray(raw.clusters)) {
        return { clusters: raw.clusters, width: raw.width, height: raw.height };
    }
    if (Array.isArray(raw.blobs)) {
        return { clusters: raw.blobs, width: raw.width, height: raw.height };
    }
    if (Array.isArray(raw.data)) {
        return { clusters: raw.data, width: raw.width, height: raw.height };
    }

    // Last resort: try to treat object as a single cluster (unlikely)
    return { clusters: [raw] };
}

// normalize coordinates to [0,1] if they are absolute. If width/height unknown, infer by max(x,y)
function normalizeClustersForPreview(payload, canvasW, canvasH) {
    const { clusters, width, height } = payload;

    // Map field aliases and coerce numbers
    const mapped = clusters.map((c) => ({
        x: ('x' in c) ? coerceNumber(c.x, 0) : 0,
        y: ('y' in c) ? coerceNumber(c.y, 0) : 0,
        percentage: coerceNumber(c.percentage ?? c.pct, 0),
        count: coerceNumber(c.count, 1),
        density: coerceNumber(c.density, 1),
        radius: coerceNumber(c.radius, 0.05),
        id: c.id
    }));

    // detect normalization need
    const maxX = mapped.reduce((m, c) => Math.max(m, c.x), 0);
    const maxY = mapped.reduce((m, c) => Math.max(m, c.y), 0);

    let W = width || (maxX > 1 ? maxX : 1);
    let H = height || (maxY > 1 ? maxY : 1);

    // Some APIs send 0..W-1; pad to avoid divide by zero
    if (W <= 1 && H <= 1) {
        // Already normalized 0..1
        return mapped.map(c => ({ ...c, x: c.x, y: c.y }));
    }

    // If width/height exist but < 2, use canvas dimensions to guess
    if (W < 2 && canvasW) W = canvasW;
    if (H < 2 && canvasH) H = canvasH;

    // Normalize
    return mapped.map(c => ({
        ...c,
        x: W ? Math.min(1, Math.max(0, c.x / W)) : c.x,
        y: H ? Math.min(1, Math.max(0, c.y / H)) : c.y
    }));
}

// ===== Stats extraction (tolerant) =====
function extractStats(raw, clusters) {
    const total = coerceNumber(raw?.totals?.clicks ?? raw?.totalClicks, NaN);
    const users = coerceNumber(raw?.totals?.users ?? raw?.uniqueUsers, NaN);

    // Coverage: prefer server value; else use max percentage as a simple proxy
    const coverage = coerceNumber(raw?.coverage, NaN);
    const fallbackCoverage = clusters.length ? Math.max(...clusters.map(c => coerceNumber(c.percentage, 0))) : 0;

    return {
        totalClicks: Number.isFinite(total) ? total : clusters.reduce((a, c) => a + (c.count || 0), 0),
        users: Number.isFinite(users) ? users : NaN,
        coverage: Number.isFinite(coverage) ? coverage : fallbackCoverage
    };
}

// ===== Polling =====
async function pollOnce() {
    if (!channel) {
        // Wait for channel to resolve; Start will trigger again when it does
        console.warn('[poll] No channel yet.');
        return;
    }

    const url = `${EBS}/heatmap?channel=${encodeURIComponent(channel)}`;
    try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const raw = await resp.json();

        const canvasW = (els.miniCanvas?.clientWidth) || 320;
        const canvasH = (els.miniCanvas?.clientHeight) || 180;
        const payload = normalizePayload(raw);
        const clusters = normalizeClustersForPreview(payload, canvasW, canvasH);

        // DIAGNOSTICS
        if (clusters.length === 0) {
            console.debug('[preview] No clusters from server at', new Date().toISOString(), raw);
        }

        ensureRenderer()?.updateClusters(clusters);

        const stats = extractStats(raw, clusters);
        els.totalClicks.textContent = Number.isFinite(stats.totalClicks) ? stats.totalClicks : '-';
        els.uniqueUsers.textContent = Number.isFinite(stats.users) ? stats.users : '-';
        els.clusterCount.textContent = clusters.length;
        els.coverage.textContent = fmtPercent(stats.coverage);
        els.lastUpdate.textContent = new Date().toLocaleTimeString();

        setServerUp(true);
        setError('');

    } catch (err) {
        console.error('[poll] Fetch/parse failed:', err);
        setServerUp(false);
        setError('Connection error. Retrying...');
    }
}

function startPolling() {
    if (pollTimer) return;
    pollOnce(); // immediate
    pollTimer = setInterval(pollOnce, POLL_MS);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ===== Buttons =====
async function onStart() {
    // Delay start until we have a channel
    const tryStart = () => {
        if (channel) {
            setRunningState(true);
            startPolling();
        } else {
            console.log('[start] Waiting for channel...');
            setTimeout(tryStart, 200);
        }
    };
    tryStart();
}

async function onStop() {
    setRunningState(false);
    stopPolling();
}

async function onReset() {
    try {
        const resp = await fetch(`${EBS}/reset?channel=${encodeURIComponent(channel || '')}`, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        ensureRenderer()?.updateClusters([]);
        els.totalClicks.textContent = '0';
        els.clusterCount.textContent = '0';
        els.coverage.textContent = '0%';
        els.lastUpdate.textContent = new Date().toLocaleTimeString();
        setError('');
    } catch (e) {
        console.warn('Reset failed; adjust the endpoint to your API (e.g., /clear)', e);
        setError('Reset failed. Check console for details.');
    }
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', () => {
    // Wire buttons
    els.startBtn?.addEventListener('click', onStart);
    els.stopBtn?.addEventListener('click', onStop);
    els.resetBtn?.addEventListener('click', onReset);

    // UI defaults
    setRunningState(false);
    setOverlayUp(true);
    els.thresholdVal.textContent = '3%';

    // Resolve channel
    const qpChannel = getQueryChannel();
    if (qpChannel) setChannel(qpChannel);
    initTwitchAuthFallback();

    // Build renderer immediately so the canvas is ready to paint
    ensureRenderer();
});
