// frontend/script.js - Main Twitch extension script with HUD-style visualization (click-through + 16:9 projection)
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

        // 16:9 projection viewport (updated on resize)
        this.targetAspect = 16 / 9;
        this.viewport = { x: 0, y: 0, width: 0, height: 0 };

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

    // ---------- helpers (same math as overlay) ----------
    fitViewport(containerW, containerH, targetAspect) {
        let vw = containerW;
        let vh = Math.round(vw / targetAspect);
        if (vh > containerH) {
            vh = containerH;
            vw = Math.round(vh * targetAspect);
        }
        const vx = Math.floor((containerW - vw) / 2);
        const vy = Math.floor((containerH - vh) / 2);
        return { x: vx, y: vy, width: vw, height: vh };
    }

    // Convert client coords to normalized coords inside the 16:9 viewport
    // Clicks outside the viewport (letterbox) are clamped to the closest edge
    clientToNormalized(clientX, clientY) {
        const vp = this.viewport;
        // Clamp to viewport edges
        const px = Math.max(vp.x, Math.min(vp.x + vp.width, clientX));
        const py = Math.max(vp.y, Math.min(vp.y + vp.height, clientY));
        const nx = (px - vp.x) / (vp.width || 1);
        const ny = (py - vp.y) / (vp.height || 1);
        return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
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

        // Absolutely never capture clicks
        try {
            canvas.style.pointerEvents = 'none';
            // safety for any injected CSS
            const style = document.createElement('style');
            style.textContent = `
                #heat { pointer-events: none !important; }
                .loading-overlay, .error-overlay { pointer-events: none; } /* overlays remain passive */
            `;
            document.head.appendChild(style);
        } catch { /* noop */ }

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
        // Update renderer’s internal size
        this.renderer.resize();

        // Recompute 16:9 viewport for this iframe size
        const cssW = window.innerWidth;
        const cssH = window.innerHeight;
        this.viewport = this.fitViewport(cssW, cssH, this.targetAspect);
    }

    setupEventListeners() {
        let clickTimeout = null;

        // Main click handler (does NOT stop propagation; Twitch player still receives clicks)
        document.addEventListener('click', (event) => {
            // ✅ Do NOT gate on this.running; only require auth
            if (!this.authToken) return;

            // Debounce a tad to bundle double-clicks
            if (clickTimeout) clearTimeout(clickTimeout);
            clickTimeout = setTimeout(() => this.handleClick(event), 40);
        }, { passive: true });

        // Touch support — passive and NO preventDefault, so native gestures/controls work
        document.addEventListener('touchstart', (event) => {
            if (!this.authToken || event.touches.length > 1) return;

            const touch = event.touches[0];
            const syntheticEvent = { clientX: touch.clientX, clientY: touch.clientY };

            if (clickTimeout) clearTimeout(clickTimeout);
            clickTimeout = setTimeout(() => this.handleClick(syntheticEvent), 40);
        }, { passive: true });
    }

    setupUI() {
        if (window.debugManager?.isDebugMode) {
            this.showLoading(true);
            this.updateStatusBadge('Connecting...', 'inactive');
        }
    }

    handleClick(event) {
        // Visual feedback (non-blocking, pointer-events: none)
        this.showClickFeedback(event.clientX, event.clientY);

        // Normalize into 16:9 viewport
        const { x, y } = this.clientToNormalized(event.clientX, event.clientY);

        // Send click to backend
        this.sendClick(x, y);

        // Update stats
        this.stats.clicks++;
        this.updateDebugStats();
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
            z-index: 2147483647;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.6s ease-out forwards;
        `;
        document.body.appendChild(feedback);
        setTimeout(() => feedback.remove(), 650);
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
                body: JSON.stringify({ x, y }) // x,y are normalized to 16:9 viewport
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.warn('⚠️ Click submission failed:', response.status, text);
            } else {
                console.debug('✅ click sent', { x: +x.toFixed(3), y: +y.toFixed(3) });
            }
        } catch (error) {
            console.error('❌ Click submission error:', error);
            if (window.analytics) window.analytics.trackError?.();
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

            // Optional: tell backend to consider session "running"
            fetch(`${this.EBS}/start`, { method: 'POST' }).catch(() => { });

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
            if (changed.includes('theme')) this.handleThemeChange(context.theme);
        });
    }

    handleThemeChange(theme) {
        document.body.classList.toggle('twitch-light', theme === 'light');
        document.body.classList.toggle('twitch-dark', theme === 'dark');
    }

    setupVisibilityOptimization() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.stopPolling();
            else if (this.isVisible) this.startPolling();
        });

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry.intersectionRatio === 0) this.stopPolling();
                else if (this.isVisible) this.startPolling();
            }, { threshold: 0 });
            observer.observe(document.body);
        }
    }

    startPolling() {
        if (this.pollInterval) return;

        if (window.debugManager?.isDebugMode) this.showLoading(false);
        this.stats.status = 'polling';

        this.pollInterval = setInterval(() => this.pollHeatmapData(), this.POLL_RATE);
        this.pollHeatmapData(); // initial
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
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const dataHash = this.hashData(data);

            if (dataHash !== this.lastDataHash) {
                this.lastDataHash = dataHash;
                this.updateVisualization(data);
            }

            this.stats.polls++;
            this.stats.lastPollTime = `${(performance.now() - pollStart).toFixed(1)}ms`;
            this.stats.status = this.running ? 'active' : 'inactive';

            if (window.debugManager?.isDebugMode) {
                this.updateStatusBadge(this.running ? 'Session Active' : 'Session Stopped',
                    this.running ? 'active' : 'inactive');
            }
            this.hideError();

        } catch (error) {
            console.error('❌ Heatmap polling error:', error);
            this.showError('Connection lost. Retrying...');
            if (window.debugManager?.isDebugMode) this.updateStatusBadge('Connection Error', 'inactive');
            if (window.analytics) window.analytics.trackError?.();
        }

        this.updateDebugStats();
    }

    hashData(data) {
        return JSON.stringify({
            running: data.running,
            clusters: data.clusters?.map(c => ({
                x: Math.round((c.x || 0) * 1000),
                y: Math.round((c.y || 0) * 1000),
                p: c.percentage
            })) || []
        });
    }

    updateVisualization(data) {
        this.running = !!data.running;
        if (!this.renderer) return;

        // If your backend returns absolute pixel coords, convert to normalized before passing along:
        // Here we assume server already sends normalized coords [0..1] relative to the same 16:9 projection.
        this.renderer.updateClusters(data.clusters || []);
        this.stats.renders++;

        document.body.classList.toggle('clickmap-active', this.running);
        document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

        this.stats.clusters = (data.clusters || []).filter(c => (c.percentage || 0) >= 3).length;

        const visibleClusters = (data.clusters || []).filter(c => (c.percentage || 0) >= 3);
        if (visibleClusters.length > 0 && this.running) {
            const top = visibleClusters[0];
            if (top && (top.percentage || 0) >= 20) {
                this.announceToScreenReader(`Hot spot detected: ${top.percentage}% of clicks`);
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
        const el = document.getElementById('loading-overlay');
        if (el) el.classList.toggle('visible', !!show);
    }

    showError(message) {
        const errorEl = document.getElementById('error-overlay');
        const messageEl = document.getElementById('error-message');
        if (errorEl) {
            if (messageEl) messageEl.textContent = message;
            errorEl.style.display = 'block';
        }
        console.error('🔴 Extension Error:', message);
    }

    hideError() {
        const errorEl = document.getElementById('error-overlay');
        if (errorEl) errorEl.style.display = 'none';
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
            setTimeout(() => { announcer.textContent = ''; }, 1000);
        }
    }

    destroy() {
        this.stopPolling();
        if (this.renderer) this.renderer.destroy();
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
        console.log('🧹 ClickMap Extension destroyed');
    }
}

// Initialize extension when DOM is ready
let extensionInstance = null;

function initializeExtension() {
    if (extensionInstance) extensionInstance.destroy();
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
