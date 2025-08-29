// frontend/overlay/overlay.js - Standalone precise area-based clustering for OBS overlay
(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';

    class PreciseAreaRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.clusters = [];
            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_RADIUS = 80; // Much larger minimum
            this.MAX_RADIUS = 160;

            this.resize();
            window.addEventListener('resize', () => this.resize());
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
            this.clusters = (newClusters || [])
                .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
                .map(cluster => this.processClusterArea(cluster))
                .sort((a, b) => b.percentage - a.percentage);

            this.render();
        }

        processClusterArea(cluster) {
            // Calculate actual coverage area
            const baseArea = this.MIN_RADIUS + (cluster.percentage * 2.5);
            const densityFactor = cluster.density ? Math.sqrt(cluster.density) : 1;
            const spreadRadius = cluster.radius || 0.05;

            const effectiveRadius = Math.max(
                this.MIN_RADIUS,
                Math.min(this.MAX_RADIUS, baseArea * densityFactor + (spreadRadius * 200))
            );

            return {
                ...cluster,
                effectiveRadius,
                needsPolygon: this.shouldUsePolygon(cluster)
            };
        }

        shouldUsePolygon(cluster) {
            return cluster.density > 3 || cluster.count > 8 || (cluster.radius && cluster.radius < 0.03);
        }

        render() {
            const W = window.innerWidth;
            const H = window.innerHeight;

            this.ctx.clearRect(0, 0, W, H);

            if (this.clusters.length === 0) return;

            // Render from lowest to highest percentage
            const reversedClusters = [...this.clusters].reverse();

            reversedClusters.forEach((cluster, index) => {
                const isTop = index === reversedClusters.length - 1;
                this.renderAreaCluster(cluster, W, H, isTop);
            });
        }

        renderAreaCluster(cluster, W, H, isTop) {
            const cx = cluster.x * W;
            const cy = cluster.y * H;
            const percentage = cluster.percentage || 0;
            const radius = cluster.effectiveRadius;

            this.ctx.save();

            // Purple/cyan color scheme
            let fillColor, borderColor;
            if (isTop) {
                fillColor = 'rgba(0, 255, 255, 0.2)';
                borderColor = 'rgba(0, 255, 255, 0.8)';
            } else if (percentage >= 15) {
                fillColor = 'rgba(147, 51, 234, 0.25)';
                borderColor = 'rgba(147, 51, 234, 0.9)';
            } else {
                fillColor = 'rgba(147, 51, 234, 0.2)';
                borderColor = 'rgba(147, 51, 234, 0.7)';
            }

            if (cluster.needsPolygon) {
                this.renderPolygonArea(cx, cy, radius, fillColor, borderColor, percentage);
            } else {
                this.renderCircularArea(cx, cy, radius, fillColor, borderColor, percentage);
            }

            this.renderPercentageText(cx, cy, percentage, radius, isTop);

            this.ctx.restore();
        }

        renderCircularArea(cx, cy, radius, fillColor, borderColor, percentage) {
            // Main area fill
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            this.ctx.fill();

            // Border
            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Inner highlight
            this.ctx.strokeStyle = borderColor.replace(/[\d\.]+\)$/g, '0.3)');
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius - 6, 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        renderPolygonArea(cx, cy, radius, fillColor, borderColor, percentage) {
            const sides = 6 + Math.floor(percentage / 10);
            const time = Date.now() * 0.001;

            this.ctx.beginPath();

            for (let i = 0; i <= sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                const variation = Math.sin(angle * 2 + time * 0.5) * 0.15;
                const currentRadius = radius * (0.9 + variation);
                const x = cx + Math.cos(angle) * currentRadius;
                const y = cy + Math.sin(angle) * currentRadius;

                if (i === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }

            this.ctx.closePath();

            this.ctx.fillStyle = fillColor;
            this.ctx.fill();

            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }

        renderPercentageText(cx, cy, percentage, radius, isTop) {
            // Large readable text
            const fontSize = Math.max(24, Math.min(40, radius * 0.35));
            this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            // Strong shadow
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            this.ctx.shadowBlur = 8;
            this.ctx.shadowOffsetX = 2;
            this.ctx.shadowOffsetY = 2;

            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(`${percentage}%`, cx, cy);

            // Reset shadow
            this.ctx.shadowBlur = 0;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;

            // Outline
            this.ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.8)' : 'rgba(147, 51, 234, 0.8)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeText(`${percentage}%`, cx, cy);
        }

        setThreshold(threshold) {
            this.PERCENTAGE_THRESHOLD = threshold;
            this.render();
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

            this.renderer = new PreciseAreaRenderer(canvas);

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) {
                this.renderer.setThreshold(parseInt(threshold));
            }
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
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                return;
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

    // Initialize when DOM is ready
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