// frontend/overlay/overlay.js - FIXED CONNECTIVITY VERSION
// Ensures proper connection with fallback to HTTP polling

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const POLL_INTERVAL = 5000;
    const STATUS_CHECK_INTERVAL = 15000;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // ========== OVERLAY CONTROLLER ==========
    class SmartOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.ws = null;
            this.pollInterval = null;
            this.statusCheckInterval = null;
            
            // State
            this.isGameRunning = false;
            this.lastVersion = 0;
            this.consecutiveErrors = 0;
            this.updateCount = 0;
            this.lastUpdate = 0;
            
            // Connection preference
            this.useWebSocket = false; // Start with HTTP, upgrade if possible
            this.wsReconnectAttempts = 0;
            this.maxWsReconnects = 3;
            
            // Page visibility
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();
            
            console.log('🎯 Smart overlay initializing...');
            console.log(`📡 Backend: ${EBS}`);
            console.log(`📺 Channel: ${this.channelId || 'NONE'}`);
            
            this.init();
        }

        async init() {
            // Load renderers first
            await this.loadRenderers();
            
            // Setup renderer
            this.setupRenderer();
            
            // Start with HTTP polling (more reliable)
            this.startPolling();
            
            // Try WebSocket after initial connection
            setTimeout(() => {
                if (this.isPageVisible) {
                    this.tryWebSocketUpgrade();
                }
            }, 2000);
            
            console.log(`✅ Overlay initialized for channel: ${this.channelId || 'global'}`);
        }

        async loadRenderers() {
            console.log('Loading renderers...');
            
            // Load standard renderer (required)
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'heatmap.js';
                script.onload = () => {
                    console.log('✅ Standard renderer loaded');
                    resolve();
                };
                script.onerror = () => {
                    console.error('❌ Failed to load standard renderer');
                    resolve();
                };
                document.head.appendChild(script);
            });
            
            // Try to load fast renderer (optional)
            await new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'heatmap-fast.js';
                script.onload = () => {
                    console.log('✅ Fast renderer loaded');
                    resolve();
                };
                script.onerror = () => {
                    console.log('⚠️ Fast renderer not available');
                    resolve();
                };
                document.head.appendChild(script);
            });
        }

        setupRenderer() {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('❌ Canvas not found');
                return;
            }
            
            // Try fast renderer first
            if (window.FastHeatmapRenderer) {
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

        // ========== HTTP POLLING ==========
        startPolling() {
            this.stopPolling();
            
            if (!this.isPageVisible) return;
            
            console.log(`📡 Starting HTTP polling (${POLL_INTERVAL}ms intervals)`);
            
            this.consecutiveErrors = 0;
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll(); // Initial poll
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
                const url = this.channelId ? 
                    `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}` :
                    `${EBS}/heatmap`;
                    
                const response = await fetch(url, { 
                    method: 'GET',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    mode: 'cors',
                    cache: 'no-cache'
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                this.handleUpdate(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.handlePollError(error);
            }
        }

        handlePollError(error) {
            this.consecutiveErrors++;
            
            console.warn(`Poll error ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
            
            if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('❌ Too many polling errors');
                
                // Try to reconnect after a delay
                this.stopPolling();
                setTimeout(() => {
                    if (this.isPageVisible) {
                        console.log('🔄 Retrying connection...');
                        this.startPolling();
                    }
                }, 10000);
            }
        }

        // ========== WEBSOCKET UPGRADE ==========
        tryWebSocketUpgrade() {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                return;
            }
            
            if (!this.channelId) {
                console.log('No channel ID for WebSocket');
                return;
            }
            
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            const fullUrl = `${wsUrl}/ws/${this.channelId}`;
            
            console.log(`🔌 Attempting WebSocket connection: ${fullUrl}`);
            
            try {
                this.ws = new WebSocket(fullUrl);
                
                this.ws.onopen = () => {
                    console.log('✅ WebSocket connected!');
                    this.wsReconnectAttempts = 0;
                    this.consecutiveErrors = 0;
                    this.useWebSocket = true;
                    
                    // Stop polling since we have WebSocket
                    this.stopPolling();
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleUpdate(data);
                    } catch (error) {
                        console.error('WebSocket parse error:', error);
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };
                
                this.ws.onclose = () => {
                    console.log('🔌 WebSocket disconnected');
                    this.ws = null;
                    this.useWebSocket = false;
                    
                    // Fall back to polling
                    if (this.isPageVisible && !this.pollInterval) {
                        console.log('📡 Falling back to HTTP polling');
                        this.startPolling();
                    }
                    
                    // Try to reconnect WebSocket after delay
                    if (this.wsReconnectAttempts < this.maxWsReconnects) {
                        this.wsReconnectAttempts++;
                        setTimeout(() => {
                            if (this.isPageVisible) {
                                this.tryWebSocketUpgrade();
                            }
                        }, 5000);
                    }
                };
                
            } catch (error) {
                console.error('WebSocket connection failed:', error);
                this.useWebSocket = false;
                
                // Make sure polling is running
                if (!this.pollInterval) {
                    this.startPolling();
                }
            }
        }

        // ========== UPDATE HANDLING ==========
        handleUpdate(data) {
            if (!data) return;
            
            const action = data.action;
            const version = data.version || 0;
            
            // Handle actions
            if (action === 'start') {
                console.log('🚀 START received');
                this.isGameRunning = true;
                this.lastVersion = version;
                this.clearDisplay();
                return;
            }
            
            if (action === 'stop' || action === 'stop_clear') {
                console.log('🛑 STOP received');
                this.isGameRunning = false;
                this.lastVersion = version;
                
                if (action === 'stop_clear') {
                    this.clearDisplay();
                } else {
                    this.updateVisualization(data, 'stop');
                    setTimeout(() => this.clearDisplay(), 2000);
                }
                return;
            }
            
            if (action === 'reset') {
                console.log('🗑️ RESET received');
                this.lastVersion = version;
                this.clearDisplay();
                return;
            }
            
            // Version check
            if (version && version < this.lastVersion) {
                console.log(`Ignoring old update (v${version} < v${this.lastVersion})`);
                return;
            }
            
            // Update state
            const wasRunning = this.isGameRunning;
            this.isGameRunning = data.running === true;
            
            if (wasRunning && !this.isGameRunning) {
                console.log('Game stopped');
                setTimeout(() => this.clearDisplay(), 2000);
            }
            
            if (!wasRunning && this.isGameRunning) {
                console.log('Game started');
            }
            
            // Update visualization
            this.updateVisualization(data, this.useWebSocket ? 'websocket' : 'http');
        }

        updateVisualization(data, source = 'update') {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            // Log updates
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

        // ========== VISIBILITY ==========
        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming');
                    
                    if (this.useWebSocket && !this.ws) {
                        this.tryWebSocketUpgrade();
                    } else if (!this.pollInterval) {
                        this.startPolling();
                    }
                } else {
                    console.log('🫥 Page hidden - pausing');
                    
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
            const channel = params.get('channel') || params.get('c') || '';
            
            // Clean the channel ID
            return channel.replace(/[^a-zA-Z0-9_-]/g, '');
        }

        getStatus() {
            return {
                backend: EBS,
                channelId: this.channelId || 'global',
                transport: this.ws ? 'WebSocket' : 'HTTP Polling',
                isGameRunning: this.isGameRunning,
                lastVersion: this.lastVersion,
                updateCount: this.updateCount,
                lastUpdate: this.lastUpdate,
                consecutiveErrors: this.consecutiveErrors,
                isPageVisible: this.isPageVisible,
                renderer: this.renderer ? 'Active' : 'None'
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
            const overlay = new SmartOverlay();
            
            // Make available for debugging
            window.smartOverlay = overlay;
            window.overlayStatus = () => overlay.getStatus();
            window.overlayReconnect = () => overlay.tryWebSocketUpgrade();
            
            console.log('✅ Overlay ready!');
            console.log('Debug: window.overlayStatus()');
            
        } catch (error) { 
            console.error('Failed to initialize overlay:', error); 
        }
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
