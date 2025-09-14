// frontend/overlay/heatmap.js - OPTIMIZED with enhanced readable percentages
class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { 
            alpha: true,
            desynchronized: true,
            powerPreference: 'high-performance'
        });

        // Ensure this renderer never blocks clicks in any embedding context
        this.canvas.style.pointerEvents = 'none';

        this.PERCENTAGE_THRESHOLD = 3;
        
        // PRESERVE: Original sophisticated sizing bounds for visual excellence
        this.MIN_VISUAL_SIZE = 45;
        this.MAX_VISUAL_SIZE = 250;
        this.OPTIMAL_TEXT_SIZE = 85;

        // PRESERVE: Complete animation system with all original features
        this.springs = new Map(); // key -> {x,y,r,p,seed,complexity,sides,shape}
        this.targets = new Map();
        this.animationId = null;
        this.lastTs = 0;
        this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Performance tracking for 5-second optimization
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.fps = 60;
        this.updateCount = 0;

        this.resize();
        this.start();
        
        console.log('🎨 Optimized renderer with ENHANCED readable text initialized');
    }

    // ========== PRESERVE: COMPLETE ORIGINAL ANIMATION SYSTEM ==========
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

            // Performance tracking optimized for 5-second intervals
            this.frameCount++;
            if (ts - this.lastRenderTime > 5000) { // Log every 5 seconds
                this.fps = Math.round(this.frameCount * 1000 / (ts - this.lastRenderTime));
                this.frameCount = 0;
                this.lastRenderTime = ts;
                
                if (this.targets.size > 0) {
                    console.log(`🎨 Enhanced Renderer: ${this.fps} FPS, ${this.targets.size} active clusters`);
                }
            }

            // PRESERVE: Complete spring physics system with all features
            for (const [key, s] of this.springs.entries()) {
                const t = this.targets.get(key);
                if (!t) continue;
                
                s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                
                // PRESERVE: All sophisticated cluster properties
                s.complexity = t.complexity || 0; 
                s.sides = t.sides || 8;
                s.shapeType = t.shapeType || 'circle';
                s.eccentricity = t.eccentricity || 0;
                s.irregularity = t.irregularity || 0;
                s.density = t.density || 1;
                s.circularity = t.circularity || 1;
                s.convexity = t.convexity || 1;
                
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

    // PRESERVE: Complete cluster processing with ALL sophisticated features
    updateClusters(newClusters) {
        this.updateCount++;
        
        const filtered = (newClusters || [])
            .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

        if (this.updateCount % 3 === 1 || filtered.length > 0) {
            console.log(`🎨 Update #${this.updateCount}: ${filtered.length} clusters with ENHANCED text`);
        }

        const nextTargets = new Map();
        
        for (const c of filtered) {
            // PRESERVE: Use backend's sophisticated visual size calculation
            const visualRadius = c.visualSize || this.fallbackSizeCalculation(c);
            
            // PRESERVE: ALL original cluster properties for maximum visual sophistication
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
                
                // PRESERVE: All sophisticated visual properties
                complexity: complexity,
                sides: sides,
                shapeType: shapeType,
                density: c.density || 1,
                spread: c.spread || 0.05,
                maxSpread: c.maxSpread || c.radius || 0.05,
                eccentricity: c.eccentricity || 0,
                irregularity: c.irregularity || 0,
                circularity: c.circularity || 1,
                convexity: c.convexity || 1,
                shapeConfidence: c.shapeConfidence || 1,
                
                // PRESERVE: Special states
                isSplit: c.isSplit || false,
                isTop: c.isTop || false
            });

            if (!this.springs.has(key)) {
                const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                this.springs.set(key, {
                    // PRESERVE: Original sophisticated spring configuration
                    x: this._spring(c.x, 9, 0.95),
                    y: this._spring(c.y, 9, 0.95),
                    r: this._spring(visualRadius, 12, 0.9),
                    p: this._spring(c.percentage || 0, 7, 1.0),
                    seed,
                    
                    // PRESERVE: All visual complexity properties
                    complexity: complexity,
                    sides: sides,
                    shapeType: shapeType,
                    eccentricity: c.eccentricity || 0,
                    irregularity: c.irregularity || 0,
                    density: c.density || 1,
                    circularity: c.circularity || 1,
                    convexity: c.convexity || 1
                });
            }
        }
        
        // Clean up old clusters
        for (const key of [...this.springs.keys()]) {
            if (!nextTargets.has(key)) this.springs.delete(key);
        }
        this.targets = nextTargets;

        // Immediate update for reduced motion accessibility
        if (this.reduced) {
            for (const [key, s] of this.springs.entries()) {
                const t = this.targets.get(key);
                if (!t) continue;
                s.x.x = s.x.t = t.x; s.x.v = 0;
                s.y.x = s.y.t = t.y; s.y.v = 0;
                s.r.x = s.r.t = t.r; s.r.v = 0;
                s.p.x = s.p.t = t.p; s.p.v = 0;
                
                // PRESERVE: All sophisticated properties
                s.complexity = t.complexity; 
                s.sides = t.sides;
                s.shapeType = t.shapeType;
                s.eccentricity = t.eccentricity;
                s.irregularity = t.irregularity;
                s.density = t.density;
                s.circularity = t.circularity;
                s.convexity = t.convexity;
            }
            this.render(performance.now() / 1000);
        }
    }

    // PRESERVE: Original sophisticated sizing decisions
    _decideSidesFromComplexity(complexity, percentage) {
        const complexityFactor = Math.max(0, Math.min(1, complexity));
        const percentageFactor = Math.min(1, percentage / 25); // 25% = full complexity
        
        const combinedFactor = complexityFactor * 0.7 + percentageFactor * 0.3;
        const sides = Math.round(6 + combinedFactor * 12); // 6-18 sides
        
        return Math.max(6, Math.min(20, sides));
    }

    fallbackSizeCalculation(cluster) {
        // PRESERVE: Original sophisticated fallback calculation
        const baseSize = 65;
        const percentage = cluster.percentage || 0;
        const activityBonus = Math.sqrt(percentage / 100) * 140;
        const densityBonus = Math.min(45, (cluster.density || 1) * 10);
        const countBonus = Math.log10((cluster.count || 1) + 1) * 15;
        const spreadBonus = (cluster.spread || 0.05) * 300;
        
        return Math.max(baseSize, Math.min(280, baseSize + activityBonus + densityBonus + countBonus + spreadBonus));
    }

    // ========== RENDER ENGINE WITH ENHANCED TEXT ==========
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
                
                // PRESERVE: All sophisticated visual properties
                complexity: s.complexity || 0,
                sides: s.sides || 8,
                shapeType: s.shapeType || 'circle',
                eccentricity: s.eccentricity || 0,
                irregularity: s.irregularity || 0,
                density: s.density || 1,
                circularity: s.circularity || 1,
                convexity: s.convexity || 1,
                
                // PRESERVE: Special states
                isSplit: target?.isSplit || false,
                isTop: target?.isTop || false
            });
        }
        
        // Sort by percentage for proper layering (smaller first, top last)
        drawables.sort((a, b) => a.percentage - b.percentage);

        for (let i = 0; i < drawables.length; i++) {
            const d = drawables[i];
            const isTop = i === drawables.length - 1;
            d.isTop = isTop; // Update top status for this render

            // PRESERVE: Original sophisticated wobble effects with all complexity factors
            const baseWobbleAmp = this.reduced ? 0 : 0.04;
            const activityWobble = (d.percentage / 100) * 0.08;
            const complexityWobble = d.complexity * 0.06;
            const eccentricityWobble = d.eccentricity * 0.03;
            const densityWobble = Math.max(0, (d.density - 1) * 0.02);
            
            const totalWobble = baseWobbleAmp + activityWobble + complexityWobble + eccentricityWobble + densityWobble;
            const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, totalWobble);

            // PRESERVE: Enhanced color system with all original sophistication
            const colors = this.calculateAdvancedColors(d, isTop);

            // PRESERVE: Adaptive shape selection based on sophistication
            const usePolygon = this._shouldUsePolygon(d);
            if (usePolygon) {
                this.renderAdvancedPolygonArea(d.cx, d.cy, r, colors, tSec, d.seed, d);
            } else {
                this.renderEnhancedCircularArea(d.cx, d.cy, r, colors, isTop, d);
            }

            // ENHANCED: New super-readable label rendering
            this._renderSuperReadablePercentageLabel(d.cx, d.cy, Math.round(d.percentage), r, isTop, d.isSplit, d.complexity);
        }
    }

    // PRESERVE: Original sophisticated shape decision logic
    _shouldUsePolygon(drawable) {
        if (this.reduced) return false;
        
        const complexityThreshold = 0.3;
        const percentageThreshold = 15;
        const sizeThreshold = 60;
        const densityThreshold = 1.5;
        
        return (drawable.complexity > complexityThreshold) ||
               (drawable.percentage > percentageThreshold && drawable.radius > sizeThreshold) ||
               (drawable.shapeType === 'polygon') ||
               (drawable.density > densityThreshold && drawable.percentage > 10);
    }

    // PRESERVE: Advanced sophisticated color calculation
    calculateAdvancedColors(drawable, isTop) {
        const percentage = drawable.percentage;
        const density = drawable.density;
        const complexity = drawable.complexity;
        const circularity = drawable.circularity;
        
        // Top cluster gets cyan theme
        if (isTop) {
            return {
                fill: `rgba(0, 255, 255, ${0.15 + complexity * 0.1 + (1 - circularity) * 0.05})`,
                border: `rgba(0, 255, 255, 0.85)`,
                glow: `rgba(0, 255, 255, 0.6)`,
                accent: `rgba(0, 255, 255, 0.4)`
            };
        } else if (percentage >= 25) {
            // High-percentage clusters get enhanced purple
            return {
                fill: drawable.isSplit ? 
                    `rgba(147, 51, 234, ${0.15 + complexity * 0.05 + density * 0.02})` : 
                    `rgba(147, 51, 234, ${0.2 + complexity * 0.05 + density * 0.02})`,
                border: drawable.isSplit ? 
                    `rgba(147, 51, 234, 0.7)` : 
                    `rgba(147, 51, 234, 0.9)`,
                glow: `rgba(147, 51, 234, 0.5)`,
                accent: `rgba(147, 51, 234, 0.3)`
            };
        } else {
            // Lower-percentage clusters get subtle purple
            return {
                fill: drawable.isSplit ? 
                    `rgba(147, 51, 234, ${0.1 + complexity * 0.05 + density * 0.01})` : 
                    `rgba(147, 51, 234, ${0.15 + complexity * 0.05 + density * 0.01})`,
                border: drawable.isSplit ? 
                    `rgba(147, 51, 234, 0.5)` : 
                    `rgba(147, 51, 234, 0.75)`,
                glow: `rgba(147, 51, 234, 0.35)`,
                accent: `rgba(147, 51, 234, 0.2)`
            };
        }
    }

    // PRESERVE: Enhanced circular area rendering with all sophistication
    renderEnhancedCircularArea(cx, cy, radius, colors, isTop, drawable) {
        const ctx = this.ctx;
        
        // PRESERVE: Main circle with enhanced effects based on properties
        ctx.fillStyle = colors.fill;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fill();

        // PRESERVE: Multi-layer border system with complexity awareness
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = isTop ? 4 : (drawable.complexity > 0.5 ? 3.5 : 3);
        ctx.stroke();

        // PRESERVE: Inner detail ring for depth with density awareness
        const innerRingOpacity = Math.min(0.5, 0.2 + drawable.density * 0.1);
        ctx.strokeStyle = colors.border.replace(/[\d\.]+\)$/g, `${innerRingOpacity})`);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, radius - 8), 0, 2 * Math.PI);
        ctx.stroke();

        // PRESERVE: Glow effect for top clusters with enhanced sophistication
        if (isTop) {
            ctx.save();
            ctx.shadowColor = colors.glow;
            ctx.shadowBlur = 15 + drawable.complexity * 5;
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // PRESERVE: Additional complexity indicators
        if (drawable.complexity > 0.7) {
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 4, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }

    // PRESERVE: Advanced polygon rendering with full sophistication
    renderAdvancedPolygonArea(cx, cy, radius, colors, tSec, seed, drawable) {
        const ctx = this.ctx;
        const sides = drawable.sides;
        const complexity = drawable.complexity;
        const eccentricity = drawable.eccentricity;
        const irregularity = drawable.irregularity;
        const circularity = drawable.circularity;
        
        // PRESERVE: Complex shape generation with all factors
        const irregularityFactor = complexity * 0.15;
        const eccentricityFactor = eccentricity * 0.2;
        const circularityFactor = (1 - circularity) * 0.1;
        
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            
            // PRESERVE: Multi-layer wobble system with all sophistication
            const baseWobble = this._wobble(tSec + i * 0.07, seed * 0.73, 1.0, 0.06);
            const irregularWobble = this._wobble(tSec * 0.3 + i * 0.2, seed * 1.17, 1.0, irregularityFactor);
            const eccentricWobble = this._wobble(tSec * 0.5 + i * 0.15, seed * 1.41, 1.0, eccentricityFactor);
            const circularWobble = this._wobble(tSec * 0.7 + i * 0.1, seed * 1.73, 1.0, circularityFactor);
            
            const combinedRadius = radius * (
                0.94 + 
                0.08 * baseWobble + 
                0.04 * irregularWobble + 
                0.03 * eccentricWobble +
                0.02 * circularWobble
            );
            
            // PRESERVE: Eccentricity effect with enhanced sophistication
            const eccentricRadius = combinedRadius * (1 + eccentricity * Math.cos(a * 2) * 0.3);
            
            const x = cx + Math.cos(a) * eccentricRadius;
            const y = cy + Math.sin(a) * eccentricRadius;
            
            if (i === 0) ctx.moveTo(x, y); 
            else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // PRESERVE: Fill and stroke with enhanced effects
        ctx.fillStyle = colors.fill;
        ctx.fill();

        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 3 + complexity * 0.5;
        ctx.stroke();

        // PRESERVE: Additional complexity-based sophisticated effects
        if (complexity > 0.5) {
            ctx.strokeStyle = colors.border.replace(/[\d\.]+\)$/g, '0.4)');
            ctx.lineWidth = 1 + complexity * 0.5;
            ctx.stroke();
        }

        if (irregularity > 0.6) {
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
    }

    // ========== ENHANCED SUPER-READABLE LABEL SYSTEM ==========
    _renderSuperReadablePercentageLabel(cx, cy, percentage, radius, isTop, isSplit = false, complexity = 0) {
        const ctx = this.ctx;
        const str = `${percentage}%`;

        // ENHANCED: Much larger text - increased from 0.35 to 0.55!
        const baseFontSize = Math.max(28, Math.min(58, radius * 0.55));
        const importanceBonus = isTop ? baseFontSize * 0.2 : (percentage >= 25 ? baseFontSize * 0.1 : 0);
        const complexityBonus = complexity * baseFontSize * 0.05;
        const fontSize = baseFontSize + importanceBonus + complexityBonus;
        
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.save();
        
        // ENHANCED: Multiple shadow layers for maximum readability
        // Layer 1: Deep black background shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 1.0)'; // Pure black
        ctx.shadowBlur = Math.max(18, fontSize * 0.4); // Much bigger blur
        ctx.shadowOffsetX = 4; // Bigger offset
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(str, cx, cy);

        // Layer 2: Medium black shadow for depth
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = Math.max(12, fontSize * 0.25);
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText(str, cx, cy);

        // Reset shadow for outlines
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // ENHANCED: Triple outline system for extreme visibility
        // Outermost black outline (thickest)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = 5; // Very thick black outline
        ctx.strokeText(str, cx, cy);

        // Middle colored outline
        const outlineColor = isTop ? 'rgba(0, 255, 255, 0.95)' : 'rgba(147, 51, 234, 0.95)';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = isTop ? 3 : 2.5; // Thicker colored outline
        ctx.strokeText(str, cx, cy);

        // Inner white text (final layer)
        ctx.fillStyle = '#ffffff';
        ctx.fillText(str, cx, cy);

        // ENHANCED: Extra glow for top cluster
        if (isTop) {
            ctx.shadowColor = 'rgba(0, 255, 255, 0.7)';
            ctx.shadowBlur = 22 + complexity * 6;
            ctx.fillText(str, cx, cy);
        }
        
        // ENHANCED: Split cluster additional indication
        if (isSplit) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1 + complexity * 0.3;
            ctx.strokeText(str, cx, cy);
        }
        
        // ENHANCED: High complexity additional sophistication
        if (complexity > 0.7) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + complexity * 0.15})`;
            ctx.lineWidth = 0.5;
            ctx.strokeText(str, cx, cy);
        }
        
        ctx.restore();
    }

    // ========== PUBLIC API ==========
    setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
    getFPS() { return this.fps; }
    getUpdateCount() { return this.updateCount; }
    getActiveClusterCount() { return this.targets.size; }
    destroy() { this.stop(); }
}

// Legacy compatibility function for older code
function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = (blobs || []).map(blob => ({
        x: blob.x, y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        density: blob.density || 1,
        radius: blob.radius || 0.05,
        spread: blob.spread || 0.05,
        maxSpread: blob.maxSpread || blob.radius || 0.05,
        complexity: blob.complexity || blob.irregularity || 0,
        eccentricity: blob.eccentricity || 0,
        irregularity: blob.irregularity || 0,
        circularity: blob.circularity || 1,
        convexity: blob.convexity || 1,
        shapeConfidence: blob.shapeConfidence || 1,
        preferredSides: blob.preferredSides || blob.sides,
        shapeType: blob.shapeType,
        isSplit: blob.isSplit || false,
        isTop: blob.isTop || false,
        id: blob.id
    }));
    renderer.updateClusters(clusters);
}

// Make classes globally available
window.HeatmapRenderer = HeatmapRenderer;
window.drawBlobs = drawBlobs;
