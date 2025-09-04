// frontend/config.js - Bulletproof configuration panel with improved Twitch integration
import { HeatmapRenderer } from './heatmap.js';

class BulletproofConfigPanel {
    constructor() {
        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.pollInterval = null;
        this.renderer = null;
        this.sessionStart = null;
        this.isRunning = false;
        this.consecutiveErrors = 0;
        this.maxRetries = 5;
        this.twitchReady = false;

        // Debug logging
        this.debug = true;

        this.log('🎛️ Bulletproof Config Panel v3.0.0 initializing...');
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
            this.log('Setting up canvas...');
            this.setupCanvas();

            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.log('Setting up Twitch extension...');
            await this.setupTwitchExtension();

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

    async setupTwitchExtension() {
        return new Promise((resolve, reject) => {
            const maxAttempts = 50; // 5 seconds total
            let attempts = 0;

            const checkTwitch = () => {
                attempts++;

                if (typeof Twitch !== 'undefined' && Twitch.ext) {
                    this.log('✅ Twitch Extension Helper found');
                    this.twitchReady = true;
                    this.initializeTwitchHandlers();
                    resolve();
                } else if (attempts >= maxAttempts) {
                    this.log('⚠️ Twitch Extension Helper not available - continuing without it');
                    // Don't reject, as config panel can work without Twitch context
                    resolve();
                } else {
                    setTimeout(checkTwitch, 100);
                }
            };

            checkTwitch();
        });
    }

    initializeTwitchHandlers() {
        try {
            // Config panels don't typically need authorization, but we can set up handlers if needed
            if (Twitch.ext.onAuthorized) {
                Twitch.ext.onAuthorized((auth) => {
                    this.log(`✅ Twitch auth received for channel: ${auth.channelId}`);
                });
            }

            if (Twitch.ext.onVisibilityChanged) {
                Twitch.ext.onVisibilityChanged((isVisible) => {
                    this.log(`Config panel visibility changed: ${isVisible}`);
                });
            }

            this.log('✅ Twitch handlers initialized');
        } catch (error) {
            this.error('Error setting up Twitch handlers', error);
        }
    }

    async testConnection() {
        try {
            const response = await fetch(`${this.EBS}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }

            const data = await response.json();
            this.log(`✅ Backend connection OK - Version: ${data.version}, Running: ${data.running}`);
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
        } else {
            this.error('Start button not found!');
        }

        // STOP button  
        if (stopBtn) {
            stopBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.log('⏹️ STOP button clicked');
                await this.handleStop();
            });
            this.log('✅ Stop button listener attached');
        } else {
            this.error('Stop button not found!');
        }

        // RESET button
        if (resetBtn) {
            resetBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                this.log('🗑️ RESET button clicked');
                await this.handleReset();
            });
            this.log('✅ Reset button listener attached');
        } else {
            this.error('Reset button not found!');
        }
    }

    async handleStart() {
        try {
            this.log('Sending START request...');
            this.setButtonDisabled('start-btn', true);
            this.showStatus('Starting...', 'running');

            const response = await fetch(`${this.EBS}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

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

            const response = await fetch(`${this.EBS}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

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

            const response = await fetch(`${this.EBS}/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

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

        this.pollInterval = setInterval(() => this.pollData(), 1000);
        this.pollData(); // Initial poll
        this.log('✅ Polling started');
    }

    async pollData() {
        try {
            const response = await fetch(`${this.EBS}/heatmap`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateUI(data);
            this.consecutiveErrors = 0;
            this.hideError();

        } catch (error) {
            this.consecutiveErrors++;
            this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);

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
        // Could add a success toast here
        console.log(`✅ ${message}`);
    }

    destroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        if (this.renderer) {
            this.renderer.destroy();
        }
        this.log('🧹 Config panel destroyed');
    }
}

// Initialize when DOM is ready with error handling
function initializeConfig() {
    try {
        window.configPanel = new BulletproofConfigPanel();
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
window.BulletproofConfigPanel = BulletproofConfigPanel;