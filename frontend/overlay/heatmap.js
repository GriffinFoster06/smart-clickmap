// frontend/overlay/heatmap.js - Advanced HUD-style renderer with all visual effects
class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });

        // Ensure this renderer never blocks clicks in any embedding context
        this.canvas.style.pointerEvents = 'none';

        this.PERCENTAGE_THRESHOLD = 3;
        
        // Smart sizing bounds - enforced for readability
        this.MIN_VISUAL_SIZE = 45;  // Absolute minimum for legibility
        this.MAX_VISUAL_SIZE = 250; // Maximum before splitting
        this.OPTIMAL_TEXT_SIZE = 85; // Target size for comfortable reading

        this.springs = new Map(); // key -> {x,y,r,p,seed,complexity,sides}
        this.targets = new Map();
        this.animationId = null;
        this.lastTs = 0;
        this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.resize();
        this.start();
    }

    // ---------- ENHANCED ANIMATION HELPERS ----------
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

    // ---------- ENHANCED LAYOUT / DRAW ----------
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
        
        // Calculate smart sizes for all clusters first (for proportional sizing)
        const sizingContext = this._calculateSizingContext(filtered);

        for (const c of filtered) {
            const smartSize = this._calculateSmartSize(c, sizingContext);
            const complexity = c.complexity || c.irregularity || 0;
            const sides = c.preferredSides || this._decideSidesFromComplexity(complexity, c.percentage);

            const key = c.id ?? `${(c.x * 10000 | 0)}_${(c.y * 10000 | 0)}_${c.count | 0}`;
            nextTargets.set(key, { 
                x: c.x, 
                y: c.y, 
                r: smartSize, 
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
                    r: this._spring(smartSize, 12, 0.9),
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

    // ---------- INTELLIGENT SIZING ALGORITHM ----------
    _calculateSizingContext(clusters) {
        if (clusters.length === 0) return { maxPercentage: 0, maxSpread: 0, avgDensity: 1 };

        const percentages = clusters.map(c => c.percentage || 0);
        const spreads = clusters.map(c => c.spread || 0.05);
        const densities = clusters.map(c => c.density || 1);

        return {
            maxPercentage: Math.max(...percentages),
            minPercentage: Math.min(...percentages),
            maxSpread: Math.max(...spreads),
            avgDensity: densities.reduce((sum, d) => sum + d, 0) / densities.length,
            totalClusters: clusters.length
        };
    }

    _calculateSmartSize(cluster, context) {
        const percentage = cluster.percentage || 0;
        const spread = cluster.spread || 0.05;
        const density = cluster.density || 1;
        const count = cluster.count || 1;

        // 1. Base size from click volume (primary factor)
        const volumeRatio = percentage / Math.max(context.maxPercentage, 1);
        const volumeSize = this.MIN_VISUAL_SIZE + 
            (this.OPTIMAL_TEXT_SIZE - this.MIN_VISUAL_SIZE) * Math.pow(volumeRatio, 0.7);

        // 2. Spatial adjustment (secondary factor)
        const spatialRatio = spread / Math.max(context.maxSpread, 0.01);
        const spatialAdjustment = spatialRatio * 40; // Max +40px for spatial spread

        // 3. Density influence (tertiary factor)
        const densityRatio = density / Math.max(context.avgDensity, 1);
        const densityMultiplier = Math.pow(Math.max(0.5, Math.min(2.0, densityRatio)), 0.3);

        // 4. Count consideration (ensures minimum representation)
        const countBonus = Math.log10(count + 1) * 8; // Logarithmic bonus for click count

        // Combine factors
        let finalSize = (volumeSize + spatialAdjustment + countBonus) * densityMultiplier;

        // 5. Proportional scaling enforcement
        if (context.totalClusters > 1) {
            const proportion = percentage / context.maxPercentage;
            const minProportionalSize = this.MIN_VISUAL_SIZE + 
                (this.MAX_VISUAL_SIZE - this.MIN_VISUAL_SIZE) * Math.pow(proportion, 0.8);
            finalSize = Math.max(finalSize, minProportionalSize);
        }

        // 6. Enforce absolute bounds
        finalSize = Math.max(this.MIN_VISUAL_SIZE, Math.min(this.MAX_VISUAL_SIZE, finalSize));

        return finalSize;
    }

    _decideSidesFromComplexity(complexity, percentage) {
        // More complex shapes get more sides, higher percentages get more detail
        const complexityFactor = Math.max(0, Math.min(1, complexity));
        const percentageFactor = Math.min(1, percentage / 25); // 25% = full complexity
        
        const combinedFactor = complexityFactor * 0.7 + percentageFactor * 0.3;
        const sides = Math.round(6 + combinedFactor * 12); // 6-18 sides
        
        return Math.max(6, Math.min(20, sides));
    }

    // ---------- ADVANCED RENDERING ENGINE ----------
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

            // Enhanced color system with split cluster indication
            let fillColor, borderColor;
            if (isTop) { 
                fillColor = 'rgba(0, 255, 255, 0.2)'; 
                borderColor = 'rgba(0, 255, 255, 0.85)'; 
            }
            else if (d.percentage >= 15) { 
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

            // ADVANCED LABEL RENDERING with off-screen detection
            this._renderPercentageLabelCanvas(d.cx, d.cy, Math.round(d.percentage), r, isTop, d.isSplit);
        }
    }

    _shouldUsePolygon(drawable) {
        if (this.reduced) return false;
        
        // Use polygon for:
        // 1. High complexity clusters
        // 2. Large enough clusters (percentage > 15%)
        // 3. Sufficient visual size for detail
        const complexityThreshold = 0.3;
        const percentageThreshold = 15;
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

    // ---------- ADVANCED LABEL SYSTEM WITH OFF-SCREEN DETECTION ----------
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
        const gutter = 8; // Slightly larger gutter for better spacing
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
        const separated = dist > Math.max(0, radius - 4); // Slightly more separation

        return { box, center: { x: clampedLx, y: clampedLy }, separated };
    }

    _renderPercentageLabelCanvas(cx, cy, percentage, radius, isTop, isSplit) {
        const ctx = this.ctx;
        const str = `${percentage}%`;

        // Dynamic font sizing based on circle size and importance
        const baseFontSize = Math.max(16, Math.min(44, radius * 0.35));
        const fontSize = isTop ? baseFontSize * 1.1 : baseFontSize;
        
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const layout = this._computeLabelLayoutCanvas(cx, cy, str, fontSize, radius);

        // ENHANCED LEADER LINE FOR OFF-SCREEN LABELS
        if (layout.separated) {
            const ang = Math.atan2(layout.center.y - cy, layout.center.x - cx);
            const sx = cx + Math.cos(ang) * Math.max(0, radius - 6);
            const sy = cy + Math.sin(ang) * Math.max(0, radius - 6);

            const halfW = layout.box.w / 2, halfH = layout.box.h / 2;
            const ex = layout.center.x - Math.sign(Math.cos(ang)) * (halfW - 4);
            const ey = layout.center.y - Math.sign(Math.sin(ang)) * (halfH - 4);

            ctx.save();
            // Enhanced leader line styling
            const lineColor = isTop ? 'rgba(0, 255, 255, 0.85)' : 'rgba(147, 51, 234, 0.85)';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([4, 2]); // Subtle dash for elegance
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.setLineDash([]); // Reset line dash
            ctx.restore();
        }

        // Enhanced text rendering with better shadows
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        // Main text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(str, layout.center.x, layout.center.y);

        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Enhanced text outline
        const outlineColor = isTop ? 'rgba(0, 255, 255, 0.9)' : 'rgba(147, 51, 234, 0.9)';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = isSplit ? 1.5 : 1; // Thicker outline for split clusters
        ctx.strokeText(str, layout.center.x, layout.center.y);
        
        // Additional glow for top cluster
        if (isTop) {
            ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
            ctx.shadowBlur = 15;
            ctx.fillText(str, layout.center.x, layout.center.y);
        }
        
        ctx.restore();
    }

    // ---------- PUBLIC API ----------
    setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
    destroy() { this.stop(); }
}

// Legacy compatibility function
function drawBlobs(ctx, blobs) {
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
        id: blob.id
    }));
    renderer.updateClusters(clusters);
}

// Make classes globally available
window.HeatmapRenderer = HeatmapRenderer;
window.drawBlobs = drawBlobs;
