// frontend/heatmap.js - FIXED version with proper sizing and 25% threshold
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });

        // Ensure this renderer never blocks clicks in any embedding context
        this.canvas.style.pointerEvents = 'none';

        this.PERCENTAGE_THRESHOLD = 25;  // FIXED: Changed from 3% to 25%
        
        // FIXED sizing bounds to match backend
        this.MIN_VISUAL_SIZE = 45;   // 25% minimum
        this.TARGET_100_SIZE = 85;   // 100% target size (user's request)
        this.MAX_VISUAL_SIZE = 120;  // Maximum size cap

        this.springs = new Map(); // key -> {x,y,r,p,seed,complexity,sides}
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
                s.complexity = t.complexity; s.sides = t.sides;
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
            // FIXED: Use backend's calculated size directly, or calculate consistently
            const visualSize = c.visualSize || this._calculateConsistentSize(c);
            const complexity = c.complexity || c.irregularity || 0;
            const sides = c.preferredSides || this._decideSidesFromComplexity(complexity, c.percentage);

            const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
            nextTargets.set(key, { 
                x: c.x, 
                y: c.y, 
                r: visualSize, 
                p: c.percentage || 0, 
                count: c.count || 1,
                complexity: complexity,
                sides: sides,
                density: c.density || 1,
                spread: c.spread || 0.05,
                eccentricity: c.eccentricity || 0,
                isSplit: c.isSplit || false
            });

            if (!this.springs.has(key)) {
                const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                this.springs.set(key, {
                    x: this._spring(c.x, 9, 0.95),
                    y: this._spring(c.y, 9, 0.95),
                    r: this._spring(visualSize, 12, 0.9),
                    p: this._spring(c.percentage || 0, 7, 1.0),
                    seed,
                    complexity: complexity,
                    sides: sides
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
                if (!t) continue;
                s.x.x = s.x.t = t.x; s.x.v = 0;
                s.y.x = s.y.t = t.y; s.y.v = 0;
                s.r.x = s.r.t = t.r; s.r.v = 0;
                s.p.x = s.p.t = t.p; s.p.v = 0;
                s.complexity = t.complexity; s.sides = t.sides;
            }
            this.render(performance.now() / 1000);
        }
    }

    // FIXED: Consistent size calculation matching backend
    _calculateConsistentSize(cluster) {
        const percentage = cluster.percentage || 0;
        
        // Match backend sizing exactly
        if (percentage >= 100) {
            return this.TARGET_100_SIZE;
        } else if (percentage >= 25) {
            // Linear interpolation between 25% and 100%
            const progress = (percentage - 25) / 75; // 0 to 1
            return this.MIN_VISUAL_SIZE + (this.TARGET_100_SIZE - this.MIN_VISUAL_SIZE) * progress;
        } else {
            // Below threshold, but still visible
            return this.MIN_VISUAL_SIZE * 0.8;
        }
    }

    _decideSidesFromComplexity(complexity, percentage) {
        // More complex shapes get more sides, higher percentages get more detail
        const complexityFactor = Math.max(0, Math.min(1, complexity));
        const percentageFactor = Math.min(1, percentage / 50); // Adjusted for 25% threshold
        
        const combinedFactor = complexityFactor * 0.7 + percentageFactor * 0.3;
        const sides = Math.round(6 + combinedFactor * 10); // 6-16 sides
        
        return Math.max(6, Math.min(16, sides));
    }

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
                isSplit: target?.isSplit || false
            });
        }
        
        // Sort by percentage for proper layering
        drawables.sort((a, b) => a.percentage - b.percentage);

        for (let i = 0; i < drawables.length; i++) {
            const d = drawables[i];
            const isTop = i === drawables.length - 1;

            const wobbleAmp = Math.min(0.12, 0.06 + (d.percentage / 100) * 0.08);
            const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, wobbleAmp);

            // Enhanced color system
            let fillColor, borderColor;
            if (isTop) { 
                fillColor = 'rgba(0, 255, 255, 0.2)'; 
                borderColor = 'rgba(0, 255, 255, 0.85)'; 
            }
            else if (d.percentage >= 50) { 
                fillColor = d.isSplit ? 'rgba(147, 51, 234, 0.15)' : 'rgba(147, 51, 234, 0.25)'; 
                borderColor = d.isSplit ? 'rgba(147, 51, 234, 0.7)' : 'rgba(147, 51, 234, 0.9)'; 
            }
            else { 
                fillColor = d.isSplit ? 'rgba(147, 51, 234, 0.1)' : 'rgba(147, 51, 234, 0.2)'; 
                borderColor = d.isSplit ? 'rgba(147, 51, 234, 0.5)' : 'rgba(147, 51, 234, 0.7)'; 
            }

            // Adaptive shape selection
            const usePolygon = this._shouldUsePolygon(d);
            if (usePolygon) {
                this.renderAdaptivePolygonArea(d.cx, d.cy, r, fillColor, borderColor, tSec, d.seed, d);
            } else {
                this.renderCircularArea(d.cx, d.cy, r, fillColor, borderColor);
            }

            this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop, d.isSplit);
        }
    }

    _shouldUsePolygon(drawable) {
        if (this.reduced) return false;
        
        // Use polygon for higher complexity or larger clusters
        const complexityThreshold = 0.3;
        const percentageThreshold = 50; // Adjusted for 25% minimum
        const sizeThreshold = 60;
        
        return (drawable.complexity > complexityThreshold) ||
               (drawable.percentage > percentageThreshold && drawable.radius > sizeThreshold);
    }

    renderCircularArea(cx, cy, radius, fillColor, borderColor) {
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        // Inner ring for depth
        this.ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius - 6, 0, 2 * Math.PI);
        this.ctx.stroke();
    }

    renderAdaptivePolygonArea(cx, cy, radius, fillColor, borderColor, tSec, seed, drawable) {
        const sides = drawable.sides;
        const complexity = drawable.complexity;
        
        // More complex shapes have more irregular vertices
        const irregularityFactor = complexity * 0.15;
        
        this.ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            
            // Base wobble + complexity-based irregularity
            const baseWobble = this._wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
            const irregularWobble = this._wobble(tSec * 0.3 + i * 0.2, seed * 1.17, 1.0, irregularityFactor);
            
            const rr = radius * (0.94 + 0.08 * baseWobble + 0.04 * irregularWobble);
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

    // Enhanced label system with better positioning for new sizes
    _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop, isSplit) {
        const ctx = this.ctx;
        const str = `${percentage}%`;

        // FIXED: Adjusted font sizing for new size ranges
        const baseFontSize = Math.max(16, Math.min(32, radius * 0.35));
        const fontSize = isTop ? baseFontSize * 1.1 : baseFontSize;
        
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Enhanced text rendering
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Main text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(str, cx, cy);

        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Enhanced text outline
        const outlineColor = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = isSplit ? 1.5 : 1;
        ctx.strokeText(str, cx, cy);
        
        // Additional glow for top cluster
        if (isTop) {
            ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
            ctx.shadowBlur = 12;
            ctx.fillText(str, cx, cy);
        }
        
        ctx.restore();
    }

    // ---------- public ----------
    setThreshold(threshold) { 
        this.PERCENTAGE_THRESHOLD = Math.max(25, threshold); // FIXED: Minimum 25%
    }
    destroy() { this.stop(); }
}

// Legacy compatibility
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = (blobs || []).map(blob => ({
        x: blob.x, y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        density: blob.density || 1,
        radius: blob.radius || 0.05,
        spread: blob.spread || 0.05,
        complexity: blob.complexity || blob.irregularity || 0,
        eccentricity: blob.eccentricity || 0,
        preferredSides: blob.preferredSides || blob.sides,
        isSplit: blob.isSplit || false,
        id: blob.id,
        visualSize: blob.visualSize // Use backend calculated size
    }));
    renderer.updateClusters(clusters);
}
