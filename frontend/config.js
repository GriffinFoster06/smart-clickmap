// frontend/config.js - HTTP-only configuration panel for Twitch extensions
import { HeatmapRenderer } from './heatmap.js';

class TwitchConfigPanel {
    constructor() {
        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.pollInterval = null;
        this.renderer = null;
        this.sessionStart = null;
        this.isRunning = false;
        this.consecutiveErrors = 0;
        this.maxRetries = 3;
        this.authToken = '';

        // Optimized for config panel
        this.POLL_RATE = 2000; // 2 seconds for config panel

        // Debug logging
        this.debug = true;

        this.log('🎛️ Config Panel v3.1.0 (HTTP-only) initializing...');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[CONFIG] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[CONFIG ERROR] ${message}`, err || '');
    }

    async init() {
        try {
            this.log('Setting up Twitch extension auth...');
            this.setupTwitchAuth();

            this.log('Setting up canvas...');
            this.setupCanvas();

            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.log('Testing backend connection...');
            await this.testConnection();

            this.log('Starting polling...');
            this.startPolling();

            this.log('✅ Configuration panel ready!');

        } catch (error) {
            this.error('Failed to initialize config panel', error);
            this.showError('Failed to initialize. Check console for details.');
        }
    }

    setupTwitchAuth() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            this.error('Twitch Extension Helper not available');
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.log('✅ Twitch auth received');
        });
    }

    async testConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.EBS}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                cache: 'no-cache'
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }

            const data = await response.json();
            this.log(`✅ Backend connection OK - Version: ${data.version}, Running: ${data.running}`);
            this.hideError();
            return data;

        } catch (error) {
            this.error('Backend connection failed', error);
            throw error;
        }
    }

    setupCanvas() {
        const canvas = document.getElementById('mini-canvas');
        if (canvas) {
            this.renderer = new HeatmapRenderer(canvas);
            this.log('✅ Canvas setup complete');
        } else {
            this.log('⚠️ Mini canvas not found');
        }
    }

    setupEventListeners() {
        // Get all buttons
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const resetBtn = document.getElementById('reset-btn');

        this.log(`Found buttons: Start=${!!startBtn}, Stop=${!!stopBtn}, Reset=${!!resetBtn}`);

        // START button
        if (startBtn) {
            startBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.log('🚀 START button clicked');
                await this.handleStart();
            });
            this.log('✅ Start button listener attached');
        }

        // STOP button  
        if (stopBtn) {
            stopBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.log('⏹️ STOP button clicked');
                await this.handleStop();
            });
            this.log('✅ Stop button listener attached');
        }

        // RESET button
        if (resetBtn) {
            resetBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.log('🗑️ RESET button clicked');
                await this.handleReset();
            });
            this.log('✅ Reset button listener attached');
        }
    }

    async handleStart() {
        try {
            this.log('Sending START request...');
            this.setButtonDisabled('start-btn', true);
            this.showStatus('Starting...', 'running');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const headers = {
                'Content-Type': 'application/json'
            };

            // Add auth token if available
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const response = await fetch(`${this.EBS}/start`, {
                method: 'POST',
                headers,
                body: JSON.stringify({}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            this.log(`START response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            this.log('START response data:', data);

            if (data.success) {
                this.sessionStart = Date.now();
                this.isRunning = true;
                this.showStatus('Session Active', 'running');
                this.showSuccess('✅ Session started successfully!');
                this.log('✅ Start successful');

                // Trigger immediate poll for updated data
                this.pollData();
            } else {
                throw new Error(data.error || 'Start failed');
            }

        } catch (error) {
            this.error('START failed', error);
            this.showStatus('Start Failed', 'stopped');
            this.showError(`Failed to start: ${error.message}`);
        } finally {
            this.setButtonDisabled('start-btn', false);
        }
    }

    async handleStop() {
        try {
            this.log('Sending STOP request...');
            this.setButtonDisabled('stop-btn', true);
            this.showStatus('Stopping...', 'stopped');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const response = await fetch(`${this.EBS}/stop`, {
                method: 'POST',
                headers,
                body: JSON.stringify({}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            this.log(`STOP response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            this.log('STOP response data:', data);

            if (data.success) {
                this.sessionStart = null;
                this.isRunning = false;
                this.showStatus('Session Stopped', 'stopped');
                this.showSuccess('⏹️ Session stopped successfully!');
                this.log('✅ Stop successful');

                // Trigger immediate poll for updated data
                this.pollData();
            } else {
                throw new Error(data.error || 'Stop failed');
            }

        } catch (error) {
            this.error('STOP failed', error);
            this.showStatus('Stop Failed', 'stopped');
            this.showError(`Failed to stop: ${error.message}`);
        } finally {
            this.setButtonDisabled('stop-btn', false);
        }
    }

    async handleReset() {
        if (!confirm('⚠️ Clear all click data? This cannot be undone.')) {
            this.log('Reset cancelled by user');
            return;
        }

        try {
            this.log('Sending RESET request...');
            this.setButtonDisabled('reset-btn', true);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const response = await fetch(`${this.EBS}/reset`, {
                method: 'POST',
                headers,
                body: JSON.stringify({}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            this.log(`RESET response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            this.log('RESET response data:', data);

            if (data.success) {
                this.showSuccess('🗑️ Data cleared successfully!');
                this.log('✅ Reset successful');

                // Clear preview
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                }

                // Trigger immediate poll for updated data
                this.pollData();
            } else {
                throw new Error(data.error || 'Reset failed');
            }

        } catch (error) {
            this.error('RESET failed', error);
            this.showError(`Failed to reset: ${error.message}`);
        } finally {
            this.setButtonDisabled('reset-btn', false);
        }
    }

    startPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }

        this.pollInterval = setInterval(() => this.pollData(), this.POLL_RATE);
        this.pollData(); // Initial poll
        this.log('✅ Polling started');
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            this.log('⏸️ Polling stopped');
        }
    }

    async pollData() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const response = await fetch(`${this.EBS}/heatmap?t=${Date.now()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateUI(data);
            this.consecutiveErrors = 0;
            this.hideError();

        } catch (error) {
            this.consecutiveErrors++;

            if (error.name !== 'AbortError') {
                this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);
            }

            if (this.consecutiveErrors >= this.maxRetries) {
                this.showError(`Connection lost after ${this.maxRetries} attempts. Check server.`);
            }
        }
    }

    updateUI(data) {
        try {
            // Update running state
            this.isRunning = data.running;

            // Update stats
            this.updateElement('total-clicks', data.totalClicks || 0);
            this.updateElement('unique-users', data.uniqueUsers || 0);
            this.updateElement('cluster-count', (data.clusters || []).length);
            this.updateElement('coverage', `${data.coverage || 0}%`);

            // Update status
            if (data.running) {
                this.showStatus('Session Active', 'running');
            } else {
                this.showStatus('Session Stopped', 'stopped');
            }

            // Update preview
            if (this.renderer) {
                this.renderer.updateClusters(data.clusters || []);
            }

            // Update last update time
            this.updateElement('last-update', new Date().toLocaleTimeString());

            // Update server status
            this.updateElement('server-status', 'Connected');
            this.updateElement('overlay-status', data.running ? 'Active' : 'Stopped');

        } catch (error) {
            this.error('Failed to update UI', error);
        }
    }

    // UI Helper methods
    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    setButtonDisabled(buttonId, disabled) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = disabled;
            this.log(`Button ${buttonId} disabled: ${disabled}`);
        }
    }

    showStatus(text, type) {
        const statusEl = document.getElementById('status');
        const statusText = document.getElementById('status-text');

        if (statusEl && statusText) {
            statusEl.className = `status-indicator ${type}`;
            statusText.textContent = text;
        }

        const previewStatus = document.getElementById('preview-status');
        if (previewStatus) {
            previewStatus.textContent = type === 'running' ? 'Live' : 'Stopped';
            previewStatus.className = `preview-status ${type === 'running' ? 'live' : 'stopped'}`;
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
        this.error(message);
    }

    hideError() {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    showSuccess(message) {
        this.log(`SUCCESS: ${message}`);
        console.log(`✅ ${message}`);

        // Show temporary success indicator
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(34, 197, 94, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            z-index: 10002;
            pointer-events: none;
            animation: slideInOut 3s ease-in-out forwards;
        `;
        indicator.textContent = message;

        // Add animation style if not exists
        if (!document.getElementById('success-style')) {
            const style = document.createElement('style');
            style.id = 'success-style';
            style.textContent = `
                @keyframes slideInOut {
                    0% { opacity: 0; transform: translateX(-100%); }
                    20%, 80% { opacity: 1; transform: translateX(0); }
                    100% { opacity: 0; transform: translateX(-100%); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(indicator);

        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 3000);
    }

    destroy() {
        this.stopPolling();
        if (this.renderer) {
            this.renderer.destroy();
        }
        this.log('🧹 Config panel destroyed');
    }
}

// Initialize when DOM is ready with error handling
function initializeConfig() {
    try {
        window.configPanel = new TwitchConfigPanel();
    } catch (error) {
        console.error('❌ Failed to initialize config panel:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeConfig);
} else {
    initializeConfig();
}

// Global reference for debugging
window.TwitchConfigPanel = TwitchConfigPanel;