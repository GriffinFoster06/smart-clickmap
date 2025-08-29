// frontend/overlay/overlay.js - Standalone precise area-based clustering for OBS overlay
(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';

    // ---- helpers ----
    function parseAspectFromURL() {
        const params = new URLSearchParams(window.location.search);

        // base_w/base_h override if present
        const bw = parseInt(params.get('base_w') || params.get('bw') || '', 10);
        const bh = parseInt(params.get('base_h') || params.get('bh') || '', 10);
        if (Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) {
            return bw / bh;
        }

        // aspect=16:9 or aspect=4/3
        const aspectStr = params.get('aspect');
        if (aspectStr) {
            const parts = aspectStr.split(/[:/]/).map(Number);
            if (parts.length === 2 && parts.every(n => Number.isFinite(n) && n > 0)) {
                return parts[0] / parts[1];
            }
            const asFloat = parseFloat(aspectStr);
            if (Number.isFinite(asFloat) && asFloat > 0) return asFloat;
        }

        // default to 16:9 (common OBS base)
        return 16 / 9;
    }

    function fitViewport(containerW, containerH, targetAspect) {
        // Returns a letterboxed viewport that fits inside container while preserving targetAspect
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

    class PreciseAreaRenderer {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.clusters = [];

            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_RADIUS = 80;
            this.MAX_RADIUS = 160;

            this.targetAspect = opts.targetAspect || 16 / 9;
            this.viewport = { x: 0, y: 0, width: 0, height: 0 };

            // initial size + listen for resize
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const dpr = window.devicePixelRatio || 1;
            const cssW = window.innerWidth;
            const cssH = window.innerHeight;

            // Physical backing store size
            this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
            this.canvas.height = Math.max(1, Math.floor(cssH * dpr));

            // CSS size (logical pixels)
            this.canvas.style.width = cssW + 'px';
            this.canvas.style.height = cssH + 'px';

            // IMPORTANT: reset transform (avoid compounding scales across resizes)
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Compute letterboxed viewport preserving OBS aspect
            this.viewport = fitViewport(cssW, cssH, this.targetAspect);

            // Optional: enable crisp lines on high DPR
            this.ctx.imageSmoothingEnabled = true;

            // Redraw with new dimensions
            this.render();
        }

        updateClusters(newClusters) {
            this.clusters = (newClusters || [])
                .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
                .map(cluster => this.processClusterArea(cluster))
                .sort((a, b) => b.percentage - a.percentage);

            this.render();
        }

        processClusterArea(cluster) {
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
            const cssW = this.canvas.width / (window.devicePixelRatio || 1);
            const cssH = this.canvas.height / (window.devicePixelRatio || 1);

            // Clear full canvas (logical coords since we setTransform to DPR)
            this.ctx.clearRect(0, 0, cssW, cssH);

            // If you want to dim outside the viewport to make the active area obvious, uncomment:
            // this._shadeOutsideViewport(cssW, cssH);

            if (this.clusters.length === 0) return;

            // Render from lowest to highest percentage
            const reversedClusters = [...this.clusters].reverse();

            reversedClusters.forEach((cluster, index) => {
                const isTop = index === reversedClusters.length - 1;
                this.renderAreaCluster(cluster, isTop);
            });
        }

        _shadeOutsideViewport(cssW, cssH) {
            const { x, y, width, height } = this.viewport;
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.15)';

            // Top bar
            this.ctx.fillRect(0, 0, cssW, y);
            // Bottom bar
            this.ctx.fillRect(0, y + height, cssW, cssH - (y + height));
            // Left bar
            this.ctx.fillRect(0, y, x, height);
            // Right bar
            this.ctx.fillRect(x + width, y, cssW - (x + width), height);

            this.ctx.restore();
        }

        renderAreaCluster(cluster, isTop) {
            const { x: vx, y: vy, width: vw, height: vh } = this.viewport;

            // Map normalized heatmap coordinates into the letterboxed viewport
            const cx = vx + (cluster.x * vw);
            const cy = vy + (cluster.y * vh);
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
                this.renderPolygonArea(cx, cy, radius, fillColor, borderColor);
            } else {
                this.renderCircularArea(cx, cy, radius, fillColor, borderColor);
            }

            this.renderPercentageText(cx, cy, percentage, radius, isTop);

            this.ctx.restore();
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

        renderPolygonArea(cx, cy, radius, fillColor, borderColor) {
            const percentage = Math.max(0, Math.min(100, this.lastPercentage || 0));
            const sides = 6 + Math.floor(percentage / 10);
            const time = Date.now() * 0.001;

            this.ctx.beginPath();

            for (let i = 0; i <= sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                const variation = Math.sin(angle * 2 + time * 0.5) * 0.15;
                const currentRadius = radius * (0.9 + variation);
                const x = cx + Math.cos(angle) * currentRadius;
                const y = cy + Math.sin(angle) * currentRadius;

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

        renderPercentageText(cx, cy, percentage, radius, isTop) {
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

            const targetAspect = parseAspectFromURL();
            this.renderer = new PreciseAreaRenderer(canvas, { targetAspect });

            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
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
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

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
