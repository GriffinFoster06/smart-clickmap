// frontend/overlay/overlay.js
// Intelligent overlay renderer for advanced clustering system

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

    // ========== INTELLIGENT HEATMAP RENDERER ==========
    class IntelligentHeatmapRenderer {
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

            this.resize();
            this.start();
        }

        // ========== ANIMATION SYSTEM ==========
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

                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    
                    s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                    this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                    this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
                    
                    // Smoothly interpolate shape properties
                    s.density = s.density + (t.density - s.density) * Math.min(1, dt * 4);
                    s.eccentricity = s.eccentricity + (t.eccentricity - s.eccentricity) * Math.min(1, dt * 3);
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

            console.log(`🎨 Rendering ${filtered.length} intelligent clusters`);

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
                    shape: c.shape || { type: 'polygon', sides: 8, isRegular: true },
                    compactness: c.compactness || 0.5
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        x: this._spring(c.x, 9, 0.95),
                        y: this._spring(c.y, 9, 0.95),
                        r: this._spring(visualRadius, 12, 0.9),
                        p: this._spring(c.percentage || 0, 7, 1.0),
                        seed,
                        density: c.density || 1,
                        eccentricity: c.eccentricity || 0,
                        shape: c.shape || { type: 'polygon', sides: 8, isRegular: true },
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
                    s.density = t.density;
                    s.eccentricity = t.eccentricity;
                    s.shape = t.shape;
                }
                this.render(performance.now() / 1000);
            }
        }

        fallbackSizeCalculation(cluster) {
            // Fallback if backend doesn't provide visualSize
            const baseSize = 60;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 120;
            const densityBonus = Math.min(40, (cluster.density || 1) * 8);
            return Math.max(baseSize, Math.min(250, baseSize + activityBonus + densityBonus));
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
                    eccentricity: s.eccentricity,
                    shape: s.shape,
                    compactness: s.compactness
                });
            }
            
            // Sort by percentage for proper layering
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                // Enhanced wobble based on cluster properties
                const wobbleAmp = this.reduced ? 0 : Math.min(0.15, 
                    0.05 + (d.percentage / 100) * 0.08 + d.eccentricity * 0.04
                );
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, wobbleAmp);

                // Enhanced color calculation based on multiple factors
                const colors = this.calculateClusterColors(d, isTop);

                // Render based on shape type
                this.renderClusterShape(d, r, colors, tSec, isTop);
                
                // Render label
                this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        calculateClusterColors(drawable, isTop) {
            const percentage = drawable.percentage;
            const density = drawable.density;
            
            if (isTop) {
                // Top cluster: cyan with intensity based on density
                const intensity = Math.min(1, 0.6 + density * 0.1);
                return {
                    fill: `rgba(0, 255, 255, ${0.15 + intensity * 0.15})`,
                    border: `rgba(0, 255, 255, ${0.7 + intensity * 0.2})`,
                    inner: `rgba(0, 255, 255, 0.3)`
                };
            } else if (percentage >= 25) {
                // High percentage: intense purple
                const intensity = Math.min(1, percentage / 50);
                return {
                    fill: `rgba(147, 51, 234, ${0.2 + intensity * 0.15})`,
                    border: `rgba(147, 51, 234, ${0.8 + intensity * 0.15})`,
                    inner: `rgba(147, 51, 234, 0.4)`
                };
            } else if (percentage >= 15) {
                // Medium percentage: standard purple
                return {
                    fill: 'rgba(147, 51, 234, 0.25)',
                    border: 'rgba(147, 51, 234, 0.9)',
                    inner: 'rgba(147, 51, 234, 0.35)'
                };
            } else {
                // Lower percentage: subtle purple
                return {
                    fill: 'rgba(147, 51, 234, 0.2)',
                    border: 'rgba(147, 51, 234, 0.7)',
                    inner: 'rgba(147, 51, 234, 0.25)'
                };
            }
        }

        renderClusterShape(drawable, radius, colors, tSec, isTop) {
            const { cx, cy, shape, eccentricity, density } = drawable;

            if (shape.type === 'hull' && shape.points && !this.reduced) {
                // Render irregular hull shape
                this.renderHullShape(cx, cy, radius, colors, shape.points, shape.smoothing || 0.3);
            } else {
                // Render regular or irregular polygon
                const usePolygon = (drawable.percentage >= 15 || eccentricity > 0.3) && !this.reduced;
                if (usePolygon) {
                    const sides = shape.sides || Math.max(6, Math.min(16, 6 + Math.floor(drawable.percentage / 8)));
                    this.renderPolygonArea(cx, cy, radius, colors, tSec, drawable.seed, sides, eccentricity);
                } else {
                    this.renderCircularArea(cx, cy, radius, colors);
                }
            }
        }

        renderCircularArea(cx, cy, radius, colors) {
            // Main fill
            this.ctx.fillStyle = colors.fill;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Primary border
            this.ctx.strokeStyle = colors.border;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Inner detail ring
            this.ctx.strokeStyle = colors.inner;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        renderPolygonArea(cx, cy, radius, colors, tSec, seed, sides, eccentricity) {
            const s = Math.max(6, Math.min(20, sides));
            
            this.ctx.beginPath();
            for (let i = 0; i <= s; i++) {
                const a = (i / s) * Math.PI * 2;
                
                // Enhanced wobble with eccentricity influence
                const wobbleIntensity = 0.04 + eccentricity * 0.08;
                const local = this._wobble(tSec + i * 0.07, seed * 0.73, 1.0, wobbleIntensity);
                
                // Eccentricity creates oval-like distortion
                const xScale = 1.0 + eccentricity * 0.3 * Math.cos(a * 2);
                const yScale = 1.0 - eccentricity * 0.2 * Math.sin(a * 2);
                
                const rr = radius * (0.92 + 0.08 * local);
                const x = cx + Math.cos(a) * rr * xScale;
                const y = cy + Math.sin(a) * rr * yScale;
                
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
        }

        renderHullShape(cx, cy, radius, colors, hullPoints, smoothing) {
            if (!hullPoints || hullPoints.length < 3) {
                this.renderCircularArea(cx, cy, radius, colors);
                return;
            }

            // Scale and position hull points relative to cluster center
            const scaledPoints = hullPoints.map(p => ({
                x: cx + (p.x - 0.5) * radius * 2,
                y: cy + (p.y - 0.5) * radius * 2
            }));

            // Create smooth path through hull points
            this.ctx.beginPath();
            this.ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);

            if (smoothing > 0) {
                // Smooth curve through points
                for (let i = 1; i < scaledPoints.length; i++) {
                    const current = scaledPoints[i];
                    const next = scaledPoints[(i + 1) % scaledPoints.length];
                    
                    const midX = (current.x + next.x) / 2;
                    const midY = (current.y + next.y) / 2;
                    
                    this.ctx.quadraticCurveTo(current.x, current.y, midX, midY);
                }
                this.ctx.quadraticCurveTo(
                    scaledPoints[0].x, scaledPoints[0].y,
                    scaledPoints[0].x, scaledPoints[0].y
                );
            } else {
                // Sharp edges
                for (let i = 1; i < scaledPoints.length; i++) {
                    this.ctx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
                }
            }
            this.ctx.closePath();

            // Fill and stroke
            this.ctx.fillStyle = colors.fill;
            this.ctx.fill();

            this.ctx.strokeStyle = colors.border;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }

        // ========== LABEL SYSTEM ==========
        _pointRectDistance(px, py, rx, ry, rw, rh) {
            const cx = Math.max(rx, Math.min(px, rx + rw));
            const cy = Math.max(ry, Math.min(py, ry + rh));
            const dx = px - cx;
            const dy = py - cy;
            return Math.hypot(dx, dy);
        }

        _computeLabelLayoutCanvas(cx, cy, text, fontSize, radius) {
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

        _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            // Dynamic font size based on cluster size and importance
            const baseFontSize = Math.max(18, Math.min(50, radius * 0.4));
            const importanceBonus = isTop ? 4 : (percentage >= 25 ? 2 : 0);
            const fontSize = baseFontSize + importanceBonus;

            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const layout = this._computeLabelLayoutCanvas(cx, cy, str, fontSize, radius);

            // Leader line if needed
            if (layout.separated) {
                const ang = Math.atan2(layout.center.y - cy, layout.center.x - cx);
                const sx = cx + Math.cos(ang) * Math.max(0, radius - 6);
                const sy = cy + Math.sin(ang) * Math.max(0, radius - 6);

                const halfW = layout.box.w / 2, halfH = layout.box.h / 2;
                const ex = layout.center.x - Math.sign(Math.cos(ang)) * (halfW - 3);
                const ey = layout.center.y - Math.sign(Math.sin(ang)) * (halfH - 3);

                ctx.save();
                ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.85)' : 'rgba(147, 51, 234, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
                ctx.restore();
            }

            // Enhanced text with stronger presence for larger clusters
            ctx.save();
            
            // Enhanced shadow for readability
            ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
            ctx.shadowBlur = Math.max(8, fontSize * 0.2);
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // Main text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(str, layout.center.x, layout.center.y);

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Enhanced outline for larger percentages
            const outlineWidth = percentage >= 25 ? 1.5 : 1;
            ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
            ctx.lineWidth = outlineWidth;
            ctx.strokeText(str, layout.center.x, layout.center.y);
            
            ctx.restore();
        }

        // ========== PUBLIC API ==========
        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        destroy() { this.stop(); }
    }

    // ========== OVERLAY CONTROLLER ==========
    class IntelligentOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.websocket = null;
            this.pollInterval = null;
            this.consecutiveErrors = 0;

            this.init();
        }

        init() {
            if (!this.channelId) {
                console.error('Missing channel parameter (?channel= or ?c=)');
                return;
            }
            this.setupRenderer();
            this.connectWebSocket();
            this.startPolling();
            console.log(`🎯 Intelligent overlay connected to: ${this.channelId}`);
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            this.renderer = new IntelligentHeatmapRenderer(canvas);

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        connectWebSocket() {
            try {
                const wsBase = EBS.replace('https://', 'wss://').replace('http://', 'ws://');

                const tryConnect = (urlList, idx = 0) => {
                    if (idx >= urlList.length) return;
                    const url = urlList[idx];

                    let ws;
                    try { ws = new WebSocket(url); }
                    catch (e) { return tryConnect(urlList, idx + 1); }

                    ws.onopen = () => { 
                        this.websocket = ws; 
                        console.log(`🔗 WebSocket connected: ${url}`);
                    };
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            this.updateVisualization(data);
                        } catch (e) { 
                            console.warn('WebSocket parse error:', e); 
                        }
                    };
                    ws.onerror = () => {
                        try { ws.close(); } catch { }
                    };
                    ws.onclose = () => {
                        if (this.websocket === ws) this.websocket = null;
                        setTimeout(() => tryConnect(urlList, (idx + 1) % urlList.length), 3000);
                    };
                };

                tryConnect([
                    `${wsBase}/ws?channel=${encodeURIComponent(this.channelId)}`,
                    `${wsBase}/ws/${this.channelId}`
                ]);
            } catch (e) {
                console.log('WebSocket not available, using polling only');
            }
        }

        startPolling() {
            if (this.pollInterval) return;
            this.pollInterval = setInterval(() => this.poll(), 1500);
            this.poll();
        }

        async poll() {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { 
                    cache: 'no-store' 
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                this.updateVisualization(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                if (this.consecutiveErrors <= 3) {
                    console.warn(`Connection issue ${this.consecutiveErrors}/3:`, error.message);
                }
            }
        }

        updateVisualization(data) {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            
            if (clusters.length > 0) {
                console.log(`🎨 Updating visualization: ${clusters.length} clusters, algorithm: ${data.algorithm || 'unknown'}`);
                clusters.forEach((c, i) => {
                    if (i < 3) { // Log first few for debugging
                        console.log(`  Cluster ${i}: ${c.percentage}% (${c.count} clicks, size: ${c.visualSize || 'calculated'})`);
                    }
                });
            }
            
            this.renderer.updateClusters(clusters);
            
            // Update body classes for CSS styling
            document.body.classList.toggle('clickmap-active', data?.running !== false);
            document.body.classList.toggle('clickmap-has-data', clusters.length > 0);
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            new IntelligentOverlay();
            console.log('🎯 Intelligent HUD overlay loaded');
        } catch (error) { 
            console.error('Failed to initialize intelligent overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
