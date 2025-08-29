// frontend/overlay/overlay.js - Standalone OBS overlay with HUD-style visualization
const EBS = 'https://smart-clickmap-backend.onrender.com';

class ObsHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3; // Only show clusters above 3%

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);
    }

    updateClusters(newClusters) {
        // Filter and sort clusters - only show above threshold
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage);

        this.render();
    }

    render() {
        const W = window.innerWidth;
        const H = window.innerHeight;

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render from lowest to highest percentage (highest on top)
        const reversedClusters = [...this.clusters].reverse();

        reversedClusters.forEach((cluster, index) => {
            const isTop = index === reversedClusters.length - 1;
            this.renderHudCluster(cluster, W, H, isTop);
        });
    }

    renderHudCluster(cluster, W, H, isTop) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;

        // Dynamic radius based on percentage
        const baseRadius = Math.max(25, Math.min(80, 30 + Math.sqrt(percentage) * 4));

        this.ctx.save();

        // Main semi-transparent circle - purple or cyan
        const fillColor = isTop
            ? `rgba(0, 255, 255, 0.35)` // Cyan for top cluster
            : `rgba(147, 51, 234, 0.3)`; // Purple for others

        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Border for definition
        const borderColor = isTop
            ? `rgba(0, 255, 255, 0.6)`
            : `rgba(147, 51, 234, 0.5)`;

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Inner glow for HUD effect
        const innerGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.6);
        innerGradient.addColorStop(0, isTop ? 'rgba(0, 255, 255, 0.15)' : 'rgba(147, 51, 234, 0.15)');
        innerGradient.addColorStop(1, 'transparent');

        this.ctx.fillStyle = innerGradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius * 0.6, 0, 2 * Math.PI);
        this.ctx.fill();

        // Bold percentage text
        const fontSize = Math.max(14, Math.min(22, baseRadius * 0.5));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text shadow for readability
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillText(`${percentage}%`, cx + 1, cy + 1);

        // Main text - white or light color
        this.ctx.fillStyle = isTop ? '#ffffff' : '#e0e7ff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        this.ctx.restore();
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
        this.render();
    }
}

class ObsOverlay {
    constructor() {
        this.channelId = this.getChannelFromUrl();
        this.renderer = null;
        this.pollInterval = null;
        this.consecutiveErrors = 0;
        this.maxErrors = 5;

        this.init();
    }

    init() {
        if (!this.channelId) {
            this.showError('Missing channel parameter in URL. Add ?channel=CHANNEL_NAME');
            return;
        }

        this.setupRenderer();
        this.startPolling();
        this.hideLoading();

        console.log(`🎯 OBS Overlay connected to channel: ${this.channelId}`);
    }

    getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel') || params.get('c');
    }

    setupRenderer() {
        const canvas = document.getElementById('overlay-canvas');
        this.renderer = new ObsHeatmapRenderer(canvas);

        // Allow threshold adjustment via URL parameter
        const threshold = new URLSearchParams(window.location.search).get('threshold');
        if (threshold) {
            this.renderer.setThreshold(parseInt(threshold));
            console.log(`📊 Custom threshold set: ${threshold}%`);
        }
    }

    startPolling() {
        this.pollInterval = setInterval(() => this.poll(), 1000);
        this.poll(); // Initial poll
    }

    async poll() {
        try {
            const response = await fetch(
                `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateOverlay(data);
            this.consecutiveErrors = 0;
            this.hideError();

        } catch (error) {
            this.consecutiveErrors++;
            console.error('🔴 Polling error:', error);

            if (this.consecutiveErrors >= this.maxErrors) {
                this.showError(`Connection lost after ${this.maxErrors} attempts. Server may be down.`);
            }
        }
    }

    updateOverlay(data) {
        // Update renderer with filtered clusters
        if (this.renderer) {
            this.renderer.updateClusters(data.clusters || []);
        }

        // Update stats display
        this.updateStats(data);
    }

    updateStats(data) {
        const userCount = document.getElementById('user-count');
        const clickCount = document.getElementById('click-count');
        const hotspotCount = document.getElementById('hotspot-count');
        const statsEl = document.getElementById('stats');

        if (userCount) userCount.textContent = data.uniqueUsers || 0;
        if (clickCount) clickCount.textContent = data.totalClicks || 0;
        if (hotspotCount) hotspotCount.textContent = (data.clusters || []).filter(c => c.percentage >= 3).length;

        // Show/hide stats based on activity
        if (statsEl) {
            statsEl.style.display = data.totalClicks > 0 ? 'block' : 'none';
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.querySelector('p:last-child').textContent = message;
            errorEl.style.display = 'block';
        }
        this.hideLoading();
        console.error('🔴 Error:', message);
    }

    hideError() {
        const errorEl = document.getElementById('error');
        if (errorEl) errorEl.style.display = 'none';
    }

    hideLoading() {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// Initialize overlay
new ObsOverlay();

console.log('🎯 Smart ClickMap OBS Overlay v2.0.0 loaded');
console.log('📖 Usage: Add ?channel=CHANNEL_NAME&threshold=5 to customize');