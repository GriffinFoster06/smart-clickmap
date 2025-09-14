// frontend/overlay/heatmap-fast.js - Balanced performance renderer with ENHANCED readable percentages

class FastHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { 
            alpha: true,
            desynchronized: true,
            powerPreference: 'high-performance'
        });

        // Ensure non-blocking
        this.canvas.style.pointerEvents = 'none';

        // Configuration
        this.PERCENTAGE_THRESHOLD = 3;
        this.MIN_SIZE = 45;
        this.MAX_SIZE = 180;
        
        // Performance tracking
        this.renderMode = 'HIGH'; // HIGH, MEDIUM, LOW
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.targetFPS = 60;
        
        // Animation state (simplified)
        this.clusters = [];
        this.animatedClusters = new Map();
        this.animationSpeed = 0.15; // Lerp speed
        
        // Pre-calculated resources
        this.colors = {
            purple: {
                main: 'rgba(147, 51, 234, 0.25)',
                border: 'rgba(147, 51, 234, 0.9)',
                glow: 'rgba(147, 51, 234, 0.5)'
            },
            cyan: {
                main: 'rgba(0, 255, 255, 0.25)',
                border: 'rgba(0, 255, 255, 0.9)',
                glow: 'rgba(0, 255, 255, 0.6)'
            }
        };
        
        this.resize();
        this.startAnimation();
        
        console.log('⚡ Fast renderer with ENHANCED text initialized');
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR for performance

        this.canvas.width = Math.floor(rect.width * dpr);
        this.canvas.height = Math.floor(rect.height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        this.width = rect.width;
        this.height = rect.height;
    }

    updateClusters(newClusters) {
        this.clusters = newClusters || [];
        
        // Determine render mode based on cluster count and properties
        const count = this.clusters.length;
        const hasComplexShapes = this.clusters.some(c => c.shapeType === 'polygon');
        
        if (count <= 5 && !hasComplexShapes) {
            this.renderMode = 'HIGH';
            this.animationSpeed = 0.15;
        } else if (count <= 10) {
            this.renderMode = 'MEDIUM';
            this.animationSpeed = 0.2;
        } else {
            this.renderMode = 'LOW';
            this.animationSpeed = 0.3;
        }
        
        console.log(`🎨 Enhanced render mode: ${this.renderMode} (${count} clusters)`);
        
        // Update animated positions
        this.updateAnimatedClusters();
    }

    updateAnimatedClusters() {
        // Add or update clusters
        this.clusters.forEach(cluster => {
            const key = cluster.id || `${cluster.x}_${cluster.y}`;
            
            if (!this.animatedClusters.has(key)) {
                // New cluster - start at position
                this.animatedClusters.set(key, {
                    x: cluster.x,
                    y: cluster.y,
                    radius: cluster.visualSize || 60,
                    percentage: cluster.percentage,
                    targetX: cluster.x,
                    targetY: cluster.y,
                    targetRadius: cluster.visualSize || 60,
                    targetPercentage: cluster.percentage,
                    ...cluster
                });
            } else {
                // Existing cluster - update target
                const animated = this.animatedClusters.get(key);
                animated.targetX = cluster.x;
                animated.targetY = cluster.y;
                animated.targetRadius = cluster.visualSize || 60;
                animated.targetPercentage = cluster.percentage;
                
                // Copy new properties
                Object.assign(animated, cluster);
            }
        });
        
        // Remove old clusters
        const currentKeys = new Set(this.clusters.map(c => c.id || `${c.x}_${c.y}`));
        for (const key of this.animatedClusters.keys()) {
            if (!currentKeys.has(key)) {
                this.animatedClusters.delete(key);
            }
        }
    }

    startAnimation() {
        const animate = () => {
            this.render();
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    render() {
        const ctx = this.ctx;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.width, this.height);
        
        if (this.animatedClusters.size === 0) return;
        
        // Update animations
        this.animatedClusters.forEach(cluster => {
            cluster.x += (cluster.targetX - cluster.x) * this.animationSpeed;
            cluster.y += (cluster.targetY - cluster.y) * this.animationSpeed;
            cluster.radius += (cluster.targetRadius - cluster.radius) * this.animationSpeed;
            cluster.percentage += (cluster.targetPercentage - cluster.percentage) * this.animationSpeed;
        });
        
        // Convert to array and sort by percentage
        const clusters = Array.from(this.animatedClusters.values())
            .sort((a, b) => a.percentage - b.percentage);
        
        // Render based on mode
        switch(this.renderMode) {
            case 'HIGH':
                this.renderHighQuality(clusters);
                break;
            case 'MEDIUM':
                this.renderMediumQuality(clusters);
                break;
            case 'LOW':
                this.renderLowQuality(clusters);
                break;
        }
        
        // Track performance
        this.frameCount++;
    }

    renderHighQuality(clusters) {
        const ctx = this.ctx;
        
        clusters.forEach((cluster, index) => {
            const isTop = index === clusters.length - 1;
            const colors = isTop ? this.colors.cyan : this.colors.purple;
            
            const x = cluster.x * this.width;
            const y = cluster.y * this.height;
            const radius = cluster.radius;
            
            // Add subtle animation
            const pulse = 1 + Math.sin(Date.now() * 0.001 + index) * 0.02;
            const r = radius * pulse;
            
            // Glow effect (only for top cluster)
            if (isTop) {
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.5);
                gradient.addColorStop(0, colors.glow);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Draw shape based on type
            if (cluster.shapeType === 'polygon' && cluster.preferredSides) {
                this.drawPolygon(x, y, r, cluster.preferredSides, colors);
            } else {
                this.drawCircle(x, y, r, colors);
            }
            
            // ENHANCED: Draw super-readable text
            this.drawEnhancedText(x, y, Math.round(cluster.percentage), r, isTop);
        });
    }

    renderMediumQuality(clusters) {
        const ctx = this.ctx;
        
        clusters.forEach((cluster, index) => {
            const isTop = index === clusters.length - 1;
            const colors = isTop ? this.colors.cyan : this.colors.purple;
            
            const x = cluster.x * this.width;
            const y = cluster.y * this.height;
            const radius = cluster.radius;
            
            // Simple circle (no polygon shapes in medium mode)
            this.drawCircle(x, y, radius, colors);
            
            // ENHANCED: Draw readable text
            this.drawEnhancedText(x, y, Math.round(cluster.percentage), radius, isTop);
        });
    }

    renderLowQuality(clusters) {
        const ctx = this.ctx;
        
        // Batch render all circles first
        ctx.fillStyle = this.colors.purple.main;
        clusters.forEach(cluster => {
            const x = cluster.x * this.width;
            const y = cluster.y * this.height;
            const radius = Math.min(cluster.radius, 80); // Cap size in low mode
            
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // ENHANCED: Then render readable text for all clusters
        clusters.forEach((cluster, index) => {
            const isTop = index === clusters.length - 1;
            const x = cluster.x * this.width;
            const y = cluster.y * this.height;
            const radius = Math.min(cluster.radius, 80);
            
            // Even in low quality, make text readable
            this.drawSimpleReadableText(x, y, Math.round(cluster.percentage), radius, isTop);
        });
    }

    drawCircle(x, y, radius, colors) {
        const ctx = this.ctx;
        
        // Fill
        ctx.fillStyle = colors.main;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Border
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        
        // Inner ring (if high quality)
        if (this.renderMode === 'HIGH') {
            ctx.strokeStyle = colors.border.replace('0.9', '0.3');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, radius - 6, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    drawPolygon(x, y, radius, sides, colors) {
        const ctx = this.ctx;
        
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
        
        // Fill
        ctx.fillStyle = colors.main;
        ctx.fill();
        
        // Border
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }

    // ENHANCED: Super-readable text for high and medium quality
    drawEnhancedText(x, y, percentage, radius, isTop) {
        const ctx = this.ctx;
        
        // ENHANCED: Much larger font size - increased from 0.35 to 0.5
        const fontSize = Math.max(24, Math.min(50, radius * 0.5));
        
        ctx.save();
        
        // ENHANCED: Multiple shadow layers for maximum readability
        // Deep black background shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 1.0)';
        ctx.shadowBlur = Math.max(16, fontSize * 0.4);
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        // Text setup
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${percentage}%`, x, y);
        
        // Medium shadow layer
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = Math.max(10, fontSize * 0.25);
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText(`${percentage}%`, x, y);
        
        // Reset shadow for outlines
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // ENHANCED: Triple outline system
        // Thick black outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = 4;
        ctx.strokeText(`${percentage}%`, x, y);
        
        // Colored outline
        const outlineColor = isTop ? 'rgba(0, 255, 255, 0.95)' : 'rgba(147, 51, 234, 0.95)';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = isTop ? 2.5 : 2;
        ctx.strokeText(`${percentage}%`, x, y);
        
        // Final white text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${percentage}%`, x, y);
        
        // Extra glow for top cluster
        if (isTop) {
            ctx.shadowColor = 'rgba(0, 255, 255, 0.7)';
            ctx.shadowBlur = 20;
            ctx.fillText(`${percentage}%`, x, y);
        }
        
        ctx.restore();
    }

    // 🔥 MASSIVE: Even low quality gets huge readable text
    drawSimpleReadableText(x, y, percentage, radius, isTop) {
        const ctx = this.ctx;
        const str = `${percentage}%`;
        
        // 🚀 MASSIVE even in low quality - increased from 0.45 to 0.7
        const fontSize = Math.max(30, Math.min(60, radius * 0.7));
        
        ctx.save();
        
        // Strong shadow for readability
        ctx.shadowColor = 'rgba(0, 0, 0, 1.0)'; // Pure black
        ctx.shadowBlur = fontSize * 0.5; // Much bigger blur
        ctx.shadowOffsetX = 4; // Bigger offset
        ctx.shadowOffsetY = 4;
        
        // Text with extra bold weight
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`; // Extra bold
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(str, x, y);
        
        // Medium shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = fontSize * 0.3;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillText(str, x, y);
        
        // Reset shadow for outlines
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Massive black outline for definition
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.lineWidth = Math.max(6, fontSize * 0.12); // Proportional thick outline
        ctx.strokeText(str, x, y);
        
        // Second black outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = Math.max(4, fontSize * 0.08);
        ctx.strokeText(str, x, y);
        
        // Colored outline
        const outlineColor = isTop ? 'rgba(0, 255, 255, 1.0)' : 'rgba(147, 51, 234, 1.0)';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = Math.max(3, fontSize * 0.06);
        ctx.strokeText(str, x, y);
        
        // Final bright white text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(str, x, y);
        
        // Extra glow for top cluster even in low quality
        if (isTop) {
            ctx.shadowColor = 'rgba(0, 255, 255, 0.7)';
            ctx.shadowBlur = fontSize * 0.4;
            ctx.fillText(str, x, y);
        }
        
        ctx.restore();
    }

    setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
    getRenderMode() { return this.renderMode; }
    getClusterCount() { return this.animatedClusters.size; }
    destroy() { this.clusters = []; this.animatedClusters.clear(); }

    getStatus() {
        return {
            mode: this.renderMode,
            clusters: this.clusters.length,
            animated: this.animatedClusters.size,
            threshold: this.PERCENTAGE_THRESHOLD,
            enhancedText: 'readable' // Flag to indicate enhanced but reasonable text rendering
        };
    }
}

// Make available globally
window.FastHeatmapRenderer = FastHeatmapRenderer;
