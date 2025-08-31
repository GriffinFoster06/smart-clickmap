// frontend/overlay/overlay.js
// Aspect-correct 16:9 projection, distribution-driven shapes, radial falloff,
// adaptive label contrast, smooth entrance/exit, optional trails, click-through.

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- Inert overlay root (never captures pointer events) ---
    let overlayRoot = document.getElementById('overlay-root');
    if (!overlayRoot) {
        overlayRoot = document.createElement('div');
        overlayRoot.id = 'overlay-root';
        document.body.appendChild(overlayRoot);
    }

    try {
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
        const style = document.createElement('style');
        style.textContent = `
      html, body { background: transparent !important; }
      #overlay-root, #overlay-root * { pointer-events: none !important; }
      #overlay-root { position: fixed; inset: 0; z-index: 2147483647; }
      #overlay-canvas {
        position: absolute; inset: 0;
        width: 100vw; height: 100vh;
        display: block; background: transparent !important;
        touch-action: none;
      }
    `;
        document.head.appendChild(style);
    } catch { }

    // Ensure a canvas exists
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

    // Perceptual luminance (0..1) from rgb (0..255)
    function luminance(r, g, b) {
        const srgb = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }

    // Critically damped spring
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

    // --- Distribution intelligence ---
    // infers non-circularity [0..1] from provided metrics; prefers backend hints when present.
    function inferNonCircularityScore(c) {
        let score = 0;

        if (typeof c.eccentricity === 'number') score = Math.max(score, Math.max(0, Math.min(1, c.eccentricity)));
        if (typeof c.axisRatio === 'number') score = Math.max(score, 1 - Math.max(0, Math.min(1, c.axisRatio)));
        if (typeof c.shapeScore === 'number') score = Math.max(score, Math.max(0, Math.min(1, c.shapeScore)));
        if (c.hints && c.hints.nonCircular === true) score = Math.max(score, 0.6);

        const spread = Number.isFinite(c.spread) ? Math.max(0, c.spread) : null;
        const maxSpread = Number.isFinite(c.maxSpread) ? Math.max(0, c.maxSpread) : null;
        const compactness = Number.isFinite(c.compactness) ? Math.max(0, Math.min(1, c.compactness)) : null;

        if (compactness !== null) {
            const dev = Math.abs(compactness - 0.60);
            score = Math.max(score, Math.min(1, dev / 0.40));
        }
        if (spread !== null && maxSpread !== null && maxSpread > 1e-6) {
            const ratio = spread / maxSpread;
            const dev = Math.abs(ratio - 0.60);
            score = Math.max(score, Math.min(1, dev / 0.40));
        }

        return Math.max(0, Math.min(1, score));
    }

    function decidePolygonSides(nonCirc, c) {
        if (typeof c?.sidesHint === 'number') return Math.max(3, Math.min(24, Math.round(c.sidesHint)));
        // slightly non-circular → 6-8 sides; very non-circular → up to 14
        const minSides = 6, maxSides = 14;
        return Math.round(minSides + (maxSides - minSides) * nonCirc);
    }

    // Get orientation (radians) of the elongated axis if provided; else stable pseudo-random from seed.
    function decideOrientation(c, seed) {
        if (Number.isFinite(c.orientation)) return c.orientation; // already radians
        if (Number.isFinite(c.angleDeg)) return (c.angleDeg * Math.PI) / 180;
        // fallback: stable angle from seed
        return (seed * Math.PI * 2) % (Math.PI * 2);
    }

    // Radial falloff fill (soft center → transparent edge)
    function radialFill(ctx, cx, cy, r, baseRGBA /* 'rgba(r,g,b,a)' */) {
        // Parse rgba to get rgb and alpha
        const m = /rgba?\(\s*(\d+)[^,]*,\s*(\d+)[^,]*,\s*(\d+)[^,]*(?:,\s*([\d.]+))?\s*\)/.exec(baseRGBA);
        let rr = 147, gg = 51, bb = 234, aa = 0.25;
        if (m) { rr = +m[1]; gg = +m[2]; bb = +m[3]; aa = m[4] != null ? +m[4] : 1; }

        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        // brighter/denser in the core; feather out to 0 at the rim
        g.addColorStop(0.0, `rgba(${rr},${gg},${bb},${Math.min(aa + 0.15, 0.4)})`);
        g.addColorStop(0.6, `rgba(${rr},${gg},${bb},${aa})`);
        g.addColorStop(1.0, `rgba(${rr},${gg},${bb},0)`);
        return g;
    }

    class PreciseAreaRenderer {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: true });
            this.canvas.style.pointerEvents = 'none';

            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_RADIUS = 80;
            this.MAX_RADIUS = 160;

            this.targetAspect = opts.targetAspect || 16 / 9;
            this.viewport = { x: 0, y: 0, width: 0, height: 0 };

            // Cluster state: springs + per-cluster display state
            this.springs = new Map(); // key -> {x,y,r,p,alpha,seed,nonCirc,orientation,sides}
            this.targets = new Map();

            // small, optional centroid trails
            this.trails = new Map(); // key -> [{x,y,t}, ...]
            this.TRAIL_MAX = 10;     // last N points
            this.TRAIL_SEC = 2.0;    // fade duration

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
                    if (!t) {
                        // fade out and shrink away when target is gone
                        s.alpha.setTarget(0);
                        s.r.setTarget(this.MIN_RADIUS * 0.6);
                        s.x.step(dt); s.y.step(dt); s.r.step(dt); s.p.step(dt); s.alpha.step(dt);
                        if (s.alpha.x <= 0.02) {
                            this.springs.delete(key);
                            this.trails.delete(key);
                        }
                        continue;
                    }
                    s.x.setTarget(t.x);
                    s.y.setTarget(t.y);
                    s.r.setTarget(t.r);
                    s.p.setTarget(t.p);
                    s.alpha.setTarget(1); // visible
                    s.nonCirc = s.nonCirc + (t.nonCirc - s.nonCirc) * Math.min(1, dt * 6);
                    s.orientation = t.orientation;
                    s.sides = t.sides;

                    s.x.step(dt); s.y.step(dt); s.r.step(dt); s.p.step(dt); s.alpha.step(dt);

                    // trail bookkeeping
                    const list = this.trails.get(key) || [];
                    const now = ts / 1000;
                    list.push({ x: s.x.x, y: s.y.x, t: now });
                    while (list.length > this.TRAIL_MAX) list.shift();
                    // prune old by age too
                    while (list.length && now - list[0].t > this.TRAIL_SEC) list.shift();
                    this.trails.set(key, list);
                }

                this.render(ts / 1000);
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }

        stop() { if (this.animationId) cancelAnimationFrame(this.animationId); this.animationId = null; }

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

        updateClusters(newClusters) {
            const filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            const nextTargets = new Map();
            for (const c of filtered) {
                // Size modeling: percentage + density + spread, clamped for readability
                const baseArea = this.MIN_RADIUS + (c.percentage * 2.5);
                const densityFactor = c.density ? Math.sqrt(c.density) : 1;
                const spreadRadius = c.radius || 0.05; // normalized from backend
                const effectiveRadius = Math.max(
                    this.MIN_RADIUS,
                    Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
                );

                // Distribution → polygon vs circle (non-circularity & sides)
                const nonCirc = inferNonCircularityScore(c);
                const sides = decidePolygonSides(nonCirc, c);
                const seed = hashSeed(c.x || 0, c.y || 0, c.percentage || 0, c.count || 1);
                const orientation = decideOrientation(c, seed);

                const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, {
                    x: c.x, y: c.y, r: effectiveRadius, p: c.percentage || 0,
                    nonCirc, sides, orientation
                });

                if (!this.springs.has(key)) {
                    // new: start slightly small and fade in
                    this.springs.set(key, {
                        x: new Spring(c.x, { omega: 9, zeta: 0.95 }),
                        y: new Spring(c.y, { omega: 9, zeta: 0.95 }),
                        r: new Spring(Math.max(this.MIN_RADIUS * 0.6, effectiveRadius * 0.85), { omega: 12, zeta: 0.9 }),
                        p: new Spring(c.percentage || 0, { omega: 7, zeta: 1.0 }),
                        alpha: new Spring(0.0, { omega: 8, zeta: 1.0 }),
                        seed,
                        nonCirc,
                        orientation,
                        sides
                    });
                }
            }

            // any missing target will fade out in RAF loop
            this.targets = nextTargets;

            if (REDUCED_MOTION) {
                // Snap to targets immediately if reduced motion requested
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (t) {
                        s.x.jump(t.x); s.y.jump(t.y); s.r.jump(t.r); s.p.jump(t.p); s.alpha.jump(1);
                        s.nonCirc = t.nonCirc; s.orientation = t.orientation; s.sides = t.sides;
                    } else {
                        s.alpha.jump(0);
                    }
                }
                this.render(performance.now() / 1000);
            }
        }

        // ---------- drawing ----------
        render(tSec = 0) {
            const cssW = this.canvas.width / (window.devicePixelRatio || 1);
            const cssH = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, cssW, cssH);

            const { x: vx, y: vy, width: vw, height: vh } = this.viewport;

            const drawables = [];
            for (const [key, s] of this.springs.entries()) {
                const alpha = Math.max(0, Math.min(1, s.alpha.x));
                if (alpha <= 0.01) continue;

                const cx = vx + s.x.x * vw;
                const cy = vy + s.y.x * vh;

                drawables.push({
                    key,
                    cx, cy,
                    radius: s.r.x,
                    percentage: s.p.x,
                    seed: s.seed,
                    nonCirc: s.nonCirc,
                    sides: s.sides,
                    orientation: s.orientation,
                    alpha
                });
            }

            // draw in ascending % so top shows last
            drawables.sort((a, b) => a.percentage - b.percentage);

            // Optional trails (very subtle)
            for (let i = 0; i < drawables.length; i++) {
                this.renderTrail(drawables[i], tSec, vw, vh, vx, vy);
            }

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;

                const wobbleAmp = Math.min(0.12, 0.06 + (d.percentage / 100) * 0.08);
                const r = REDUCED_MOTION ? d.radius : d.radius * wobble(tSec, d.seed, 1.0, wobbleAmp);

                // Color scheme (top = cyan, others = purple)
                let fillBase, strokeBaseRGB;
                if (isTop) {
                    fillBase = 'rgba(0, 255, 255, 0.20)';
                    strokeBaseRGB = '0,255,255';
                } else if (d.percentage >= 15) {
                    fillBase = 'rgba(147, 51, 234, 0.25)';
                    strokeBaseRGB = '147,51,234';
                } else {
                    fillBase = 'rgba(147, 51, 234, 0.20)';
                    strokeBaseRGB = '147,51,234';
                }

                const needsPolygon = d.nonCirc > 0.25 && !REDUCED_MOTION;

                // Fill with radial falloff (soft center → transparent edge)
                const g = radialFill(this.ctx, d.cx, d.cy, r, fillBase);
                this.ctx.globalAlpha = d.alpha;
                if (needsPolygon) {
                    this.renderPolygonArea(d.cx, d.cy, r, g, `rgba(${strokeBaseRGB},0.9)`, tSec, d.seed, d.nonCirc, d.sides, d.orientation);
                } else {
                    this.renderCircularArea(d.cx, d.cy, r, g, `rgba(${strokeBaseRGB},0.9)`);
                }
                this.ctx.globalAlpha = 1;

                this._renderPercentageLabel(d.cx, d.cy, Math.round(d.percentage), r, isTop, strokeBaseRGB, needsPolygon);
            }
        }

        renderTrail(d, tSec, vw, vh, vx, vy) {
            const list = this.trails.get(d.key);
            if (!list || list.length < 2) return;
            const now = tSec;
            const ctx = this.ctx;
            ctx.save();
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            // faint, color-matched trail
            const base = (d.sides && d.nonCirc > 0.25) ? '147,51,234' : (d.percentage >= 15 ? '147,51,234' : '147,51,234');
            // cyan for top cluster trail
            const rgb = (d === this._topDrawable) ? '0,255,255' : base;

            for (let i = 1; i < list.length; i++) {
                const a = list[i - 1], b = list[i];
                const age = Math.min(1, (now - a.t) / this.TRAIL_SEC);
                const alpha = (1 - age) * 0.12; // very subtle
                if (alpha <= 0) continue;

                ctx.strokeStyle = `rgba(${rgb},${alpha})`;
                ctx.beginPath();
                ctx.moveTo(vx + a.x * vw, vy + a.y * vh);
                ctx.lineTo(vx + b.x * vw, vy + b.y * vh);
                ctx.stroke();
            }
            ctx.restore();
        }

        renderCircularArea(cx, cy, radius, fillStyle, borderColor) {
            const ctx = this.ctx;

            // Fill
            ctx.fillStyle = fillStyle;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Inner highlight ring
            ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
            ctx.stroke();
        }

        renderPolygonArea(cx, cy, radius, fillStyle, borderColor, tSec, seed, nonCirc, sides, orientationRad) {
            const ctx = this.ctx;
            const s = Math.max(3, Math.min(24, Math.round(sides || 8)));
            const ampBase = 0.04 + 0.10 * Math.min(1, nonCirc);

            // Draw with a global rotation so the polygon can align with distribution orientation
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(orientationRad || 0);
            ctx.beginPath();
            for (let i = 0; i <= s; i++) {
                const a = (i / s) * Math.PI * 2;
                const local = wobble(tSec + i * 0.07, seed * 0.73, 1.0, ampBase);
                const rr = radius * (0.94 + 0.08 * local);
                const x = Math.cos(a) * rr;
                const y = Math.sin(a) * rr;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();

            // Fill (gradient already centered at cx,cy; since we rotated, approximate by using fillStyle as is)
            // We can't "rotate" a gradient; but the radial gradient is rotationally symmetric—perfect.
            ctx.fillStyle = fillStyle;
            ctx.fill();

            // Stroke
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();

            // Inner highlight ring (approx as a circle to keep cheap & clean)
            ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ---------- labels (adaptive contrast; leader only when outside) ----------
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

            // Start centered
            let lx = cx, ly = cy;

            // Keep text inside viewport gutters
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

            // If the text rect intersects the blob, we keep it inside (no leader)
            const dist = this._pointRectDistance(cx, cy, box.x, box.y, box.w, box.h);
            const separated = dist > Math.max(0, radius - 2);

            return { box, center: { x: clampedLx, y: clampedLy }, separated };
        }

        _renderPercentageLabel(cx, cy, percentage, radius, isTop, strokeBaseRGB, shapeIsPolygon) {
            const ctx = this.ctx;
            const str = `${percentage}%`;

            const fontSize = Math.max(22, Math.min(40, radius * 0.35));
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const layout = this._computeLabelLayout(cx, cy, str, fontSize, radius);

            // Leader line only when the label had to be moved outside
            if (layout.separated) {
                const ang = Math.atan2(layout.center.y - cy, layout.center.x - cx);
                const sx = cx + Math.cos(ang) * Math.max(0, radius - 4);
                const sy = cy + Math.sin(ang) * Math.max(0, radius - 4);

                const halfW = layout.box.w / 2, halfH = layout.box.h / 2;
                const ex = layout.center.x - Math.sign(Math.cos(ang)) * (halfW - 2);
                const ey = layout.center.y - Math.sign(Math.sin(ang)) * (halfH - 2);

                ctx.save();
                ctx.strokeStyle = `rgba(${strokeBaseRGB},0.85)`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
                ctx.restore();
            }

            // Adaptive label contrast:
            // heuristic: if label is outside (over unknown video content), prefer black text + colored stroke;
            // if inside the (often darker) blob, prefer white text + colored stroke.
            // (If you later expose local frame luminance, plug it here.)
            const insideBlob = !layout.separated;
            let fillColor = insideBlob ? '#ffffff' : '#000000';

            // If top is cyan (bright), and inside, check perceived brightness—flip to black if too bright.
            if (insideBlob && isTop) {
                const L = luminance(0, 255, 255); // cyan perceived luminance
                if (L > 0.7) fillColor = '#000000';
            }

            ctx.save();
            // Soft shadow to keep readable on any video
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            ctx.fillStyle = fillColor;
            ctx.fillText(str, layout.center.x, layout.center.y);

            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = `rgba(${strokeBaseRGB},0.9)`;
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
            console.log(`🎯 Smart ClickMap overlay connected to: ${this.channelId}`);
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
            // Try both ?channel and /ws/<id>
            try {
                const wsBase = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
                const candidates = [
                    `${wsBase}/ws?channel=${encodeURIComponent(this.channelId)}`,
                    `${wsBase}/ws/${this.channelId}`
                ];
                const tryConnect = (idx = 0) => {
                    const url = candidates[idx % candidates.length];
                    let ws;
                    try { ws = new WebSocket(url); } catch { return setTimeout(() => tryConnect(idx + 1), 3000); }

                    ws.onopen = () => { this.websocket = ws; };
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            this.updateVisualization(data);
                        } catch (e) { console.warn('WebSocket parse error:', e); }
                    };
                    ws.onerror = () => { try { ws.close(); } catch { } };
                    ws.onclose = () => {
                        if (this.websocket === ws) this.websocket = null;
                        setTimeout(() => tryConnect(idx + 1), 3000);
                    };
                };
                tryConnect(0);
            } catch {
                console.log('WebSocket not available');
            }
        }

        startPolling() {
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
            console.log('🎯 Overlay loaded (distribution shapes + radial falloff + adaptive labels + smooth I/O)');
        } catch (error) { console.error('Failed to initialize overlay:', error); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
