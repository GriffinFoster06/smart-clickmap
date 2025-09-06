// frontend/overlay/heatmap.js - Advanced HUD-style heatmap renderer (full original sophistication)

// Advanced HeatmapRenderer class with all original sophistication
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });

        // Ensure this renderer never blocks clicks in any embedding context
        this.canvas.style.pointerEvents = 'none';

        this.PERCENTAGE_THRESHOLD = 3;
        this.MIN_RADIUS = 80;
        this.MAX_RADIUS = 160;

        this.springs = new Map(); // key -> {x,y,r,p,seed}
        this.targets = new Map();
        this.animationId = null;
        this.lastTs = 0;
        this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.resize();
        this.start();
    }

    // ---------- animation helpers ----------
    _spring(value = 0, omega = 10, zeta = 1) { return { x: value, v: 0, o: omega, z: zeta, t: value }; }
    _stepSpring(s, dt) {
        const f = -s.o * s.o * (s.x - s.t) - 2 * s.z * s.o * s.v;
        s.v += f * dt; s.x += s.v * dt; return s.x;
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
            }

            this.render(ts / 1000);
            this.animationId = requestAnimationFrame(loop);
        };
        this.animationId = requestAnimationFrame(loop);
    }

    stop() { if (this.animationId) cancelAnimationFrame(this.animationId); this.animationId = null; }

    // ---------- layout / draw ----------
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

    updateClusters(newClusters) {
        const filtered = (newClusters || [])
            .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

        const nextTargets = new Map();
        for (const c of filtered) {
            const baseArea = this.MIN_RADIUS + (c.percentage * 2.5);
            const densityFactor = c.density ? Math.sqrt(c.density) : 1;
            const spreadRadius = c.radius || 0.05;
            const rEff = Math.max(
                this.MIN_RADIUS,
                Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
            );

            const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
            nextTargets.set(key, { x: c.x, y: c.y, r: rEff, p: c.percentage || 0, count: c.count || 1 });

            if (!this.springs.has(key)) {
                const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                this.springs.set(key, {
                    x: this._spring(c.x, 9, 0.95),
                    y: this._spring(c.y, 9, 0.95),
                    r: this._spring(rEff, 12, 0.9),
                    p: this._spring(c.percentage || 0, 7, 1.0),
                    seed
                });
            }
        }
        for (const key of [...this.springs.keys()]) {
            if (!nextTargets.has(key)) this.springs.delete(key);
        }
        this.targets = nextTargets;

        if (this.reduced) {
            for (const [key, s] of this.springs.entries()) {
                const t = this.targets.get(key);
                s.x.x = s.x.t = t.x; s.x.v = 0;
                s.y.x = s.y.t = t.y; s.y.v = 0;
                s.r.x = s.r.t = t.r; s.r.v = 0;
                s.p.x = s.p.t = t.p; s.p.v = 0;
            }
            this.render(performance.now() / 1000);
        }
    }

    render(tSec = 0) {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);
        this.ctx.clearRect(0, 0, W, H);

        const drawables = [];
        for (const [key, s] of this.springs.entries()) {
            drawables.push({ key, cx: s.x.x * W, cy: s.y.x * H, radius: s.r.x, percentage: s.p.x, seed: s.seed });
        }
        drawables.sort((a, b) => a.percentage - b.percentage);

        for (let i = 0; i < drawables.length; i++) {
            const d = drawables[i];
            const isTop = i === drawables.length - 1;

            const wobbleAmp = Math.min(0.12, 0.06 + (d.percentage / 100) * 0.08);
            const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, wobbleAmp);

            let fillColor, borderColor;
            if (isTop) { fillColor = 'rgba(0, 255, 255, 0.2)'; borderColor = 'rgba(0, 255, 255, 0.85)'; }
            else if (d.percentage >= 15) { fillColor = 'rgba(147, 51, 234, 0.25)'; borderColor = 'rgba(147, 51, 234, 0.9)'; }
            else { fillColor = 'rgba(147, 51, 234, 0.2)'; borderColor = 'rgba(147, 51, 234, 0.7)'; }

            const usePoly = (d.percentage >= 20) && !this.reduced;
            if (usePoly) this.renderPolygonArea(d.cx, d.cy, r, fillColor, borderColor, tSec, d.seed, d.percentage);
            else this.renderCircularArea(d.cx, d.cy, r, fillColor, borderColor);

            this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop);
        }
    }

    renderCircularArea(cx, cy, radius, fillColor, borderColor) {
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        this.ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius - 6, 0, 2 * Math.PI);
        this.ctx.stroke();
    }

    renderPolygonArea(cx, cy, radius, fillColor, borderColor, tSec, seed, pct) {
        const sides = Math.max(8, Math.min(16, 6 + Math.floor(pct / 7)));
        this.ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            const local = this._wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
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

    // ---------- label helpers (NO PILL) ----------
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
        const gutter = 6;
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
        const separated = dist > Math.max(0, radius - 2);

        return { box, center: { x: clampedLx, y: clampedLy }, separated };
    }

    _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop) {
        const ctx = this.ctx;
        const str = `${percentage}%`;

        const fontSize = Math.max(22, Math.min(40, radius * 0.35));
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const layout = this._computeLabelLayoutCanvas(cx, cy, str, fontSize, radius);

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

        // Text only (no background box)
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

    // ---------- public ----------
    setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
    destroy() { this.stop(); }
}

// Legacy compatibility function
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = (blobs || []).map(blob => ({
        x: blob.x, y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        density: blob.density || 1,
        radius: blob.radius || 0.05,
        id: blob.id
    }));
    renderer.updateClusters(clusters);
}
