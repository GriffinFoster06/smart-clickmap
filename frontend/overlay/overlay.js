// frontend/overlay/overlay.js
// Real-time intelligent overlay renderer with immediate updates

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

    // ========== REAL-TIME HEATMAP RENDERER ==========
    class RealTimeHeatmapRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: true });
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            
            // Enhanced animation system for real-time updates
            this.springs = new Map(); // key -> {x,y,r,p,seed,shape,density}
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            // Real-time optimization
            this.lastUpdateTime = 0;
            this.frameCount = 0;
            this.fps = 60;

            this.resize();
            this.start();
            
            console.log('🎨 Real-time renderer initialized');
        }

        // ========== ENHANCED ANIMATION SYSTEM ==========
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

                // Enhanced spring physics for smooth real-time updates
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    
                    s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                    
                    // Faster spring response for real-time feel
                    this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                    this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
                    
                    // Smoothly interpolate shape properties
                    const smoothing = Math.min(1, dt * 6); // Faster interpolation
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

        // ========== REAL-TIME CLUSTER PROCESSING ==========
        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            console.log(`🎨 Real-time update: ${filtered.length} clusters`);

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
                    eccentricity: c.eccentricity || 0,
                    // Shape properties
                    shapeType: c.shapeType || 'circle',
                    polygonPoints: c.polygonPoints || null,
                    shapeOrientation: c.shapeOrientation || 0,
                    shapeConfidence: c.shapeConfidence || 1.0,
                    preferredSides: c.preferredSides || 8,
                    circularity: c.circularity || 1.0,
                    complexity: c.complexity || 0,
                    compactness: c.compactness || 0.5
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        // Faster spring response for real-time updates
                        x: this._spring(c.x, 15, 0.85),
                        y: this._spring(c.y, 15, 0.85),
                        r: this._spring(visualRadius, 18, 0.8),
                        p: this._spring(c.percentage || 0, 10, 1.0),
                        seed,
                        density: c.density || 1,
                        eccentricity: c.eccentricity || 0,
                        // Shape information
                        shapeType: c.shapeType || 'circle',
                        polygonPoints: c.polygonPoints || null,
                        shapeOrientation: c.shapeOrientation || 0,
                        shapeConfidence: c.shapeConfidence || 1.0,
                        preferredSides: c.preferredSides || 8,
                        circularity: c.circularity || 1.0,
                        complexity: c.complexity || 0,
                        compactness: c.compactness || 0.5
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
                    // Update shape properties
                    s.density = t.density;
                    s.eccentricity = t.eccentricity;
                    s.shapeType = t.shapeType;
                    s.polygonPoints = t.polygonPoints;
                    s.shapeOrientation = t.shapeOrientation;
                    s.shapeConfidence = t.shapeConfidence;
                    s.preferredSides = t.preferredSides;
                    s.circularity = t.circularity;
                    s.complexity = t.complexity;
                    s.compactness = t.compactness;
                }
                this.render(performance.now() / 1000);
            }
        }

        fallbackSizeCalculation(cluster) {
            // Enhanced fallback calculation for real-time responsiveness
            const baseSize = 65;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 140;
            const densityBonus = Math.min(45, (cluster.density || 1) * 10);
            const countBonus = Math.log10((cluster.count || 1) + 1) * 15;
            return Math.max(baseSize, Math.min(280, baseSize + activityBonus + densityBonus + countBonus));
        }

        // ========== ENHANCED RENDERING ENGINE ==========
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
                    density: s.density,
                    eccentricity: s.eccentricity,
                    // SHAPE PROPERTIES
                    shapeType: s.shapeType || 'circle',
                    polygonPoints: s.polygonPoints,
                    shapeOrientation: s.shapeOrientation || 0,
                    shapeConfidence: s.shapeConfidence || 1.0,
                    preferredSides: s.preferredSides || 8,
                    circularity: s.circularity || 1.0,
                    complexity: s.complexity || 0,
                    compactness: s.compactness || 0.5
                });
            }
            
            // Sort by percentage for proper layering
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                // Enhanced real-time wobble
                const baseWobbleAmp = this.reduced ? 0 : 0.04;
                const shapeStability = d.shapeConfidence || 1.0;
                const activityWobble = (d.percentage / 100) * 0.06;
                const eccentricityWobble = d.eccentricity * 0.03;
                
                const totalWobble = (baseWobbleAmp + activityWobble + eccentricityWobble) * (2 - shapeStability);
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, totalWobble);

                // Enhanced colors for real-time feel
                const colors = this.calculateRealTimeColors(d, isTop);

                // Render with shape intelligence
                this.renderClusterShape(d, r, colors, tSec, isTop);
                
                // Enhanced label rendering
                this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        calculateRealTimeColors(drawable, isTop) {
            const percentage = drawable.percentage;
            const density = drawable.density;
            const shapeConfidence = drawable.shapeConfidence || 1.0;
            
            // Real-time intensity calculation
            const intensityBoost = 0.85 + (shapeConfidence * 0.15);
            const activityBoost = Math.min(1, percentage / 50);
            
            if (isTop) {
                // Top cluster: enhanced cyan with real-time glow
                const intensity = Math.min(1, (0.7 + density * 0.15 + activityBoost * 0.15) * intensityBoost);
                return {
                    fill: `rgba(0, 255, 255, ${(0.18 + intensity * 0.12)})`,
                    border: `rgba(0, 255, 255, ${(0.8 + intensity * 0.2)})`,
                    inner: `rgba(0, 255, 255, ${0.4 * intensityBoost})`,
                    glow: `rgba(0, 255, 255, ${0.6 * intensityBoost})`
                };
            } else if (percentage >= 25) {
                // High percentage: vibrant purple
                const intensity = Math.min(1, activityBoost * intensityBoost);
                return {
                    fill: `rgba(147, 51, 234, ${(0.22 + intensity * 0.13)})`,
                    border: `rgba(147, 51, 234, ${(0.85 + intensity * 0.15)})`,
                    inner: `rgba(147, 51, 234, ${0.45 * intensityBoost})`,
                    glow: `rgba(147, 51, 234, ${0.5 * intensityBoost})`
                };
            } else if (percentage >= 15) {
                // Medium percentage
                return {
                    fill: `rgba(147, 51, 234, ${0.28 * intensityBoost})`,
                    border: `rgba(147, 51, 234, ${0.92 * intensityBoost})`,
                    inner: `rgba(147, 51, 234, ${0.38 * intensityBoost})`,
                    glow: `rgba(147, 51, 234, ${0.35 * intensityBoost})`
                };
            } else {
                // Lower percentage
                return {
                    fill: `rgba(147, 51, 234, ${0.22 * intensityBoost})`,
                    border: `rgba(147, 51, 234, ${0.75 * intensityBoost})`,
                    inner: `rgba(147, 51, 234, ${0.28 * intensityBoost})`,
                    glow: `rgba(147, 51, 234, ${0.25 * intensityBoost})`
                };
            }
        }

        // ========== SHAPE RENDERING (SIMPLIFIED FOR PERFORMANCE) ==========
        renderClusterShape(drawable, radius, colors, tSec, isTop) {
            const { cx, cy, shapeType } = drawable;

            // For real-time performance, favor circles and simple polygons
            if (shapeType === 'circle' || drawable.circularity > 0.8) {
                this.renderEnhancedCircle(cx, cy, radius, colors, tSec, drawable.seed, isTop);
            } else {
                this.renderSimplePolygon(cx, cy, radius, colors, tSec, drawable.seed, drawable.preferredSides || 8);
            }
        }

        renderEnhancedCircle(cx, cy, radius, colors, tSec, seed, isTop) {
            // Main circle with enhanced glow for real-time feel
            this.ctx.fillStyle = colors.fill;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Enhanced border with glow effect
            this.ctx.strokeStyle = colors.border;
            this.ctx.lineWidth = isTop ? 4 : 3;
            this.ctx.stroke();

            // Real-time glow effect
            if (colors.glow) {
                this.ctx.shadowColor = colors.glow;
                this.ctx.shadowBlur = isTop ? 15 : 10;
                this.ctx.strokeStyle = colors.glow;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
                this.ctx.shadowBlur = 0;
            }

            // Inner detail ring
            this.ctx.strokeStyle = colors.inner;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, Math.max(2, radius - 8), 0, Math.PI * 2);
            this.ctx.stroke();
        }

        renderSimplePolygon(cx, cy, radius, colors, tSec, seed, sides) {
            const s = Math.max(6, Math.min(16, sides));
            
            this.ctx.beginPath();
            for (let i = 0; i <= s; i++) {
                const a = (i / s) * Math.PI * 2;
                const wobble = this.reduced ? 1 : this._wobble(tSec + i * 0.1, seed * 0.77, 1.0, 0.04);
                const rr = radius * (0.95 + 0.05 * wobble);
                const x = cx + Math.cos(a) * rr;
                const y = cy + Math.sin(a) * rr;
                
                if (i === 0) this.ctx.moveTo(x, y); 
                else this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();

            // Fill and stroke
            this.ctx.fillStyle = colors.fill;
            this.ctx.fill();

            this.ctx.strokeStyle = colors.border;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Glow effect for polygons too
            if (colors.glow) {
                this.ctx.shadowColor = colors.glow;
                this.ctx.shadowBlur = 8;
                this.ctx.strokeStyle = colors.glow;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
                this.ctx.shadowBlur = 0;
            }
        }

        // ========== ENHANCED LABEL SYSTEM ==========
        _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            // Enhanced font sizing for real-time visibility
            const baseFontSize = Math.max(20, Math.min(52, radius * 0.38));
            const importanceBonus = isTop ? 6 : (percentage >= 25 ? 3 : 0);
            const fontSize = baseFontSize + importanceBonus;

            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Enhanced text rendering with stronger presence
            ctx.save();
            
            // Enhanced shadow for real-time readability
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

    // ========== REAL-TIME OVERLAY CONTROLLER ==========
    class RealTimeOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.websocket = null;
            this.pollInterval = null;
            this.consecutiveErrors = 0;
            this.lastUpdateTime = 0;
            this.updateCount = 0;

            // Real-time optimization settings
            this.fastPollInterval = 250; // 4 FPS fallback polling
            this.isRealTimeMode = false;

            this.init();
        }

        init() {
            if (!this.channelId) {
                console.error('Missing channel parameter (?channel= or ?c=)');
                return;
            }
            this.setupRenderer();
            this.connectWebSocket();
            this.startRealTimePolling();
            console.log(`🎯 Real-time overlay connected to: ${this.channelId}`);
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            this.renderer = new RealTimeHeatmapRenderer(canvas);

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        connectWebSocket() {
            try {
                const wsBase = EBS.replace('https://', 'wss://').replace('http://', 'ws://');

                const tryConnect = (urlList, idx = 0) => {
                    if (idx >= urlList.length) {
                        console.log('All WebSocket attempts failed, using fast polling');
                        return;
                    }
                    const url = urlList[idx];

                    let ws;
                    try { ws = new WebSocket(url); }
                    catch (e) { return tryConnect(urlList, idx + 1); }

                    ws.onopen = () => { 
                        this.websocket = ws; 
                        this.isRealTimeMode = true;
                        console.log(`🔗 Real-time WebSocket connected: ${url}`);
                    };
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            this.updateVisualization(data, 'websocket');
                        } catch (e) { 
                            console.warn('WebSocket parse error:', e); 
                        }
                    };
                    ws.onerror = () => {
                        try { ws.close(); } catch { }
                        this.isRealTimeMode = false;
                    };
                    ws.onclose = () => {
                        if (this.websocket === ws) {
                            this.websocket = null;
                            this.isRealTimeMode = false;
                        }
                        // Faster reconnection for real-time feel
                        setTimeout(() => tryConnect(urlList, (idx + 1) % urlList.length), 1000);
                    };
                };

                tryConnect([
                    `${wsBase}/ws/${this.channelId}`
                ]);
            } catch (e) {
                console.log('WebSocket not available, using fast polling only');
            }
        }

        startRealTimePolling() {
            if (this.pollInterval) return;
            
            // Much faster polling as fallback (4 FPS)
            this.pollInterval = setInterval(() => this.poll(), this.fastPollInterval);
            this.poll();
            
            console.log(`🚀 Real-time polling started (${this.fastPollInterval}ms interval)`);
        }

        async poll() {
            // Skip polling if WebSocket is working
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store' 
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                this.updateVisualization(data, 'poll');
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                if (this.consecutiveErrors <= 3) {
                    console.warn(`Connection issue ${this.consecutiveErrors}/3:`, error.message);
                }
            }
        }

        updateVisualization(data, source = 'unknown') {
            if (!this.renderer) return;
            
            const now = Date.now();
            this.updateCount++;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            
            if (clusters.length > 0 || (now - this.lastUpdateTime > 5000)) {
                console.log(`🎨 Real-time update #${this.updateCount} via ${source}: ${clusters.length} clusters (FPS: ${this.renderer.getFPS()})`);
                this.lastUpdateTime = now;
            }
            
            this.renderer.updateClusters(clusters);
            
            // Update body classes for CSS styling
            document.body.classList.toggle('clickmap-active', data?.running !== false);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
            document.body.classList.toggle('clickmap-realtime', this.isRealTimeMode);
        }

        getStatus() {
            return {
                channelId: this.channelId,
                isRealTime: this.isRealTimeMode,
                websocketConnected: this.websocket && this.websocket.readyState === WebSocket.OPEN,
                updateCount: this.updateCount,
                fps: this.renderer ? this.renderer.getFPS() : 0,
                consecutiveErrors: this.consecutiveErrors
            };
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new RealTimeOverlay();
            window.realTimeOverlay = overlay; // For debugging
            console.log('🎯 Real-time shape-adaptive overlay loaded');
        } catch (error) { 
            console.error('Failed to initialize real-time overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
