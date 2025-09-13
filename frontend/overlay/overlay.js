// frontend/overlay/overlay.js - Complete implementation with immediate state control
// No catch-up behavior, instant clearing on state changes

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const POLL_INTERVAL = 3000; // Faster polling for responsiveness
    const STATUS_CHECK_INTERVAL = 10000;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const CONNECTION_TIMEOUT = 5000;

    // ========== LOAD RENDERERS ==========
    function loadRenderers() {
        return new Promise((resolve) => {
            let loadedCount = 0;
            let hasFastRenderer = false;
            
            // Load standard renderer first (fallback)
            const standardScript = document.createElement('script');
            standardScript.src = 'heatmap.js';
            standardScript.onload = () => {
                console.log('Standard renderer loaded');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            standardScript.onerror = () => {
                console.error('Failed to load standard renderer');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            document.head.appendChild(standardScript);
            
            // Try to load fast renderer
            const fastScript = document.createElement('script');
            fastScript.src = 'heatmap-fast.js';
            fastScript.onload = () => {
                console.log('Fast renderer loaded');
                hasFastRenderer = true;
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            fastScript.onerror = () => {
                console.log('Fast renderer not available');
                loadedCount++;
                if (loadedCount === 2) resolve(hasFastRenderer);
            };
            document.head.appendChild(fastScript);
        });
    }

    // ========== REAL-TIME OVERLAY WITH IMMEDIATE STATE CONTROL ==========
    class ImmediateStateOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.ws = null;
            this.pollInterval = null;
            
            // IMMEDIATE STATE CONTROL
            this.isGameRunning = false;
            this.lastVersion = 0;
            this.lastInstanceId = null;
            this.forceCleared = false; // Flag to prevent catch-up after clearing
            
            // Connection management
            this.consecutiveErrors = 0;
            this.updateCount = 0;
            this.lastUpdate = 0;
            this.connectionAttempts = 0;
            this.maxConnectionAttempts = 5;
            
            // WebSocket preference and management
            this.preferWebSocket = true;
            this.wsReconnectAttempts = 0;
            this.maxWsReconnects = 3;
            this.wsConnectionTimeout = null;
            
            // Page visibility tracking
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();
            
            console.log('Immediate state overlay initializing...');
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('No channel parameter');
                return;
            }
            
            // Load renderers
            const hasFastRenderer = await loadRenderers();
            this.setupRenderer(hasFastRenderer);
            
            // Start with immediate clearing
            this.immediatelyClear();
            
            // Try WebSocket first for real-time updates
            if (this.preferWebSocket) {
                this.connectWebSocket();
            } else {
                this.startPolling();
            }
            
            console.log(`Real-time overlay ready: ${this.channelId}`);
        }

        setupRenderer(useFastRenderer) {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('Canvas not found');
                return;
            }
            
            // Use fast renderer if available
            if (useFastRenderer && window.FastHeatmapRenderer) {
                console.log('Using FAST renderer');
                this.renderer = new window.FastHeatmapRenderer(canvas);
            } else if (window.HeatmapRenderer) {
                console.log('Using standard renderer');
                this.renderer = new window.HeatmapRenderer(canvas);
            } else {
                console.error('No renderer available');
                return;
            }
            
            // Set threshold from URL params
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
            
            console.log(`Connecting WebSocket: ${fullUrl}`);
            
            // Set connection timeout
            this.wsConnectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                    console.log('WebSocket connection timeout');
                    this.ws.close();
                    this.fallbackToPolling();
                }
            }, CONNECTION_TIMEOUT);
            
            try {
                this.ws = new WebSocket(fullUrl);
                
                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.wsReconnectAttempts = 0;
                    this.consecutiveErrors = 0;
                    this.connectionAttempts = 0;
                    
                    if (this.wsConnectionTimeout) {
                        clearTimeout(this.wsConnectionTimeout);
                        this.wsConnectionTimeout = null;
                    }
                    
                    // Stop polling if it was running
                    this.stopPolling();
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleImmediateUpdate(data);
                    } catch (error) {
                        console.error('WebSocket parse error:', error);
                    }
                };
                
                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    if (this.wsConnectionTimeout) {
                        clearTimeout(this.wsConnectionTimeout);
                        this.wsConnectionTimeout = null;
                    }
                };
                
                this.ws.onclose = (event) => {
                    console.log(`WebSocket closed: ${event.code} ${event.reason}`);
                    this.ws = null;
                    
                    if (this.wsConnectionTimeout) {
                        clearTimeout(this.wsConnectionTimeout);
                        this.wsConnectionTimeout = null;
                    }
                    
                    // Try to reconnect or fall back to polling
                    if (this.wsReconnectAttempts < this.maxWsReconnects && this.isPageVisible) {
                        this.wsReconnectAttempts++;
                        console.log(`Reconnect attempt ${this.wsReconnectAttempts}/${this.maxWsReconnects}`);
                        setTimeout(() => this.connectWebSocket(), 2000 * this.wsReconnectAttempts);
                    } else {
                        console.log('Falling back to HTTP polling');
                        this.fallbackToPolling();
                    }
                };
                
            } catch (error) {
                console.error('WebSocket connection failed:', error);
                if (this.wsConnectionTimeout) {
                    clearTimeout(this.wsConnectionTimeout);
                    this.wsConnectionTimeout = null;
                }
                this.fallbackToPolling();
            }
        }

        fallbackToPolling() {
            this.preferWebSocket = false;
            this.startPolling();
        }

        // ========== IMMEDIATE STATE UPDATE HANDLING - FIXED ==========
        handleImmediateUpdate(data) {
            const action = data.action;
            const version = data.version || 0;
            const instanceId = data.instanceId;
            
            // Detect instance changes during autoscaling
            if (this.lastInstanceId && this.lastInstanceId !== instanceId) {
                console.log(`Instance changed: ${this.lastInstanceId} -> ${instanceId}`);
            }
            this.lastInstanceId = instanceId;
            
            // IMMEDIATE ACTION HANDLING - SIMPLIFIED
            if (action === 'start') {
                console.log('START received - enabling overlay');
                this.isGameRunning = true;
                this.lastVersion = version;
                this.immediatelyClear(); // Clear old data
                return;
            }
            
            if (action === 'stop') {
                console.log('STOP received - disabling overlay');
                this.isGameRunning = false;
                this.lastVersion = version;
                this.immediatelyClear(); // Clear and stay cleared
                return;
            }
            
            if (action === 'reset') {
                console.log('RESET received - clearing data');
                this.lastVersion = version;
                this.immediatelyClear(); // Just clear data, keep running state
                return;
            }
            
            // Version check - ignore old updates
            if (version && version < this.lastVersion) {
                console.log(`Ignoring old update (v${version} < v${this.lastVersion})`);
                return;
            }
            
            // Update game state from data
            const wasRunning = this.isGameRunning;
            const newRunning = data.running === true;
            
            // Handle state transitions
            if (wasRunning !== newRunning) {
                console.log(`State change: ${wasRunning} -> ${newRunning}`);
                this.isGameRunning = newRunning;
                
                if (!newRunning) {
                    this.immediatelyClear();
                    return;
                }
            }
            
            this.isGameRunning = newRunning;
            this.lastVersion = version;
            
            // Always update visualization if running
            if (this.isGameRunning) {
                this.updateVisualization(data, 'realtime');
            } else {
                this.immediatelyClear();
            }
        }

        // ========== HTTP POLLING FALLBACK ==========
        startPolling() {
            this.stopPolling();
            
            if (!this.isPageVisible) return;
            
            this.consecutiveErrors = 0;
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll(); // Initial poll
            
            console.log(`HTTP polling started (${POLL_INTERVAL}ms)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
                console.log('Polling stopped');
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
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(CONNECTION_TIMEOUT)
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                this.handleImmediateUpdate(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                console.warn(`Poll error ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
                
                if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.error('Too many polling errors');
                    this.stopPolling();
                    
                    // Try to reconnect WebSocket after polling fails
                    if (this.preferWebSocket || this.connectionAttempts < this.maxConnectionAttempts) {
                        this.connectionAttempts++;
                        setTimeout(() => {
                            console.log(`Retry connection attempt ${this.connectionAttempts}`);
                            this.connectWebSocket();
                        }, 5000);
                    }
                }
            }
        }

        // ========== VISUALIZATION ==========
        updateVisualization(data, source = 'update') {
            if (!this.renderer) return;
            
            // Never update if force-cleared or not running
            if (this.forceCleared || !this.isGameRunning) {
                return;
            }
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            // Log significant updates
            if (clusters.length > 0 || this.updateCount % 20 === 1) {
                const mode = data?.mode || 'UNKNOWN';
                const instanceId = data?.instanceId || 'unknown';
                console.log(`Update #${this.updateCount} (${source}): ${clusters.length} clusters, mode: ${mode}, instance: ${instanceId}`);
            }
            
            // Update renderer
            this.renderer.updateClusters(clusters);
            
            // Update CSS classes
            document.body.classList.toggle('clickmap-active', this.isGameRunning);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }

        // ========== IMMEDIATE CLEAR ==========
        immediatelyClear() {
            console.log('IMMEDIATE CLEAR - no catch-up allowed');
            
            if (this.renderer) {
                this.renderer.updateClusters([]);
            }
            
            document.body.classList.remove('clickmap-active', 'clickmap-has-data');
            
            // Set flags to prevent any catch-up behavior
            this.forceCleared = true;
            this.lastUpdate = Date.now();
        }

        // ========== VISIBILITY TRACKING ==========
        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('Page visible - reconnecting');
                    
                    // Reset connection attempts when page becomes visible
                    this.connectionAttempts = 0;
                    this.consecutiveErrors = 0;
                    
                    // Reconnect based on preference
                    if (this.preferWebSocket && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                        this.connectWebSocket();
                    } else if (!this.preferWebSocket && !this.pollInterval) {
                        this.startPolling();
                    }
                } else {
                    console.log('Page hidden - disconnecting to save resources');
                    
                    // Disconnect to save resources
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                    }
                    this.stopPolling();
                    
                    if (this.wsConnectionTimeout) {
                        clearTimeout(this.wsConnectionTimeout);
                        this.wsConnectionTimeout = null;
                    }
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
                forceCleared: this.forceCleared,
                lastVersion: this.lastVersion,
                lastInstanceId: this.lastInstanceId,
                updateCount: this.updateCount,
                lastUpdate: this.lastUpdate,
                consecutiveErrors: this.consecutiveErrors,
                connectionAttempts: this.connectionAttempts,
                isPageVisible: this.isPageVisible,
                preferWebSocket: this.preferWebSocket,
                renderer: rendererStatus
            };
        }

        // ========== MANUAL CONTROL (for debugging) ==========
        forceReconnect() {
            console.log('Force reconnect requested');
            this.connectionAttempts = 0;
            this.consecutiveErrors = 0;
            
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            this.stopPolling();
            
            // Try WebSocket first
            this.preferWebSocket = true;
            this.connectWebSocket();
        }

        forceClear() {
            console.log('Force clear requested');
            this.immediatelyClear();
        }

        forceUpdate() {
            console.log('Force update requested');
            if (this.pollInterval) {
                this.poll();
            } else {
                this.forceReconnect();
            }
        }

        // ========== CLEANUP ==========
        destroy() {
            console.log('Destroying overlay');
            
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            this.stopPolling();
            
            if (this.wsConnectionTimeout) {
                clearTimeout(this.wsConnectionTimeout);
                this.wsConnectionTimeout = null;
            }
            
            if (this.renderer && this.renderer.destroy) {
                this.renderer.destroy();
            }
            
            this.immediatelyClear();
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new ImmediateStateOverlay();
            window.immediateOverlay = overlay;
            
            // Global debugging commands
            window.overlayDebug = {
                status: () => {
                    const status = overlay.getStatus();
                    console.table(status);
                    return status;
                },
                clear: () => overlay.forceClear(),
                reconnect: () => overlay.forceReconnect(),
                update: () => overlay.forceUpdate(),
                destroy: () => overlay.destroy(),
                
                // Quick status check
                info: () => {
                    const s = overlay.getStatus();
                    console.log(`${s.transport} | Running: ${s.isGameRunning} | Cleared: ${s.forceCleared} | Updates: ${s.updateCount} | Instance: ${s.lastInstanceId}`);
                }
            };
            
            console.log('Real-time overlay with immediate state control initialized');
            console.log('Debug: window.overlayDebug.info() for quick status');
            
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
