// frontend/script.js - Main Twitch extension script with HUD-style visualization
import { HeatmapRenderer } from './heatmap.js';

class ClickMapExtension {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.renderer = null;
        this.pollInterval = null;
        this.isVisible = true;
        this.lastDataHash = '';

        // Statistics for debug mode
        this.stats = {
            clicks: 0,
            polls: 0,
            renders: 0,
            lastPollTime: '-',
            status: 'initializing'
        };

        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.POLL_RATE = 1000; // 1 second polling

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupTwitchExtension();
        this.setupVisibilityOptimization();
        this.setupUI();

        console.log('🎯 Smart ClickMap Extension v2.0.0 initialized');
        this.stats.status = 'initialized';
        this.updateDebugStats();
    }

    setupCanvas() {
        const canvas = document.getElementById('heat');
        if (!canvas) {
            console.error('❌ Heat canvas not found');
            this.showError('Canvas element not found');
            return;
        }

        this.renderer = new HeatmapRenderer(canvas);
        this.resizeCanvas();

        // Handle window resize
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        });
    }

    resizeCanvas() {
        if (!this.renderer) return;
        this.renderer.resize();
    }

    setupEventListeners() {
        let clickTimeout = null;

        // Main click handler
        document.addEventListener('click', (event) => {
            if (!this.running || !this.authToken) return;

            // Track interaction for analytics
            if (window.analytics) {
                window.analytics.trackInteraction();
            }

            // Debounce rapid clicks
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }

            clickTimeout = setTimeout(() => {
                this.handleClick(event);
            }, 50);
        });

        // Touch support for mobile
        document.addEventListener('touchstart', (event) => {
            if (!this.running || !this.authToken || event.touches.length > 1) return;

            event.preventDefault();
            const touch = event.touches[0];
            const syntheticEvent = {
                clientX: touch.clientX,
                clientY: touch.clientY
            };

            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }

            clickTimeout = setTimeout(() => {
                this.handleClick(syntheticEvent);
            }, 50);
        }, { passive: false });
    }

    setupUI() {
        // Show loading initially
        this.showLoading(true);
        this.updateStatusBadge('Connecting...', 'inactive');
    }

    handleClick(event) {
        const rect = document.body.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

        // Visual feedback for the click
        this.showClickFeedback(event.clientX, event.clientY);

        // Send click to backend
        this.sendClick(x, y);

        // Update stats
        this.stats.clicks++;
        this.updateDebugStats();
    }

    showClickFeedback(clientX, clientY) {
        // Create temporary visual feedback element
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
        `;

        document.body.appendChild(feedback);

        // Remove after animation
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 600);

        // Announce click for screen readers
        this.announceToScreenReader('Click registered');
    }

    async sendClick(x, y) {
        try {
            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ x, y })
            });

            if (!response.ok) {
                console.warn('⚠️ Click submission failed:', response.status);
            }
        } catch (error) {
            console.error('❌ Click submission error:', error);
            if (window.analytics) {
                window.analytics.trackError();
            }
        }
    }

    setupTwitchExtension() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            console.error('❌ Twitch Extension Helper not loaded');
            this.showError('Twitch Extension Helper not available');
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            console.log('✅ Extension authorized for channel:', this.channelId);
            this.stats.status = 'authorized';
            this.updateDebugStats();
            this.startPolling();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            if (isVisible) {
                this.startPolling();
                this.updateStatusBadge('Reconnecting...', 'inactive');
            } else {
                this.stopPolling();
            }
        });

        Twitch.ext.onContext((context, changed) => {
            // Handle context changes if needed
            if (changed.includes('theme')) {
                this.handleThemeChange(context.theme);
            }
        });
    }

    handleThemeChange(theme) {
        // Adjust colors based on Twitch theme
        document.body.classList.toggle('twitch-light', theme === 'light');
        document.body.classList.toggle('twitch-dark', theme === 'dark');
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else if (this.isVisible) {
                this.startPolling();
            }
        });

        // Intersection observer for off-screen detection
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry.intersectionRatio === 0) {
                    this.stopPolling();
                } else if (this.isVisible) {
                    this.startPolling();
                }
            }, { threshold: 0 });

            observer.observe(document.body);
        }
    }

    startPolling() {
        if (this.pollInterval) return;

        this.showLoading(false);
        this.stats.status = 'polling';

        this.pollInterval = setInterval(() => {
            this.pollHeatmapData();
        }, this.POLL_RATE);

        // Initial poll
        this.pollHeatmapData();
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            this.stats.status = 'stopped';
            this.updateDebugStats();
        }
    }

    async pollHeatmapData() {
        const pollStart = performance.now();

        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const dataHash = this.hashData(data);

            // Only update if data has changed
            if (dataHash !== this.lastDataHash) {
                this.lastDataHash = dataHash;
                this.updateVisualization(data);
            }

            // Update stats
            this.stats.polls++;
            this.stats.lastPollTime = `${(performance.now() - pollStart).toFixed(1)}ms`;
            this.stats.status = this.running ? 'active' : 'inactive';

            // Update UI
            this.updateStatusBadge(
                this.running ? 'Session Active' : 'Session Stopped',
                this.running ? 'active' : 'inactive'
            );
            this.hideError();

        } catch (error) {
            console.error('❌ Heatmap polling error:', error);
            this.showError('Connection lost. Retrying...');
            this.updateStatusBadge('Connection Error', 'inactive');

            if (window.analytics) {
                window.analytics.trackError();
            }
        }

        this.updateDebugStats();
    }

    hashData(data) {
        // Simple hash for change detection
        return JSON.stringify({
            running: data.running,
            clusters: data.clusters?.map(c => ({
                x: Math.round(c.x * 1000),
                y: Math.round(c.y * 1000),
                p: c.percentage
            })) || []
        });
    }

    updateVisualization(data) {
        this.running = data.running;

        if (!this.renderer) return;

        // Update renderer with HUD-style clusters
        this.renderer.updateClusters(data.clusters || []);
        this.stats.renders++;

        // Update body classes for CSS styling
        document.body.classList.toggle('clickmap-active', this.running);
        document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

        // Update debug stats
        this.stats.clusters = (data.clusters || []).filter(c => c.percentage >= 3).length;

        // Announce significant changes to screen readers
        const visibleClusters = (data.clusters || []).filter(c => c.percentage >= 3);
        if (visibleClusters.length > 0 && this.running) {
            const topCluster = visibleClusters[0];
            if (topCluster && topCluster.percentage >= 20) {
                this.announceToScreenReader(`Hot spot detected: ${topCluster.percentage}% of clicks`);
            }
        }
    }

    updateDebugStats() {
        if (window.debugManager) {
            window.debugManager.updateDebugStats({
                ...this.stats,
                channel: this.channelId || 'not connected'
            });
        }
    }

    // UI Helper Methods
    showLoading(show) {
        const loadingEl = document.getElementById('loading-overlay');
        if (loadingEl) {
            loadingEl.classList.toggle('visible', show);
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error-overlay');
        const messageEl = document.getElementById('error-message');

        if (errorEl && messageEl) {
            messageEl.textContent = message;
            errorEl.style.display = 'block';
        }

        console.error('🔴 Extension Error:', message);
    }

    hideError() {
        const errorEl = document.getElementById('error-overlay');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    updateStatusBadge(text, status) {
        const badge = document.getElementById('status-badge');
        const statusText = document.getElementById('status-text');

        if (badge && statusText) {
            statusText.textContent = text;
            badge.className = `status-badge visible ${status}`;
        }
    }

    announceToScreenReader(message) {
        const announcer = document.getElementById('announcements');
        if (announcer) {
            announcer.textContent = message;

            // Clear after announcement
            setTimeout(() => {
                announcer.textContent = '';
            }, 1000);
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

        console.log('🧹 ClickMap Extension destroyed');
    }
}

// Initialize extension when DOM is ready
let extensionInstance = null;

function initializeExtension() {
    if (extensionInstance) {
        extensionInstance.destroy();
    }
    extensionInstance = new ClickMapExtension();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// Global reference for debugging
window.ClickMapExtension = extensionInstance;

export default ClickMapExtension;