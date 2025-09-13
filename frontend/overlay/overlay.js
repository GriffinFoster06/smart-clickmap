// frontend/overlay/overlay.js - Updated to use fast renderer for performance
// Maintains compatibility while improving performance

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Polling settings - 5 second intervals
    const POLL_INTERVAL = 5000;
    const STATUS_CHECK_INTERVAL = 15000;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // ========== LOAD FAST RENDERER ==========
    function loadFastRenderer() {
        return new Promise((resolve) => {
            // Check if already loaded
            if (window.FastHeatmapRenderer) {
                resolve(true);
                return;
            }

            // Try to load the fast renderer
            const script = document.createElement('script');
            script.src = 'heatmap-fast.js';
            script.onload = () => {
                console.log('✅ Fast renderer loaded');
                resolve(true);
            };
            script.onerror = () => {
                console.log('⚠️ Fast renderer not available, using fallback');
                resolve(false);
            };
            document.head.appendChild(script);
        });
    }

    // ========== SMART OVERLAY CONTROLLER ==========
    class SmartOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.pollInterval = null;
            this.statusCheckInterval = null;
            this.consecutiveErrors = 0;
            this.updateCount = 0;

            this.isGameRunning = false;
            this.lastUpdate = 0;
            this.hasEverHadData = false;
            
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();

            console.log('🎯 Smart overlay initializing...');
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('❌ Missing channel parameter - overlay disabled');
                return;
            }
            
            // Try to load fast renderer
            const hasFastRenderer = await loadFastRenderer();
            
            // Setup renderer
            this.setupRenderer(hasFastRenderer);
            
            if (this.isPageVisible) {
                this.checkInitialStatus();
            }
            
            console.log(`🎯 Overlay ready: ${this.channelId} (${hasFastRenderer ? 'FAST' : 'STANDARD'} renderer)`);
        }

        setupRenderer(useFastRenderer) {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('❌ Canvas not found');
                return;
            }
            
            // Use fast renderer if available, otherwise fallback to original
            if (useFastRenderer && window.FastHeatmapRenderer) {
                console.log('⚡ Using FAST renderer for optimal performance');
                this.renderer = new window.FastHeatmapRenderer(canvas);
            } else if (window.HeatmapRenderer) {
                console.log('🎨 Using standard renderer');
                this.renderer = new window.HeatmapRenderer(canvas);
            } else {
                console.error('❌ No renderer available');
                return;
            }
            
            // Set threshold if provided in URL
            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold && this.renderer.setThreshold) {
                this.renderer.setThreshold(parseInt(threshold, 10));
            }
        }

        async checkInitialStatus() {
            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!response.ok) {
                    console.log('❌ Backend not reachable');
                    this.scheduleStatusCheck();
                    return;
                }

                const data = await response.json();
                
                console.log(`📊 Initial: running=${data?.running}, clusters=${data?.clusters?.length || 0}, mode=${data?.mode || 'UNKNOWN'}`);
                
                if (data?.running === true) {
                    console.log('🎮 Game active - starting polling');
                    this.isGameRunning = true;
                    this.startPolling();
                } else {
                    console.log('💤 Game inactive - periodic checks');
                    this.isGameRunning = false;
                    this.scheduleStatusCheck();
                }
                
                this.updateVisualization(data, 'initial');

            } catch (error) {
                console.log('❌ Initial check failed:', error.message);
                this.scheduleStatusCheck();
            }
        }

        scheduleStatusCheck() {
            if (this.statusCheckInterval) {
                clearInterval(this.statusCheckInterval);
            }
            
            this.statusCheckInterval = setInterval(() => {
                if (this.isPageVisible && !this.isGameRunning) {
                    this.checkInitialStatus();
                }
            }, STATUS_CHECK_INTERVAL);
            
            console.log(`⏰ Status checks every ${STATUS_CHECK_INTERVAL}ms`);
        }

        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming');
                    if (this.isGameRunning && !this.pollInterval) {
                        this.startPolling();
                    } else if (!this.isGameRunning) {
                        this.checkInitialStatus();
                    }
                } else {
                    console.log('🫥 Page hidden - pausing');
                    this.stopPolling();
                }
            });
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        startPolling() {
            this.stopPolling();
            
            if (!this.isPageVisible) return;
            
            this.consecutiveErrors = 0;
            
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll(); // Initial poll
            
            console.log(`🚀 Polling started (${POLL_INTERVAL}ms intervals)`);
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
                this.handlePollResponse(data);

            } catch (error) {
                this.handlePollError(error);
            }
        }

        handlePollResponse(data) {
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const gameRunning = data?.running === true;
            const hasActivity = clusters.length > 0;
            const mode = data?.mode || 'UNKNOWN';
            
            this.consecutiveErrors = 0;
            
            // Log mode changes
            if (this.updateCount % 5 === 0 || mode !== this.lastMode) {
                console.log(`📊 Server mode: ${mode} (${clusters.length} clusters)`);
                this.lastMode = mode;
            }
            
            // Handle game state changes
            if (gameRunning !== this.isGameRunning) {
                console.log(`🎮 State change: ${this.isGameRunning} → ${gameRunning}`);
                this.isGameRunning = gameRunning;
                
                if (!gameRunning) {
                    console.log('🛑 Game stopped');
                    this.stopPolling();
                    this.scheduleStatusCheck();
                    this.updateVisualization({ running: false, clusters: [] }, 'stopped');
                    return;
                }
            }
            
            if (hasActivity) {
                this.hasEverHadData = true;
            }

            this.updateVisualization(data, 'poll');
        }

        handlePollError(error) {
            this.consecutiveErrors++;
            
            if (this.consecutiveErrors <= 2) {
                console.warn(`Poll error ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
            }
            
            if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('❌ Too many errors - switching to status checks');
                this.isGameRunning = false;
                this.stopPolling();
                this.scheduleStatusCheck();
            }
        }

        updateVisualization(data, source = 'poll') {
            if (!this.renderer) return;
            
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
            
            // Update CSS classes
            document.body.classList.toggle('clickmap-active', data?.running !== false);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }

        getStatus() {
            const rendererStatus = this.renderer?.getStatus ? this.renderer.getStatus() : {};
            
            return {
                channelId: this.channelId,
                transport: 'HTTP Polling',
                updateCount: this.updateCount,
                consecutiveErrors: this.consecutiveErrors,
                isGameRunning: this.isGameRunning,
                hasEverHadData: this.hasEverHadData,
                isPolling: !!this.pollInterval,
                isPageVisible: this.isPageVisible,
                lastUpdate: this.lastUpdate,
                renderer: rendererStatus,
                pollInterval: POLL_INTERVAL
            };
        }

        destroy() {
            this.stopPolling();
            if (this.renderer && this.renderer.destroy) {
                this.renderer.destroy();
            }
            console.log('🧹 Overlay destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            // First load the original heatmap renderer as fallback
            const script = document.createElement('script');
            script.src = 'heatmap.js';
            script.onload = () => {
                console.log('✅ Standard renderer loaded');
                
                // Now initialize the overlay
                const overlay = new SmartOverlay();
                window.smartOverlay = overlay; // For debugging
                
                console.log('🎯 Smart overlay initialized');
            };
            script.onerror = () => {
                console.error('❌ Failed to load standard renderer');
            };
            document.head.appendChild(script);
            
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
