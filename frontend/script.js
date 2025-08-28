/**
 * Ex Machina Smart Click Map - Fixed Version
 * This file should work without module import issues
 */

// Import the heatmap components with error handling
let ExMachinaRenderer, ExMachinaClusterer;

// Try to import modules, fall back to inline versions if needed
try {
    const heatmapModule = await import('./heatmap.js');
    ExMachinaRenderer = heatmapModule.ExMachinaRenderer;
    ExMachinaClusterer = heatmapModule.ExMachinaClusterer;
} catch (error) {
    console.error('Failed to import heatmap module, using fallback:', error);

    // Fallback: Define basic renderer inline
    ExMachinaRenderer = class {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.setupCanvas();
        }

        setupCanvas() {
            const dpr = window.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.ctx.scale(dpr, dpr);
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
        }

        renderClusters(clusters) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (!clusters || clusters.length === 0) return;

            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);

            clusters.forEach(cluster => {
                const cx = cluster.x * W;
                const cy = cluster.y * H;
                const r = 20 + Math.sqrt(cluster.pct || 10) * 2;

                // Determine colors
                const isTop = cluster.isTop || cluster.pct >= Math.max(...clusters.map(c => c.pct));
                const color = isTop ? '#00FFFF' : '#9D4EDD'; // Cyan for top, purple for others

                // Draw glow
                this.ctx.shadowColor = color;
                this.ctx.shadowBlur = 15;

                // Draw circle
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = isTop ? 4 : 3;
                this.ctx.fillStyle = color + '20'; // 20 = low alpha
                this.ctx.beginPath();
                this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();

                // Reset shadow
                this.ctx.shadowBlur = 0;

                // Draw percentage
                const fontSize = isTop ? 28 : 24;
                this.ctx.font = `bold ${fontSize}px Arial`;
                this.ctx.fillStyle = 'white';
                this.ctx.strokeStyle = 'black';
                this.ctx.lineWidth = 3;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';

                const text = `${cluster.pct}%`;
                this.ctx.strokeText(text, cx, cy);
                this.ctx.fillText(text, cx, cy);
            });
        }

        handleResize() {
            this.setupCanvas();
        }

        clearCanvas() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    };

    ExMachinaClusterer = class {
        constructor() { }
        clusterPoints() { return []; } // Fallback - server will provide clusters
    };
}

/**
 * Main ClickMap Class
 */
class ExMachinaClickMap {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;

        // Get canvas and setup renderer
        this.canvas = document.getElementById('heat');
        if (!this.canvas) {
            console.error('Canvas element with ID "heat" not found');
            return;
        }

        this.renderer = new ExMachinaRenderer(this.canvas);
        this.clusterer = new ExMachinaClusterer();

        // Backend connection
        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.wsUrl = this.EBS.replace('https://', 'wss://');
        this.ws = null;
        this.pollInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        // Data storage
        this.currentClusters = [];
        this.stats = { totalClicks: 0, uniqueUsers: 0 };

        this.setupEventListeners();
        this.setupResizeHandler();

        console.log('Ex Machina ClickMap initialized');
    }

    /**
     * Initialize with Twitch Extension authorization
     */
    async initialize() {
        return new Promise((resolve) => {
            if (window.Twitch && window.Twitch.ext) {
                Twitch.ext.onAuthorized((auth) => {
                    this.authToken = auth.token;
                    this.channelId = auth.channelId;
                    console.log(`Authorized for channel: ${this.channelId}`);
                    this.startDataConnection();
                    resolve();
                });

                Twitch.ext.onContext((context) => {
                    this.handleContextChange(context);
                });
            } else {
                // Fallback for testing without Twitch
                console.log('Running in test mode without Twitch extension');
                this.channelId = 'test_channel';
                this.startDataConnection();
                resolve();
            }
        });
    }

    /**
     * Start data connections
     */
    startDataConnection() {
        this.connectWebSocket();
        this.startPolling();
    }

    /**
     * Connect WebSocket
     */
    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const wsUrl = `${this.wsUrl}?channel=${encodeURIComponent(this.channelId)}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                this.dispatchEvent('ex-machina-ws-status', { status: 'Connected' });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('WebSocket message error:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.dispatchEvent('ex-machina-ws-status', { status: 'Disconnected' });
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.dispatchEvent('ex-machina-ws-status', { status: 'Error' });
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.dispatchEvent('ex-machina-ws-status', { status: 'Failed' });
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'click':
                this.requestDataUpdate();
                break;

            case 'status':
                this.running = data.data.running;
                this.updateCanvasState();
                break;

            case 'reset':
                this.currentClusters = [];
                this.renderClusters();
                break;
        }
    }

    /**
     * Start polling
     */
    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => {
            this.requestDataUpdate();
        }, 2000); // Every 2 seconds

        // Initial fetch
        this.requestDataUpdate();
    }

    /**
     * Request data update
     */
    async requestDataUpdate() {
        try {
            const url = this.channelId ?
                `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}` :
                `${this.EBS}/heatmap`;

            const response = await fetch(url, {
                headers: this.authToken ? {
                    'Authorization': `Bearer ${this.authToken}`
                } : {},
                cache: 'no-cache'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.processServerData(data);

        } catch (error) {
            console.error('Failed to fetch data:', error);
        }
    }

    /**
     * Process server data
     */
    processServerData(data) {
        this.running = data.running;
        this.stats = {
            totalClicks: data.totalClicks || 0,
            uniqueUsers: data.uniqueUsers || 0
        };

        // Update canvas state
        this.updateCanvasState();

        // Process clusters
        if (data.rawClicks && Array.isArray(data.rawClicks)) {
            // Use server clusters if available, otherwise convert rawClicks
            this.updateClusters(data.rawClicks);
        } else if (data.blobs && Array.isArray(data.blobs)) {
            this.currentClusters = data.blobs;
            this.renderClusters();
        }

        // Dispatch event for debug display
        this.dispatchEvent('ex-machina-clusters-update', {
            count: this.currentClusters.length,
            clicks: this.stats.totalClicks
        });
    }

    /**
     * Update clusters (simplified version)
     */
    updateClusters(rawClicks) {
        try {
            // For now, just convert rawClicks to simple circular clusters
            // Group clicks by proximity
            const clusters = this.groupClicksByProximity(rawClicks);
            this.currentClusters = clusters;
            this.renderClusters();

        } catch (error) {
            console.error('Clustering error:', error);
            this.currentClusters = [];
            this.renderClusters();
        }
    }

    /**
     * Simple proximity-based clustering
     */
    groupClicksByProximity(clicks) {
        if (!clicks || clicks.length === 0) return [];

        // Remove duplicates (one per user)
        const uniqueClicks = new Map();
        clicks.forEach(click => {
            if (click.userId) {
                uniqueClicks.set(click.userId, click);
            }
        });

        const clicksArray = Array.from(uniqueClicks.values());
        if (clicksArray.length === 0) return [];

        const clusters = [];
        const processed = new Set();
        const threshold = 0.1; // Distance threshold for clustering

        clicksArray.forEach((click, i) => {
            if (processed.has(i)) return;

            const cluster = {
                x: click.x,
                y: click.y,
                count: 1,
                clicks: [click]
            };

            // Find nearby clicks
            for (let j = i + 1; j < clicksArray.length; j++) {
                if (processed.has(j)) continue;

                const other = clicksArray[j];
                const distance = Math.sqrt(
                    Math.pow(click.x - other.x, 2) +
                    Math.pow(click.y - other.y, 2)
                );

                if (distance < threshold) {
                    cluster.x = (cluster.x * cluster.count + other.x) / (cluster.count + 1);
                    cluster.y = (cluster.y * cluster.count + other.y) / (cluster.count + 1);
                    cluster.count++;
                    cluster.clicks.push(other);
                    processed.add(j);
                }
            }

            processed.add(i);
            clusters.push(cluster);
        });

        // Calculate percentages and mark top cluster
        const totalClicks = clicksArray.length;
        clusters.forEach(cluster => {
            cluster.pct = Math.round((cluster.count / totalClicks) * 100);
        });

        // Sort and mark top
        clusters.sort((a, b) => b.count - a.count);
        if (clusters.length > 0) {
            clusters[0].isTop = true;
        }

        // Filter out small clusters
        return clusters.filter(cluster => cluster.pct >= 8);
    }

    /**
     * Render clusters
     */
    renderClusters() {
        this.renderer.renderClusters(this.currentClusters);
    }

    /**
     * Update canvas state based on running status
     */
    updateCanvasState() {
        if (this.running) {
            this.canvas.classList.remove('inactive');
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.classList.add('inactive');
            this.canvas.style.cursor = 'not-allowed';
        }
    }

    /**
     * Handle canvas clicks
     */
    handleCanvasClick(event) {
        if (!this.running || !this.authToken) {
            console.log('Click ignored - system not running or not authorized');
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        if (x < 0 || x > 1 || y < 0 || y > 1) return;

        this.sendClick(x, y);
    }

    /**
     * Send click to server
     */
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

            if (response.ok) {
                console.log(`Click sent: (${x.toFixed(3)}, ${y.toFixed(3)})`);
                // Immediate update
                setTimeout(() => this.requestDataUpdate(), 100);
            } else {
                console.warn('Click failed:', response.status);
            }

        } catch (error) {
            console.error('Failed to send click:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'r' && e.ctrlKey) {
                this.renderer.clearCanvas();
                e.preventDefault();
            }
        });

        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    /**
     * Handle touch events
     */
    handleTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = (touch.clientX - rect.left) / rect.width;
            const y = (touch.clientY - rect.top) / rect.height;

            if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                this.handleCanvasClick({
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
            }
        }
    }

    /**
     * Setup resize handler
     */
    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.renderer.handleResize();
                this.renderClusters();
            }, 250);
        });
    }

    /**
     * Handle context changes
     */
    handleContextChange(context) {
        setTimeout(() => {
            this.renderer.handleResize();
            this.renderClusters();
        }, 100);
    }

    /**
     * Schedule reconnect
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectAttempts++;

            setTimeout(() => {
                if (navigator.onLine) {
                    console.log(`Reconnecting (attempt ${this.reconnectAttempts})`);
                    this.connectWebSocket();
                }
            }, delay);
        }
    }

    /**
     * Handle online/offline
     */
    handleOnline() {
        console.log('Connection restored');
        this.connectWebSocket();
        this.requestDataUpdate();
    }

    handleOffline() {
        console.log('Connection lost');
    }

    /**
     * Dispatch custom events
     */
    dispatchEvent(eventName, detail) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.renderer.clearCanvas();
        this.currentClusters = [];
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const clickMap = new ExMachinaClickMap();
        await clickMap.initialize();

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
            clickMap.destroy();
        });

        // Expose for debugging
        if (new URLSearchParams(location.search).has('debug')) {
            window.exMachinaClickMap = clickMap;
        }

        console.log('Ex Machina ClickMap ready');

    } catch (error) {
        console.error('Failed to initialize Ex Machina ClickMap:', error);
    }
});