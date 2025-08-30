// frontend/overlay/overlay.js - Bulletproof OBS overlay
const EBS = 'https://smart-clickmap-backend.onrender.com';

class BulletproofHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3;

        this.resize();
        window.addEventListener('resize', () => this.resize());

        console.log('🎨 Heatmap renderer initialized');
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);

        console.log(`🔄 Canvas resized: ${window.innerWidth}x${window.innerHeight} (DPR: ${dpr})`);
    }

    updateClusters(newClusters) {
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage);

        this.render();

        console.log(`📊 Updated clusters: ${this.clusters.length} visible`);
    }

    render() {
        const W = window.innerWidth;
        const H = window.innerHeight;

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        this.clusters.forEach((cluster) => {
            this.renderCleanCircle(cluster, W, H);
        });
    }

    renderCleanCircle(cluster, W, H) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;

        // Size based on percentage - exactly like the reference image
        const baseRadius = Math.max(35, Math.min(75, 40 + (percentage * 1.2)));

        this.ctx.save();

        // Clean dark circular background - semi-transparent
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Clean white border - like the reference
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();

        // Subtle inner highlight for professional look
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, baseRadius - 4, 0, 2 * Math.PI);
        this.ctx.stroke();

        // Clean bold percentage text
        const fontSize = Math.max(18, Math.min(28, baseRadius * 0.55));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text shadow for better contrast
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
        console.log(`🎯 Threshold updated: ${threshold}%`);
    }
}

class BulletproofObsOverlay {
    constructor() {
        this.channelId = this.getChannelFromUrl();
        this.renderer = null;
        this.websocket = null;
        this.pollInterval = null;
        this.consecutiveErrors = 0;
        this.maxRetries = 5;

        console.log('🎯 Bulletproof OBS Overlay v3.0.0 initializing...');
        this.init();
    }

    async init() {
        try {
            if (!this.channelId) {
                throw new Error('Missing channel parameter in URL. Add ?channel=CHANNEL_NAME');
            }

            console.log(`🔗 Connecting to channel: ${this.channelId}`);

            await this.testConnection();
            this.setupRenderer();
            this.connectWebSocket();
            this.startPolling();

            console.log('✅ OBS Overlay ready!');

        } catch (error) {
            console.error('❌ OBS Overlay initialization failed:', error);
            this.showError(error.message);
        }
    }

    async testConnection() {
        try {
            const response = await fetch(`${EBS}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Backend health check failed: ${response.status}`);
            }

            const data = await response.json();
            console.log(`✅ Backend connection OK - Version: ${data.version}, Running: ${data.running}`);
            return data;

        } catch (error) {
            console.error('❌ Backend connection failed:', error);
            throw new Error('Cannot connect to ClickMap server. Check backend status.');
        }
    }

    getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel') || params.get('c');
    }

    setupRenderer() {
        const canvas = document.getElementById('overlay-canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        this.renderer = new BulletproofHeatmapRenderer(canvas);

        // Custom threshold from URL
        const threshold = new URLSearchParams(window.location.search).get('threshold');
        if (threshold) {
            this.renderer.setThreshold(parseInt(threshold));
            console.log(`🎯 Custom threshold: ${threshold}%`);
        }
    }

    connectWebSocket() {
        if (this.websocket) return;

        try {
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            this.websocket = new WebSocket(`${wsUrl}/ws/${this.channelId}`);

            this.websocket.onopen = () => {
                console.log('📡 WebSocket connected');
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    console.error('❌ WebSocket parse error:', e);
                }
            };

            this.websocket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.websocket = null;
            };

            this.websocket.onclose = () => {
                console.log('📡 WebSocket disconnected');
                this.websocket = null;

                // Retry connection
                setTimeout(() => this.connectWebSocket(), 5000);
            };

        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
        }
    }

    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => this.poll(), 800);
        this.poll(); // Initial poll

        console.log('⏰ Polling started');
    }

    async poll() {
        // Skip if WebSocket is active
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const response = await fetch(
                `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateVisualization(data);
            this.consecutiveErrors = 0;

        } catch (error) {
            this.consecutiveErrors++;
            console.error(`❌ Polling error (${this.consecutiveErrors}/${this.maxRetries}):`, error);

            if (this.consecutiveErrors >= this.maxRetries) {
                this.showError(`Connection lost after ${this.maxRetries} attempts. Server may be down.`);
            }
        }
    }

    updateVisualization(data) {
        if (this.renderer) {
            this.renderer.updateClusters(data.clusters || []);
        }

        // Log significant updates
        if ((data.clusters || []).length > 0) {
            console.log(`📊 Updated: ${data.clusters.length} clusters, ${data.totalClicks} total clicks`);
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            const paragraphs = errorEl.querySelectorAll('p');
            if (paragraphs.length > 0) {
                paragraphs[paragraphs.length - 1].textContent = message;
            }
            errorEl.style.display = 'block';
        }

        console.error(`🔴 Error: ${message}`);
    }

    hideError() {
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }
}

// Initialize with complete error handling
function initializeObsOverlay() {
    try {
        window.obsOverlay = new BulletproofObsOverlay();
    } catch (error) {
        console.error('❌ Failed to initialize OBS overlay:', error);

        // Show error in DOM if possible
        const errorEl = document.getElementById('error');
        if (errorEl) {
            errorEl.style.display = 'block';
            const paragraphs = errorEl.querySelectorAll('p');
            if (paragraphs.length > 0) {
                paragraphs[0].textContent = 'Failed to initialize overlay: ' + error.message;
            }
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeObsOverlay);
} else {
    initializeObsOverlay();
}

// URL parameter info
console.log('🎯 OBS Overlay URL Parameters:');
console.log('   ?channel=CHANNEL_NAME (required)');
console.log('   &threshold=5 (optional, default: 3)');
console.log('');
console.log('📖 Example: overlay.html?channel=ninja&threshold=5');

// Global reference for debugging
window.BulletproofObsOverlay = BulletproofObsOverlay;