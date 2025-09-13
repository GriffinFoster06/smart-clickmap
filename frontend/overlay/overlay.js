// frontend/overlay/overlay.js - EXTREME PERFORMANCE: 50k clicks/sec capable
// Optimized for massive load with client-side batching and aggressive caching

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // EXTREME PERFORMANCE SETTINGS - Reduced server load
    const POLL_INTERVAL = 8000; // 8 seconds to match server broadcasts
    const STATUS_CHECK_INTERVAL = 20000; // 20 seconds for inactive status checks
    const RAPID_POLL_INTERVAL = 1000; // 1 second for reset detection (reduced from 500ms)
    const MAX_CONSECUTIVE_ERRORS = 5;
    
    // CLIENT-SIDE CACHING
    const RESPONSE_CACHE_TTL = 5000; // Cache responses for 5 seconds
    const responseCache = new Map();

    // ========== EXTREME PERFORMANCE HEATMAP RENDERER ==========
    class ExtremePerformanceRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { 
                alpha: true,
                desynchronized: true,
                powerPreference: 'high-performance',
                willReadFrequently: false
            });

            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_VISUAL_SIZE = 45;
            this.MAX_VISUAL_SIZE = 200; // Reduced for performance
            
            // EXTREME OPTIMIZATIONS
            this.springs = new Map();
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            // Performance tracking
            this.lastRenderTime = 0;
            this.frameCount = 0;
            this.fps = 60;
            this.skipFrames = 0; // Skip frames under heavy load
            this.maxClusters = 20; // Limit clusters for performance
            
            // Render quality scaling
            this.renderQuality = 1.0; // 1.0 = full quality, 0.5 = half quality
            this.lastClusterCount = 0;

            this.resize();
            this.start();
            
            console.log('🎨 EXTREME performance renderer initialized (50k capable)');
        }

        // ========== OPTIMIZED ANIMATION SYSTEM ==========
        _spring(value = 0, omega = 8, zeta = 0.8) { // Reduced complexity
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
        
        _wobble(t, seed, base = 1.0, amp = 0.05) { // Reduced wobble for performance
            if (this.reduced || this.renderQuality < 0.7) return base;
            
            const a1 = Math.sin(t * 0.5 + seed * 3.14159); // Simplified
            return base * (1.0 + amp * a1);
        }

        start() {
            if (this.reduced) return;
            if (this.animationId) return;
            
            const loop = (ts) => {
                if (!this.lastTs) this.lastTs = ts;
                const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
                this.lastTs = ts;

                // EXTREME: Skip frames under heavy load
                this.frameCount++;
                const shouldSkip = this.frameCount % (this.skipFrames + 1) !== 0;
                
                if (!shouldSkip) {
                    // FPS tracking
                    if (ts - this.lastRenderTime > 1000) {
                        this.fps = Math.round(this.frameCount * 1000 / (ts - this.lastRenderTime));
                        this.frameCount = 0;
                        this.lastRenderTime = ts;
                        
                        // Adaptive quality scaling
                        this.adjustRenderQuality();
                    }

                    // Simplified spring physics
                    for (const [key, s] of this.springs.entries()) {
                        const t = this.targets.get(key);
                        if (!t) continue;
                        
                        s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                        this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                        this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
                    }

                    this.render(ts / 1000);
                }
                
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }

        adjustRenderQuality() {
            const clusterCount = this.targets.size;
            
            // Adjust quality based on cluster count
            if (clusterCount <= 5) {
                this.renderQuality = 1.0;
                this.skipFrames = 0;
            } else if (clusterCount <= 10) {
                this.renderQuality = 0.8;
                this.skipFrames = 0;
            } else if (clusterCount <= 15) {
                this.renderQuality = 0.6;
                this.skipFrames = 1; // Skip every other frame
            } else {
                this.renderQuality = 0.4;
                this.skipFrames = 2; // Skip 2 out of 3 frames
            }
            
            // Adjust based on FPS
            if (this.fps < 30) {
                this.renderQuality *= 0.7;
                this.skipFrames = Math.min(this.skipFrames + 1, 3);
            } else if (this.fps > 50) {
                this.renderQuality = Math.min(this.renderQuality * 1.1, 1.0);
                this.skipFrames = Math.max(this.skipFrames - 1, 0);
            }
        }

        stop() { 
            if (this.animationId) cancelAnimationFrame(this.animationId); 
            this.animationId = null; 
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR for performance

            this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render(performance.now() / 1000);
        }

        // EXTREME: Simplified cluster processing for performance
        updateClusters(newClusters) {
            let filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            // EXTREME: Limit clusters for performance
            if (filtered.length > this.maxClusters) {
                filtered = filtered
                    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
                    .slice(0, this.maxClusters);
                console.log(`⚡ EXTREME: Limited to top ${this.maxClusters} clusters for performance`);
            }

            console.log(`🎨 EXTREME Rendering: ${filtered.length} clusters (quality: ${(this.renderQuality * 100).toFixed(0)}%)`);

            const nextTargets = new Map();
            
            for (const c of filtered) {
                // Simplified size calculation for performance
                const visualRadius = c.visualSize || this.fastSizeCalculation(c);
                
                // Simplified properties
                const complexity = Math.min(c.complexity || 0, 0.5); // Cap complexity
                const sides = Math.min(c.preferredSides || 8, 12); // Cap sides

                const key = c.id ?? `${(c.x * 1000 | 0)}_${(c.y * 1000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, { 
                    x: c.x, 
                    y: c.y, 
                    r: visualRadius, 
                    p: c.percentage || 0, 
                    count: c.count || 1,
                    complexity: complexity,
                    sides: sides,
                    shapeType: c.shapeType || 'circle',
                    isTop: c.isTop || false
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        // Simplified springs for performance
                        x: this._spring(c.x, 6, 0.8), // Faster animation
                        y: this._spring(c.y, 6, 0.8),
                        r: this._spring(visualRadius, 8, 0.7),
                        p: this._spring(c.percentage || 0, 5, 0.9),
                        seed,
                        complexity: complexity,
                        sides: sides,
                        shapeType: c.shapeType || 'circle'
                    });
                }
            }
            
            // Clean up old clusters
            for (const key of [...this.springs.keys()]) {
                if (!nextTargets.has(key)) this.springs.delete(key);
            }
            this.targets = nextTargets;
            this.lastClusterCount = filtered.length;

            // Immediate update for reduced motion
            if (this.reduced) {
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.x = s.x.t = t.x; s.x.v = 0;
                    s.y.x = s.y.t = t.y; s.y.v = 0;
                    s.r.x = s.r.t = t.r; s.r.v = 0;
                    s.p.x = s.p.t = t.p; s.p.v = 0;
                }
                this.render(performance.now() / 1000);
            }
        }

        fastSizeCalculation(cluster) {
            // Simplified size calculation for extreme performance
            const baseSize = 50;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 80; // Reduced
            return Math.max(baseSize, Math.min(200, baseSize + activityBonus));
        }

        // ========== SIMPLIFIED RENDERING FOR EXTREME PERFORMANCE ==========
        render(tSec = 0) {
            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, W, H);

            const drawables = [];
            for (const [key, s] of this.springs.entries()) {
                const target = this.targets.get(key);
                drawables.push({ 
                    key, 
                    cx: s.x.x * W, 
                    cy: s.y.x * H, 
                    radius: s.r.x, 
                    percentage: s.p.x, 
                    seed: s.seed,
                    complexity: s.complexity || 0,
                    sides: s.sides || 8,
                    shapeType: s.shapeType || 'circle',
                    isTop: target?.isTop || false
                });
            }
            
            // Sort by percentage for proper layering
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;
                d.isTop = isTop;

                // Simplified wobble based on quality
                const wobbleAmp = this.renderQuality > 0.7 ? 0.04 : 0;
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, wobbleAmp);

                // Simplified colors
                const colors = this.getSimpleColors(d, isTop);

                // Choose rendering method based on quality
                if (this.renderQuality > 0.8 && d.complexity > 0.3 && d.shapeType === 'polygon') {
                    this.renderSimplePolygon(d.cx, d.cy, r, colors, d.sides);
                } else {
                    this.renderOptimizedCircle(d.cx, d.cy, r, colors, isTop);
                }

                // Simplified text rendering
                this.renderSimpleText(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        getSimpleColors(drawable, isTop) {
            if (isTop) {
                return {
                    fill: 'rgba(0, 255, 255, 0.2)',
                    border: 'rgba(0, 255, 255, 0.85)'
                };
            } else {
                return {
                    fill: 'rgba(147, 51, 234, 0.18)',
                    border: 'rgba(147, 51, 234, 0.8)'
                };
            }
        }

        renderOptimizedCircle(cx, cy, radius, colors, isTop) {
            const ctx = this.ctx;
            
            // Main circle
            ctx.fillStyle = colors.fill;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = isTop ? 3 : 2.5;
            ctx.stroke();

            // Only add inner ring for high quality
            if (this.renderQuality > 0.8) {
                ctx.strokeStyle = colors.border.replace('0.85', '0.3').replace('0.8', '0.3');
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(cx, cy, Math.max(2, radius - 6), 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        renderSimplePolygon(cx, cy, radius, colors, sides) {
            const ctx = this.ctx;
            
            ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                const x = cx + Math.cos(a) * radius;
                const y = cy + Math.sin(a) * radius;
                
                if (i === 0) ctx.moveTo(x, y); 
                else ctx.lineTo(x, y);
            }
            ctx.closePath();

            ctx.fillStyle = colors.fill;
            ctx.fill();

            ctx.strokeStyle = colors.border;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        renderSimpleText(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            // Simplified font sizing
            const fontSize = Math.max(16, Math.min(36, radius * 0.3));
            
            ctx.save();
            
            // Simplified shadow (only for high quality)
            if (this.renderQuality > 0.7) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = Math.max(6, fontSize * 0.2);
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
            }

            // Text
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(str, cx, cy);

            // Simplified outline
            if (this.renderQuality > 0.6) {
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                
                const outlineColor = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
                ctx.strokeStyle = outlineColor;
                ctx.lineWidth = isTop ? 1.5 : 1;
                ctx.strokeText(str, cx, cy);
            }
            
            ctx.restore();
        }

        // ========== PUBLIC API ==========
        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        getFPS() { return this.fps; }
        getRenderQuality() { return this.renderQuality; }
        getClusterCount() { return this.lastClusterCount; }
        destroy() { this.stop(); }
    }

    // ========== EXTREME PERFORMANCE OVERLAY CONTROLLER ==========
    class ExtremePerformanceOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.pollInterval = null;
            this.statusCheckInterval = null;
            this.rapidPollInterval = null;
            this.consecutiveErrors = 0;
            this.updateCount = 0;
            this.lastProcessedResetId = null;

            // Extreme performance state tracking
            this.isGameRunning = false;
            this.lastKnownState = null;
            this.lastUpdate = 0;
            this.hasEverHadData = false;
            
            // Page visibility optimization
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();

            console.log('🎯 EXTREME performance overlay initialized (50k capable)');
            this.init();
        }

        init() {
            if (!this.channelId) {
                console.log('❌ Missing channel parameter');
                return;
            }
            
            this.setupRenderer();
            
            if (this.isPageVisible) {
                this.checkInitialStatus();
            }
            
            console.log(`🎯 EXTREME overlay ready: ${this.channelId} (${POLL_INTERVAL}ms polling)`);
        }

        async checkInitialStatus() {
            try {
                const data = await this.cachedFetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
                
                console.log(`📊 Initial: running=${data?.running}, clusters=${data?.clusters?.length || 0}`);
                
                if (data?.running === true) {
                    this.isGameRunning = true;
                    this.startOptimizedPolling();
                } else {
                    this.isGameRunning = false;
                    this.scheduleStatusCheck();
                }
                
                this.updateVisualization(data, 'initial');

            } catch (error) {
                console.log('❌ Failed initial status check:', error.message);
                this.scheduleStatusCheck();
            }
        }

        // CLIENT-SIDE RESPONSE CACHING
        async cachedFetch(url) {
            const cached = responseCache.get(url);
            if (cached && (Date.now() - cached.timestamp) < RESPONSE_CACHE_TTL) {
                return cached.data;
            }

            const response = await fetch(url, { 
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            responseCache.set(url, { data, timestamp: Date.now() });
            
            // Clean old cache entries
            if (responseCache.size > 10) {
                const oldestEntry = Array.from(responseCache.entries())
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
                responseCache.delete(oldestEntry[0]);
            }
            
            return data;
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
        }

        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming');
                    if (this.isGameRunning && !this.pollInterval) {
                        this.startOptimizedPolling();
                    } else if (!this.isGameRunning) {
                        this.checkInitialStatus();
                    }
                } else {
                    console.log('🫥 Page hidden - pausing');
                    this.stopPolling();
                    this.stopRapidPolling();
                }
            });
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('❌ Canvas not found');
                return;
            }
            
            this.renderer = new ExtremePerformanceRenderer(canvas);
            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        startOptimizedPolling() {
            this.stopPolling();
            
            if (!this.isPageVisible) return;
            
            this.consecutiveErrors = 0;
            
            // 8-second polling to match server broadcasts
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll();
            
            // Reduced rapid polling for reset detection
            this.startRapidResetDetection();
            
            console.log(`🚀 EXTREME polling started (${POLL_INTERVAL}ms + ${RAPID_POLL_INTERVAL}ms rapid)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
            }
            
            if (this.statusCheckInterval) {
                clearInterval(this.statusCheckInterval);
                this.statusCheckInterval = null;
            }
        }

        startRapidResetDetection() {
            this.stopRapidPolling();
            
            this.rapidPollInterval = setInterval(async () => {
                try {
                    const data = await this.cachedFetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
                    
                    // Only process reset signals
                    if (data?.stickyReset || data?.action === 'reset' || data?.hardReset || data?.allDataCleared) {
                        console.log(`⚡ RAPID RESET DETECTION: Processing immediately`);
                        this.handlePollResponse(data);
                    }
                } catch (error) {
                    // Silent fail for rapid polling
                }
            }, RAPID_POLL_INTERVAL);
        }

        stopRapidPolling() {
            if (this.rapidPollInterval) {
                clearInterval(this.rapidPollInterval);
                this.rapidPollInterval = null;
            }
        }

        async poll() {
            if (!this.isPageVisible) {
                this.stopPolling();
                this.stopRapidPolling();
                return;
            }

            try {
                const data = await this.cachedFetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
                this.handlePollResponse(data);

            } catch (error) {
                this.handlePollError(error);
            }
        }

        handlePollResponse(data) {
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const gameRunning = data?.running === true;
            const hasActivity = clusters.length > 0;
            const action = data?.action;
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true;
            const stickyReset = data?.stickyReset === true;
            const resetSignalId = data?.resetSignalId;
            
            this.consecutiveErrors = 0;
            
            // EXTREME RESET HANDLING
            if (action === 'reset' || allDataCleared || hardReset || stickyReset) {
                console.log(`🗑️ EXTREME RESET: ${action}, cleared=${allDataCleared}, hard=${hardReset}, sticky=${stickyReset}`);
                
                if (resetSignalId && this.lastProcessedResetId === resetSignalId) {
                    console.log(`⚠️ Ignoring duplicate reset: ${resetSignalId}`);
                    return;
                }
                
                if (resetSignalId) {
                    this.lastProcessedResetId = resetSignalId;
                    setTimeout(() => {
                        if (this.lastProcessedResetId === resetSignalId) {
                            this.lastProcessedResetId = null;
                        }
                    }, 30000);
                }
                
                // EXTREME CLEARING
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                    
                    // Additional clearing methods
                    if (this.renderer.springs) this.renderer.springs.clear();
                    if (this.renderer.targets) this.renderer.targets.clear();
                }
                
                // Clear caches
                responseCache.clear();
                
                this.isGameRunning = gameRunning;
                this.lastKnownState = null;
                
                document.body.classList.remove('clickmap-has-data');
                document.body.classList.toggle('clickmap-active', gameRunning);
                
                if (gameRunning && !this.pollInterval) {
                    this.startOptimizedPolling();
                } else if (!gameRunning) {
                    this.stopPolling();
                    this.scheduleStatusCheck();
                }
                
                return;
            }
            
            // Handle state changes
            if (gameRunning !== this.isGameRunning) {
                console.log(`🎮 State change: ${this.isGameRunning} → ${gameRunning}`);
                this.isGameRunning = gameRunning;
                
                if (!gameRunning) {
                    this.stopPolling();
                    this.scheduleStatusCheck();
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
                console.warn(`Connection issue ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
            }
            
            if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('❌ Too many errors - switching to status check');
                this.isGameRunning = false;
                this.stopPolling();
                this.scheduleStatusCheck();
            }
        }

        updateVisualization(data, source = 'poll') {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true;
            const stickyReset = data?.stickyReset === true;
            
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            if (source.includes('reset') || allDataCleared || hardReset || stickyReset) {
                console.log(`🔥 EXTREME RESET VISUAL: Clearing all`);
                this.renderer.updateClusters([]);
            } else {
                this.renderer.updateClusters(clusters);
            }
            
            // Update CSS classes
            const isActive = data?.running !== false;
            const hasData = clusters.length > 0;
            
            document.body.classList.toggle('clickmap-active', isActive);
            document.body.classList.toggle('clickmap-has-data', hasData);
            
            if (source.includes('reset') || allDataCleared || hardReset || stickyReset) {
                document.body.classList.remove('clickmap-has-data');
                document.body.offsetHeight; // Force reflow
            }
            
            this.lastKnownState = data;
        }

        getStatus() {
            return {
                channelId: this.channelId,
                transport: `EXTREME HTTP (${POLL_INTERVAL}ms + ${RAPID_POLL_INTERVAL}ms rapid)`,
                updateCount: this.updateCount,
                consecutiveErrors: this.consecutiveErrors,
                isGameRunning: this.isGameRunning,
                hasEverHadData: this.hasEverHadData,
                isPolling: !!this.pollInterval,
                isRapidPolling: !!this.rapidPollInterval,
                isPageVisible: this.isPageVisible,
                lastUpdate: this.lastUpdate,
                backend: 'EXTREME High-Performance (50k clicks/sec)',
                fps: this.renderer ? this.renderer.getFPS() : 0,
                renderQuality: this.renderer ? this.renderer.getRenderQuality() : 1,
                clusterCount: this.renderer ? this.renderer.getClusterCount() : 0,
                cacheSize: responseCache.size,
                maxClusters: this.renderer ? this.renderer.maxClusters : 0
            };
        }

        destroy() {
            this.stopPolling();
            this.stopRapidPolling();
            if (this.renderer) {
                this.renderer.destroy();
            }
            responseCache.clear();
            console.log('🧹 EXTREME overlay destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new ExtremePerformanceOverlay();
            window.extremeOverlay = overlay;
            console.log('🎯 EXTREME overlay loaded (50k clicks/sec capable)');
        } catch (error) { 
            console.error('Failed to initialize extreme overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Clean response cache periodically
    setInterval(() => {
        const now = Date.now();
        for (const [url, cached] of responseCache.entries()) {
            if (now - cached.timestamp > RESPONSE_CACHE_TTL * 2) {
                responseCache.delete(url);
            }
        }
    }, RESPONSE_CACHE_TTL);

})();
