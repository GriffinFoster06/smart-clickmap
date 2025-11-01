import { SimpleHeatmap, deriveChannelFromLocation, connectToHeatmap } from './heatmap.js';

const stage = document.getElementById('stage');
const captureLayer = document.getElementById('capture-layer');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const statusConnection = document.getElementById('status-connection');
const statusChannel = document.getElementById('status-channel');
const statusClicks = document.getElementById('status-clicks');
const toggleInteraction = document.getElementById('toggle-interaction');
const overlayUrlEl = document.getElementById('overlay-url');
const player = document.getElementById('twitch-player');

const heatmap = new SimpleHeatmap(heatmapCanvas);
let websocket;
let currentChannel = '';
let allowPassThrough = false;

async function loadServerConfig() {
    const response = await fetch('/api/config');
    if (!response.ok) {
        throw new Error('Unable to fetch server config');
    }
    return response.json();
}

function updateStatusPill(element, text, type = 'neutral') {
    element.textContent = text;
    element.classList.remove('online', 'error');
    if (type === 'online') {
        element.classList.add('online');
    } else if (type === 'error') {
        element.classList.add('error');
    }
}

function setOverlayUrl(channel) {
    const url = new URL(window.location.href);
    url.pathname = `/overlay/${channel}`;
    url.search = '';
    overlayUrlEl.textContent = url.toString();
}

function configureIframe(channel) {
    const parent = window.location.hostname;
    const params = new URLSearchParams({
        channel,
        parent,
        autoplay: 'true',
        muted: 'true'
    });

    if (parent !== 'localhost' && parent !== '127.0.0.1') {
        params.append('parent', 'localhost');
        params.append('parent', '127.0.0.1');
    }

    player.src = `https://player.twitch.tv/?${params.toString()}`;
}

function connect(channel) {
    websocket?.close();
    websocket = connectToHeatmap(channel, {
        onSummary(summary) {
            heatmap.setSummary(summary);
            updateStatusPill(statusClicks, `Clicks: ${summary.totalClicks ?? 0}`);
        },
        onStatus(state) {
            if (state === 'connected') {
                updateStatusPill(statusConnection, 'Backend: Connected', 'online');
            } else {
                updateStatusPill(statusConnection, 'Backend: Reconnecting…');
            }
        }
    });
}

function setChannel(channel, config) {
    currentChannel = channel;
    updateStatusPill(statusChannel, `Channel: ${channel}`, 'online');
    setOverlayUrl(channel);
    configureIframe(channel);
    connect(channel);
    if (config?.hotkeys?.resetChannels?.[channel]) {
        statusChannel.title = `Reset hotkey: ${config.hotkeys.resetChannels[channel]}`;
    } else {
        statusChannel.removeAttribute('title');
    }
}

async function init() {
    try {
        const config = await loadServerConfig();
        const channel = deriveChannelFromLocation(config.defaultStreamer);
        if (!channel) {
            throw new Error('No channel selected. Add /streamername to the URL.');
        }
        setChannel(channel, config);
        document.title = `Smart ClickMap – ${channel}`;
    } catch (error) {
        console.error(error);
        updateStatusPill(statusConnection, 'Backend unavailable', 'error');
        statusConnection.title = error.message;
    }
}

function sendClick(x, y) {
    if (!currentChannel) return;
    return fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: currentChannel, x, y })
    })
        .then((response) => {
            if (!response.ok) {
                return response.json().then((payload) => {
                    const message = payload?.error || response.statusText;
                    throw new Error(message);
                });
            }
        })
        .catch((error) => {
            console.error('Failed to send click', error);
            updateStatusPill(statusConnection, 'Send failed', 'error');
        });
}

function clamp(value) {
    return Math.min(1, Math.max(0, value));
}

function handlePointer(event) {
    if (allowPassThrough) return;
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);
    sendClick(x, y);
}

captureLayer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handlePointer(event);
});

captureLayer.addEventListener('touchstart', (event) => {
    if (event.touches.length === 1) {
        handlePointer(event.touches[0]);
    }
}, { passive: true });

function togglePassThrough() {
    allowPassThrough = !allowPassThrough;
    if (allowPassThrough) {
        captureLayer.style.pointerEvents = 'none';
        toggleInteraction.textContent = 'Capture Clicks Again';
        toggleInteraction.classList.remove('is-inactive');
    } else {
        captureLayer.style.pointerEvents = 'auto';
        toggleInteraction.textContent = 'Allow Player Controls';
        toggleInteraction.classList.add('is-inactive');
    }
}

toggleInteraction.addEventListener('click', () => {
    togglePassThrough();
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && allowPassThrough) {
        togglePassThrough();
    }
});

init();
