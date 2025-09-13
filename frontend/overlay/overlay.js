// frontend/overlay/overlay.js - OPTIMIZED for 5-second updates and ultra-high performance backend
// Matches server's 5-second broadcast cycle for maximum efficiency

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com'; // Your Render URL
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // OPTIMIZED POLLING SETTINGS - Match server's 5-second broadcast cycle
    const POLL_INTERVAL = 5000; // 5 seconds to match server broadcasts
    const STATUS_CHECK_INTERVAL = 15000; // 15 seconds for status checks when inactive
    const MAX_CONSECUTIVE_ERRORS = 3;

    // ========== PRESERVE ALL VISUAL FEATURES - ADVANCED HEATMAP RENDERER ==========
    class AdvancedHeatmapRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { 
                alpha: true,
                desynchronized: true,
                powerPreference: 'high-performance'
            });

            // Ensure this renderer never blocks clicks
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            
            // PRESERVE: Original sophisticated sizing bounds
            this.MIN_VISUAL_SIZE = 45;
            this.MAX_VISUAL_SIZE = 250;
            this.OPTIMAL_TEXT_SIZE = 85;

            // PRESERVE: Complete animation system with all features
            this.springs = new Map(); // key -> {x,y,r,p,seed,complexity,sides,shape}
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            // PRESERVE: Performance tracking
            this.lastRenderTime = 0;
            this.frameCount = 0;
            this.fps = 60;
            
            // Debug tracking
            this.lastDrawableCount = 0;

            this.resize();
            this.start();
            
            console.log('🎨 Advanced renderer with ALL features initialized (5-second optimized)');
        }

        // ========== PRESERVE: COMPLETE ANIMATION SYSTEM ==========
        _spring(value = 0, omega = 10, zeta = 1) { 
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
        
        _wobble(t, seed, base = 1.0, amp = 0.10) {
            if (this.reduced) return base;
            
            const a1 = Math.sin(t * 0.7 + seed * 6.28318);
            const a2 = Math.sin(t * 1.1 + seed * 12.56636);
            const a3 = Math.sin(t * 0.43 + seed * 3.14159);
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

                // FPS tracking
                this.frameCount++;
                if (ts - this.lastRenderTime > 1000) {
                    this.fps = Math.round(this.frameCount * 1000 / (ts - this.lastRenderTime));
                    this.frameCount = 0;
                    this.lastRenderTime = ts;
                }

                // PRESERVE: Complete spring physics system
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    
                    s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                    
                    // PRESERVE: All spring properties
                    s.complexity = t.complexity; 
                    s.sides = t.sides;
                    s.shapeType = t.shapeType;
                    s.eccentricity = t.eccentricity;
                    s.irregularity = t.irregularity;
                    
                    this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                    this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
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

        // PRESERVE: Complete cluster processing with ALL original features
        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            console.log(`🎨 Rendering: ${filtered.length} sophisticated clusters (5s interval)`);

            const nextTargets = new Map();
            
            for (const c of filtered) {
                // PRESERVE: Use backend's sophisticated visual size calculation
                const visualRadius = c.visualSize || this.fallbackSizeCalculation(c);
                
                // PRESERVE: All original cluster properties
                const complexity = c.complexity || c.irregularity || 0;
                const sides = c.preferredSides || this._decideSidesFromComplexity(complexity, c.percentage);
                const shapeType = c.shapeType || (complexity > 0.4 ? 'polygon' : 'circle');

                const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, { 
                    x: c.x, 
                    y: c.y, 
                    r: visualRadius, 
                    p: c.percentage || 0, 
                    count: c.count || 1,
                    complexity: complexity,
                    sides: sides,
                    shapeType: shapeType,
                    density: c.density || 1,
                    spread: c.spread || 0.05,
                    eccentricity: c.eccentricity || 0,
                    irregularity: c.irregularity || 0,
                    circularity: c.circularity || 1,
                    convexity: c.convexity || 1,
                    isSplit: c.isSplit || false,
                    isTop: c.isTop || false
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        // PRESERVE: Original spring configuration
                        x: this._spring(c.x, 9, 0.95),
                        y: this._spring(c.y, 9, 0.95),
                        r: this._spring(visualRadius, 12, 0.9),
                        p: this._spring(c.percentage || 0, 7, 1.0),
                        seed,
                        complexity: complexity,
                        sides: sides,
                        shapeType: shapeType,
                        eccentricity: c.eccentricity || 0,
                        irregularity: c.irregularity || 0,
                        density: c.density || 1
                    });
                }
            }
            
            // Clean up old clusters
            for (const key of [...this.springs.keys()]) {
                if (!nextTargets.has(key)) this.springs.delete(key);
            }
            this.targets = nextTargets;

            // Immediate update for reduced motion
            if (this.reduced) {
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.x = s.x.t = t.x; s.x.v = 0;
                    s.y.x = s.y.t = t.y; s.y.v = 0;
                    s.r.x = s.r.t = t.r; s.r.v = 0;
                    s.p.x = s.p.t = t.p; s.p.v = 0;
                    // PRESERVE: All properties
                    s.complexity = t.complexity; 
                    s.sides = t.sides;
                    s.shapeType = t.shapeType;
                    s.eccentricity = t.eccentricity;
                    s.irregularity = t.irregularity;
                    s.density = t.density;
                }
                this.render(performance.now() / 1000);
            }
        }

        // PRESERVE: Original intelligent sizing algorithm
        _decideSidesFromComplexity(complexity, percentage) {
            const complexityFactor = Math.max(0, Math.min(1, complexity));
            const percentageFactor = Math.min(1, percentage / 25);
            
            const combinedFactor = complexityFactor * 0.7 + percentageFactor * 0.3;
            const sides = Math.round(6 + combinedFactor * 12);
            
            return Math.max(6, Math.min(20, sides));
        }

        fallbackSizeCalculation(cluster) {
            // PRESERVE: Original fallback calculation
            const baseSize = 65;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 140;
            const densityBonus = Math.min(45, (cluster.density || 1) * 10);
            const countBonus = Math.log10((cluster.count || 1) + 1) * 15;
            return Math.max(baseSize, Math.min(280, baseSize + activityBonus + densityBonus + countBonus));
        }

        // ========== PRESERVE: COMPLETE RENDERING ENGINE WITH ALL VISUAL FEATURES ==========
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
                    eccentricity: s.eccentricity || 0,
                    irregularity: s.irregularity || 0,
                    density: s.density || 1,
                    isSplit: target?.isSplit || false,
                    isTop: target?.isTop || false
                });
            }
            
            // Sort by percentage for proper layering
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;
                d.isTop = isTop; // Update top status

                // PRESERVE: Original wobble effects with complexity
                const baseWobbleAmp = this.reduced ? 0 : 0.04;
                const activityWobble = (d.percentage / 100) * 0.08;
                const complexityWobble = d.complexity * 0.06;
                const eccentricityWobble = d.eccentricity * 0.03;
                
                const totalWobble = baseWobbleAmp + activityWobble + complexityWobble + eccentricityWobble;
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, totalWobble);

                // PRESERVE: Enhanced color system with all original features
                const colors = this.calculateAdvancedColors(d, isTop);

                // PRESERVE: Adaptive shape selection
                const usePolygon = this._shouldUsePolygon(d);
                if (usePolygon) {
                    this.renderAdvancedPolygonArea(d.cx, d.cy, r, colors, tSec, d.seed, d);
                } else {
                    this.renderEnhancedCircularArea(d.cx, d.cy, r, colors, isTop);
                }

                // PRESERVE: Advanced label rendering with off-screen detection
                this._renderAdvancedPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop, d.isSplit);
            }
        }

        // PRESERVE: All the original rendering methods
        _shouldUsePolygon(drawable) {
            if (this.reduced) return false;
            
            const complexityThreshold = 0.3;
            const percentageThreshold = 15;
            const sizeThreshold = 60;
            
            return (drawable.complexity > complexityThreshold) ||
                   (drawable.percentage > percentageThreshold && drawable.radius > sizeThreshold) ||
                   (drawable.shapeType === 'polygon');
        }

        calculateAdvancedColors(drawable, isTop) {
            const percentage = drawable.percentage;
            const complexity = drawable.complexity;
            
            if (isTop) {
                return {
                    fill: `rgba(0, 255, 255, ${0.15 + complexity * 0.1})`,
                    border: `rgba(0, 255, 255, 0.85)`,
                    glow: `rgba(0, 255, 255, 0.6)`
                };
            } else if (percentage >= 25) {
                return {
                    fill: drawable.isSplit ? 
                        `rgba(147, 51, 234, ${0.15 + complexity * 0.05})` : 
                        `rgba(147, 51, 234, ${0.2 + complexity * 0.05})`,
                    border: drawable.isSplit ? 
                        `rgba(147, 51, 234, 0.7)` : 
                        `rgba(147, 51, 234, 0.9)`,
                    glow: `rgba(147, 51, 234, 0.5)`
                };
            } else {
                return {
                    fill: drawable.isSplit ? 
                        `rgba(147, 51, 234, ${0.1 + complexity * 0.05})` : 
                        `rgba(147, 51, 234, ${0.15 + complexity * 0.05})`,
                    border: drawable.isSplit ? 
                        `rgba(147, 51, 234, 0.5)` : 
                        `rgba(147, 51, 234, 0.75)`,
                    glow: `rgba(147, 51, 234, 0.35)`
                };
            }
        }

        renderEnhancedCircularArea(cx, cy, radius, colors, isTop) {
            const ctx = this.ctx;
            
            // Main circle with enhanced effects
            ctx.fillStyle = colors.fill;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.fill();

            // PRESERVE: Multi-layer border system
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = isTop ? 4 : 3;
            ctx.stroke();

            // PRESERVE: Inner detail ring for depth
            ctx.strokeStyle = colors.border.replace(/[\d\.]+\)$/g, '0.3)');
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(2, radius - 8), 0, 2 * Math.PI);
            ctx.stroke();

            // PRESERVE: Glow effect for top clusters
            if (isTop) {
                ctx.save();
                ctx.shadowColor = colors.glow;
                ctx.shadowBlur = 15;
                ctx.strokeStyle = colors.border;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }
        }

        renderAdvancedPolygonArea(cx, cy, radius, colors, tSec, seed, drawable) {
            const ctx = this.ctx;
            const sides = drawable.sides;
            const complexity = drawable.complexity;
            const eccentricity = drawable.eccentricity;
            
            const irregularityFactor = complexity * 0.15;
            const eccentricityFactor = eccentricity * 0.2;
            
            ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                
                const baseWobble = this._wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
                const irregularWobble = this._wobble(tSec * 0.3 + i * 0.2, seed * 1.17, 1.0, irregularityFactor);
                const eccentricWobble = this._wobble(tSec * 0.5 + i * 0.15, seed * 1.41, 1.0, eccentricityFactor);
                
                const combinedRadius = radius * (
                    0.94 + 
                    0.08 * baseWobble + 
                    0.04 * irregularWobble + 
                    0.03 * eccentricWobble
                );
                
                const eccentricRadius = combinedRadius * (1 + eccentricity * Math.cos(a * 2) * 0.3);
                
                const x = cx + Math.cos(a) * eccentricRadius;
                const y = cy + Math.sin(a) * eccentricRadius;
                
                if (i === 0) ctx.moveTo(x, y); 
                else ctx.lineTo(x, y);
            }
            ctx.closePath();

            ctx.fillStyle = colors.fill;
            ctx.fill();

            ctx.strokeStyle = colors.border;
            ctx.lineWidth = 3;
            ctx.stroke();

            if (complexity > 0.5) {
                ctx.strokeStyle = colors.border.replace(/[\d\.]+\)$/g, '0.4)');
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // ========== PRESERVE: ADVANCED LABEL SYSTEM ==========
        _pointRectDistance(px, py, rx, ry, rw, rh) {
            const cx = Math.max(rx, Math.min(px, rx + rw));
            const cy = Math.max(ry, Math.min(py, ry + rh));
            const dx = px - cx;
            const dy = py - cy;
            return Math.hypot(dx, dy);
        }

        _computeAdvancedLabelLayoutCanvas(cx, cy, text, fontSize, radius) {
            const ctx = this.ctx;
            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);

            const textWidth = ctx.measureText(text).width;
            const boxW = Math.ceil(textWidth);
            const boxH = Math.ceil(fontSize);

            let lx = cx, ly = cy;
            const gutter = 8;
            const minX = gutter + boxW / 2;
            const maxX = W - gutter - boxW / 2;
            const minY = gutter + boxH / 2;
            const maxY = H - gutter - boxH / 2;

            const clampedLx = Math.max(minX, Math.min(maxX, lx));
            const clampedLy = Math.max(minY, Math.min(maxY, ly));

            const box = {
                x: Math.round(clampedLx - boxW / 2),
                y: Math.round(clampedLy - boxH / 2),
                w: boxW,
                h: boxH
            };

            const dist = this._pointRectDistance(cx, cy, box.x, box.y, box.w, box.h);
            const separated = dist > Math.max(0, radius - 4);

            return { box, center: { x: clampedLx, y: clampedLy }, separated };
        }

        _renderAdvancedPercentageLabelCanvas(cx, cy, percentage, radius, isTop, isSplit) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            const baseFontSize = Math.max(16, Math.min(44, radius * 0.35));
            const importanceBonus = isTop ? baseFontSize * 0.15 : (percentage >= 25 ? baseFontSize * 0.08 : 0);
            const fontSize = baseFontSize + importanceBonus;
            
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const layout = this._computeAdvancedLabelLayoutCanvas(cx, cy, str, fontSize, radius);

            if (layout.separated) {
                const ang = Math.atan2(layout.center.y - cy, layout.center.x - cx);
                const sx = cx + Math.cos(ang) * Math.max(0, radius - 6);
                const sy = cy + Math.sin(ang) * Math.max(0, radius - 6);

                const halfW = layout.box.w / 2, halfH = layout.box.h / 2;
                const ex = layout.center.x - Math.sign(Math.cos(ang)) * (halfW - 4);
                const ey = layout.center.y - Math.sign(Math.sin(ang)) * (halfH - 4);

                ctx.save();
                const lineColor = isTop ? 'rgba(0, 255, 255, 0.85)' : 'rgba(147, 51, 234, 0.85)';
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = isSplit ? 3 : 2.5;
                ctx.setLineDash([4, 2]);
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            ctx.save();
            
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = Math.max(10, fontSize * 0.25);
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            ctx.fillStyle = '#ffffff';
            ctx.fillText(str, layout.center.x, layout.center.y);

            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            const outlineWidth = isTop ? 2 : (isSplit ? 1.5 : 1);
            const outlineColor = isTop ? 'rgba(0, 255, 255, 0.95)' : 'rgba(147, 51, 234, 0.95)';
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = outlineWidth;
            ctx.strokeText(str, layout.center.x, layout.center.y);
            
            if (isTop) {
                ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
                ctx.shadowBlur = 18;
                ctx.fillText(str, layout.center.x, layout.center.y);
            }
            
            if (isSplit) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 0.5;
                ctx.strokeText(str, layout.center.x, layout.center.y);
            }
            
            ctx.restore();
        }

        // ========== PUBLIC API ==========
        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        getFPS() { return this.fps; }
        destroy() { this.stop(); }
    }

    // ========== OPTIMIZED OVERLAY CONTROLLER - 5 SECOND INTERVALS ==========
    class OptimizedSmartOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.pollInterval = null;
            this.statusCheckInterval = null;
            this.consecutiveErrors = 0;
            this.updateCount = 0;

            // Optimized state tracking
            this.isGameRunning = false;
            this.lastKnownState = null;
            this.lastUpdate = 0;
            this.hasEverHadData = false;
            
            // Page visibility optimization
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();

            console.log('🎯 Optimized overlay initialized (5-second intervals)');
            this.init();
        }

        init() {
            if (!this.channelId) {
                console.log('❌ Missing channel parameter - overlay disabled');
                return;
            }
            
            this.setupRenderer();
            
            if (this.isPageVisible) {
                this.checkInitialStatus();
            }
            
            console.log(`🎯 Optimized overlay ready: ${this.channelId} (${POLL_INTERVAL}ms polling)`);
        }

        async checkInitialStatus() {
            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (!response.ok) {
                    console.log('❌ Ultra-high performance backend not reachable');
                    this.scheduleStatusCheck();
                    return;
                }

                const data = await response.json();
                
                console.log(`📊 Initial status: running=${data?.running}, clusters=${data?.clusters?.length || 0}, frozen=${data?.frozen}`);
                
                if (data?.running === true) {
                    console.log('🎮 Game is active - starting optimized polling');
                    this.isGameRunning = true;
                    this.startOptimizedPolling();
                } else {
                    console.log('💤 Game is not running - will check periodically');
                    this.isGameRunning = false;
                    this.scheduleStatusCheck();
                    
                    // If we have existing clusters but game is not running, they might be frozen
                    if (data?.clusters?.length > 0) {
                        console.log('🧊 Found frozen clusters from stopped session');
                        data.frozen = true; // Mark as frozen for display
                    }
                }
                
                this.updateVisualization(data, 'initial');

            } catch (error) {
                console.log('❌ Failed to check initial status:', error.message);
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
            
            console.log(`⏰ Status check scheduled every ${STATUS_CHECK_INTERVAL}ms`);
        }

        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming optimized polling');
                    if (this.isGameRunning && !this.pollInterval) {
                        this.startOptimizedPolling();
                    } else if (!this.isGameRunning) {
                        this.checkInitialStatus();
                    }
                } else {
                    console.log('🫥 Page hidden - pausing all polling');
                    this.stopPolling();
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
            
            this.renderer = new AdvancedHeatmapRenderer(canvas);
            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        startOptimizedPolling() {
            this.stopPolling(); // Clean up any existing intervals
            
            if (!this.isPageVisible) return;
            
            this.consecutiveErrors = 0;
            
            // Start 5-second polling to match server broadcasts
            this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL);
            this.poll(); // Initial poll
            
            console.log(`🚀 Optimized polling started (${POLL_INTERVAL}ms intervals)`);
        }

        stopPolling() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
                console.log('⏹️ Optimized polling stopped');
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
            const isHardCutoff = data?.hardCutoff === true;
            const action = data?.action;
            const frozen = data?.frozen === true;
            const unfrozen = data?.unfrozen === true;
            const dataPreserved = data?.dataPreserved === true;
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true; // NEW: Enhanced reset signal
            
            this.consecutiveErrors = 0;
            
            // ENHANCED RESET HANDLING: Immediate and aggressive clearing
            if (action === 'reset' || allDataCleared || hardReset) {
                console.log(`🗑️ RESET DETECTED: action=${action}, allDataCleared=${allDataCleared}, hardReset=${hardReset}`);
                
                // FORCE IMMEDIATE CLEAR: Don't wait, clear everything now
                console.log('🔥 FORCE IMMEDIATE RESET: Clearing renderer immediately');
                
                // 1. Immediately clear the renderer
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                    
                    // 2. Force clear any cached/animated clusters
                    if (this.renderer.springs) {
                        this.renderer.springs.clear();
                    }
                    if (this.renderer.targets) {
                        this.renderer.targets.clear();
                    }
                    if (this.renderer.animatedClusters) {
                        this.renderer.animatedClusters.clear();
                    }
                    
                    // 3. Force a manual render to ensure canvas is cleared
                    if (this.renderer.ctx) {
                        const canvas = this.renderer.canvas;
                        const ctx = this.renderer.ctx;
                        const W = canvas.width / (window.devicePixelRatio || 1);
                        const H = canvas.height / (window.devicePixelRatio || 1);
                        ctx.clearRect(0, 0, W, H);
                        console.log('🧹 Canvas manually cleared');
                    }
                }
                
                // 4. Update state immediately
                this.isGameRunning = gameRunning;
                
                // 5. Clear any cached state
                this.lastKnownState = null;
                
                // 6. Update CSS classes
                document.body.classList.remove('clickmap-has-data');
                document.body.classList.toggle('clickmap-active', gameRunning);
                
                console.log('✅ RESET COMPLETE: All visualization cleared');
                
                // 7. Update polling strategy based on new state
                if (gameRunning && !this.pollInterval) {
                    console.log('🚀 RESET: Game is running, starting polling');
                    this.startOptimizedPolling();
                } else if (!gameRunning) {
                    console.log('💤 RESET: Game not running, switching to status checks');
                    this.stopPolling();
                    this.scheduleStatusCheck();
                }
                
                // 8. Store cleared state
                this.lastKnownState = {
                    running: gameRunning,
                    clusters: [],
                    totalClicks: 0,
                    uniqueUsers: 0,
                    coverage: 0,
                    frozen: false,
                    action: 'reset'
                };
                
                return; // Exit early for reset
            }
            
            // Handle immediate state changes from start/stop
            if (isHardCutoff || action) {
                console.log(`🔥 STATE CHANGE: ${action} - running=${gameRunning}, frozen=${frozen}, unfrozen=${unfrozen}, preserved=${dataPreserved}`);
                
                if (action === 'start') {
                    this.isGameRunning = true;
                    console.log('🚀 Game started - overlay activated, unfrozen, data preserved');
                    
                    const unfrozenData = {
                        ...data,
                        running: true,
                        frozen: false,
                        unfrozen: true,
                        clusters: clusters
                    };
                    this.updateVisualization(unfrozenData, 'start_unfreeze');
                    
                } else if (action === 'stop') {
                    this.isGameRunning = false;
                    console.log('🛑 Game stopped - overlay FROZEN (data preserved)');
                    this.stopPolling();
                    this.scheduleStatusCheck();
                    
                    const frozenData = {
                        ...data,
                        running: false,
                        frozen: true,
                        unfrozen: false,
                        clusters: clusters
                    };
                    this.updateVisualization(frozenData, 'stop_freeze');
                    return;
                }
            }
            
            // Handle unfrozen signal
            if (unfrozen && !action) {
                console.log('🔓 Received unfreeze signal - clearing frozen state');
                const unfrozenData = {
                    ...data,
                    frozen: false,
                    unfrozen: true
                };
                this.updateVisualization(unfrozenData, 'unfreeze_signal');
            }
            
            // Detect regular game state changes
            if (gameRunning !== this.isGameRunning && !isHardCutoff) {
                console.log(`🎮 Game state changed: ${this.isGameRunning} → ${gameRunning}`);
                this.isGameRunning = gameRunning;
                
                if (!gameRunning) {
                    console.log('🛑 Game stopped - switching to status check mode (preserving visualization)');
                    this.stopPolling();
                    this.scheduleStatusCheck();
                    
                    const preservedData = {
                        ...data,
                        running: false,
                        frozen: true,
                        clusters: clusters.length > 0 ? clusters : (this.lastKnownState?.clusters || [])
                    };
                    this.updateVisualization(preservedData, 'game_stopped_preserve');
                    return;
                }
            }
            
            if (hasActivity) {
                this.hasEverHadData = true;
            }

            // Regular update
            this.updateVisualization(data, 'poll');
        }

        handlePollError(error) {
            this.consecutiveErrors++;
            
            if (this.consecutiveErrors <= 2) {
                console.warn(`Connection issue ${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}:`, error.message);
            }
            
            if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('❌ Too many consecutive errors - switching to status check mode');
                this.isGameRunning = false;
                this.stopPolling();
                this.scheduleStatusCheck();
            }
        }

        updateVisualization(data, source = 'poll') {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const frozen = data?.frozen === true;
            const unfrozen = data?.unfrozen === true;
            const dataPreserved = data?.dataPreserved === true;
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true;
            
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            // Enhanced logging for state changes
            if (source.includes('start') || source.includes('stop') || source.includes('reset') || source.includes('freeze') || source.includes('unfreeze')) {
                console.log(`🎨 ${source.toUpperCase()}: ${clusters.length} clusters, frozen=${frozen}, unfrozen=${unfrozen}, preserved=${dataPreserved}, cleared=${allDataCleared}, hardReset=${hardReset}`);
            } else if (clusters.length > 0 || this.updateCount % 5 === 1) {
                console.log(`🎨 Update #${this.updateCount} (${source}): ${clusters.length} clusters`);
            }
            
            // ENHANCED RESET HANDLING: Multiple approaches to ensure clearing
            if (source.includes('reset') || allDataCleared || hardReset) {
                console.log('🔥 MULTIPLE RESET APPROACHES: Trying all clearing methods');
                
                // Approach 1: Immediate clear
                this.renderer.updateClusters([]);
                
                // Approach 2: Force clear with delay
                setTimeout(() => {
                    console.log('🔥 Delayed reset clear #1');
                    this.renderer.updateClusters([]);
                }, 50);
                
                // Approach 3: Second delayed clear
                setTimeout(() => {
                    console.log('🔥 Delayed reset clear #2');
                    this.renderer.updateClusters([]);
                }, 200);
                
                // Approach 4: Final clear with data (should be empty)
                setTimeout(() => {
                    console.log('🔥 Final reset update with actual data (should be empty)');
                    this.renderer.updateClusters(clusters);
                }, 500);
                
            } else {
                // Normal update
                this.renderer.updateClusters(clusters);
            }
            
            // Update CSS classes - enhanced for reset
            const isActive = data?.running !== false;
            const hasData = clusters.length > 0;
            
            document.body.classList.toggle('clickmap-active', isActive);
            document.body.classList.toggle('clickmap-has-data', hasData);
            
            // Special handling for resets
            if (source.includes('reset') || allDataCleared || hardReset) {
                // Force remove data class for resets
                document.body.classList.remove('clickmap-has-data');
                console.log('🎨 CSS classes updated for reset: clickmap-has-data removed');
            }
            
            // Store last known good state
            this.lastKnownState = data;
        }

        // Add method to force clear everything (for debugging)
        forceResetVisualization() {
            console.log('🆘 EMERGENCY RESET: Force clearing all visualization');
            
            if (this.renderer) {
                // Clear all data structures
                this.renderer.updateClusters([]);
                
                if (this.renderer.springs) this.renderer.springs.clear();
                if (this.renderer.targets) this.renderer.targets.clear();
                if (this.renderer.animatedClusters) this.renderer.animatedClusters.clear();
                
                // Manual canvas clear
                if (this.renderer.ctx) {
                    const canvas = this.renderer.canvas;
                    const ctx = this.renderer.ctx;
                    const W = canvas.width / (window.devicePixelRatio || 1);
                    const H = canvas.height / (window.devicePixelRatio || 1);
                    ctx.clearRect(0, 0, W, H);
                }
            }
            
            // Clear state
            this.lastKnownState = null;
            
            // Update classes
            document.body.classList.remove('clickmap-has-data');
            
            console.log('✅ EMERGENCY RESET: Complete');
        }

        getStatus() {
            return {
                channelId: this.channelId,
                threshold: this.threshold,
                transport: `Optimized HTTP (${POLL_INTERVAL}ms)`,
                updateCount: this.updateCount,
                consecutiveErrors: this.consecutiveErrors,
                isGameRunning: this.isGameRunning,
                hasEverHadData: this.hasEverHadData,
                isPolling: !!this.pollInterval,
                isPageVisible: this.isPageVisible,
                lastUpdate: this.lastUpdate,
                backend: 'Ultra High-Performance with Sampling',
                fps: this.renderer ? this.renderer.getFPS() : 0,
                pollInterval: POLL_INTERVAL,
                statusCheckInterval: STATUS_CHECK_INTERVAL,
                isActive: document.body.classList.contains('clickmap-active'),
                hasData: document.body.classList.contains('clickmap-has-data'),
                lastKnownState: this.lastKnownState
            };
        }

        destroy() {
            this.stopPolling();
            if (this.renderer) {
                this.renderer.destroy();
            }
            console.log('🧹 Optimized overlay destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new OptimizedSmartOverlay();
            window.smartOverlay = overlay; // For debugging
            console.log('🎯 Optimized 5-second overlay with ALL visual features loaded');
        } catch (error) { 
            console.error('Failed to initialize optimized overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Make the force reset available globally for debugging
    window.forceResetOverlay = () => {
        if (window.smartOverlay && window.smartOverlay.forceResetVisualization) {
            window.smartOverlay.forceResetVisualization();
        }
    };
})();
