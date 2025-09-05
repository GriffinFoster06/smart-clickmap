// frontend/script.js - WebSocket-free extension with smart HTTP polling
import { HeatmapRenderer } from './heatmap.js';

class TwitchClickMapExtension {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.renderer = null;
        this.pollInterval = null;
        this.isVisible = true;
        this.lastDataHash = '';
        this.consecutiveErrors = 0;
        this.maxRetries = 5;
        this.pollRate = 1000; // Base polling rate
        this.activePollRate = 500; // Fast polling when active
        this.idlePollRate = 2000; // Slower when idle

        // Connection status
        this.connectionStatus = 'connecting';
        this.lastSuccessfulPoll = 0;
        this.lastClickTime = 0;

        this.EBS = 'https://smart-clickmap-backend.onrender.com';

        // Debug logging
        this.debug = true;

        this.log('🎯 Twitch ClickMap Extension v3.2.0 (HTTP-Only Mode)');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[CLICKMAP] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[CLICKMAP ERROR] ${message}`, err || '');
    }

    async init() {
        try {
            this.log('Setting up canvas...');
            this.setupCanvas();

            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.log('Setting up Twitch extension...');
            this.setupTwitchExtension();

            this.log('Setting up visibility optimization...');
            this.setupVisibilityOptimization();

            this.log('Testing backend connection...');
            await this.testConnection();

            this.log('✅ Extension ready! (HTTP-only mode for Twitch compatibility)');
            this.showConnectionStatus('connected');

        } catch (error) {
            this.error('Failed to initialize extension', error);
            this.showConnectionStatus('error');
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
            this.log(`✅ Backend connection OK - Version: ${data.version}`);
            this.connectionStatus = 'connected';
            return data;

        } catch (error) {
            this.error('Backend connection failed', error);
            this.connectionStatus = 'error';
            throw error;
        }
    }

    setupCanvas() {
        const canvas = document.getElementById('heat');
        if (!canvas) {
            this.error('Heat canvas not found!');
            return;
        }

        this.renderer = new HeatmapRenderer(canvas);
        this.resizeCanvas();

        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        });

        this.log('✅ Canvas setup complete');
    }

    resizeCanvas() {
        if (this.renderer) {
            this.renderer.resize();
        }
    }

    setupEventListeners() {
        let clickTimeout = null;
        let clickCount = 0;

        // Click handler with debouncing and validation
        const handleClick = (event) => {
            if (!this.running || !this.authToken || !this.channelId) {
                this.log('Click ignored - extension not ready');
                return;
            }

            // Prevent spam clicking
            clearTimeout(clickTimeout);
            clickCount++;

            clickTimeout = setTimeout(() => {
                this.processClick(event);
                clickCount = 0;
            }, 50);
        };

        // Mouse clicks
        document.addEventListener('click', handleClick);

        // Touch support for mobile
        document.addEventListener('touchstart', (event) => {
            if (event.touches.length === 1) {
                event.preventDefault();
                const touch = event.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                };
                handleClick(syntheticEvent);
            }
        }, { passive: false });

        this.log('✅ Event listeners setup complete');
    }

    processClick(event) {
        try {
            const rect = document.body.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

            this.log(`Processing click at (${x.toFixed(3)}, ${y.toFixed(3)})`);

            // Record click time for smart polling
            this.lastClickTime = Date.now();

            // Visual feedback
            this.showClickFeedback(event.clientX, event.clientY);

            // Send to backend
            this.sendClick(x, y);

            // Speed up polling temporarily after a click
            this.adjustPollingRate();

        } catch (error) {
            this.error('Failed to process click', error);
        }
    }

    showClickFeedback(clientX, clientY) {
        const feedback = document.createElement('div');
        feedback.className = 'click-feedback';
        feedback.style.cssText = `
            position: fixed;
            left: ${clientX}px;
            top: ${clientY}px;
            width: 24px;
            height: 24px;
            border: 3px solid rgba(147, 51, 234, 0.9);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            margin: -12px 0 0 -12px;
            animation: clickPulse 0.6s ease-out forwards;
            background: rgba(147, 51, 234, 0.2);
            box-shadow: 0 0 20px rgba(147, 51, 234, 0.5);
        `;

        // Add animation if not exists
        if (!document.getElementById('click-animation-style')) {
            const style = document.createElement('style');
            style.id = 'click-animation-style';
            style.textContent = `
                @keyframes clickPulse {
                    0% { 
                        transform: scale(0); 
                        opacity: 1; 
                        border-color: rgba(147, 51, 234, 1);
                        box-shadow: 0 0 20px rgba(147, 51, 234, 0.8);
                    }
                    50% { 
                        border-color: rgba(0, 255, 255, 0.8);
                        box-shadow: 0 0 30px rgba(0, 255, 255, 0.6);
                    }
                    100% { 
                        transform: scale(4); 
                        opacity: 0; 
                        border-color: rgba(147, 51, 234, 0);
                        box-shadow: 0 0 40px rgba(147, 51, 234, 0);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(feedback);

        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 600);
    }

    async sendClick(x, y) {
        try {
            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`,
                    'Cache-Control': 'no-cache'
                },
                body: JSON.stringify({ x, y })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data.success) {
                this.log(`✅ Click sent successfully - Total: ${data.totalClicks}`);

                // Immediate data refresh after click
                setTimeout(() => this.pollHeatmapData(), 100);
            } else {
                throw new Error(data.error || 'Click failed');
            }

        } catch (error) {
            this.error('Failed to send click', error);
            this.showConnectionStatus('error');
        }
    }

    setupTwitchExtension() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            this.error('Twitch Extension Helper not available');
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            this.log(`✅ Twitch auth: Channel ${this.channelId}`);

            // Start HTTP polling immediately
            this.startSmartPolling();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.startSmartPolling();
                this.showConnectionStatus(this.connectionStatus);
            } else {
                this.stopPolling();
                this.hideConnectionStatus();
            }
        });

        this.log('✅ Twitch extension setup complete');
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else if (this.isVisible) {
                this.startSmartPolling();
            }
        });

        this.log('✅ Visibility optimization setup complete');
    }

    adjustPollingRate() {
        if (!this.pollInterval) return;

        const timeSinceClick = Date.now() - this.lastClickTime;

        let newRate;
        if (timeSinceClick < 5000) {
            // Very fast polling for 5 seconds after click
            newRate = this.activePollRate;
        } else if (timeSinceClick < 30000) {
            // Medium polling for 30 seconds after click
            newRate = this.pollRate;
        } else {
            // Slower polling when idle
            newRate = this.idlePollRate;
        }

        if (newRate !== this.currentPollRate) {
            this.currentPollRate = newRate;
            this.stopPolling();
            this.startSmartPolling();
        }
    }

    startSmartPolling() {
        if (this.pollInterval || !this.channelId) return;

        // Determine initial poll rate
        const timeSinceClick = Date.now() - this.lastClickTime;
        if (timeSinceClick < 5000) {
            this.currentPollRate = this.activePollRate;
        } else {
            this.currentPollRate = this.pollRate;
        }

        this.pollInterval = setInterval(() => {
            this.pollHeatmapData();
            this.adjustPollingRate(); // Dynamically adjust rate
        }, this.currentPollRate);

        this.pollHeatmapData(); // Initial poll

        this.log(`✅ Smart polling started (${this.currentPollRate}ms interval)`);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            this.log('⏸️ Polling stopped');
        }
    }

    async pollHeatmapData() {
        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}&t=${Date.now()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Track successful polls
            this.lastSuccessfulPoll = Date.now();
            this.consecutiveErrors = 0;

            if (this.connectionStatus !== 'connected') {
                this.connectionStatus = 'connected';
                this.showConnectionStatus('connected');
            }

            this.updateVisualization(data);

        } catch (error) {
            this.consecutiveErrors++;

            if (this.consecutiveErrors >= 3) {
                this.connectionStatus = 'error';
                this.showConnectionStatus('error');
            }

            if (this.consecutiveErrors <= 3) {
                this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);
            }
        }
    }

    updateVisualization(data) {
        try {
            this.running = data.running;

            if (this.renderer) {
                this.renderer.updateClusters(data.clusters || []);
            }

            // Update body classes for CSS styling
            document.body.classList.toggle('clickmap-active', this.running);
            document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

            // Update status indicator
            this.updateStatusIndicator(data);

            // Debug info
            if ((data.clusters || []).length > 0) {
                this.log(`Updated: ${data.clusters.length} clusters, ${data.totalClicks} total clicks`);
            }

        } catch (error) {
            this.error('Failed to update visualization', error);
        }
    }

    // UI Status Methods
    showConnectionStatus(status) {
        let existingStatus = document.getElementById('connection-status');
        if (!existingStatus) {
            existingStatus = document.createElement('div');
            existingStatus.id = 'connection-status';
            existingStatus.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                z-index: 1002;
                transition: all 0.3s ease;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;
            document.body.appendChild(existingStatus);
        }

        let bgColor, textColor, text;
        switch (status) {
            case 'connected':
                bgColor = 'rgba(34, 197, 94, 0.15)';
                textColor = '#22c55e';
                text = '🟢 Connected';
                break;
            case 'error':
                bgColor = 'rgba(239, 68, 68, 0.15)';
                textColor = '#ef4444';
                text = '🔴 Connection Error';
                break;
            default:
                bgColor = 'rgba(107, 114, 128, 0.15)';
                textColor = '#9ca3af';
                text = '🟡 Connecting...';
        }

        existingStatus.style.background = bgColor;
        existingStatus.style.color = textColor;
        existingStatus.style.border = `1px solid ${textColor}40`;
        existingStatus.textContent = text;
        existingStatus.style.opacity = '1';

        // Auto-hide success status after 3 seconds
        if (status === 'connected') {
            setTimeout(() => {
                if (existingStatus.textContent === text) {
                    existingStatus.style.opacity = '0';
                }
            }, 3000);
        }
    }

    hideConnectionStatus() {
        const status = document.getElementById('connection-status');
        if (status) {
            status.style.opacity = '0';
        }
    }

    updateStatusIndicator(data) {
        // Update any status indicators with current data
        const totalClicks = data.totalClicks || 0;
        const clusterCount = (data.clusters || []).length;

        // Add to page title for debugging
        if (this.debug && totalClicks > 0) {
            document.title = `ClickMap (${totalClicks} clicks, ${clusterCount} clusters)`;
        }
    }

    destroy() {
        this.stopPolling();

        if (this.renderer) {
            this.renderer.destroy();
        }

        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.hideConnectionStatus();

        this.log('🧹 Extension destroyed');
    }
}

// Initialize extension with error handling
function initializeExtension() {
    try {
        window.clickMapExtension = new TwitchClickMapExtension();
    } catch (error) {
        console.error('❌ Failed to initialize ClickMap extension:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// Global reference for debugging
window.TwitchClickMapExtension = TwitchClickMapExtension;