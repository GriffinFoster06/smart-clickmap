// frontend/overlay/overlay.js
// Aspect-correct 16:9 projection, smooth animation, click-through everywhere,
// readable % labels with leader line ONLY if forced outside the blob.

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

    // Global safety: ensure our overlay never captures input; keep page transparent
    try {
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
        const style = document.createElement('style');
        style.textContent = `
      html, body { background: transparent !important; }
      /* The entire overlay subtree is inert to mouse/touch */
      #overlay-root, #overlay-root * { pointer-events: none !important; }
      /* Fullscreen, on top, but inert to input */
      #overlay-root {
        position: fixed; inset: 0;
        z-index: 2147483647; /* above Twitch UI but doesn't block it */
      }
      /* Canvas fills viewport */
      #overlay-canvas {
        position: absolute; left: 0; top: 0; right: 0; bottom: 0;
        width: 100vw; height: 100vh; display: block;
        background: transparent !important;
        touch-action: none; /* avoid touch panning capture on mobile */
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

    // ---------- helpers ----------
    function parseAspectFromURL() {
        const params = new URLSearchParams(window.location.search);

        const bw = parseInt(params.get('base_w') || params.get('bw') || '', 10);
        const bh = parseInt(params.get('base_h') || params.get('bh') || '', 10);
        if (Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) {
            return bw / bh; // OBS base canvas hint
        }

        const aspectStr = params.get('aspect');
        if (aspectStr) {
            const parts = aspectStr.split(/[:/]/).map(Number);
            if (parts.length === 2 && parts.every(n => Number.isFinite(n) && n > 0)) {
                return parts[0] / parts[1];
            }
            const asFloat = parseFloat(aspectStr);
            if (Number.isFinite(asFloat) && asFloat > 0) return asFloat;
        }

        return 16 / 9; // default: works for ANY 16:9 size
    }

    // Center a target aspect inside the window using "contain" fit.
    function fitViewport(containerW, containerH, targetAspect) {
        let vw = containerW;
        let vh = Math.round(vw / targetAspect);
        if (vh > containerH) {
            vh = containerH;
            vw = Math.round(vh * targetAspect);
        }
        const vx = Math.floor((containerW - vw) / 2);
        const vy = Math.floor((containerH - vh) / 2);
        return { x: vx, y: vy, width: vw, height: vh };
    }

    function hashSeed(x, y, pct, count) {
        let h = 2166136261 >>> 0;
        function mix(n) { h ^= (n | 0); h = Math.imul(h, 16777619); }
        mix((x * 1e6) | 0);
        mix((y * 1e6) | 0);
        mix(((pct || 0) * 100) | 0);
        mix(count | 0);
        return (h >>> 0) / 4294967295;
    }

    function wobble(t, seed, base = 1.0, amp = 0.10) {
        const a1 = Math.sin(t * 0.7 + seed * 6.28318);
        const a2 = Math.sin(t * 1.1 + seed * 12.56636);
        const a3 = Math.sin(t * 0.43 + seed * 3.14159);
        const n = (a1 * 0.5 + a2 * 0.35 + a3 * 0.15);
        return base * (1.0 + amp * n);
    }

    // Critically-damped spring for smooth, non-choppy motion
    class Spring {
        constructor(value = 0, { omega = 10, zeta = 1 } = {}) {
            this.x = value;
            this.v = 0;
            this.omega = omega;
            this.zeta = zeta;
            this.target = value;
        }
        setTarget(t) { this.target = t; }
        jump(v) { this.x = v; this.v = 0; this.target = v; }
        step(dt) {
            const f = -this.omega * this.omega * (this.x - this.target) - 2 * this.zeta * this.omega * this.v;
            this.v += f * dt;
            this.x += this.v * dt;
            return this.x;
        }
    }

    class PreciseAreaRenderer {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: true });

            // Ensure our canvas never eats clicks
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_RADIUS = 80;
            this.MAX_RADIUS = 160;

            this.targetAspect = opts.targetAspect || 16 / 9;
            this.viewport = { x: 0, y: 0, width: 0, height: 0 };

            this.springs = new Map(); // key -> {x,y,r,p,seed}
            this.targets = new Map();

            this.animationId = null;
            this.lastTs = 0;

            this.resize();
            window.addEventListener('resize', () => this.resize());
            this.start();
        }

        start() {
            if (REDUCED_MOTION) return;
            if (this.animationId) return;
            const loop = (ts) => {
                if (!this.lastTs) this.lastTs = ts;
                const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
                this.lastTs = ts;

                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.setTarget(t.x);
                    s.y.setTarget(t.y);
                    s.r.setTarget(t.r);
                    s.p.setTarget(t.p);
                    s.x.step(dt); s.y.step(dt); s.r.step(dt); s.p.step(dt);
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
            const dpr = window.devicePixelRatio || 1;
            const cssW = window.innerWidth;
            const cssH = window.innerHeight;

            // Fullscreen canvas
            this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
            this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
            this.canvas.style.width = cssW + 'px';
            this.canvas.style.height = cssH + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Project clusters into a 16:9 box centered in the window.
            this.viewport = fitViewport(cssW, cssH, this.targetAspect);
            this.render(performance.now() / 1000);
        }

        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            const nextTargets = new Map();
            for (const c of filtered) {
                const baseArea = this.MIN_RADIUS + (c.percentage * 2.5);
                const densityFactor = c.density ? Math.sqrt(c.density) : 1;
                const spreadRadius = c.radius || 0.05;
                const effectiveRadius = Math.max(
                    this.MIN_RADIUS,
                    Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
                );

                const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, {
                    x: c.x,
                    y: c.y,
                    r: effectiveRadius,
                    p: c.percentage || 0,
                    count: c.count || 1
                });

                if (!this.springs.has(key)) {
                    const seed = hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        x: new Spring(c.x, { omega: 9, zeta: 0.95 }),
                        y: new Spring(c.y, { omega: 9, zeta: 0.95 }),
                        r: new Spring(effectiveRadius, { omega: 12, zeta: 0.9 }),
                        p: new Spring(c.percentage || 0, { omega: 7, zeta: 1.0 }),
                        seed
                    });
                }
            }
            // prune missing
            for (const key of [...this.springs.keys()]) {
                if (!nextTargets.has(key)) this.springs.delete(key);
            }
            this.targets = nextTargets;

            if (REDUCED_MOTION) {
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.jump(t.x); s.y.jump(t.y); s.r.jump(t.r); s.p.jump(t.p);
                }
                this.render(performance.now() / 1000);
            }
        }

        render(tSec = 0) {
            const cssW = this.canvas.width / (window.devicePixelRatio || 1);
            const cssH = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, cssW, cssH);

            const { x: vx, y: vy, width: vw, height: vh } = this.viewport;

            const drawables = [];
            for (const [key, s] of this.springs.entries()) {
                drawables.push({
                    key,
                    cx: vx + s.x.x * vw,   // normalized to 16:9 viewport, not the whole window
                    cy: vy + s.y.x * vh,
                    radius: s.r.x,
                    percentage: s.p.x,
                    seed: s.seed
                });
            }
            // low % first, highest on top
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                const wobbleAmp = Math.min(0.12, 0.06 + (d.percentage / 100) * 0.08);
                const r = REDUCED_MOTION ? d.radius : d.radius * wobble(tSec, d.seed, 1.0, wobbleAmp);

                let fillColor, borderColor;
                if (isTop) {
                    fillColor = 'rgba(0, 255, 255, 0.20)';
                    borderColor = 'rgba(0, 255, 255, 0.85)';
                } else if (d.percentage >= 15) {
                    fillColor = 'rgba(147, 51, 234, 0.25)';
                    borderColor = 'rgba(147, 51, 234, 0.90)';
                } else {
                    fillColor = 'rgba(147, 51, 234, 0.20)';
                    borderColor = 'rgba(147, 51, 234, 0.70)';
                }

                const needsPolygon = (d.percentage >= 20) && !REDUCED_MOTION;
                if (needsPolygon) this.renderPolygonArea(d.cx, d.cy, r, fillColor, borderColor, tSec, d.seed, d.percentage);
                else this.renderCircularArea(d.cx, d.cy, r, fillColor, borderColor);

                this._renderPercentageLabel(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        renderCircularArea(cx, cy, radius, fillColor, borderColor) {
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            this.ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        renderPolygonArea(cx, cy, radius, fillColor, borderColor, tSec, seed, pct) {
            const sides = Math.max(8, Math.min(16, 6 + Math.floor(pct / 7)));
            this.ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                const local = wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
                const rr = radius * (0.94 + 0.08 * local);
                const x = cx + Math.cos(a) * rr;
                const y = cy + Math.sin(a) * rr;
                if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();

            this.ctx.fillStyle = fillColor;
            this.ctx.fill();

            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }

        // ---------- labels (text only; leader line only when needed) ----------
        _pointRectDistance(px, py, rx, ry, rw, rh) {
            const cx = Math.max(rx, Math.min(px, rx + rw));
            const cy = Math.max(ry, Math.min(py, ry + rh));
            const dx = px - cx;
            const dy = py - cy;
            return Math.hypot(dx, dy);
        }

        _computeLabelLayout(cx, cy, text, fontSize, radius) {
            const ctx = this.ctx;
            const { x: vx, y: vy, width: vw, height: vh } = this.viewport;

            const textWidth = ctx.measureText(text).width;
            const boxW = Math.ceil(textWidth);
            const boxH = Math.ceil(fontSize);

            let lx = cx, ly = cy;

            const gutter = 6;
            const minX = vx + gutter + boxW / 2;
            const maxX = vx + vw - gutter - boxW / 2;
            const minY = vy + gutter + boxH / 2;
            const maxY = vy + vh - gutter - boxH / 2;

            const clampedLx = Math.max(minX, Math.min(maxX, lx));
            const clampedLy = Math.max(minY, Math.min(maxY, ly));

            const box = {
                x: Math.round(clampedLx - boxW / 2),
                y: Math.round(clampedLy - boxH / 2),
                w: boxW,
                h: boxH
            };

            // If the text rect intersects the circle, we don't separate (no leader line)
            const dist = this._pointRectDistance(cx, cy, box.x, box.y, box.w, box.h);
            const separated = dist > Math.max(0, radius - 2);

            return { box, center: { x: clampedLx, y: clampedLy }, separated };
        }

        _renderPercentageLabel(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            const fontSize = Math.max(22, Math.min(40, radius * 0.35));
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const layout = this._computeLabelLayout(cx, cy, str, fontSize, radius);

            // Only draw a leader line if we had to move the label outside the blob
            if (layout.separated) {
                const ang = Math.atan2(layout.center.y - cy, layout.center.x - cx);
                const sx = cx + Math.cos(ang) * Math.max(0, radius - 4);
                const sy = cy + Math.sin(ang) * Math.max(0, radius - 4);

                const halfW = layout.box.w / 2, halfH = layout.box.h / 2;
                const ex = layout.center.x - Math.sign(Math.cos(ang)) * (halfW - 2);
                const ey = layout.center.y - Math.sign(Math.sin(ang)) * (halfH - 2);

                ctx.save();
                ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.85)' : 'rgba(147, 51, 234, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
                ctx.restore();
            }

            // Text only (no pill). Strong shadow to ensure readability over any video.
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            ctx.fillStyle = '#ffffff';
            ctx.fillText(str, layout.center.x, layout.center.y);

            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
            ctx.lineWidth = 1;
            ctx.strokeText(str, layout.center.x, layout.center.y);
            ctx.restore();
        }

        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
    }

    class InstantOverlay {
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
            console.log(`🎯 Precise area overlay connected to: ${this.channelId}`);
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            const targetAspect = parseAspectFromURL();
            this.renderer = new PreciseAreaRenderer(canvas, { targetAspect });

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        connectWebSocket() {
            // Try ?channel= form first, then /ws/<id>
            try {
                const wsBase = EBS.replace('https://', 'wss://').replace('http://', 'ws://');

                const tryConnect = (urlList, idx = 0) => {
                    if (idx >= urlList.length) return;
                    const url = urlList[idx];

                    let ws;
                    try { ws = new WebSocket(url); }
                    catch (e) { return tryConnect(urlList, idx + 1); }

                    ws.onopen = () => { this.websocket = ws; };
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            this.updateVisualization(data);
                        } catch (e) { console.warn('WebSocket parse error:', e); }
                    };
                    ws.onerror = () => {
                        try { ws.close(); } catch { }
                    };
                    ws.onclose = () => {
                        if (this.websocket === ws) this.websocket = null;
                        // Reconnect after a bit
                        setTimeout(() => tryConnect(urlList, (idx + 1) % urlList.length), 3000);
                    };
                };

                tryConnect([
                    `${wsBase}/ws?channel=${encodeURIComponent(this.channelId)}`,
                    `${wsBase}/ws/${this.channelId}`
                ]);
            } catch (e) {
                console.log('WebSocket not available');
            }
        }

        startPolling() {
            // Keep a light polling fallback in case WS is blocked by a proxy
            if (this.pollInterval) return;
            this.pollInterval = setInterval(() => this.poll(), 1000);
            this.poll();
        }

        async poll() {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

            try {
                const response = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                this.updateVisualization(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                if (this.consecutiveErrors <= 3) console.warn(`Connection issue ${this.consecutiveErrors}/3`);
            }
        }

        updateVisualization(data) {
            if (!this.renderer) return;
            const clusters = Array.isArray(data) ? data : (data?.clusters || data?.blobs || []);
            this.renderer.updateClusters(clusters);
        }
    }

    function initialize() {
        try {
            new InstantOverlay();
            console.log('🎯 Precise area-based overlay loaded');
        } catch (error) { console.error('Failed to initialize overlay:', error); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
