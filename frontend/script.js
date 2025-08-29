import { ExMachinaRenderer, ExMachinaClusterer } from './heatmap.js';

/**
 * Ex Machina Smart Click Maps - Main Application
 * Properly uses all dedicated files and components
 */
class ExMachinaSmartClickMap {
    constructor() {
        console.log('🚀 Initializing Ex Machina Smart Click Maps...');

        // Twitch Extension data
        this.authToken = '';
        this.channelId = '';
        this.running = false;

        // Get canvas element
        this.canvas = document.getElementById('heat');
        if (!this.canvas) {
            console.error('❌ Canvas element not found!');
            return;
        }

        // Initialize renderer and clusterer from heatmap.js
        this.renderer = new ExMachinaRenderer(this.canvas);
        this.clusterer = new ExMachinaClusterer({
            epsilon: 0.08,        // Clustering distance
            minPts: 3,           // Minimum points per cluster
            maxClusters: 8,      // Max clusters to show
            minPercentage: 8     // Minimum 8% to show cluster
        });

        console.log('✅ Renderer and clusterer initialized');

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
        if (this.debugMode) {
            document.getElementById('debug-overlay').classList.add('visible');
            console.log('🐛 Debug mode enabled');
        }

        // Setup event listeners and start system
        this.setupEventListeners();
        this.setupResizeHandler();
        this.initialize();
    }

    /**
     * Initialize Twitch Extension authorization
     */
    async initialize() {
        console.log('🔐 Starting Twitch authorization...');
        this.updateDebugInfo('status', 'Initializing...');

        return new Promise((resolve) => {
            // Set up timeout to prevent hanging
            const authTimeout = setTimeout(() => {
                console.log('⏰ Twitch auth timeout - using fallback mode');
                this.authToken = '';
                this.channelId = 'test_channel_' + Date.now();
                this.updateDebugInfo('auth', 'Timeout');
                this.updateDebugInfo('channel', this.channelId);
                this.startSystem();
                resolve();
            }, 3000);

            if (window.Twitch && window.Twitch.ext) {
                console.log('✅ Twitch Extension API available');

                Twitch.ext.onAuthorized((auth) => {
                    clearTimeout(authTimeout);

                    this.authToken = auth.token;
                    this.channelId = auth.channelId;

                    console.log(`🎪 Authorized for channel: ${this.channelId}`);
                    console.log(`🎫 Token: ${this.authToken ? 'Present' : 'Missing'}`);

                    this.updateDebugInfo('auth', 'Yes');
                    this.updateDebugInfo('channel', this.channelId);

                    this.startSystem();
                    resolve();
                });

                Twitch.ext.onContext((context) => {
                    console.log('📱 Context changed:', context);
                    this.handleContextChange(context);
                });
            } else {
                clearTimeout(authTimeout);
                console.log('⚠️ No Twitch Extension API - running standalone');
                this.authToken = '';
                this.channelId = 'standalone_test';
                this.updateDebugInfo('auth', 'Standalone');
                this.updateDebugInfo('channel', this.channelId);
                this.startSystem();
                resolve();
            }
        });
    }

    /**
     * Start the main system
     */
    startSystem() {
        console.log('📡 Starting Ex Machina system...');
        this.updateDebugInfo('status', 'Starting...');

        // Start data connections
        this.connectWebSocket();
        this.startPolling();

        this.updateDebugInfo('status', 'Running');
        console.log('✅ Ex Machina system started successfully!');

        // Show success notification in debug mode
        if (this.debugMode) {
            this.showNotification('Ex Machina Debug Mode Active', 'info');

            // Expose for debugging
            window.exMachinaDebug = {
                instance: this,
                sendTestClick: (x = 0.5, y = 0.5) => this.sendClick(x, y),
                clearCanvas: () => this.renderer.clearCanvas(),
                getStats: () => ({
                    running: this.running,
                    clusters: this.currentClusters.length,
                    totalClicks: this.stats.totalClicks,
                    channelId: this.channelId,
                    hasAuth: !!this.authToken
                }),
                addTestData: () => {
                    const testClicks = [
                        { x: 0.3, y: 0.3, userId: 'test1', timestamp: Date.now() },
                        { x: 0.32, y: 0.31, userId: 'test2', timestamp: Date.now() },
                        { x: 0.7, y: 0.7, userId: 'test3', timestamp: Date.now() },
                        { x: 0.71, y: 0.69, userId: 'test4', timestamp: Date.now() }
                    ];
                    this.processClicks(testClicks);
                }
            };

            console.log('🐛 Debug commands available: window.exMachinaDebug');
        }
    }

    /**
     * Connect WebSocket for real-time updates
     */
    connectWebSocket() {
        if (!this.channelId || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        try {
            const wsUrl = `${this.wsUrl}?channel=${encodeURIComponent(this.channelId)}`;
            console.log(`🔌 Connecting WebSocket: ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.updateDebugInfo('ws', 'Connected');
                this.reconnectAttempts = 0;
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
                this.updateDebugInfo('ws', 'Disconnected');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.updateDebugInfo('ws', 'Error');
            };

        } catch (error) {
            console.error('❌ WebSocket connection failed:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'click':
                console.log('👆 Real-time click received:', data.data);
                // Trigger immediate data update
                setTimeout(() => this.fetchHeatmapData(), 100);
                break;

            case 'status':
                const wasRunning = this.running;
                this.running = data.data.running;

                console.log(`📊 Status update: ${this.running ? 'RUNNING' : 'STOPPED'}`);
                this.updateDebugInfo('status', this.running ? 'Running' : 'Stopped');

                // Update canvas state
                this.canvas.className = this.running ? '' : 'inactive';

                if (wasRunning !== this.running) {
                    this.showNotification(
                        this.running ? 'Click mapping started!' : 'Click mapping stopped',
                        this.running ? 'success' : 'info'
                    );
                }
                break;

            case 'reset':
                console.log('🗑️ Reset received');
                this.currentClusters = [];
                this.stats = { totalClicks: 0, uniqueUsers: 0 };
                this.renderClusters();
                this.updateDebugInfo('clicks', '0');
                this.updateDebugInfo('clusters', '0');
                this.showNotification('Map reset', 'info');
                break;
        }
    }

    /**
     * Start polling for data updates
     */
    startPolling() {
        if (this.pollInterval) return;

        console.log('⏰ Starting data polling...');

        // Initial fetch
        this.fetchHeatmapData();

        // Poll every 2 seconds
        this.pollInterval = setInterval(() => {
            this.fetchHeatmapData();
        }, 2000);
    }

    /**
     * Fetch heatmap data from server
     */
    async fetchHeatmapData() {
        if (!this.channelId) return;

        try {
            const url = `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`;
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
            this.processHeatmapData(data);

        } catch (error) {
            if (this.debugMode) {
                console.error('❌ Failed to fetch heatmap data:', error);
            }
        }
    }

    /**
     * Process heatmap data from server
     */
    processHeatmapData(data) {
        const wasRunning = this.running;
        this.running = data.running;

        // Update status if changed
        if (wasRunning !== this.running) {
            console.log(`📊 Status changed: ${this.running ? 'RUNNING' : 'STOPPED'}`);
            this.updateDebugInfo('status', this.running ? 'Running' : 'Stopped');
            this.canvas.className = this.running ? '' : 'inactive';
        }

        // Update statistics
        this.stats = {
            totalClicks: data.totalClicks || 0,
            uniqueUsers: data.uniqueUsers || 0
        };

        this.updateDebugInfo('clicks', this.stats.totalClicks.toString());

        // Process clicks and create clusters
        if (data.rawClicks && Array.isArray(data.rawClicks)) {
            console.log(`📊 Processing ${data.rawClicks.length} raw clicks`);
            this.processClicks(data.rawClicks);
        } else if (data.blobs && Array.isArray(data.blobs)) {
            // Fallback to server-provided clusters
            console.log(`📊 Using ${data.blobs.length} server-provided clusters`);
            this.currentClusters = this.convertServerBlobs(data.blobs);
            this.renderClusters();
        } else {
            // No data
            this.currentClusters = [];
            this.renderClusters();
        }

        this.updateDebugInfo('clusters', this.currentClusters.length.toString());
    }

    /**
     * Process raw clicks and create clusters using our clustering engine
     */
    processClicks(rawClicks) {
        const startTime = performance.now();

        try {
            console.log('🧮 Running Ex Machina clustering algorithm...');

            // Use our advanced clustering engine from heatmap.js
            this.currentClusters = this.clusterer.clusterPoints(rawClicks);

            const clusterTime = performance.now() - startTime;

            console.log(`✅ Generated ${this.currentClusters.length} clusters in ${clusterTime.toFixed(1)}ms`);

            // Render the clusters
            this.renderClusters();

        } catch (error) {
            console.error('❌ Clustering error:', error);
            // Fallback to simple visualization
            this.createSimpleVisualization(rawClicks);
        }
    }

    /**
     * Render clusters using our Ex Machina renderer
     */
    renderClusters() {
        try {
            console.log(`🎨 Rendering ${this.currentClusters.length} clusters...`);
            this.renderer.renderClusters(this.currentClusters);
        } catch (error) {
            console.error('❌ Rendering error:', error);
        }
    }

    /**
     * Fallback simple visualization when clustering fails
     */
    createSimpleVisualization(rawClicks) {
        console.log('⚠️ Using fallback simple visualization');

        if (!rawClicks || rawClicks.length === 0) {
            this.currentClusters = [];
            this.renderClusters();
            return;
        }

        // Create simple clusters for fallback
        const clusters = [];
        const totalClicks = rawClicks.length;

        // Group clicks by proximity (simple algorithm)
        const processed = new Set();

        rawClicks.forEach((click, i) => {
            if (processed.has(i)) return;

            const cluster = {
                id: `simple_cluster_${clusters.length}`,
                points: [click],
                centroid: { x: click.x, y: click.y },
                count: 1
            };

            // Find nearby clicks
            for (let j = i + 1; j < rawClicks.length; j++) {
                if (processed.has(j)) continue;

                const distance = Math.sqrt(
                    Math.pow(click.x - rawClicks[j].x, 2) +
                    Math.pow(click.y - rawClicks[j].y, 2)
                );

                if (distance < 0.08) { // 8% of screen distance
                    cluster.points.push(rawClicks[j]);
                    cluster.count++;
                    processed.add(j);
                }
            }

            // Recalculate centroid
            if (cluster.count > 1) {
                cluster.centroid.x = cluster.points.reduce((sum, p) => sum + p.x, 0) / cluster.count;
                cluster.centroid.y = cluster.points.reduce((sum, p) => sum + p.y, 0) / cluster.count;
            }

            cluster.percentage = Math.round((cluster.count / totalClicks) * 100);

            // Create simple polygon (circle)
            cluster.polygon = this.createCirclePolygon(cluster.centroid, 0.05);

            if (cluster.percentage >= 8) { // Only show 8%+ clusters
                clusters.push(cluster);
                processed.add(i);
            }
        });

        // Sort by percentage and mark top
        clusters.sort((a, b) => b.percentage - a.percentage);
        clusters.forEach((cluster, index) => {
            cluster.rank = index + 1;
            cluster.isTop = index === 0;
        });

        this.currentClusters = clusters.slice(0, 8);
        this.renderClusters();
    }

    /**
     * Convert server blobs to our format (fallback)
     */
    convertServerBlobs(serverBlobs) {
        return serverBlobs.map((blob, index) => ({
            id: `server_cluster_${index}`,
            points: [{ x: blob.x, y: blob.y }],
            polygon: this.createCirclePolygon({ x: blob.x, y: blob.y }, 0.05),
            centroid: { x: blob.x, y: blob.y },
            count: blob.count || 1,
            percentage: blob.pct || blob.percentage || 0,
            isTop: blob.isTop || false,
            rank: blob.rank || null
        }));
    }

    /**
     * Create circle polygon (utility function)
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
     * Handle canvas clicks
     */
    handleCanvasClick(event) {
        console.log('👆 Canvas clicked!');

        // Check if system is running
        if (!this.running) {
            console.log('⚠️ Click ignored - system not running');
            this.showNotification('Click mapping is not active', 'warning');
            return;
        }

        // Check authorization
        if (!this.authToken && this.channelId.startsWith('test') === false && this.channelId !== 'standalone_test') {
            console.log('⚠️ Click ignored - not authorized');
            this.showNotification('Not authorized to click', 'error');
            return;
        }

        // Calculate click coordinates
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

        // Show immediate visual feedback
        this.showClickRipple(event.clientX, event.clientY);
    }

    /**
     * Send click to server
     */
    async sendClick(x, y) {
        try {
            console.log(`📤 Sending click to server: (${x.toFixed(3)}, ${y.toFixed(3)})`);

            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.authToken ? `Bearer ${this.authToken}` : ''
                },
                body: JSON.stringify({ x, y })
            });

            if (response.ok) {
                console.log('✅ Click sent successfully!');
                this.showNotification('Click registered!', 'success');

                // Trigger immediate data update
                setTimeout(() => this.fetchHeatmapData(), 200);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.log(`❌ Click failed: ${response.status} - ${errorData.error || 'Unknown'}`);
                this.showNotification(errorData.error || 'Click failed', 'error');
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
            this.handleCanvasClick(e);
        });

        // Touch support for mobile
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();

            if (e.changedTouches.length === 1) {
                const touch = e.changedTouches[0];
                const rect = this.canvas.getBoundingClientRect();
                const x = (touch.clientX - rect.left) / rect.width;
                const y = (touch.clientY - rect.top) / rect.height;

                if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                    console.log('📱 Touch click:', x.toFixed(3), y.toFixed(3));
                    this.sendClick(x, y);
                    this.showClickRipple(touch.clientX, touch.clientY);
                }
            }
        });

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Debug keyboard shortcuts
        if (this.debugMode) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 't' && e.ctrlKey) {
                    console.log('🧪 Test click triggered via keyboard');
                    this.sendClick(0.5, 0.5);
                    e.preventDefault();
                }

                if (e.key === 'c' && e.ctrlKey) {
                    console.log('🧹 Canvas clear requested');
                    this.renderer.clearCanvas();
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
     * Handle context changes (fullscreen, etc.)
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
                if (navigator.onLine && this.channelId) {
                    console.log(`🔄 Reconnecting WebSocket (attempt ${this.reconnectAttempts})`);
                    this.connectWebSocket();
                }
            }, delay);
        } else {
            console.log('❌ Max WebSocket reconnection attempts reached');
            this.updateDebugInfo('ws', 'Failed');
        }
    }

    /**
     * Handle online/offline events
     */
    handleOnline() {
        console.log('🌐 Connection restored');
        this.connectWebSocket();
        this.fetchHeatmapData();
    }

    handleOffline() {
        console.log('📴 Connection lost');
        this.updateDebugInfo('ws', 'Offline');
    }

    /**
     * Show click ripple effect
     */
    showClickRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = (x - 20) + 'px';
        ripple.style.top = (y - 20) + 'px';
        ripple.style.width = '40px';
        ripple.style.height = '40px';

        document.body.appendChild(ripple);

        setTimeout(() => {
            if (ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 600);
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        console.log(`📢 ${type.toUpperCase()}: ${message}`);

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
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
        }, type === 'success' ? 2000 : 3000);
    }

    /**
     * Update debug information
     */
    updateDebugInfo(key, value) {
        if (this.debugMode) {
            const element = document.getElementById(`debug-${key}`);
            if (element) {
                element.textContent = value;
            }
        }
    }

    /**
     * Cleanup and destroy
     */
    destroy() {
        console.log('🧹 Destroying Ex Machina ClickMap...');

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

        console.log('✅ Ex Machina ClickMap destroyed');
    }
}

// Initialize the system when DOM is ready
function initializeExMachina() {
    try {
        console.log('🎯 Starting Ex Machina Smart Click Maps initialization...');

        const exMachinaSystem = new ExMachinaSmartClickMap();

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            exMachinaSystem.destroy();
        });

        console.log('✅ Ex Machina Smart Click Maps loaded successfully!');

    } catch (error) {
        console.error('❌ Failed to initialize Ex Machina:', error);
    }
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExMachina);
} else {
    initializeExMachina();
}