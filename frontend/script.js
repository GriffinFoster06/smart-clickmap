import { ExMachinaRenderer, ExMachinaClusterer } from './heatmap.js';

/**
 * Ex Machina Style Smart Click Map
 * Replicates the exact behavior and visuals from the reference image
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
        this.clusterer = new ExMachinaClusterer({
            epsilon: 0.08,           // Clustering distance threshold  
            minPts: 3,              // Minimum points per cluster
            maxClusters: 8,         // Max clusters to display
            minPercentage: 8        // Minimum 8% to show cluster
        });

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

        // Performance tracking
        this.lastUpdateTime = 0;
        this.updateCount = 0;

        this.setupEventListeners();
        this.setupResizeHandler();
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
                    console.log(`Ex Machina ClickMap initialized for channel: ${this.channelId}`);
                    this.startDataConnection();
                    resolve();
                });

                Twitch.ext.onContext((context) => {
                    this.handleContextChange(context);
                });
            } else {
                // Fallback for testing without Twitch
                console.log('Running Ex Machina ClickMap in test mode');
                this.channelId = 'test_channel';
                this.startDataConnection();
                resolve();
            }
        });
    }

    /**
     * Start data connections (WebSocket + polling fallback)
     */
    startDataConnection() {
        this.connectWebSocket();
        this.startPolling();
    }

    /**
     * Connect WebSocket for real-time updates
     */
    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const wsUrl = `${this.wsUrl}?channel=${encodeURIComponent(this.channelId)}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('Ex Machina WebSocket connected');
                this.reconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('WebSocket message parsing error:', e);
                }
            };

            this.ws.onclose = (event) => {
                console.log('Ex Machina WebSocket disconnected');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Ex Machina WebSocket error:', error);
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'click':
                // Real-time click received - trigger immediate update
                this.requestDataUpdate();
                break;

            case 'status':
                const wasRunning = this.running;
                this.running = data.data.running;

                if (wasRunning !== this.running) {
                    console.log(`Ex Machina status: ${this.running ? 'Started' : 'Stopped'}`);
                }
                break;

            case 'reset':
                this.currentClusters = [];
                this.stats = { totalClicks: 0, uniqueUsers: 0 };
                this.renderClusters();
                console.log('Ex Machina map reset');
                break;
        }
    }

    /**
     * Start polling for data updates
     */
    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => {
            this.requestDataUpdate();
        }, 1500); // Poll every 1.5 seconds

        // Initial data fetch
        this.requestDataUpdate();
    }

    /**
     * Request data update from server
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
            console.error('Failed to fetch Ex Machina data:', error);
        }
    }

    /**
     * Process data from server and update clusters
     */
    processServerData(data) {
        const wasRunning = this.running;
        this.running = data.running;

        // Update statistics
        this.stats = {
            totalClicks: data.totalClicks || 0,
            uniqueUsers: data.uniqueUsers || 0
        };

        // Process raw clicks if available
        if (data.rawClicks && Array.isArray(data.rawClicks)) {
            this.updateClusters(data.rawClicks);
        }
        // Fallback to server-provided blobs
        else if (data.blobs && Array.isArray(data.blobs)) {
            this.currentClusters = this.convertServerBlobs(data.blobs);
            this.renderClusters();
        }

        // Track update performance
        const now = performance.now();
        this.updateCount++;

        if (this.updateCount % 20 === 0) { // Log every 20 updates
            const avgTime = (now - this.lastUpdateTime) / 20;
            console.log(`Ex Machina: ${this.updateCount} updates, ${avgTime.toFixed(1)}ms avg`);
        }
        this.lastUpdateTime = now;
    }

    /**
     * Update clusters using Ex Machina clustering algorithm
     */
    updateClusters(rawClicks) {
        const startTime = performance.now();

        try {
            // Use Ex Machina clusterer to create polygon clusters
            this.currentClusters = this.clusterer.clusterPoints(rawClicks);

            const clusterTime = performance.now() - startTime;

            // Render the updated clusters
            this.renderClusters();

            if (this.currentClusters.length > 0) {
                console.log(`Ex Machina: ${this.currentClusters.length} clusters generated in ${clusterTime.toFixed(1)}ms`);
            }

        } catch (error) {
            console.error('Ex Machina clustering error:', error);
        }
    }

    /**
     * Convert server blobs to our format (fallback)
     */
    convertServerBlobs(serverBlobs) {
        return serverBlobs.map((blob, index) => ({
            id: `server_${index}`,
            points: [{ x: blob.x, y: blob.y }],
            polygon: this.createCirclePolygon({ x: blob.x, y: blob.y }, 0.05),
            centroid: { x: blob.x, y: blob.y },
            count: blob.count || 1,
            percentage: blob.pct || 0,
            isTop: blob.isTop || false,
            rank: blob.rank || null
        }));
    }

    /**
     * Render clusters using Ex Machina renderer
     */
    renderClusters() {
        this.renderer.renderClusters(this.currentClusters);
    }

    /**
     * Handle user clicks on canvas
     */
    handleCanvasClick(event) {
        // Only process clicks when system is running and user is authorized
        if (!this.running || !this.authToken) {
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        // Validate coordinates
        if (x < 0 || x > 1 || y < 0 || y > 1) {
            return;
        }

        // Send click to server
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
                console.log(`Ex Machina click sent: (${x.toFixed(3)}, ${y.toFixed(3)})`);
                // Trigger immediate data update for responsive feedback
                setTimeout(() => this.requestDataUpdate(), 100);
            } else {
                console.warn('Ex Machina click failed:', response.status);
            }

        } catch (error) {
            console.error('Failed to send Ex Machina click:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Click handling
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

        // Touch support for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+R to clear display (for testing)
            if (e.key === 'r' && e.ctrlKey) {
                this.renderer.clearCanvas();
                e.preventDefault();
            }
        });

        // Network status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    /**
     * Handle touch events for mobile
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
     * Setup canvas resize handling
     */
    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.renderer.handleResize();
                this.renderClusters(); // Re-render after resize
            }, 250);
        });
    }

    /**
     * Handle Twitch context changes
     */
    handleContextChange(context) {
        // Handle fullscreen, theater mode changes
        setTimeout(() => {
            this.renderer.handleResize();
            this.renderClusters();
        }, 100);
    }

    /**
     * Schedule WebSocket reconnection
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectAttempts++;

            setTimeout(() => {
                if (navigator.onLine) {
                    console.log(`Ex Machina reconnecting (attempt ${this.reconnectAttempts})`);
                    this.connectWebSocket();
                }
            }, delay);
        }
    }

    /**
     * Handle online/offline events
     */
    handleOnline() {
        console.log('Ex Machina: Connection restored');
        this.connectWebSocket();
        this.requestDataUpdate();
    }

    handleOffline() {
        console.log('Ex Machina: Connection lost');
    }

    /**
     * Create circle polygon (utility)
     */
    createCirclePolygon(center, radius, segments = 8) {
        const polygon = [];
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            polygon.push({
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius
            });
        }
        return polygon;
    }

    /**
     * Get current statistics
     */
    getStats() {
        return {
            running: this.running,
            clusters: this.currentClusters.length,
            totalClicks: this.stats.totalClicks,
            uniqueUsers: this.stats.uniqueUsers,
            wsConnected: this.ws && this.ws.readyState === WebSocket.OPEN,
            updateCount: this.updateCount
        };
    }

    /**
     * Cleanup and destroy
     */
    destroy() {
        // Stop polling
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        // Close WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Clear display
        this.renderer.clearCanvas();
        this.currentClusters = [];

        console.log('Ex Machina ClickMap destroyed');
    }
}

// Initialize Ex Machina ClickMap when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const exMachinaClickMap = new ExMachinaClickMap();

    exMachinaClickMap.initialize().catch(error => {
        console.error('Failed to initialize Ex Machina ClickMap:', error);
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        exMachinaClickMap.destroy();
    });

    // Expose for debugging (only in development)
    if (new URLSearchParams(location.search).has('debug')) {
        window.exMachinaClickMap = exMachinaClickMap;
        console.log('Ex Machina ClickMap debug mode enabled');
    }
});