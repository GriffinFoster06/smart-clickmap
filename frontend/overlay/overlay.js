// frontend/overlay/overlay.js - Enhanced dynamic heatmap with instant updates
const EBS = 'https://smart-clickmap-backend.onrender.com';

class DynamicHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.particles = []; // For fire effects
        this.animationId = null;
        this.lastTime = 0;

        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.startAnimation();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);
    }

    updateClusters(newClusters) {
        // Filter clusters above 3% threshold
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= 3)
            .sort((a, b) => b.percentage - a.percentage);

        // Generate fire particles for high-intensity clusters
        this.generateFireParticles();
    }

    generateFireParticles() {
        // Clear old particles
        this.particles = [];

        this.clusters.forEach(cluster => {
            if (cluster.percentage >= 10) { // Only for significant clusters
                const particleCount = Math.min(20, Math.floor(cluster.percentage / 3));
                const cx = cluster.x * window.innerWidth;
                const cy = cluster.y * window.innerHeight;
                const radius = this.calculateRadius(cluster.percentage);

                for (let i = 0; i < particleCount; i++) {
                    this.particles.push({
                        x: cx + (Math.random() - 0.5) * radius * 2,
                        y: cy + (Math.random() - 0.5) * radius * 2,
                        vx: (Math.random() - 0.5) * 2,
                        vy: (Math.random() - 0.5) * 2,
                        life: 1.0,
                        maxLife: 1.0 + Math.random() * 2,
                        size: 2 + Math.random() * 3,
                        clusterId: cluster.id || 0,
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
            particle.life -= deltaTime * 0.001; // Fade over time

            // Add some drift
            particle.vx *= 0.99;
            particle.vy *= 0.99;
        });

        // Remove dead particles
        this.particles = this.particles.filter(p => p.life > 0);
    }

    render() {
        const W = window.innerWidth;
        const H = window.innerHeight;

        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render clusters from lowest to highest percentage
        const reversedClusters = [...this.clusters].reverse();

        reversedClusters.forEach((cluster, index) => {
            const isTop = index === reversedClusters.length - 1;
            this.renderDynamicBlob(cluster, W, H, isTop);
        });

        // Render fire particles
        this.renderFireParticles();
    }

    renderDynamicBlob(cluster, W, H, isTop) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;
        const baseRadius = this.calculateRadius(percentage);

        this.ctx.save();

        // Create organic blob shape instead of perfect circle
        this.ctx.beginPath();
        const points = 8; // Number of control points for organic shape
        const variation = baseRadius * 0.3; // How much the shape can vary

        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const radiusVariation = baseRadius + (Math.sin(angle * 3 + Date.now() * 0.001) * variation * 0.5);
            const x = cx + Math.cos(angle) * radiusVariation;
            const y = cy + Math.sin(angle) * radiusVariation;

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        this.ctx.closePath();

        // Gradient fill with more intense colors
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);

        if (isTop) {
            // Cyan/blue intense gradient for top cluster
            gradient.addColorStop(0, 'rgba(0, 255, 255, 0.6)');
            gradient.addColorStop(0.4, 'rgba(0, 200, 255, 0.4)');
            gradient.addColorStop(0.7, 'rgba(100, 150, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
        } else if (percentage >= 15) {
            // Hot orange/red for high intensity
            gradient.addColorStop(0, 'rgba(255, 100, 0, 0.5)');
            gradient.addColorStop(0.4, 'rgba(255, 150, 0, 0.35)');
            gradient.addColorStop(0.7, 'rgba(200, 50, 150, 0.2)');
            gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
        } else {
            // Purple gradient for moderate intensity
            gradient.addColorStop(0, 'rgba(147, 51, 234, 0.4)');
            gradient.addColorStop(0.4, 'rgba(167, 71, 254, 0.3)');
            gradient.addColorStop(0.7, 'rgba(120, 40, 200, 0.2)');
            gradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
        }

        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        // Fiery ring effect for high-intensity clusters
        if (percentage >= 10) {
            this.renderFireRing(cx, cy, baseRadius, isTop, percentage);
        }

        // Bold percentage text with glow
        const fontSize = Math.max(16, Math.min(32, baseRadius * 0.4));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text glow effect
        this.ctx.shadowColor = isTop ? '#00ffff' : '#9333ea';
        this.ctx.shadowBlur = 10;
        this.ctx.fillStyle = isTop ? '#ffffff' : '#e0e7ff';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        // Reset shadow
        this.ctx.shadowBlur = 0;

        this.ctx.restore();
    }

    renderFireRing(cx, cy, radius, isTop, percentage) {
        const ringRadius = radius * 1.2;
        const intensity = Math.min(1, percentage / 30);

        this.ctx.save();

        // Animated fire ring
        const time = Date.now() * 0.003;
        const segments = 32;

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const nextAngle = ((i + 1) / segments) * Math.PI * 2;

            // Animated radius variation
            const radiusVar1 = ringRadius + Math.sin(angle * 5 + time) * 8 * intensity;
            const radiusVar2 = ringRadius + Math.sin(nextAngle * 5 + time) * 8 * intensity;

            const x1 = cx + Math.cos(angle) * radiusVar1;
            const y1 = cy + Math.sin(angle) * radiusVar1;
            const x2 = cx + Math.cos(nextAngle) * radiusVar2;
            const y2 = cy + Math.sin(nextAngle) * radiusVar2;

            // Fire gradient
            const fireGradient = this.ctx.createLinearGradient(cx, cy, x1, y1);

            if (isTop) {
                fireGradient.addColorStop(0, `rgba(0, 255, 255, ${0.3 * intensity})`);
                fireGradient.addColorStop(1, `rgba(100, 200, 255, ${0.1 * intensity})`);
            } else {
                fireGradient.addColorStop(0, `rgba(255, ${100 + i * 2}, 0, ${0.4 * intensity})`);
                fireGradient.addColorStop(1, `rgba(255, ${150 + i}, ${50 + i}, ${0.1 * intensity})`);
            }

            this.ctx.strokeStyle = fireGradient;
            this.ctx.lineWidth = 2 + Math.sin(time + i) * intensity;
            this.ctx.beginPath();
            this.ctx.moveTo(cx, cy);
            this.ctx.lineTo(x1, y1);
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

            // Particle color based on cluster
            if (particle.isTop) {
                this.ctx.fillStyle = `rgba(0, 255, 255, ${alpha * 0.8})`;
            } else {
                this.ctx.fillStyle = `rgba(255, ${100 + Math.random() * 100}, 0, ${alpha * 0.6})`;
            }

            // Glowing particle
            this.ctx.shadowColor = particle.isTop ? '#00ffff' : '#ff6600';
            this.ctx.shadowBlur = size * 2;

            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        });
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
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
        this.connectWebSocket(); // Try WebSocket first for instant updates
        this.startPolling(); // Fallback to polling

        console.log(`🔥 Enhanced ClickMap connected to: ${this.channelId}`);
    }

    getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel') || params.get('c');
    }

    setupRenderer() {
        const canvas = document.getElementById('overlay-canvas');
        if (!canvas) return;

        this.renderer = new DynamicHeatmapRenderer(canvas);
    }

    connectWebSocket() {
        // Try to establish WebSocket connection for instant updates
        try {
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            this.websocket = new WebSocket(`${wsUrl}/ws/${this.channelId}`);

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    console.warn('WebSocket message parse error:', e);
                }
            };

            this.websocket.onerror = () => {
                console.log('WebSocket failed, using polling');
                this.websocket = null;
            };

            this.websocket.onclose = () => {
                this.websocket = null;
                setTimeout(() => this.connectWebSocket(), 5000); // Retry
            };

        } catch (e) {
            console.log('WebSocket not available, using polling');
        }
    }

    startPolling() {
        // Faster polling for more responsive updates
        this.pollInterval = setInterval(() => this.poll(), 500); // 0.5 second polling
        this.poll();
    }

    async poll() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return; // Skip polling if WebSocket is active
        }

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

// Initialize with error handling
try {
    new InstantOverlay();
} catch (error) {
    console.error('Failed to initialize overlay:', error);
}