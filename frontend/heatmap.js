// frontend/heatmap.js - Enhanced dynamic heatmap with organic shapes and fire effects
export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.particles = [];
        this.animationId = null;
        this.lastTime = 0;
        this.PERCENTAGE_THRESHOLD = 3;

        this.resize();
        this.startAnimation();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        this.ctx.scale(dpr, dpr);
    }

    updateClusters(newClusters) {
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage);

        this.generateFireParticles();
    }

    generateFireParticles() {
        this.particles = [];

        this.clusters.forEach(cluster => {
            if (cluster.percentage >= 10) {
                const particleCount = Math.min(15, Math.floor(cluster.percentage / 4));
                const W = this.canvas.width / (window.devicePixelRatio || 1);
                const H = this.canvas.height / (window.devicePixelRatio || 1);
                const cx = cluster.x * W;
                const cy = cluster.y * H;
                const radius = this.calculateRadius(cluster.percentage);

                for (let i = 0; i < particleCount; i++) {
                    this.particles.push({
                        x: cx + (Math.random() - 0.5) * radius * 2,
                        y: cy + (Math.random() - 0.5) * radius * 2,
                        vx: (Math.random() - 0.5) * 1.5,
                        vy: (Math.random() - 0.5) * 1.5,
                        life: 1.0,
                        maxLife: 1.0 + Math.random() * 1.5,
                        size: 1.5 + Math.random() * 2.5,
                        isTop: cluster.isTop
                    });
                }
            }
        });
    }

    calculateRadius(percentage) {
        return Math.max(30, Math.min(120, 40 + Math.sqrt(percentage) * 8));
    }

    startAnimation() {
        const animate = (currentTime) => {
            const deltaTime = currentTime - this.lastTime;
            this.lastTime = currentTime;

            this.updateParticles(deltaTime);
            this.render();

            this.animationId = requestAnimationFrame(animate);
        };

        this.animationId = requestAnimationFrame(animate);
    }

    updateParticles(deltaTime) {
        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= deltaTime * 0.0008;

            particle.vx *= 0.99;
            particle.vy *= 0.99;
        });

        this.particles = this.particles.filter(p => p.life > 0);
    }

    render() {
        const W = this.canvas.width / (window.devicePixelRatio || 1);
        const H = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render from lowest to highest percentage
        const reversedClusters = [...this.clusters].reverse();

        reversedClusters.forEach((cluster, index) => {
            const isTop = index === reversedClusters.length - 1;
            this.renderDynamicBlob(cluster, W, H, isTop);
        });

        this.renderFireParticles();
    }

    renderDynamicBlob(cluster, W, H, isTop) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;
        const baseRadius = this.calculateRadius(percentage);

        this.ctx.save();

        // Create organic blob shape
        this.ctx.beginPath();
        const points = 8;
        const variation = baseRadius * 0.25;
        const time = Date.now() * 0.001;

        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const radiusVariation = baseRadius + (Math.sin(angle * 3 + time) * variation * 0.6);
            const x = cx + Math.cos(angle) * radiusVariation;
            const y = cy + Math.sin(angle) * radiusVariation;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();

        // Enhanced gradient with more intensity
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);

        if (isTop) {
            gradient.addColorStop(0, 'rgba(0, 255, 255, 0.6)');
            gradient.addColorStop(0.4, 'rgba(0, 200, 255, 0.4)');
            gradient.addColorStop(0.7, 'rgba(100, 150, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
        } else if (percentage >= 15) {
            gradient.addColorStop(0, 'rgba(255, 100, 0, 0.5)');
            gradient.addColorStop(0.4, 'rgba(255, 150, 0, 0.35)');
            gradient.addColorStop(0.7, 'rgba(200, 50, 150, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
        } else {
            gradient.addColorStop(0, 'rgba(147, 51, 234, 0.4)');
            gradient.addColorStop(0.4, 'rgba(167, 71, 254, 0.3)');
            gradient.addColorStop(0.7, 'rgba(120, 40, 200, 0.2)');
            gradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
        }

        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        // Fire ring effect
        if (percentage >= 10) {
            this.renderFireRing(cx, cy, baseRadius, isTop, percentage);
        }

        // Glowing text
        const fontSize = Math.max(16, Math.min(28, baseRadius * 0.4));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        this.ctx.shadowColor = isTop ? '#00ffff' : '#9333ea';
        this.ctx.shadowBlur = 8;
        this.ctx.fillStyle = isTop ? '#ffffff' : '#e0e7ff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        this.ctx.shadowBlur = 0;
        this.ctx.restore();
    }

    renderFireRing(cx, cy, radius, isTop, percentage) {
        const ringRadius = radius * 1.15;
        const intensity = Math.min(1, percentage / 25);
        const time = Date.now() * 0.003;
        const segments = 24;

        this.ctx.save();

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const radiusVar = ringRadius + Math.sin(angle * 4 + time) * 6 * intensity;

            const x = cx + Math.cos(angle) * radiusVar;
            const y = cy + Math.sin(angle) * radiusVar;

            if (isTop) {
                this.ctx.strokeStyle = `rgba(0, 255, 255, ${0.3 * intensity})`;
            } else {
                this.ctx.strokeStyle = `rgba(255, ${120 + i * 2}, 0, ${0.4 * intensity})`;
            }

            this.ctx.lineWidth = 1.5 + Math.sin(time + i) * intensity;
            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(x, y);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    renderFireParticles() {
        this.particles.forEach(particle => {
            if (particle.life <= 0) return;

            this.ctx.save();

            const alpha = particle.life / particle.maxLife;
            const size = particle.size * alpha;

            if (particle.isTop) {
                this.ctx.fillStyle = `rgba(0, 255, 255, ${alpha * 0.7})`;
                this.ctx.shadowColor = '#00ffff';
            } else {
                this.ctx.fillStyle = `rgba(255, ${100 + Math.random() * 100}, 0, ${alpha * 0.6})`;
                this.ctx.shadowColor = '#ff6600';
            }

            this.ctx.shadowBlur = size * 1.5;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        });
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    }
}

// Legacy compatibility
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    const clusters = blobs.map(blob => ({
        x: blob.x,
        y: blob.y,
        percentage: blob.pct || blob.percentage,
        count: blob.count || 1,
        isTop: blob.isTop
    }));
    renderer.updateClusters(clusters);
}