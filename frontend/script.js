// frontend/script.js - HTTP-only approach optimized for Twitch extensions
import { HeatmapRenderer } from './heatmap.js';

class TwitchExtensionClickMap {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.renderer = null;
        this.pollInterval = null;
        this.isVisible = true;
        this.lastDataHash = '';
        this.consecutiveErrors = 0;
        this.maxRetries = 3;

        // Optimized settings for HTTP-only approach
        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.POLL_RATE = 1500; // 1.5 seconds - balanced for responsiveness vs server load
        this.FAST_POLL_RATE = 500; // Fast polling when game is active
        this.SLOW_POLL_RATE = 5000; // Slow polling when inactive

        // State management
        this.lastPollTime = 0;
        this.pendingClicks = [];
        this.isPolling = false;

        // Debug logging
        this.debug = true;

        this.log('🎯 ClickMap Extension v3.1.0 (HTTP-only) initializing...');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[EXTENSION] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[EXTENSION ERROR] ${message}`, err || '');
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

            this.log('✅ Extension ready! (HTTP polling mode)');

        } catch (error) {
            this.error('Failed to initialize extension', error);
            this.showError('Failed to connect to ClickMap service');
        }
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
            this.log(`✅ Backend connection OK - Version: ${data.version}`);
            this.hideError();
            return data;

        } catch (error) {
            this.error('Backend connection failed', error);
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

        // Debounced resize handler
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 150);
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
        const CLICK_DEBOUNCE_MS = 100;

        // Optimized click handler with batching
        const handleClick = (event) => {
            if (!this.running || !this.authToken || !this.channelId) {
                this.log('Click ignored - not ready');
                return;
            }

            // Prevent spam clicking
            clearTimeout(clickTimeout);

            clickTimeout = setTimeout(() => {
                this.processClick(event);
            }, CLICK_DEBOUNCE_MS);
        };

        // Mouse clicks
        document.addEventListener('click', handleClick, { passive: true });

        // Touch support with better mobile handling
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

            // Visual feedback
            this.showClickFeedback(event.clientX, event.clientY);

            // Send click immediately (don't batch for better UX)
            this.sendClick(x, y);

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
            width: 20px;
            height: 20px;
            border: 2px solid rgba(147, 51, 234, 0.8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.6s ease-out forwards;
            background: rgba(147, 51, 234, 0.1);
        `;

        document.body.appendChild(feedback);

        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 600);
    }

    async sendClick(x, y) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ x, y }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data.success) {
                this.log(`✅ Click sent successfully`);
                // Trigger fast polling for immediate feedback
                this.triggerFastPoll();
            } else {
                throw new Error(data.error || 'Click failed');
            }

        } catch (error) {
            this.error('Failed to send click', error);
            // Show brief error indicator
            this.showTemporaryError('Click failed');
        }
    }

    setupTwitchExtension() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            this.error('Twitch Extension Helper not available');
            // Continue without Twitch for testing
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            this.log(`✅ Twitch auth: Channel ${this.channelId}`);

            // Start polling immediately after auth
            this.startPolling();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.startPolling();
            } else {
                this.stopPolling();
            }
        });

        // Listen for PubSub messages (if available)
        if (Twitch.ext.listen) {
            Twitch.ext.listen('broadcast', (target, contentType, data) => {
                this.log('PubSub message received:', data);
                try {
                    const parsedData = JSON.parse(data);
                    this.updateVisualization(parsedData);
                } catch (e) {
                    this.error('PubSub parse error', e);
                }
            });
        }

        this.log('✅ Twitch extension setup complete');
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isVisible) {
                this.log('Tab hidden - stopping polling');
                this.stopPolling();
            } else if (!document.hidden && this.isVisible) {
                this.log('Tab visible - starting polling');
                this.startPolling();
            }
        });

        // Page lifecycle events
        window.addEventListener('beforeunload', () => {
            this.stopPolling();
        });

        this.log('✅ Visibility optimization setup complete');
    }

    triggerFastPoll() {
        // Temporarily use fast polling after user interaction
        if (this.fastPollTimeout) {
            clearTimeout(this.fastPollTimeout);
        }

        this.getCurrentPollRate = () => this.FAST_POLL_RATE;

        this.fastPollTimeout = setTimeout(() => {
            this.getCurrentPollRate = () => this.getAdaptivePollRate();
        }, 5000); // Fast poll for 5 seconds
    }

    getAdaptivePollRate() {
        if (!this.running) {
            return this.SLOW_POLL_RATE;
        }
        return this.POLL_RATE;
    }

    getCurrentPollRate() {
        return this.getAdaptivePollRate();
    }

    startPolling() {
        if (this.pollInterval || !this.channelId) return;

        // Initial poll
        this.pollHeatmapData();

        // Set up adaptive polling
        const scheduleNextPoll = () => {
            if (this.pollInterval) {
                const rate = this.getCurrentPollRate();
                this.pollInterval = setTimeout(() => {
                    this.pollHeatmapData().finally(() => {
                        if (this.isVisible && !document.hidden) {
                            scheduleNextPoll();
                        }
                    });
                }, rate);
            }
        };

        this.pollInterval = true; // Mark as active
        scheduleNextPoll();

        this.log(`✅ Polling started (rate: ${this.getCurrentPollRate()}ms)`);
    }

    stopPolling() {
        if (this.pollInterval) {
            if (this.pollInterval !== true) {
                clearTimeout(this.pollInterval);
            }
            this.pollInterval = null;
            this.log('⏸️ Polling stopped');
        }

        if (this.fastPollTimeout) {
            clearTimeout(this.fastPollTimeout);
            this.fastPollTimeout = null;
        }
    }

    async pollHeatmapData() {
        if (this.isPolling) {
            this.log('Poll already in progress, skipping');
            return;
        }

        this.isPolling = true;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            // Add cache-busting and conditional request headers
            const headers = {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            };

            if (this.lastDataHash) {
                headers['If-None-Match'] = this.lastDataHash;
            }

            const response = await fetch(
                `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}&t=${Date.now()}`,
                {
                    method: 'GET',
                    headers,
                    signal: controller.signal
                }
            );

            clearTimeout(timeoutId);

            if (response.status === 304) {
                // No changes
                this.consecutiveErrors = 0;
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Update hash for caching
            const etag = response.headers.get('etag');
            if (etag) {
                this.lastDataHash = etag;
            }

            this.updateVisualization(data);
            this.consecutiveErrors = 0;
            this.hideError();

        } catch (error) {
            this.consecutiveErrors++;

            if (error.name === 'AbortError') {
                this.log('Poll timeout');
            } else {
                this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);
            }

            if (this.consecutiveErrors >= this.maxRetries) {
                this.showError('Connection lost. Retrying...');
                // Exponential backoff
                const backoffDelay = Math.min(10000, 1000 * Math.pow(2, this.consecutiveErrors - this.maxRetries));
                setTimeout(() => {
                    this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 1);
                }, backoffDelay);
            }
        } finally {
            this.isPolling = false;
            this.lastPollTime = Date.now();
        }
    }

    updateVisualization(data) {
        try {
            this.running = data.running;

            if (this.renderer) {
                this.renderer.updateClusters(data.clusters || []);
            }

            // Update body classes for styling
            document.body.classList.toggle('clickmap-active', this.running);
            document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

            // Update status indicator if present
            this.updateStatusIndicator(data);

            // Debug info
            if ((data.clusters || []).length > 0) {
                this.log(`Updated: ${data.clusters.length} clusters, running: ${data.running}`);
            }

        } catch (error) {
            this.error('Failed to update visualization', error);
        }
    }

    updateStatusIndicator(data) {
        const status = document.querySelector('.status-badge');
        if (status) {
            status.textContent = data.running ?
                `Active • ${data.totalClicks || 0} clicks` :
                'Stopped';
            status.className = `status-badge visible ${data.running ? 'active' : 'inactive'}`;
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error-overlay');
        if (errorEl) {
            const messageEl = errorEl.querySelector('#error-message');
            if (messageEl) messageEl.textContent = message;
            errorEl.style.display = 'block';
        }
        this.log(`Error displayed: ${message}`);
    }

    hideError() {
        const errorEl = document.getElementById('error-overlay');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    showTemporaryError(message) {
        // Create temporary error indicator
        const indicator = document.createElement('div');
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(239, 68, 68, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            z-index: 10002;
            pointer-events: none;
            animation: fadeInOut 3s ease-in-out forwards;
        `;
        indicator.textContent = message;

        // Add animation if not exists
        if (!document.getElementById('temp-error-style')) {
            const style = document.createElement('style');
            style.id = 'temp-error-style';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateY(-10px); }
                    20%, 80% { opacity: 1; transform: translateY(0); }
                    100% { opacity: 0; transform: translateY(-10px); }
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

    // Public API for debugging
    getDebugInfo() {
        return {
            running: this.running,
            channelId: this.channelId,
            isVisible: this.isVisible,
            pollRate: this.getCurrentPollRate(),
            consecutiveErrors: this.consecutiveErrors,
            lastPollTime: this.lastPollTime,
            isPolling: this.isPolling
        };
    }

    destroy() {
        this.stopPolling();

        if (this.renderer) {
            this.renderer.destroy();
        }

        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        if (this.fastPollTimeout) {
            clearTimeout(this.fastPollTimeout);
        }

        this.log('🧹 Extension destroyed');
    }
}

// Initialize extension with error handling
function initializeExtension() {
    try {
        window.clickMapExtension = new TwitchExtensionClickMap();
    } catch (error) {
        console.error('❌ Failed to initialize ClickMap extension:', error);
    }
}

// Initialize when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// Global reference for debugging
window.TwitchExtensionClickMap = TwitchExtensionClickMap;
window.TwitchExtensionClickMap = TwitchExtensionClickMap;