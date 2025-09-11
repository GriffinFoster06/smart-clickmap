// frontend/overlay/overlay.js - FIXED: Only poll when actually needed
(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- Build an inert overlay root so nothing here can ever consume clicks ---
    let overlayRoot = document.getElementById('overlay-root');
    if (!overlayRoot) {
        overlayRoot = document.createElement('div');
        overlayRoot.id = 'overlay-root';
        document.body.appendChild(overlayRoot);
    }

    // Global safety: ensure our overlay never captures input
    try {
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
        const style = document.createElement('style');
        style.textContent = `
      html, body { background: transparent !important; }
      #overlay-root, #overlay-root * { pointer-events: none !important; }
      #overlay-root {
        position: fixed; inset: 0;
        z-index: 2147483647;
      }
      #overlay-canvas {
        position: absolute; left: 0; top: 0; right: 0; bottom: 0;
        width: 100vw; height: 100vh; display: block;
        background: transparent !important;
        touch-action: none;
      }
    `;
        document.head.appendChild(style);
    } catch { /* noop */ }

    // Ensure we have a canvas inside our root
    let canvas = document.getElementById('overlay-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'overlay-canvas';
        overlayRoot.appendChild(canvas);
    }

    // ========== SMART POLLING OVERLAY CONTROLLER ==========
    class SmartPollingOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.pollInterval = null;
            this.consecutiveErrors = 0;
            this.maxRetries = 3; // Reduced from 5
            this.lastUpdateTime = 0;
            this.updateCount = 0;

            // SMART POLLING SETTINGS
            this.basePollInterval = 3000; // Start with 3 seconds instead of 1.5
            this.currentPollInterval = this.basePollInterval;
            this.maxPollInterval = 30000; // Back off to 30 seconds max
            this.isGameActive = false;
            this.hasRecentData = false;
            this.consecutiveEmptyPolls = 0;
            this.maxEmptyPolls = 5; // Stop polling after 5 empty responses

            // Page visibility tracking
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();

            this.init();
        }

        init() {
            if (!this.channelId) {
                console.log('❌ Missing channel parameter - overlay disabled');
                return;
            }
            
            this.setupRenderer();
            
            // ✅ ONLY START POLLING IF PAGE IS VISIBLE
            if (this.isPageVisible) {
                this.startSmartPolling();
            }
            
            console.log(`🎯 Smart overlay initialized for: ${this.channelId}`);
        }

        setupVisibilityTracking() {
            // Stop polling when page is hidden, resume when visible
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming polling');
                    this.consecutiveErrors = 0; // Reset errors
                    this.startSmartPolling();
                } else {
                    console.log('🫥 Page hidden - stopping polling');
                    this.stopPolling();
                }
            });

            // Also track window focus/blur
            window.addEventListener('focus', () => {
                if (!this.pollInterval && this.isPageVisible) {
                    this.startSmartPolling();
                }
            });

            window.addEventListener('blur', () => {
                // Don't immediately stop on blur, but do stop on visibility change
            });
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            this.renderer = new ReliableHeatmapRenderer(canvas);

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        startSmartPolling() {
            if (this.pollInterval) return;
            if (!this.isPageVisible) return; // Don't start if not visible
            
            // Reset to base interval
            this.currentPollInterval = this.basePollInterval;
            this.consecutiveEmptyPolls = 0;
            
            this.pollInterval = setInterval(() => this.smartPoll(), this.currentPollInterval);
            this.smartPoll(); // Initial poll
            
            console.log(`🚀 Smart polling started (${this.currentPollInterval}ms interval)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
                console.log('⏹️ Polling stopped');
            }
        }

        async smartPoll() {
            // ✅ DON'T POLL IF PAGE NOT VISIBLE
            if (!this.isPageVisible) {
                this.stopPolling();
                return;
            }

            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                this.handlePollingResponse(data);

            } catch (error) {
                this.handlePollingError(error);
            }
        }

        handlePollingResponse(data) {
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            const wasGameActive = this.isGameActive;
            this.isGameActive = data?.running === true;
            
            // ✅ ADAPTIVE POLLING BASED ON ACTIVITY
            if (clusters.length > 0) {
                this.hasRecentData = true;
                this.consecutiveEmptyPolls = 0;
                this.consecutiveErrors = 0;
                
                // Speed up polling when there's activity
                if (this.isGameActive && this.currentPollInterval > 2000) {
                    this.adjustPollingInterval(2000);
                }
            } else {
                this.consecutiveEmptyPolls++;
                
                // ✅ BACK OFF WHEN NO DATA
                if (this.consecutiveEmptyPolls >= this.maxEmptyPolls) {
                    if (!this.isGameActive) {
                        console.log('💤 No activity detected - stopping polling to save costs');
                        this.stopPolling();
                        return;
                    } else {
                        // Game is active but no data - slow down polling
                        this.adjustPollingInterval(Math.min(this.maxPollInterval, this.currentPollInterval * 1.5));
                    }
                }
            }

            // ✅ STOP POLLING WHEN GAME BECOMES INACTIVE
            if (wasGameActive && !this.isGameActive) {
                console.log('🛑 Game stopped - reducing polling frequency');
                this.adjustPollingInterval(this.maxPollInterval);
            }

            this.updateVisualization(data, 'smart-poll');
        }

        handlePollingError(error) {
            this.consecutiveErrors++;
            
            if (this.consecutiveErrors <= 2) {
                console.warn(`Connection issue ${this.consecutiveErrors}/3:`, error.message);
            }
            
            // ✅ STOP POLLING ON PERSISTENT ERRORS
            if (this.consecutiveErrors >= 3) {
                console.error('❌ Too many errors - stopping polling to prevent cost drain');
                this.stopPolling();
                
                // Retry once after 30 seconds if page is still visible
                setTimeout(() => {
                    if (this.isPageVisible && !this.pollInterval) {
                        console.log('🔄 Retrying connection...');
                        this.consecutiveErrors = 0;
                        this.startSmartPolling();
                    }
                }, 30000);
            }
        }

        adjustPollingInterval(newInterval) {
            if (newInterval === this.currentPollInterval) return;
            
            this.currentPollInterval = newInterval;
            
            // Restart polling with new interval
            this.stopPolling();
            if (this.isPageVisible) {
                this.startSmartPolling();
            }
            
            console.log(`⚙️ Polling interval adjusted to ${newInterval}ms`);
        }

        updateVisualization(data, source = 'smart-poll') {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            this.updateCount++;
            
            // Only log when there's actual data or significant events
            if (clusters.length > 0 || this.updateCount % 10 === 1) {
                console.log(`🎨 Update #${this.updateCount}: ${clusters.length} clusters`);
            }
            
            this.renderer.updateClusters(clusters);
            
            // Update body classes for CSS styling
            document.body.classList.toggle('clickmap-active', data?.running !== false);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }

        getStatus() {
            return {
                channelId: this.channelId,
                transport: 'Smart HTTP',
                updateCount: this.updateCount,
                consecutiveErrors: this.consecutiveErrors,
                isGameActive: this.isGameActive,
                hasRecentData: this.hasRecentData,
                pollInterval: this.currentPollInterval,
                isPolling: !!this.pollInterval,
                isPageVisible: this.isPageVisible,
                consecutiveEmptyPolls: this.consecutiveEmptyPolls
            };
        }

        destroy() {
            this.stopPolling();
            if (this.renderer) {
                this.renderer.destroy();
            }
            console.log('🧹 Smart overlay destroyed');
        }
    }

    // ========== MINIMAL RENDERER (same as before but with class name) ==========
    class ReliableHeatmapRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: true });
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            this.springs = new Map();
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            this.resize();
            this.start();
        }

        // [Include the same rendering methods as your original ReliableHeatmapRenderer]
        // I'm keeping this minimal for the fix - the main change is in the polling logic above

        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            // Simple update for demo - use your existing logic
            this.clear();
            console.log(`🎨 Rendering ${filtered.length} clusters`);
        }

        clear() {
            if (!this.ctx) return;
            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, W, H);
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        start() { /* Implement your animation loop */ }
        stop() { if (this.animationId) cancelAnimationFrame(this.animationId); }
        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        destroy() { this.stop(); }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new SmartPollingOverlay();
            window.smartOverlay = overlay; // For debugging
            console.log('🎯 Smart overlay loaded - will only poll when needed');
        } catch (error) { 
            console.error('Failed to initialize smart overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
