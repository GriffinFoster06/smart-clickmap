// frontend/config.js
import { HeatmapRenderer } from './heatmap.js';

const EBS = 'https://smart-clickmap-backend.onrender.com'; // same as overlay
const POLL_MS = 1000;

let channel = null;            // filled from Twitch auth or query param
let pollTimer = null;
let running = false;

let renderer = null;           // HeatmapRenderer for #mini-canvas

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

// ---- Preview wiring ----
function ensureRenderer() {
    if (renderer) return renderer;
    if (!els.miniCanvas) {
        console.warn('mini-canvas not found');
        return null;
    }
    renderer = new HeatmapRenderer(els.miniCanvas);
    return renderer;
}

async function pollOnce() {
    if (!channel) return;

    try {
        const resp = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(channel)}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // clusters for preview
        const clusters = (data?.clusters) || [];
        ensureRenderer()?.updateClusters(clusters);

        // quick stats — adapt to your API
        const total = data?.totals?.clicks ?? data?.totalClicks ?? clusters.reduce((a, c) => a + (c.count || 0), 0);
        const users = data?.totals?.users ?? data?.uniqueUsers ?? '-';
        const coveragePct = data?.coverage ?? (clusters.length ? Math.min(100, clusters.reduce((m, c) => Math.max(m, c.percentage || 0), 0)) : 0);

        els.totalClicks.textContent = Number.isFinite(total) ? total : '-';
        els.uniqueUsers.textContent = Number.isFinite(users) ? users : '-';
        els.clusterCount.textContent = clusters.length;
        els.coverage.textContent = fmtPercent(coveragePct);
        els.lastUpdate.textContent = new Date().toLocaleTimeString();

        setServerUp(true);
        setError('');

    } catch (err) {
        console.error('[poll]', err);
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

// ---- Buttons ----
async function onStart() {
    setRunningState(true);
    startPolling();
    // If you have a server-side flag to enable overlay stream, call it here:
    // await fetch(`${EBS}/control/start?channel=${encodeURIComponent(channel)}`, { method: 'POST' }).catch(console.warn);
}
async function onStop() {
    setRunningState(false);
    stopPolling();
    // If you have a server-side flag to disable overlay stream, call it here:
    // await fetch(`${EBS}/control/stop?channel=${encodeURIComponent(channel)}`, { method: 'POST' }).catch(console.warn);
}
async function onReset() {
    try {
        // Adjust to your backend route; common names: /reset, /clear, /purge
        const resp = await fetch(`${EBS}/reset?channel=${encodeURIComponent(channel)}`, { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        // Clear preview immediately so the user sees something happened
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

// ---- Twitch channel detection ----
function resolveChannel() {
    // 1) allow ?channel= in dev
    const qp = new URLSearchParams(location.search);
    const fromQP = qp.get('channel');
    if (fromQP) return fromQP;

    // 2) Twitch Extensions helper (in a config page it should be available)
    try {
        if (window.Twitch && window.Twitch.ext) {
            window.Twitch.ext.onAuthorized((auth) => {
                // You may need to decode channel/opaque user id from auth; often `channelId` is available
                // If your backend uses broadcaster name instead, pass it via query param in dev.
                channel = auth.channelId || channel;
            });
        }
    } catch (e) {
        console.warn('Twitch.ext not available:', e);
    }

    return null;
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
    // Hook buttons
    els.startBtn?.addEventListener('click', onStart);
    els.stopBtn?.addEventListener('click', onStop);
    els.resetBtn?.addEventListener('click', onReset);

    // Initial UI state
    setRunningState(false);
    setOverlayUp(true);
    els.thresholdVal.textContent = '3%';

    // Channel
    channel = resolveChannel() || 'demo'; // fallback so preview works locally
    if (!channel) {
        console.warn('No channel resolved; pass ?channel=yourchannel locally.');
    }

    // Build preview renderer immediately so the canvas paints
    ensureRenderer();
});
