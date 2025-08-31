// frontend/overlay/overlay.js - Bulletproof OBS overlay with enhanced WebSocket handling
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
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 10;
        this.wsReconnectTimeout = null;
        this.preferWebSocket = true;
        this.lastDataReceived = 0;

        console.log('🎯 Bulletproof OBS Overlay v3.1.0 initializing...');
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

            // Try WebSocket first, fallback to polling
            await this.connectWithFallback();

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
            console.log(`📊 WebSocket info:`, data.websocket, data.clients);
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

    async connectWithFallback() {
        console.log('🔄 Attempting connection with fallback strategy...');

        if (this.preferWebSocket) {
            try {
                await this.connectWebSocket();
                console.log('✅ WebSocket connection successful');
                return;
            } catch (error) {
                console.warn('⚠️ WebSocket failed, falling back to polling:', error);
                this.preferWebSocket = false;
            }
        }

        // Fallback to polling
        this.startPolling();
        console.log('✅ Polling connection active');
    }

    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (this.websocket) {
                this.websocket.close();
                this.websocket = null;
            }

            if (this.connectionAttempts >= this.maxConnectionAttempts) {
                console.warn('🚫 Max WebSocket connection attempts reached');
                reject(new Error('Max connection attempts reached'));
                return;
            }

            this.connectionAttempts++;

            try {
                const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
                const fullWsUrl = `${wsUrl}/ws/${this.channelId}`;

                console.log(`🔗 WebSocket attempt ${this.connectionAttempts}: ${fullWsUrl}`);

                this.websocket = new WebSocket(fullWsUrl);

                const connectionTimeout = setTimeout(() => {
                    console.warn('⏰ WebSocket connection timeout');
                    this.websocket.close();
                    reject(new Error('Connection timeout'));
                }, 10000);

                this.websocket.onopen = () => {
                    clearTimeout(connectionTimeout);
                    console.log('📡 WebSocket connected successfully');
                    this.consecutiveErrors = 0;
                    this.connectionAttempts = 0;
                    this.lastDataReceived = Date.now();

                    // Stop polling since WebSocket is working
                    if (this.pollInterval) {
                        clearInterval(this.pollInterval);
                        this.pollInterval = null;
                        console.log('⏸️ Polling stopped - WebSocket active');
                    }

                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.updateVisualization(data);
                        this.lastDataReceived = Date.now();
                        this.consecutiveErrors = 0;
                    } catch (e) {
                        console.error('❌ WebSocket parse error:', e);
                    }
                };

                this.websocket.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    console.error('❌ WebSocket error:', error);
                    reject(error);
                };

                this.websocket.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    console.log(`📡 WebSocket disconnected: Code ${event.code}, Reason: ${event.reason || 'none'}`);

                    this.websocket = null;

                    // If we were successfully connected before, try to reconnect
                    if (this.connectionAttempts < this.maxConnectionAttempts && this.preferWebSocket) {
                        const delay = Math.min(5000 * Math.pow(2, this.consecutiveErrors), 30000);
                        console.log(`🔄 Reconnecting WebSocket in ${delay}ms...`);

                        this.wsReconnectTimeout = setTimeout(() => {
                            this.connectWebSocket().catch(err => {
                                console.warn('🔄 WebSocket reconnection failed:', err);
                                if (!this.pollInterval) {
                                    console.log('🔄 Starting polling as fallback');
                                    this.startPolling();
                                }
                            });
                        }, delay);
                    } else {
                        // Switch to polling permanently
                        if (!this.pollInterval) {
                            console.log('🔄 Switching to polling mode');
                            this.startPolling();
                        }
                    }

                    if (this.connectionAttempts < this.maxConnectionAttempts) {
                        reject(new Error('WebSocket closed'));
                    }
                };

                // Handle pong responses
                this.websocket.onpong = () => {
                    console.log('🏓 WebSocket pong received');
                };

            } catch (error) {
                console.error('❌ WebSocket creation failed:', error);
                reject(error);
            }
        });
    }

    startPolling() {
        if (this.pollInterval) return;

        // More aggressive polling as fallback
        const pollRate = this.preferWebSocket ? 2000 : 800;

        this.pollInterval = setInterval(() => this.poll(), pollRate);
        this.poll(); // Initial poll

        console.log(`⏰ Polling started (${pollRate}ms interval)`);
    }

    async poll() {
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
            this.hideError();

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

        // Track data reception for health monitoring
        this.lastDataReceived = Date.now();
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

    // Health monitoring
    startHealthMonitoring() {
        setInterval(() => {
            const timeSinceLastData = Date.now() - this.lastDataReceived;

            if (timeSinceLastData > 30000) { // 30 seconds
                console.warn('⚠️ No data received for 30 seconds');

                // Try to reconnect WebSocket if it's closed
                if (this.preferWebSocket && (!this.websocket || this.websocket.readyState !== WebSocket.OPEN)) {
                    console.log('🔄 Attempting WebSocket reconnection due to data timeout');
                    this.connectWebSocket().catch(err => {
                        console.warn('🔄 Health monitor reconnection failed:', err);
                    });
                }
            }
        }, 15000); // Check every 15 seconds
    }

    destroy() {
        if (this.wsReconnectTimeout) {
            clearTimeout(this.wsReconnectTimeout);
        }

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        console.log('🧹 Overlay destroyed');
    }
}

// Initialize with complete error handling
function initializeObsOverlay() {
    try {
        window.obsOverlay = new BulletproofObsOverlay();

        // Start health monitoring
        window.obsOverlay.startHealthMonitoring();

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

// Global cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.obsOverlay) {
        window.obsOverlay.destroy();
    }
});

// URL parameter info
console.log('🎯 OBS Overlay URL Parameters:');
console.log('   ?channel=CHANNEL_NAME (required)');
console.log('   &threshold=5 (optional, default: 3)');
console.log('');
console.log('📖 Example: overlay.html?channel=ninja&threshold=5');
console.log('🔗 WebSocket will fallback to polling if connection fails');

// Global reference for debugging
window.BulletproofObsOverlay = BulletproofObsOverlay;