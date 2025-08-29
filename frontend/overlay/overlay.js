// frontend/overlay/overlay.js - Aspect-correct overlay with smooth, dynamic animation
(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';

    // ---- prefs / helpers ----
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function parseAspectFromURL() {
        const params = new URLSearchParams(window.location.search);

        const bw = parseInt(params.get('base_w') || params.get('bw') || '', 10);
        const bh = parseInt(params.get('base_h') || params.get('bh') || '', 10);
        if (Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) {
            return bw / bh;
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

        return 16 / 9; // default
    }

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

    // Stable hash from cluster props to seed wobble (avoid synchronized motion)
    function hashSeed(x, y, pct, count) {
        // simple 32-bit mix
        let h = 2166136261 >>> 0;
        function mix(n) { h ^= (n | 0); h = Math.imul(h, 16777619); }
        mix((x * 1e6) | 0);
        mix((y * 1e6) | 0);
        mix(((pct || 0) * 100) | 0);
        mix(count | 0);
        return (h >>> 0) / 4294967295; // 0..1
    }

    // Small “organic” wobble using layered sines (fast, no libs)
    function wobble(t, seed, base = 1.0, amp = 0.10) {
        const p1 = 2.1 + seed * 0.9;
        const p2 = 3.7 + seed * 0.8;
        const p3 = 5.2 + seed * 0.7;
        const a1 = Math.sin(t * 0.7 + seed * 6.28318);
        const a2 = Math.sin(t * 1.1 + seed * 12.56636);
        const a3 = Math.sin(t * 0.43 + seed * 3.14159);
        // Weighted blend; stays in [-1,1], then map to [base-amp, base+amp]
        const n = (a1 * 0.5 + a2 * 0.35 + a3 * 0.15);
        return base * (1.0 + amp * n);
    }

    // Critically-damped spring integrator
    class Spring {
        constructor(value = 0, { omega = 10, zeta = 1 } = {}) {
            this.x = value; // value
            this.v = 0;     // velocity
            this.omega = omega;
            this.zeta = zeta;
        }
        setTarget(target) { this.target = target; }
        jump(value) { this.x = value; this.v = 0; }
        step(dt) {
            const x = this.x, v = this.v;
            const y = this.target ?? x;
            const omega = this.omega;
            const zeta = this.zeta;
            // x'' + 2ζω x' + ω^2(x - y) = 0  → integrate
            const f = -omega * omega * (x - y) - 2 * zeta * omega * v;
            this.v = v + f * dt;
            this.x = x + this.v * dt;
            return this.x;
        }
    }

    class PreciseAreaRenderer {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_RADIUS = 80;
            this.MAX_RADIUS = 160;

            this.targetAspect = opts.targetAspect || 16 / 9;
            this.viewport = { x: 0, y: 0, width: 0, height: 0 };

            // animated state per-cluster (by stable key)
            this.springs = new Map(); // key -> {x:Spring, y:Spring, r:Spring, p:Spring, seed:number}
            this.targets = new Map(); // key -> {x,y,r,p,count}

            this.animationId = null;
            this.lastTs = 0;

            this.resize();
            window.addEventListener('resize', () => this.resize());
            this.start();
        }

        start() {
            if (REDUCED_MOTION) return; // respect user preference
            if (this.animationId) return;
            const loop = (ts) => {
                if (!this.lastTs) this.lastTs = ts;
                const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
                this.lastTs = ts;

                // advance all springs
                for (const [key, springs] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    springs.x.setTarget(t.x);
                    springs.y.setTarget(t.y);
                    springs.r.setTarget(t.r);
                    springs.p.setTarget(t.p);
                    springs.x.step(dt);
                    springs.y.step(dt);
                    springs.r.step(dt);
                    springs.p.step(dt);
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

            this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
            this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
            this.canvas.style.width = cssW + 'px';
            this.canvas.style.height = cssH + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            this.viewport = fitViewport(cssW, cssH, this.targetAspect);
            this.render(performance.now() / 1000);
        }

        // called by networking code
        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            // Build target map
            const nextTargets = new Map();
            for (const c of filtered) {
                const baseArea = this.MIN_RADIUS + (c.percentage * 2.5);
                const densityFactor = c.density ? Math.sqrt(c.density) : 1;
                const spreadRadius = c.radius || 0.05;
                const effectiveRadius = Math.max(
                    this.MIN_RADIUS,
                    Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
                );

                // stable key (prefer server id if given)
                const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, {
                    x: c.x, y: c.y, r: effectiveRadius, p: c.percentage || 0,
                    count: c.count || 1
                });

                // ensure springs exist
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

            // Remove springs that are no longer present (let them fade out smoothly if desired)
            for (const key of this.springs.keys()) {
                if (!nextTargets.has(key)) {
                    this.springs.delete(key);
                }
            }

            this.targets = nextTargets;

            if (REDUCED_MOTION) {
                // No animation: jump to targets and render immediately
                for (const [key, springs] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    springs.x.jump(t.x);
                    springs.y.jump(t.y);
                    springs.r.jump(t.r);
                    springs.p.jump(t.p);
                }
                this.render(performance.now() / 1000);
            }
        }

        render(tSec = 0) {
            const cssW = this.canvas.width / (window.devicePixelRatio || 1);
            const cssH = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, cssW, cssH);

            const { x: vx, y: vy, width: vw, height: vh } = this.viewport;

            // Gather drawable clusters (sorted so top percentage is drawn last)
            const drawables = [];
            for (const [key, springs] of this.springs.entries()) {
                const percentage = springs.p.x;
                drawables.push({
                    key,
                    cx: vx + springs.x.x * vw,
                    cy: vy + springs.y.x * vh,
                    radius: springs.r.x,
                    percentage,
                    seed: springs.seed
                });
            }
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                // smooth wobble factor (reduced on low %)
                const wobbleAmp = Math.min(0.12, 0.06 + (d.percentage / 100) * 0.08);
                const r = REDUCED_MOTION ? d.radius : d.radius * wobble(tSec, d.seed, 1.0, wobbleAmp);

                // Colors
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

                // Choose shape mode
                const needsPolygon = (d.percentage >= 20); // higher % look nicer with soft polygon
                if (needsPolygon && !REDUCED_MOTION) {
                    this.renderPolygonArea(d.cx, d.cy, r, fillColor, borderColor, tSec, d.seed, d.percentage);
                } else {
                    this.renderCircularArea(d.cx, d.cy, r, fillColor, borderColor);
                }

                this.renderPercentageText(d.cx, d.cy, Math.round(d.percentage), r, isTop);
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
            // Smooth, rounded-ish polygon via many short edges (8..16)
            const sides = Math.max(8, Math.min(16, 6 + Math.floor(pct / 7)));
            this.ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                // gentle per-angle wobble; coherent across perimeter
                const local = wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
                const rr = radius * (0.94 + 0.08 * local);
                const x = cx + Math.cos(a) * rr;
                const y = cy + Math.sin(a) * rr;
                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();

            this.ctx.fillStyle = fillColor;
            this.ctx.fill();

            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }

        renderPercentageText(cx, cy, percentage, radius, isTop) {
            const fontSize = Math.max(24, Math.min(40, radius * 0.35));
            this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            this.ctx.shadowBlur = 8;
            this.ctx.shadowOffsetX = 2;
            this.ctx.shadowOffsetY = 2;

            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(`${percentage}%`, cx, cy);

            this.ctx.shadowBlur = 0;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;

            this.ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.8)' : 'rgba(147, 51, 234, 0.8)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeText(`${percentage}%`, cx, cy);
        }

        setThreshold(threshold) {
            this.PERCENTAGE_THRESHOLD = threshold;
        }
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
                console.error('Missing channel parameter');
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
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) return;

            const targetAspect = parseAspectFromURL();
            this.renderer = new PreciseAreaRenderer(canvas, { targetAspect });

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        connectWebSocket() {
            try {
                const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
                this.websocket = new WebSocket(`${wsUrl}/ws/${this.channelId}`);

                this.websocket.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.updateVisualization(data);
                    } catch (e) {
                        console.warn('WebSocket parse error:', e);
                    }
                };

                this.websocket.onerror = () => {
                    this.websocket = null;
                };

                this.websocket.onclose = () => {
                    this.websocket = null;
                    setTimeout(() => this.connectWebSocket(), 5000);
                };

            } catch (e) {
                console.log('WebSocket not available');
            }
        }

        startPolling() {
            this.pollInterval = setInterval(() => this.poll(), 800);
            this.poll();
        }

        async poll() {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

            try {
                const response = await fetch(
                    `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                this.updateVisualization(data);
                this.consecutiveErrors = 0;

            } catch (error) {
                this.consecutiveErrors++;
                if (this.consecutiveErrors <= 3) {
                    console.warn(`Connection issue ${this.consecutiveErrors}/3`);
                }
            }
        }

        updateVisualization(data) {
            if (this.renderer) {
                this.renderer.updateClusters(data.clusters || []);
            }
        }
    }

    function initialize() {
        try {
            new InstantOverlay();
            console.log('🎯 Precise area-based overlay loaded');
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
