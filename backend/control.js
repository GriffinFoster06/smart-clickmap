const chan = location.pathname.split('/')[1];
const key = new URLSearchParams(location.search).get('key');
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const reset = document.getElementById('reset');
const statusEl = document.getElementById('status');

async function callAPI(ep) {
    try {
        const res = await fetch(`/api/${chan}/${ep}?key=${key}`, { method: 'POST' });
        return res.ok ? 'OK' : `Error ${res.status}`;
    } catch (error) {
        console.error(`API call to ${ep} failed:`, error);
        return `Error: ${error.message}`;
    }
}

start.onclick = async () => {
    statusEl.textContent = 'Status: ' + await callAPI('start');
};
stop.onclick = async () => {
    statusEl.textContent = 'Status: ' + await callAPI('stop');
};
reset.onclick = async () => {
    statusEl.textContent = 'Status: ' + await callAPI('reset');
};

// load config into UI
async function loadCfg() {
    try {
        const res = await fetch(`/api/${chan}/config?key=${key}`);
        if (!res.ok) {
            console.error('Failed to load config:', res.status);
            statusEl.textContent = `Status: Failed to load config (${res.status})`;
            return;
        }

        const cfg = await res.json();

        // Set all available config options
        Object.entries({
            'blobColor': cfg.blobColor,
            'topColor': cfg.topColor,
            'displayThreshold': cfg.displayThreshold,
            'strokeColor': cfg.strokeColor,
            'strokeWidth': cfg.strokeWidth,
            'textColor': cfg.textColor,
            'radiusBase': cfg.radiusBase,
            'radiusScale': cfg.radiusScale
        }).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'number') {
                    el.value = Number(value);
                } else {
                    el.value = value;
                }
            }
        });
    } catch (error) {
        console.error('Error loading config:', error);
        statusEl.textContent = `Status: Error loading config: ${error.message}`;
    }
}
loadCfg();

document.getElementById('saveCfg').onclick = async () => {
    try {
        // Get all config values from UI
        const newCfg = {};
        const configFields = ['blobColor', 'topColor', 'displayThreshold', 'strokeColor', 'strokeWidth', 'textColor', 'radiusBase', 'radiusScale'];

        configFields.forEach(field => {
            const el = document.getElementById(field);
            if (el) {
                newCfg[field] = el.type === 'number' ? Number(el.value) : el.value;
            }
        });

        const res = await fetch(`/api/${chan}/config?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newCfg)
        });

        if (res.ok) {
            alert('Settings saved');
            statusEl.textContent = 'Status: Settings saved';
        } else {
            alert('Save failed: ' + res.status);
            statusEl.textContent = 'Status: Save failed';
        }
    } catch (error) {
        console.error('Error saving config:', error);
        alert(`Error saving settings: ${error.message}`);
        statusEl.textContent = `Status: Error saving settings`;
    }
};
// Ensure the server is correctly serving JavaScript files with the proper MIME type.
// Add this middleware to your server configuration if using Node.js with Express.

const express = require('express');
const path = require('path');
const app = express();

// Serve static files with correct MIME types
app.use('/js', express.static(path.join(__dirname, 'js'), { setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
    }
}}));

// Example route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
