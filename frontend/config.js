// frontend/config.js - Fixed config panel with working reset and live preview
import { HeatmapRenderer } from './heatmap.js';

const EBS = 'https://smart-clickmap-backend.onrender.com';

class ConfigPanel {
    constructor() {
        this.pollInterval = null;
        this.renderer = null;
        this.sessionStart = null;
        this.isRunning = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.authToken = '';
        this.channelId = '';

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupTwitchAuth();
        this.startPolling();

        console.log('🎛️ Config Panel v2.2.0 initialized');
    }

    setupCanvas() {
        const canvas = document.getElementById('mini-canvas');
        if (canvas) {
            // Initialize the heatmap renderer for live preview
            this.renderer = new HeatmapRenderer(canvas);
            console.log('✅ Live preview canvas initialized');
        } else {
            console.error('❌ Mini canvas not found');
        }
    }

    setupEventListeners() {
        // Control buttons with error handling
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const resetBtn = document.getElementById('reset-btn');

        if (startBtn) {
            startBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.startSession();
            });
            console.log('✅ Start button event listener added');
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.stopSession();
            });
            console.log('✅ Stop button event listener added');
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetSession();
            });
            console.log('✅ Reset button event listener added');
        } else {
            console.error('❌ Reset button not found');
        }

        // Test button functionality
        console.log('🔧 Button elements found:', {
            start: !!startBtn,
            stop: !!stopBtn,
            reset: !!resetBtn
        });
    }

    setupTwitchAuth() {
        if (typeof Twitch !== 'undefined' && Twitch.ext) {
            Twitch.ext.onAuthorized((auth) => {
                this.authToken = auth.token;
                this.channelId = auth.channelId;
                console.log('✅ Config panel authorized for channel:', this.channelId);
            });
        } else {
            console.warn('⚠️ Twitch Extension Helper not available in config panel');
        }
    }

    async startSession() {
        console.log('🚀 Starting session...');

        try {
            this.setButtonState('start-btn', true); // Disable button
            this.updateElement('server-status', 'Starting...');

            const response = await fetch(`${EBS}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.sessionStart = Date.now();
                this.isRunning = true;
                this.updateStatus(true);
                this.showNotification('✅ Session started successfully!', 'success');
                console.log('🚀 ClickMap session started:', data);

                // Clear preview immediately
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                }

            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to start session:', error);
            this.showError(`Failed to start session: ${error.message}`);
        } finally {
            this.setButtonState('start-btn', false);
            this.updateElement('server-status', 'Connected');
        }
    }

    async stopSession() {
        console.log('⏹️ Stopping session...');

        try {
            this.setButtonState('stop-btn', true);
            this.updateElement('server-status', 'Stopping...');

            const response = await fetch(`${EBS}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.isRunning = false;
                this.updateStatus(false);
                this.sessionStart = null;
                this.showNotification('⏹️ Session stopped', 'info');
                console.log('⏸️ ClickMap session stopped:', data);
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to stop session:', error);
            this.showError(`Failed to stop session: ${error.message}`);
        } finally {
            this.setButtonState('stop-btn', false);
            this.updateElement('server-status', 'Connected');
        }
    }

    async resetSession() {
        console.log('🗑️ Reset button clicked');

        const confirmed = confirm('⚠️ Are you sure you want to clear all click data?\n\nThis action cannot be undone.');
        if (!confirmed) {
            console.log('❌ Reset cancelled by user');
            return;
        }

        console.log('🗑️ Resetting session...');

        try {
            this.setButtonState('reset-btn', true);
            this.updateElement('server-status', 'Resetting...');

            const response = await fetch(`${EBS}/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.showNotification('🗑️ All data cleared', 'info');
                console.log('🧹 ClickMap data reset:', data);

                // Clear the preview immediately
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                }

                // Reset all stats
                this.updateElement('total-clicks', '0');
                this.updateElement('unique-users', '0');
                this.updateElement('cluster-count', '0');
                this.updateElement('coverage', '0%');

            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to reset data:', error);
            this.showError(`Failed to reset data: ${error.message}`);
        } finally {
            this.setButtonState('reset-btn', false);
            this.updateElement('server-status', 'Connected');
        }
    }

    setButtonState(buttonId, disabled) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = disabled;
            console.log(`🔘 Button ${buttonId} ${disabled ? 'disabled' : 'enabled'}`);
        }
    }

    startPolling() {
        // Poll every second for real-time updates
        this.pollInterval = setInterval(() => this.pollData(), 1000);
        this.pollData(); // Initial poll
        console.log('📊 Polling started');
    }

    async pollData() {
        try {
            document.body.classList.remove('loading');

            // Use channel ID if available, otherwise poll general stats
            const url = this.channelId
                ? `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`
                : `${EBS}/heatmap`;

            const response = await fetch(url);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.updateUI(data);
            this.hideError();
            this.retryCount = 0;

        } catch (error) {
            this.retryCount++;
            console.warn(`⚠️ Polling error (attempt ${this.retryCount}):`, error);

            if (this.retryCount <= this.maxRetries) {
                this.showError(`Connection issue. Retrying... (${this.retryCount}/${this.maxRetries})`);
            } else {
                this.showError('❌ Connection lost. Please check your internet connection and refresh the page.');
            }
            document.body.classList.add('loading');
        }
    }

    updateUI(data) {
        this.isRunning = data.running;
        this.updateStatus(data.running);

        // Update main statistics
        this.updateElement('total-clicks', data.totalClicks || 0);
        this.updateElement('unique-users', data.uniqueUsers || 0);

        // Count clusters above threshold
        const visibleClusters = (data.clusters || []).filter(c => c.percentage >= (data.threshold || 3));
        this.updateElement('cluster-count', visibleClusters.length);
        this.updateElement('coverage', `${data.coverage || 0}%`);

        // Update advanced statistics
        this.updateAdvancedStats(data);

        // Update preview canvas - FIXED
        if (this.renderer && data.clusters) {
            console.log(`🎨 Updating preview with ${data.clusters.length} clusters`);
            this.renderer.updateClusters(data.clusters);
        } else if (this.renderer) {
            console.log('🎨 Clearing preview - no clusters');
            this.renderer.updateClusters([]);
        }

        // Update preview status
        this.updatePreviewStatus(data.running, visibleClusters.length);
    }

    updatePreviewStatus(isRunning, clusterCount) {
        const previewStatus = document.getElementById('preview-status');
        if (previewStatus) {
            if (isRunning) {
                previewStatus.textContent = clusterCount > 0 ? 'LIVE' : 'ACTIVE';
                previewStatus.className = 'preview-status live';
            } else {
                previewStatus.textContent = 'STOPPED';
                previewStatus.className = 'preview-status stopped';
            }
        }
    }

    updateAdvancedStats(data) {
        // Session duration
        if (this.sessionStart && data.running) {
            const duration = Math.floor((Date.now() - this.sessionStart) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            this.updateElement('duration', `${minutes}:${seconds.toString().padStart(2, '0')}`);
        } else {
            this.updateElement('duration', '-');
        }

        // Last update time
        this.updateElement('last-update', new Date().toLocaleTimeString());

        // Server and overlay status
        this.updateElement('server-status', 'Connected');
        this.updateElement('overlay-status', data.running ? 'Active' : 'Ready');

        // Threshold information
        this.updateElement('threshold-value', `${data.threshold || 3}%`);
    }

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        } else {
            console.warn(`⚠️ Element ${id} not found`);
        }
    }

    updateStatus(isRunning) {
        const statusEl = document.getElementById('status');
        const statusText = document.getElementById('status-text');

        if (statusEl && statusText) {
            if (isRunning) {
                statusEl.className = 'status-indicator running';
                statusText.textContent = 'Session Active';
            } else {
                statusEl.className = 'status-indicator stopped';
                statusText.textContent = 'Session Stopped';
            }
        }

        // Update button states
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (startBtn && stopBtn) {
            if (isRunning) {
                startBtn.textContent = '▶️ Running';
                startBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                startBtn.textContent = '▶️ Start';
                startBtn.disabled = false;
                stopBtn.disabled = false;
            }
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            if (errorEl.textContent !== undefined) {
                errorEl.textContent = message;
            } else {
                errorEl.innerHTML = message;
            }
            errorEl.style.display = 'block';
        }
        console.error('🔴 Config Panel Error:', message);
    }

    hideError() {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    showNotification(message, type = 'info') {
        console.log(`${type.toUpperCase()}: ${message}`);

        // Create temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 16px;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            font-weight: 600;
            z-index: 10000;
            transition: all 0.3s ease;
        `;

        // Set color based on type
        switch (type) {
            case 'success':
                notification.style.background = 'rgba(34, 197, 94, 0.95)';
                break;
            case 'error':
                notification.style.background = 'rgba(239, 68, 68, 0.95)';
                break;
            default:
                notification.style.background = 'rgba(59, 130, 246, 0.95)';
        }

        notification.textContent = message;
        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                setTimeout(() => {
                    notification.parentNode.removeChild(notification);
                }, 300);
            }
        }, 3000);
    }

    destroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        if (this.renderer) {
            this.renderer.destroy();
        }
    }
}

// Initialize config panel when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new ConfigPanel();
    });
} else {
    new ConfigPanel();
}

// Global reference for debugging
window.ConfigPanel = ConfigPanel;