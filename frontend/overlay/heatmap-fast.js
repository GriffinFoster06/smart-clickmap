// frontend/overlay/heatmap-fast.js - Balanced performance renderer with visual richness
// Maintains visual quality at low load, gracefully degrades at high load

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
        
        console.log('⚡ Fast renderer initialized');
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
        
        console.log(`🎨 Render mode: ${this.renderMode} (${count} clusters)`);
        
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
            
            // Draw text
            this.drawText(x, y, Math.round(cluster.percentage), r, isTop);
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
            
            // Draw text
            this.drawText(x, y, Math.round(cluster.percentage), radius, isTop);
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
        
        // Then render text for significant clusters only
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        clusters.filter(c => c.percentage >= 5).forEach(cluster => {
            const x = cluster.x * this.width;
            const y = cluster.y * this.height;
            ctx.fillText(`${Math.round(cluster.percentage)}%`, x, y);
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

    drawText(x, y, percentage, radius, isTop) {
        const ctx = this.ctx;
        
        // Calculate font size based on radius
        const fontSize = Math.max(18, Math.min(40, radius * 0.35));
        
        ctx.save();
        
        // Shadow for readability
        if (this.renderMode !== 'LOW') {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
        }
        
        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${percentage}%`, x, y);
        
        // Outline for top cluster
        if (isTop && this.renderMode === 'HIGH') {
            ctx.shadowBlur = 0;
            ctx.strokeStyle = this.colors.cyan.border;
            ctx.lineWidth = 1;
            ctx.strokeText(`${percentage}%`, x, y);
        }
        
        ctx.restore();
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
    }

    destroy() {
        this.clusters = [];
        this.animatedClusters.clear();
    }

    getStatus() {
        return {
            mode: this.renderMode,
            clusters: this.clusters.length,
            animated: this.animatedClusters.size,
            threshold: this.PERCENTAGE_THRESHOLD
        };
    }
}

// Make available globally
window.FastHeatmapRenderer = FastHeatmapRenderer;
