import { SimpleHeatmap, deriveChannelFromLocation, connectToHeatmap } from './heatmap.js';

const canvas = document.getElementById('overlay-canvas');
const statusEl = document.getElementById('overlay-status');
const heatmap = new SimpleHeatmap(canvas);
let currentConnection;

function updateStatus(text, type = 'neutral') {
    statusEl.textContent = text;
    statusEl.style.color = type === 'error' ? '#f97316' : '#f8fafc';
}

async function init() {
    const response = await fetch('/api/config');
    const config = response.ok ? await response.json() : {};
    const channel = deriveChannelFromLocation(config.defaultStreamer);
    if (!channel) {
        updateStatus('No channel selected. Add /streamername to the URL.', 'error');
        return;
    }

    document.title = `Smart ClickMap Overlay – ${channel}`;

    currentConnection = connectToHeatmap(channel, {
        onSummary(summary) {
            heatmap.setSummary(summary);
            if ((summary?.totalClicks ?? 0) === 0) {
                updateStatus('Connected — waiting for clicks');
            } else {
                updateStatus(`Clicks captured: ${summary.totalClicks}`);
            }
        },
        onStatus(state) {
            if (state === 'connected') {
                statusEl.style.opacity = 0.9;
            } else {
                statusEl.style.opacity = 1;
                updateStatus('Reconnecting…');
            }
        }
    });
}

init();

window.addEventListener('beforeunload', () => currentConnection?.close());
