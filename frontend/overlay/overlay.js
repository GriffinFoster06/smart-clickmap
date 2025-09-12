// frontend/overlay/overlay.js - FIXED: Proper rendering + truly smart polling
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

    // ========== FULL HEATMAP RENDERER (restored from original) ==========
    class ReliableHeatmapRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: true });
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            
            // Enhanced animation system
            this.springs = new Map(); // key -> {x,y,r,p,seed,shape,density}
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            // Performance tracking
            this.lastUpdateTime = 0;
            this.frameCount = 0;
            this.fps = 60;

            this.resize();
            this.start();
            
            console.log('🎨 Reliable renderer initialized');
        }

        // ========== ANIMATION SYSTEM ==========
        _spring(value = 0, omega = 12, zeta = 0.9) { 
            return { x: value, v: 0, o: omega, z: zeta, t: value }; 
        }
        
        _stepSpring(s, dt) {
            const f = -s.o * s.o * (s.x - s.t) - 2 * s.z * s.o * s.v;
            s.v += f * dt; 
            s.x += s.v * dt; 
            return s.x;
        }
        
        _hashSeed(x, y, pct, count) {
            let h = 2166136261 >>> 0;
            const mix = (n) => { h ^= (n | 0); h = Math.imul(h, 16777619); };
            mix((x * 1e6) | 0); mix((y * 1e6) | 0);
            mix(((pct || 0) * 100) | 0); mix(count | 0);
            return (h >>> 0) / 4294967295;
        }
        
        _wobble(t, seed, base = 1.0, amp = 0.08) {
            const a1 = Math.sin(t * 0.8 + seed * 6.28318);
            const a2 = Math.sin(t * 1.2 + seed * 12.56636);
            const a3 = Math.sin(t * 0.5 + seed * 3.14159);
            const n = (a1 * 0.5 + a2 * 0.35 + a3 * 0.15);
            return base * (1.0 + amp * n);
        }

        start() {
            if (this.reduced) return;
            if (this.animationId) return;
            
            const loop = (ts) => {
                if (!this.lastTs) this.lastTs = ts;
                const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
                this.lastTs = ts;

                // FPS tracking for performance monitoring
                this.frameCount++;
                if (ts - this.lastUpdateTime > 1000) {
                    this.fps = Math.round(this.frameCount * 1000 / (ts - this.lastUpdateTime));
                    this.frameCount = 0;
                    this.lastUpdateTime = ts;
                }

                // Spring physics for smooth updates
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    
                    s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                    
                    // Smooth spring response
                    this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                    this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
                    
                    // Smoothly interpolate shape properties
                    const smoothing = Math.min(1, dt * 4);
                    s.density = s.density + (t.density - s.density) * smoothing;
                    s.eccentricity = s.eccentricity + (t.eccentricity - s.eccentricity) * smoothing;
                }

                this.render(ts / 1000);
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }

        stop() { 
            if (this.animationId) cancelAnimationFrame(this.animationId); 
            this.animationId = null; 
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render(performance.now() / 1000);
        }

        // ========== CLUSTER PROCESSING ==========
        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            console.log(`🎨 Rendering: ${filtered.length} clusters`);

            const nextTargets = new Map();
            for (const c of filtered) {
                // Use the backend's intelligent size calculation directly
                const visualRadius = c.visualSize || this.fallbackSizeCalculation(c);
                
                const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, { 
                    x: c.x, 
                    y: c.y, 
                    r: visualRadius, 
                    p: c.percentage || 0, 
                    count: c.count || 1,
                    density: c.density || 1,
                    eccentricity: c.eccentricity || 0
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        // Smooth spring response for HTTP polling
                        x: this._spring(c.x, 8, 0.9),
                        y: this._spring(c.y, 8, 0.9),
                        r: this._spring(visualRadius, 10, 0.85),
                        p: this._spring(c.percentage || 0, 6, 1.0),
                        seed,
                        density: c.density || 1,
                        eccentricity: c.eccentricity || 0
                    });
                }
            }
            
            // Remove old clusters
            for (const key of [...this.springs.keys()]) {
                if (!nextTargets.has(key)) this.springs.delete(key);
            }
            this.targets = nextTargets;

            if (this.reduced) {
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.x = s.x.t = t.x; s.x.v = 0;
                    s.y.x = s.y.t = t.y; s.y.v = 0;
                    s.r.x = s.r.t = t.r; s.r.v = 0;
                    s.p.x = s.p.t = t.p; s.p.v = 0;
                    s.density = t.density;
                    s.eccentricity = t.eccentricity;
                }
                this.render(performance.now() / 1000);
            }
        }

        fallbackSizeCalculation(cluster) {
            // Enhanced fallback calculation
            const baseSize = 65;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 140;
            const densityBonus = Math.min(45, (cluster.density || 1) * 10);
            const countBonus = Math.log10((cluster.count || 1) + 1) * 15;
            return Math.max(baseSize, Math.min(280, baseSize + activityBonus + densityBonus + countBonus));
        }

        // ========== RENDERING ENGINE ==========
        render(tSec = 0) {
            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, W, H);

            const drawables = [];
            for (const [key, s] of this.springs.entries()) {
                drawables.push({ 
                    key, 
                    cx: s.x.x * W, 
                    cy: s.y.x * H, 
                    radius: s.r.x, 
                    percentage: s.p.x, 
                    seed: s.seed,
                    density: s.density,
                    eccentricity: s.eccentricity
                });
            }
            
            // Sort by percentage for proper layering
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                // Enhanced wobble effects
                const baseWobbleAmp = this.reduced ? 0 : 0.04;
                const activityWobble = (d.percentage / 100) * 0.06;
                const eccentricityWobble = d.eccentricity * 0.03;
                
                const totalWobble = baseWobbleAmp + activityWobble + eccentricityWobble;
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, totalWobble);

                // Enhanced colors
                const colors = this.calculateColors(d, isTop);

                // Render shapes
                this.renderEnhancedCircle(d.cx, d.cy, r, colors, tSec, d.seed, isTop);
                
                // Enhanced label rendering
                this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        calculateColors(drawable, isTop) {
            const percentage = drawable.percentage;
            const density = drawable.density;
            
            if (isTop) {
                return {
                    fill: `rgba(0, 255, 255, 0.2)`,
                    border: `rgba(0, 255, 255, 0.85)`,
                    glow: `rgba(0, 255, 255, 0.6)`
                };
            } else if (percentage >= 25) {
                return {
                    fill: `rgba(147, 51, 234, 0.25)`,
                    border: `rgba(147, 51, 234, 0.9)`,
                    glow: `rgba(147, 51, 234, 0.5)`
                };
            } else {
                return {
                    fill: `rgba(147, 51, 234, 0.2)`,
                    border: `rgba(147, 51, 234, 0.75)`,
                    glow: `rgba(147, 51, 234, 0.35)`
                };
            }
        }

        renderEnhancedCircle(cx, cy, radius, colors, tSec, seed, isTop) {
            // Main circle
            this.ctx.fillStyle = colors.fill;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Border
            this.ctx.strokeStyle = colors.border;
            this.ctx.lineWidth = isTop ? 4 : 3;
            this.ctx.stroke();

            // Inner detail ring
            this.ctx.strokeStyle = colors.border.replace(/[\d\.]+\)$/g, '0.3)');
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, Math.max(2, radius - 8), 0, Math.PI * 2);
            this.ctx.stroke();
        }

        _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            // Enhanced font sizing for visibility
            const baseFontSize = Math.max(20, Math.min(52, radius * 0.38));
            const importanceBonus = isTop ? 6 : (percentage >= 25 ? 3 : 0);
            const fontSize = baseFontSize + importanceBonus;

            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Enhanced text rendering
            ctx.save();
            
            // Enhanced shadow for readability
            ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
            ctx.shadowBlur = Math.max(10, fontSize * 0.25);
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // Main text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(str, cx, cy);

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Enhanced outline
            const outlineWidth = isTop ? 2 : (percentage >= 25 ? 1.5 : 1);
            ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.95)' : 'rgba(147, 51, 234, 0.95)';
            ctx.lineWidth = outlineWidth;
            ctx.strokeText(str, cx, cy);
            
            // Extra glow for top cluster
            if (isTop) {
                ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
                ctx.shadowBlur = 18;
                ctx.fillText(str, cx, cy);
            }
            
            ctx.restore();
        }

        // ========== PUBLIC API ==========
        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        getFPS() { return this.fps; }
        destroy() { this.stop(); }
    }

    // ========== TRULY SMART OVERLAY CONTROLLER ==========
    class TrulySmartOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.pollInterval = null;
            this.consecutiveErrors = 0;
            this.maxRetries = 2; // Reduced from 3
            this.lastUpdateTime = 0;
            this.updateCount = 0;

            // ✅ FIXED SMART POLLING LOGIC
            this.isGameRunning = false;
            this.consecutiveInactivePolls = 0;
            this.maxInactivePolls = 1; // Stop after just 1 poll showing game is not running
            this.hasEverHadData = false;
            
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
            
            // Start with one poll to check status
            if (this.isPageVisible) {
                this.checkInitialStatus();
            }
            
            console.log(`🎯 Truly smart overlay initialized for: ${this.channelId}`);
        }

        async checkInitialStatus() {
            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.status === 429) {
                    console.log('🚫 Rate limited on initial check - will retry much later');
                    setTimeout(() => {
                        if (this.isPageVisible && !this.pollInterval) {
                            this.checkInitialStatus();
                        }
                    }, 300000); // 5 minutes
                    return;
                }
                
                if (!response.ok) {
                    console.log('❌ Backend not reachable - overlay will remain inactive');
                    this.scheduleStatusCheck();
                    return;
                }

                const data = await response.json();
                
                // ✅ ONLY START POLLING IF GAME IS ACTUALLY RUNNING
                if (data?.running === true) {
                    console.log('🎮 Game is active - starting polling');
                    this.isGameRunning = true;
                    this.startPolling();
                } else {
                    console.log('💤 Game is not running - overlay will wait');
                    this.scheduleStatusCheck();
                }
                
                // Always update visualization with initial data
                this.updateVisualization(data, 'initial');

            } catch (error) {
                console.log('❌ Failed to check initial status:', error.message);
                this.scheduleStatusCheck();
            }
        }

        scheduleStatusCheck() {
            // Check again in 5 minutes if game might have started
            setTimeout(() => {
                if (this.isPageVisible && !this.pollInterval) {
                    console.log('🔍 Scheduled status check...');
                    this.checkInitialStatus();
                }
            }, 300000); // 5 minutes instead of 30 seconds
        }

        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible');
                    if (this.isGameRunning && !this.pollInterval) {
                        this.startPolling();
                    } else if (!this.isGameRunning) {
                        this.checkInitialStatus();
                    }
                } else {
                    console.log('🫥 Page hidden - stopping polling');
                    this.stopPolling();
                }
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

        startPolling() {
            if (this.pollInterval) return;
            if (!this.isPageVisible) return;
            
            this.consecutiveInactivePolls = 0;
            this.consecutiveErrors = 0;
            
            this.pollInterval = setInterval(() => this.poll(), 3000); // 3 second polling when active
            console.log(`🚀 Polling started (3s interval)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
                console.log('⏹️ Polling stopped');
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
                
                if (response.status === 429) {
                    console.log('🚫 Rate limited - stopping polling and backing off');
                    this.isGameRunning = false;
                    this.stopPolling();
                    // Wait 10 minutes before checking again
                    setTimeout(() => {
                        if (this.isPageVisible && !this.pollInterval) {
                            console.log('🔍 Post-rate-limit status check...');
                            this.checkInitialStatus();
                        }
                    }, 600000); // 10 minutes
                    return;
                }
                
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
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            const gameRunning = data?.running === true;
            
            this.consecutiveErrors = 0; // Reset errors on successful poll
            
            // ✅ KEY FIX: Stop polling immediately when game becomes inactive
            if (!gameRunning) {
                this.consecutiveInactivePolls++;
                console.log(`🔍 Game inactive (${this.consecutiveInactivePolls}/${this.maxInactivePolls})`);
                
                if (this.consecutiveInactivePolls >= this.maxInactivePolls) {
                    console.log('🛑 Game confirmed inactive - stopping polling completely');
                    this.isGameRunning = false;
                    this.stopPolling();
                    this.scheduleStatusCheck(); // Check again in 5 minutes
                    return;
                }
            } else {
                this.consecutiveInactivePolls = 0;
                this.isGameRunning = true;
                if (clusters.length > 0) {
                    this.hasEverHadData = true;
                }
            }

            this.updateVisualization(data, 'poll');
        }

        handlePollError(error) {
            this.consecutiveErrors++;
            
            if (this.consecutiveErrors <= 2) {
                console.warn(`Connection issue ${this.consecutiveErrors}/3:`, error.message);
            }
            
            if (this.consecutiveErrors >= 2) {
                console.error('❌ Multiple errors - stopping polling to reduce load');
                this.stopPolling();
                this.scheduleStatusCheck();
            }
        }

        updateVisualization(data, source = 'poll') {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            this.updateCount++;
            
            if (clusters.length > 0 || this.updateCount % 10 === 1) {
                console.log(`🎨 Update #${this.updateCount} (${source}): ${clusters.length} clusters`);
            }
            
            // ✅ If we detect a state change action, and we're not currently polling, try to resume
            if ((data?.action === 'start' || data?.action === 'reset') && !this.pollInterval && this.isPageVisible) {
                console.log(`🔄 Detected ${data.action} action - attempting to resume polling`);
                this.isGameRunning = data?.running === true;
                if (this.isGameRunning) {
                    this.consecutiveErrors = 0;
                    this.consecutiveInactivePolls = 0;
                    this.startPolling();
                }
            }
            
            this.renderer.updateClusters(clusters);
            
            // Update body classes for CSS styling
            document.body.classList.toggle('clickmap-active', data?.running !== false);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }

        getStatus() {
            return {
                channelId: this.channelId,
                transport: 'Truly Smart HTTP',
                updateCount: this.updateCount,
                consecutiveErrors: this.consecutiveErrors,
                isGameRunning: this.isGameRunning,
                hasEverHadData: this.hasEverHadData,
                isPolling: !!this.pollInterval,
                isPageVisible: this.isPageVisible,
                consecutiveInactivePolls: this.consecutiveInactivePolls
            };
        }

        destroy() {
            this.stopPolling();
            if (this.renderer) {
                this.renderer.destroy();
            }
            console.log('🧹 Truly smart overlay destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new TrulySmartOverlay();
            window.smartOverlay = overlay; // For debugging
            console.log('🎯 Truly smart overlay loaded with aggressive rate limit protection');
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
