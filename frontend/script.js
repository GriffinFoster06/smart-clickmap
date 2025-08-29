import { ExMachinaRenderer, ExMachinaClusterer } from './heatmap.js';

/**
 *  Style Smart Click Map - Fixed Version
 */
class ExMachinaClickMap {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;

        // Get canvas and setup renderer
        this.canvas = document.getElementById('heat');
        if (!this.canvas) {
            console.error('❌ Canvas element with ID "heat" not found');
            return;
        }

        console.log('🎯 Canvas found, initializing  renderer...');

        this.renderer = new ExMachinaRenderer(this.canvas);
        this.clusterer = new ExMachinaClusterer({
            epsilon: 0.08,
            minPts: 3,
            maxClusters: 8,
            minPercentage: 8
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

        // Debug mode
        this.debugMode = new URLSearchParams(location.search).has('debug');

        console.log('🚀  ClickMap initialized');
        this.setupEventListeners();
        this.setupResizeHandler();
    }

    /**
     * Initialize with Twitch Extension authorization
     */
    async initialize() {
        console.log('🔐 Starting Twitch authorization...');

        return new Promise((resolve) => {
            if (window.Twitch && window.Twitch.ext) {
                console.log('✅ Twitch extension API found');

                Twitch.ext.onAuthorized((auth) => {
                    this.authToken = auth.token;
                    this.channelId = auth.channelId;
                    console.log(`🎪 Authorized for channel: ${this.channelId}`);
                    console.log(`🎫 Token: ${this.authToken ? 'Present' : 'Missing'}`);

                    this.updateStatus('Connected', true);
                    this.startDataConnection();
                    resolve();
                });

                Twitch.ext.onContext((context) => {
                    console.log('📱 Context changed:', context);
                    this.handleContextChange(context);
                });
            } else {
                // Fallback for testing without Twitch
                console.log('⚠️ Running in test mode (no Twitch extension)');
                this.channelId = 'test_channel';
                this.updateStatus('Test Mode', false);
                this.startDataConnection();
                resolve();
            }
        });
    }

    /**
     * Start data connections
     */
    startDataConnection() {
        console.log('📡 Starting data connections...');
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
            console.log(`🔌 Connecting WebSocket: ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.reconnectAttempts = 0;
                this.dispatchEvent('ex-machina-ws-status', { status: 'Connected' });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 WebSocket message:', data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('❌ WebSocket message parsing error:', e);
                }
            };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', event.code);
                this.dispatchEvent('ex-machina-ws-status', { status: 'Disconnected' });
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.dispatchEvent('ex-machina-ws-status', { status: 'Error' });
            };

        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'click':
                console.log('👆 Real-time click received');
                // Trigger immediate data update
                setTimeout(() => this.requestDataUpdate(), 100);
                break;

            case 'status':
                const wasRunning = this.running;
                this.running = data.data.running;

                console.log(`📊 Status update: ${this.running ? 'RUNNING' : 'STOPPED'}`);
                this.updateStatus(this.running ? 'Running' : 'Stopped', this.running);

                // Update canvas cursor
                this.canvas.className = this.running ? '' : 'inactive';
                break;

            case 'reset':
                console.log('🗑️ Reset received');
                this.currentClusters = [];
                this.stats = { totalClicks: 0, uniqueUsers: 0 };
                this.renderClusters();
                break;
        }
    }

    /**
     * Start polling for data updates
     */
    startPolling() {
        if (this.pollInterval) return;

        console.log('⏰ Starting data polling...');

        this.pollInterval = setInterval(() => {
            this.requestDataUpdate();
        }, 1500);

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
            if (this.debugMode) {
                console.error('❌ Failed to fetch data:', error);
            }
        }
    }

    /**
     * Process data from server and update clusters
     */
    processServerData(data) {
        const wasRunning = this.running;
        this.running = data.running;

        // Update status if changed
        if (wasRunning !== this.running) {
            console.log(`📊 Status changed: ${this.running ? 'RUNNING' : 'STOPPED'}`);
            this.updateStatus(this.running ? 'Running' : 'Stopped', this.running);
            this.canvas.className = this.running ? '' : 'inactive';
        }

        // Update statistics
        this.stats = {
            totalClicks: data.totalClicks || 0,
            uniqueUsers: data.uniqueUsers || 0
        };

        // Process raw clicks if available
        if (data.rawClicks && Array.isArray(data.rawClicks)) {
            if (data.rawClicks.length > 0) {
                console.log(`📊 Processing ${data.rawClicks.length} raw clicks`);
            }
            this.updateClusters(data.rawClicks);
        } else if (data.blobs && Array.isArray(data.blobs)) {
            // Fallback to server-provided blobs
            this.currentClusters = this.convertServerBlobs(data.blobs);
            this.renderClusters();
        }

        // Dispatch update event for debug display
        this.dispatchEvent('ex-machina-clusters-update', {
            count: this.currentClusters.length,
            clicks: this.stats.totalClicks
        });
    }

    /**
     * Update clusters using clustering algorithm
     */
    updateClusters(rawClicks) {
        const startTime = performance.now();

        try {
            this.currentClusters = this.clusterer.clusterPoints(rawClicks);

            const clusterTime = performance.now() - startTime;

            this.renderClusters();

            if (this.currentClusters.length > 0 && this.debugMode) {
                console.log(`🧮 Generated ${this.currentClusters.length} clusters in ${clusterTime.toFixed(1)}ms`);
            }

        } catch (error) {
            console.error('❌ Clustering error:', error);
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
     * Render clusters
     */
    renderClusters() {
        this.renderer.renderClusters(this.currentClusters);
    }

    /**
     * Handle user clicks on canvas
     */
    handleCanvasClick(event) {
        console.log('👆 Canvas clicked!');

        // Check if system is running and user is authorized
        if (!this.running) {
            console.log('⚠️ Click ignored - system not running');
            this.showNotification('Click mapping is not active', 'info');
            return;
        }

        if (!this.authToken) {
            console.log('⚠️ Click ignored - not authorized');
            this.showNotification('Not authorized to click', 'error');
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        console.log(`👆 Click coordinates: (${x.toFixed(3)}, ${y.toFixed(3)})`);

        // Validate coordinates
        if (x < 0 || x > 1 || y < 0 || y > 1) {
            console.log('⚠️ Click ignored - out of bounds');
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
            console.log(`📤 Sending click: (${x.toFixed(3)}, ${y.toFixed(3)})`);

            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ x, y })
            });

            if (response.ok) {
                console.log('✅ Click sent successfully');
                this.showNotification('Click registered!', 'success');

                // Trigger immediate data update
                setTimeout(() => this.requestDataUpdate(), 200);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.log(`❌ Click failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
                this.showNotification(`Click failed: ${errorData.error || 'Server error'}`, 'error');
            }

        } catch (error) {
            console.error('❌ Failed to send click:', error);
            this.showNotification('Network error - click not sent', 'error');
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        console.log('🖱️ Setting up event listeners...');

        // Click handling
        this.canvas.addEventListener('click', (e) => {
            console.log('🖱️ Canvas click event triggered');
            this.handleCanvasClick(e);
        });

        // Touch support for mobile
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            console.log('📱 Touch event triggered');

            if (e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
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
        });

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Keyboard shortcuts (debug mode)
        if (this.debugMode) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'r' && e.ctrlKey) {
                    console.log('🧹 Manual clear requested');
                    this.renderer.clearCanvas();
                    e.preventDefault();
                }

                if (e.key === 't' && e.ctrlKey) {
                    // Test click
                    console.log('🧪 Test click triggered');
                    this.handleCanvasClick({
                        clientX: this.canvas.width / 2,
                        clientY: this.canvas.height / 2
                    });
                    e.preventDefault();
                }
            });
        }

        // Network status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        console.log('✅ Event listeners setup complete');
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
     * Schedule WebSocket reconnection
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectAttempts++;

            setTimeout(() => {
                if (navigator.onLine) {
                    console.log(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})`);
                    this.connectWebSocket();
                }
            }, delay);
        } else {
            console.log('❌ Max reconnection attempts reached');
        }
    }

    /**
     * Handle online/offline events
     */
    handleOnline() {
        console.log('🌐 Connection restored');
        this.connectWebSocket();
        this.requestDataUpdate();
    }

    handleOffline() {
        console.log('📴 Connection lost');
    }

    /**
     * Utility functions
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

    updateStatus(text, isRunning = null) {
        // Dispatch custom event for status updates
        this.dispatchEvent('ex-machina-status-update', {
            status: text,
            running: isRunning
        });

        // Update UI elements if they exist
        const statusText = document.getElementById('ex-machina-status-text');
        const statusContainer = document.getElementById('ex-machina-status');

        if (statusText) statusText.textContent = text;
        if (statusContainer && isRunning !== null) {
            statusContainer.className = `ex-machina-status visible ${isRunning ? 'running' : 'stopped'}`;
        }
    }

    showNotification(message, type = 'info') {
        console.log(`📢 ${type.toUpperCase()}: ${message}`);

        if (!this.debugMode && type === 'info') {
            return; // Don't show info notifications in production
        }

        const notification = document.createElement('div');
        notification.className = `ex-machina-overlay-notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    dispatchEvent(eventName, detail) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
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
            channelId: this.channelId,
            hasAuth: !!this.authToken
        };
    }

    /**
     * Cleanup and destroy
     */
    destroy() {
        console.log('🧹 Destroying  ClickMap...');

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

        console.log('✅  ClickMap destroyed');
    }
}

// Initialize immediately when script loads
let exMachinaInstance = null;

// Initialize function
async function initializeExMachina() {
    try {
        console.log('🚀 Initializing  Smart Click Maps...');

        exMachinaInstance = new ExMachinaClickMap();
        await exMachinaInstance.initialize();

        console.log('✅  initialization complete');

        // Expose for debugging
        if (exMachinaInstance.debugMode) {
            window.exMachinaClickMap = exMachinaInstance;
            console.log('🐛 Debug mode: window.exMachinaClickMap available');
        }

    } catch (error) {
        console.error('❌ Failed to initialize :', error);
        throw error;
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExMachina);
} else {
    // DOM already ready
    initializeExMachina();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (exMachinaInstance) {
        exMachinaInstance.destroy();
    }
});

// Export for dynamic import
export default ExMachinaClickMap;