// frontend/config.js - Complete broadcaster control panel
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

        console.log('🎛️ Config Panel v2.0.0 initialized');
    }

    setupCanvas() {
        const canvas = document.getElementById('mini-canvas');
        if (canvas) {
            this.renderer = new HeatmapRenderer(canvas);
        }
    }

    setupEventListeners() {
        // Control buttons
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const resetBtn = document.getElementById('reset-btn');

        if (startBtn) startBtn.addEventListener('click', () => this.startSession());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopSession());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetSession());

        // Threshold control (if exists)
        const thresholdSlider = document.getElementById('threshold-slider');
        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', (e) => {
                const threshold = parseInt(e.target.value);
                if (this.renderer) {
                    this.renderer.setThreshold(threshold);
                }
                document.getElementById('threshold-value').textContent = threshold + '%';
            });
        }
    }

    setupTwitchAuth() {
        if (typeof Twitch !== 'undefined' && Twitch.ext) {
            Twitch.ext.onAuthorized((auth) => {
                this.authToken = auth.token;
                this.channelId = auth.channelId;
                console.log('✅ Config panel authorized for channel:', this.channelId);
            });
        }
    }

    async startSession() {
        try {
            this.setButtonState('start-btn', true); // Disable button

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
                this.updateStatus(true);
                this.showNotification('✅ Session started successfully!', 'success');
                console.log('🚀 ClickMap session started');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to start session:', error);
            this.showError('Failed to start session. Please try again.');
        } finally {
            this.setButtonState('start-btn', false); // Re-enable button
        }
    }

    async stopSession() {
        try {
            this.setButtonState('stop-btn', true);

            const response = await fetch(`${EBS}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                }
            });

            if (response.ok) {
                this.updateStatus(false);
                this.sessionStart = null;
                this.showNotification('⏹️ Session stopped', 'info');
                console.log('⏸️ ClickMap session stopped');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to stop session:', error);
            this.showError('Failed to stop session. Please try again.');
        } finally {
            this.setButtonState('stop-btn', false);
        }
    }

    async resetSession() {
        const confirmed = confirm('⚠️ Are you sure you want to clear all click data?\n\nThis action cannot be undone.');
        if (!confirmed) return;

        try {
            this.setButtonState('reset-btn', true);

            const response = await fetch(`${EBS}/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                }
            });

            if (response.ok) {
                this.showNotification('🗑️ All data cleared', 'info');
                console.log('🧹 ClickMap data reset');

                // Clear the preview canvas
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                }
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to reset data:', error);
            this.showError('Failed to reset data. Please try again.');
        } finally {
            this.setButtonState('reset-btn', false);
        }
    }

    setButtonState(buttonId, disabled) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = disabled;
        }
    }

    startPolling() {
        // Poll every second for real-time updates
        this.pollInterval = setInterval(() => this.pollData(), 1000);
        this.pollData(); // Initial poll
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

        // Update preview canvas
        if (this.renderer) {
            this.renderer.updateClusters(data.clusters || []);
        }

        // Update preview status
        const previewStatus = document.getElementById('preview-status');
        if (previewStatus) {
            previewStatus.textContent = data.running ? 'LIVE' : 'STOPPED';
            previewStatus.className = 'preview-overlay ' + (data.running ? 'live' : 'stopped');
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

        // Top hotspot information
        const topCluster = data.clusters?.[0];
        if (topCluster) {
            const topHotspotText = `${topCluster.percentage}% (${topCluster.count} users)`;
            this.updateElement('top-hotspot', topHotspotText);
        } else {
            this.updateElement('top-hotspot', 'None');
        }

        // Threshold information
        this.updateElement('threshold-info', `${data.threshold || 3}%`);
    }

    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    updateStatus(isRunning) {
        const statusEl = document.getElementById('status');
        const statusText = document.getElementById('status-text');

        if (statusEl && statusText) {
            if (isRunning) {
                statusEl.className = 'status-indicator running';
                statusText.textContent = '🟢 Session Active';
            } else {
                statusEl.className = 'status-indicator stopped';
                statusText.textContent = '🔴 Session Stopped';
            }
        }

        // Update button states
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (startBtn && stopBtn) {
            if (isRunning) {
                startBtn.textContent = '▶️ Session Running';
                startBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                startBtn.textContent = '▶️ Start Session';
                startBtn.disabled = false;
                stopBtn.disabled = false;
            }
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.textContent = message;
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

        // Create temporary notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 16px;
            border-radius: 6px;
            color: white;
            font-size: 12px;
            font-weight: 600;
            z-index: 10000;
            opacity: 0;
            transform: translateX(20px);
            transition: all 0.3s ease;
        `;

        // Set color based on type
        switch (type) {
            case 'success':
                notification.style.background = 'rgba(34, 197, 94, 0.9)';
                break;
            case 'error':
                notification.style.background = 'rgba(239, 68, 68, 0.9)';
                break;
            default:
                notification.style.background = 'rgba(59, 130, 246, 0.9)';
        }

        document.body.appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateX(0)';
        });

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(20px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
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