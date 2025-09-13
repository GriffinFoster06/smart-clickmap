// frontend/overlay/overlay.js - Real-time priority with immediate state changes
// Never plays catch-up, responds instantly to stop/reset

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const POLL_INTERVAL = 5000;
    const STATUS_CHECK_INTERVAL = 15000;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // ========== LOAD RENDERERS ==========
    function loadRenderers() {
        return new Promise((resolve) => {
            let loadedCount = 0;
            let hasFastRenderer = false;
            
            // Load standard renderer first (fallback)
            const standardScript = document.createElement('script');
            standardScript.src = 'heatmap.js';
            standardScript.onload = () => {
                console.log('✅ Standard renderer loaded');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            standardScript.onerror = () => {
                console.error('❌ Failed to load standard renderer');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            document.head.appendChild(standardScript);
            
            // Try to load fast renderer
            const fastScript = document.createElement('script');
            fastScript.src = 'heatmap-fast.js';
            fastScript.onload = () => {
                console.log('✅ Fast renderer loaded');
                hasFastRenderer = true;
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            fastScript.onerror = () => {
                console.log('⚠️ Fast renderer not available');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            document.head.appendChild(fastScript);
        });
    }

    // ========== REAL-TIME OVERLAY ==========
    class RealTimeOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.ws = null;
            this.pollInterval = null;
            this.statusCheckInterval = null;
            
            // State tracking
            this.isGameRunning = false;
            this.lastVersion = 0;
            this.consecutiveErrors = 0;
            this.updateCount = 0;
            this.lastUpdate = 0;
            
            // WebSocket preference
            this.preferWebSocket = true;
            this.wsReconnectAttempts = 0;
            this.maxWsReconnects = 3;
            
            // Page visibility
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();
            
            console.log('🎯 Real-time overlay initializing...');
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('❌ No channel parameter');
                return;
            }
            
            // Load renderers
            const hasFastRenderer = await loadRenderers();
            this.setupRenderer(hasFastRenderer);
            
            // Try WebSocket first for real-time updates
            if (this.preferWebSocket) {
                this.connectWebSocket();
            } else {
                this.startPolling();
            }
            
            console.log(`🎯 Real-time overlay ready: ${this.channelId}`);
        }

        setupRenderer(useFastRenderer) {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('❌ Canvas not found');
                return;
            }
            
            // Use fast renderer if available
            if (useFastRenderer && window.FastHeatmapRenderer) {
                console.log('⚡ Using FAST renderer');
                this.renderer = new window.FastHeatmapRenderer(canvas);
            } else if (window.HeatmapRenderer) {
                console.log('🎨 Using standard renderer');
                this.renderer = new window.HeatmapRenderer(canvas);
            } else {
                console.error('❌ No renderer available');
                return;
            }
            
            // Set threshold
            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold && this.renderer.setThreshold) {
                this.renderer.setThreshold(parseInt(threshold, 10));
            }
        }

        // ========== WEBSOCKET FOR REAL-TIME ==========
        connectWebSocket() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                return;
            }
            
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            const fullUrl = `${wsUrl}/ws/${this.channelId}`;
            
            console.log(`🔌 Connecting WebSocket: ${fullUrl}`);
            
            try {
                this.ws = new WebSocket(fullUrl);
                
                this.ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    this.wsReconnectAttempts = 0;
                    this.consecutiveErrors = 0;
                    
                    // Stop polling if it was running
                    this.stopPolling();
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleRealtimeUpdate(data);
                    } catch (error) {
                        console.error('WebSocket parse error:', error);
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };
                
                this.ws.onclose = () => {
                    console.log('🔌 WebSocket closed');
                    this.ws = null;
                    
                    // Try to reconnect or fall back to polling
                    if (this.wsReconnectAttempts < this.maxWsReconnects && this.isPageVisible) {
                        this.wsReconnectAttempts++;
                        console.log(`Reconnect attempt ${this.wsReconnectAttempts}/${this.maxWsReconnects}`);
                        setTimeout(() => this.connectWebSocket(), 2000);
                    } else {
                        console.log('📡 Falling back to HTTP polling');
                        this.preferWebSocket = false;
                        this.startPolling();
                    }
                };
                
            } catch (error) {
                console.error('WebSocket connection failed:', error);
                this.preferWebSocket = false;
                this.startPolling();
            }
        }

        // ========== HANDLE REAL-TIME UPDATES ==========
        handleRealtimeUpdate(data) {
            const action = data.action;
            const version = data.version || 0;
            
            // IMMEDIATE ACTION HANDLING
            if (action === 'start') {
                console.log('🚀 START received - clearing display');
                this.isGameRunning = true;
                this.lastVersion = version;
                this.clearDisplay();
                return;
            }
            
            if (action === 'stop' || action === 'stop_clear') {
                console.log('🛑 STOP received - halting updates');
                this.isGameRunning = false;
                this.lastVersion = version;
                
                if (action === 'stop_clear') {
                    this.clearDisplay();
                } else {
                    // Show final state briefly then clear
                    this.updateVisualization(data, 'stop');
                    setTimeout(() => this.clearDisplay(), 2000);
                }
                return;
            }
            
            if (action === 'reset') {
                console.log('🗑️ RESET received - clearing everything');
                this.lastVersion = version;
                this.clearDisplay();
                return;
            }
            
            // Version check - ignore old updates
            if (version && version < this.lastVersion) {
                console.log(`Ignoring old update (v${version} < v${this.lastVersion})`);
                return;
            }
            
            // Update game state
            const wasRunning = this.isGameRunning;
            this.isGameRunning = data.running === true;
            
            if (wasRunning && !this.isGameRunning) {
                console.log('🛑 Game stopped');
                this.clearDisplay();
                return;
            }
            
            if (!wasRunning && this.isGameRunning) {
                console.log('🚀 Game started');
            }
            
            // Update visualization
            this.updateVisualization(data, 'realtime');
        }

        // ========== HTTP POLLING FALLBACK ==========
        startPolling() {
            this.stopPolling();
            
            if (!this.isPageVisible) return;
            
            this.consecutiveErrors = 0;
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll(); // Initial poll
            
            console.log(`📡 HTTP polling started (${POLL_INTERVAL}ms)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
                console.log('⏹️ Polling stopped');
            }
            
            if (this.statusCheckInterval) {
                clearInterval(this.statusCheckInterval);
                this.statusCheckInterval = null;
            }
        }

        async poll() {
            if (!this.isPageVisible) {
                this.stopPolling();
                return;
            }

            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                this.handleRealtimeUpdate(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                console.warn(`Poll error ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
                
                if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.error('❌ Too many errors');
                    this.stopPolling();
                    
                    // Try to reconnect WebSocket
                    if (this.preferWebSocket) {
                        this.connectWebSocket();
                    }
                }
            }
        }

        // ========== VISUALIZATION ==========
        updateVisualization(data, source = 'update') {
            if (!this.renderer) return;
            
            // Only update if game is running or it's a final state
            if (!this.isGameRunning && source !== 'stop') {
                return;
            }
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            // Log significant updates
            if (clusters.length > 0 || this.updateCount % 10 === 1) {
                const mode = data?.mode || 'UNKNOWN';
                console.log(`🎨 Update #${this.updateCount} (${source}): ${clusters.length} clusters, mode: ${mode}`);
            }
            
            // Update renderer
            this.renderer.updateClusters(clusters);
            
            // Update CSS
            document.body.classList.toggle('clickmap-active', this.isGameRunning);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }

        clearDisplay() {
            console.log('🧹 Clearing display');
            
            if (this.renderer) {
                this.renderer.updateClusters([]);
            }
            
            document.body.classList.remove('clickmap-active', 'clickmap-has-data');
        }

        // ========== VISIBILITY TRACKING ==========
        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible');
                    
                    // Reconnect if needed
                    if (this.preferWebSocket && !this.ws) {
                        this.connectWebSocket();
                    } else if (!this.preferWebSocket && !this.pollInterval) {
                        this.startPolling();
                    }
                } else {
                    console.log('🫥 Page hidden');
                    
                    // Disconnect to save resources
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                    }
                    this.stopPolling();
                }
            });
        }

        // ========== UTILITIES ==========
        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        getStatus() {
            const rendererStatus = this.renderer?.getStatus ? this.renderer.getStatus() : {};
            
            return {
                channelId: this.channelId,
                transport: this.ws ? 'WebSocket' : 'HTTP Polling',
                isGameRunning: this.isGameRunning,
                lastVersion: this.lastVersion,
                updateCount: this.updateCount,
                lastUpdate: this.lastUpdate,
                consecutiveErrors: this.consecutiveErrors,
                isPageVisible: this.isPageVisible,
                renderer: rendererStatus
            };
        }

        destroy() {
            console.log('🧹 Destroying overlay');
            
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            this.stopPolling();
            
            if (this.renderer && this.renderer.destroy) {
                this.renderer.destroy();
            }
            
            this.clearDisplay();
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new RealTimeOverlay();
            window.realtimeOverlay = overlay;
            
            // Global debugging commands
            window.overlayDebug = {
                status: () => overlay.getStatus(),
                clear: () => overlay.clearDisplay(),
                destroy: () => overlay.destroy(),
                reconnect: () => overlay.connectWebSocket()
            };
            
            console.log('🎯 Real-time overlay initialized');
            console.log('Debug commands: window.overlayDebug.status()');
            
        } catch (error) { 
            console.error('Failed to initialize overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
