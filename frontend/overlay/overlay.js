// frontend/overlay/overlay.js - Clean circular overlays matching the reference image
const EBS = 'https://smart-clickmap-backend.onrender.com';

class CleanHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3;

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

        // Render clean circular overlays
        this.clusters.forEach((cluster) => {
            this.renderCleanCircle(cluster, W, H);
        });
    }

    renderCleanCircle(cluster, W, H) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;

        // Precise sizing to maintain distinct targets
        let baseRadius;
        if (cluster.count === 1) {
            // Single clicks get small, consistent size
            baseRadius = 30;
        } else if (cluster.count <= 3) {
            // Small groups stay compact  
            baseRadius = Math.max(34, 37 + (percentage * 0.8));
        } else {
            // Larger groups but capped to prevent merging visually
            baseRadius = Math.max(37, Math.min(70, 40 + (percentage * 1.0)));
        }

        // Factor in cluster confidence for precise targets
        if (cluster.confidence) {
            baseRadius *= (0.9 + (cluster.confidence * 0.2));
        }

        this.ctx.save();

        // Clean dark circular background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Clean white border - adaptive width
        const borderWidth = baseRadius < 37 ? 2 : 2.5;
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.lineWidth = borderWidth;
        this.ctx.stroke();

        // Subtle inner highlight for larger targets
        if (baseRadius > 32) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, baseRadius - 4, 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        // Adaptive text sizing
        const fontSize = Math.max(16, Math.min(26, baseRadius * 0.5));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text shadow for contrast
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillText(`${percentage}%`, cx + 1, cy + 1);

        // Main white text
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        this.ctx.restore();
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
        this.render();
    }
}

class InstantOverlay {
    constructor() {
        this.channelId = this.getChannelFromUrl();
        this.renderer = null;
        this.websocket = null;
        this.pollInterval = null;
        this.consecutiveErrors = 0;

        this.init();
    }

    init() {
        if (!this.channelId) {
            console.error('Missing channel parameter');
            return;
        }

        this.setupRenderer();
        this.connectWebSocket();
        this.startPolling();

        console.log(`🎯 Clean ClickMap overlay connected to: ${this.channelId}`);
    }

    getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel') || params.get('c');
    }

    setupRenderer() {
        const canvas = document.getElementById('overlay-canvas');
        if (!canvas) return;

        this.renderer = new CleanHeatmapRenderer(canvas);

        // Custom threshold from URL
        const threshold = new URLSearchParams(window.location.search).get('threshold');
        if (threshold) {
            this.renderer.setThreshold(parseInt(threshold));
        }
    }

    connectWebSocket() {
        try {
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            this.websocket = new WebSocket(`${wsUrl}/ws/${this.channelId}`);

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    console.warn('WebSocket parse error:', e);
                }
            };

            this.websocket.onerror = () => {
                this.websocket = null;
            };

            this.websocket.onclose = () => {
                this.websocket = null;
                setTimeout(() => this.connectWebSocket(), 5000);
            };

        } catch (e) {
            console.log('WebSocket not available, using polling');
        }
    }

    startPolling() {
        this.pollInterval = setInterval(() => this.poll(), 800);
        this.poll();
    }

    async poll() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const response = await fetch(
                `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.updateVisualization(data);
            this.consecutiveErrors = 0;

        } catch (error) {
            this.consecutiveErrors++;
            if (this.consecutiveErrors <= 3) {
                console.warn(`Connection issue ${this.consecutiveErrors}/3`);
            }
        }
    }

    updateVisualization(data) {
        if (this.renderer) {
            this.renderer.updateClusters(data.clusters || []);
        }
    }
}

// Initialize
try {
    new InstantOverlay();
    console.log('🎯 Clean circular overlay loaded');
} catch (error) {
    console.error('Failed to initialize overlay:', error);
}