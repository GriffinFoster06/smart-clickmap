// frontend/overlay/overlay.js - Complete overlay with fancy visuals restored
const EBS = 'https://smart-clickmap-backend.onrender.com';

class FancyHeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.clusters = [];
        this.PERCENTAGE_THRESHOLD = 3;
        this.animationId = null;

        console.log('🎨 Fancy heatmap renderer initialized');
        this.resize();
        this.startAnimation();

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);

        console.log(`🔄 Canvas resized: ${window.innerWidth}x${window.innerHeight} (DPR: ${dpr})`);

        // Test draw to verify canvas is working
        this.testDraw();
    }

    testDraw() {
        // Quick test to verify canvas is responsive
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        this.ctx.fillRect(0, 0, 50, 50);
        this.ctx.restore();
        setTimeout(() => {
            this.ctx.clearRect(0, 0, 50, 50);
        }, 100);
    }

    updateClusters(newClusters) {
        this.clusters = (newClusters || [])
            .filter(cluster => (cluster.percentage || 0) >= this.PERCENTAGE_THRESHOLD)
            .sort((a, b) => b.percentage - a.percentage);

        console.log(`📊 Updated clusters: ${this.clusters.length} visible`);

        // Force immediate render
        this.render();
    }

    startAnimation() {
        if (this.animationId) return;

        const animate = (timestamp) => {
            this.render(timestamp);
            this.animationId = requestAnimationFrame(animate);
        };

        this.animationId = requestAnimationFrame(animate);
        console.log('🎬 Animation loop started');
    }

    render(timestamp = 0) {
        const W = window.innerWidth;
        const H = window.innerHeight;

        // Clear canvas
        this.ctx.clearRect(0, 0, W, H);

        if (this.clusters.length === 0) return;

        // Render each cluster with fancy effects
        this.clusters.forEach((cluster, index) => {
            this.renderFancyBubble(cluster, W, H, index, timestamp);
        });
    }

    renderFancyBubble(cluster, W, H, index, timestamp) {
        const cx = cluster.x * W;
        const cy = cluster.y * H;
        const percentage = cluster.percentage || 0;
        const isTop = cluster.isTop || index === 0;

        // Dynamic size with subtle animation
        const baseRadius = Math.max(45, Math.min(85, 50 + (percentage * 1.8)));
        const pulseAmount = Math.sin((timestamp * 0.002) + (index * 0.5)) * 3;
        const radius = baseRadius + pulseAmount;

        this.ctx.save();

        // ✨ OUTER GLOW EFFECT
        const glowGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius + 20);
        if (isTop) {
            glowGradient.addColorStop(0, 'rgba(0, 255, 255, 0.2)');
            glowGradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
        } else if (percentage >= 15) {
            glowGradient.addColorStop(0, 'rgba(147, 51, 234, 0.15)');
            glowGradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
        } else {
            glowGradient.addColorStop(0, 'rgba(147, 51, 234, 0.1)');
            glowGradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
        }

        this.ctx.fillStyle = glowGradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius + 20, 0, 2 * Math.PI);
        this.ctx.fill();

        // ✨ MAIN BUBBLE WITH GRADIENT
        const bubbleGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        if (isTop) {
            bubbleGradient.addColorStop(0, 'rgba(0, 255, 255, 0.4)');
            bubbleGradient.addColorStop(0.6, 'rgba(0, 200, 255, 0.3)');
            bubbleGradient.addColorStop(1, 'rgba(0, 150, 255, 0.2)');
        } else if (percentage >= 20) {
            bubbleGradient.addColorStop(0, 'rgba(147, 51, 234, 0.35)');
            bubbleGradient.addColorStop(0.6, 'rgba(147, 51, 234, 0.25)');
            bubbleGradient.addColorStop(1, 'rgba(147, 51, 234, 0.15)');
        } else {
            bubbleGradient.addColorStop(0, 'rgba(147, 51, 234, 0.3)');
            bubbleGradient.addColorStop(0.6, 'rgba(147, 51, 234, 0.2)');
            bubbleGradient.addColorStop(1, 'rgba(147, 51, 234, 0.1)');
        }

        this.ctx.fillStyle = bubbleGradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        // ✨ ANIMATED BORDER
        const borderOpacity = 0.8 + Math.sin(timestamp * 0.003) * 0.2;
        const borderColor = isTop
            ? `rgba(0, 255, 255, ${borderOpacity})`
            : `rgba(147, 51, 234, ${borderOpacity})`;

        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = isTop ? 4 : 3;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        this.ctx.stroke();

        // ✨ INNER HIGHLIGHT RING
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + Math.sin(timestamp * 0.004) * 0.2})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius - 8, 0, 2 * Math.PI);
        this.ctx.stroke();

        // ✨ PERCENTAGE TEXT WITH ENHANCED STYLING
        const fontSize = Math.max(22, Math.min(36, radius * 0.5));
        this.ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text glow effect
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowOffsetX = 3;
        this.ctx.shadowOffsetY = 3;

        // Main text
        this.ctx.fillStyle = isTop ? '#ffffff' : '#f5f5f5';
        this.ctx.fillText(`${percentage}%`, cx, cy);

        // Reset shadow
        this.ctx.shadowBlur = 0;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;

        // ✨ TEXT OUTLINE
        this.ctx.strokeStyle = isTop
            ? 'rgba(0, 255, 255, 0.9)'
            : 'rgba(147, 51, 234, 0.9)';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeText(`${percentage}%`, cx, cy);

        // ✨ SPARKLE EFFECT FOR TOP CLUSTER
        if (isTop && Math.random() > 0.7) {
            this.drawSparkle(cx, cy, radius, timestamp);
        }

        this.ctx.restore();
    }

    drawSparkle(cx, cy, radius, timestamp) {
        const sparkleCount = 3;
        for (let i = 0; i < sparkleCount; i++) {
            const angle = (timestamp * 0.001 + i * 2.094) % (Math.PI * 2);
            const distance = radius * 0.7;
            const sx = cx + Math.cos(angle) * distance;
            const sy = cy + Math.sin(angle) * distance;
            const sparkleSize = 2 + Math.sin(timestamp * 0.01 + i) * 1;

            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.beginPath();
            this.ctx.arc(sx, sy, sparkleSize, 0, 2 * Math.PI);
            this.ctx.fill();
        }
    }

    setThreshold(threshold) {
        this.PERCENTAGE_THRESHOLD = threshold;
        console.log(`🎯 Threshold updated: ${threshold}%`);
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('🎨 Renderer destroyed');
    }
}

class WorkingObsOverlay {
    constructor() {
        this.channelId = this.getChannelFromUrl();
        this.renderer = null;
        this.websocket = null;
        this.pollInterval = null;
        this.consecutiveErrors = 0;
        this.maxRetries = 3;

        console.log('🎯 Working OBS Overlay v3.3.0 - Fancy Visuals Restored');
        this.init();
    }

    async init() {
        try {
            if (!this.channelId) {
                throw new Error('Missing channel parameter in URL. Add ?channel=CHANNEL_NAME');
            }

            console.log(`🔗 Connecting to channel: ${this.channelId}`);

            await this.testConnection();
            this.setupRenderer();

            // Start with polling for reliability, then try WebSocket
            this.startPolling();
            setTimeout(() => this.tryWebSocket(), 2000);

            console.log('✅ OBS Overlay ready with fancy visuals!');

        } catch (error) {
            console.error('❌ Overlay initialization failed:', error);
            this.showError(error.message);
        }
    }

    async testConnection() {
        try {
            const response = await fetch(`${EBS}/health`);
            if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
            const data = await response.json();
            console.log(`✅ Backend OK - Version: ${data.version}, WebSocket: ${data.websocket.enabled}`);
            return data;
        } catch (error) {
            console.error('❌ Backend connection failed:', error);
            throw error;
        }
    }

    getChannelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('channel') || params.get('c');
    }

    setupRenderer() {
        const canvas = document.getElementById('overlay-canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        console.log('🎨 Setting up fancy renderer...');
        this.renderer = new FancyHeatmapRenderer(canvas);

        // Custom threshold
        const threshold = new URLSearchParams(window.location.search).get('threshold');
        if (threshold) {
            this.renderer.setThreshold(parseInt(threshold));
        }

        console.log('✅ Fancy renderer ready');
    }

    startPolling() {
        if (this.pollInterval) return;

        console.log('⏰ Starting reliable polling...');
        this.pollInterval = setInterval(() => this.poll(), 800);
        this.poll(); // Initial poll
    }

    async poll() {
        try {
            const response = await fetch(
                `${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}&t=${Date.now()}`
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            this.updateVisualization(data);
            this.consecutiveErrors = 0;

        } catch (error) {
            this.consecutiveErrors++;
            if (this.consecutiveErrors >= this.maxRetries) {
                this.showError('Connection lost. Check server status.');
            }
        }
    }

    tryWebSocket() {
        if (this.websocket) return;

        try {
            const wsUrl = `wss://smart-clickmap-backend.onrender.com/ws/${this.channelId}`;
            console.log('📡 Attempting WebSocket connection...');

            this.websocket = new WebSocket(wsUrl);

            const timeout = setTimeout(() => {
                console.log('⏰ WebSocket timeout, keeping polling');
                this.websocket?.close();
                this.websocket = null;
            }, 8000);

            this.websocket.onopen = () => {
                clearTimeout(timeout);
                console.log('✅ WebSocket connected! Stopping polling.');
                if (this.pollInterval) {
                    clearInterval(this.pollInterval);
                    this.pollInterval = null;
                }
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    console.error('❌ WebSocket parse error:', e);
                }
            };

            this.websocket.onerror = () => {
                clearTimeout(timeout);
                console.log('⚠️ WebSocket failed, keeping polling');
            };

            this.websocket.onclose = () => {
                clearTimeout(timeout);
                console.log('📡 WebSocket closed, resuming polling');
                this.websocket = null;
                if (!this.pollInterval) {
                    this.startPolling();
                }
            };

        } catch (error) {
            console.warn('⚠️ WebSocket setup failed:', error);
        }
    }

    updateVisualization(data) {
        console.log(`📊 Updating visualization: ${(data.clusters || []).length} clusters`);

        if (this.renderer) {
            this.renderer.updateClusters(data.clusters || []);
        }

        // Log updates for debugging
        const clusterCount = (data.clusters || []).length;
        if (clusterCount > 0) {
            console.log(`📊 Updated: ${clusterCount} clusters, ${data.totalClicks} total clicks`);

            // Log first cluster details for debugging
            if (data.clusters && data.clusters[0]) {
                const c = data.clusters[0];
                console.log(`🎯 Top cluster: ${c.percentage}% at (${c.x.toFixed(3)}, ${c.y.toFixed(3)})`);
            }
        }
    }

    showError(message) {
        console.error(`🔴 Error: ${message}`);
        const errorEl = document.getElementById('error');
        if (errorEl) {
            const p = errorEl.querySelector('p');
            if (p) p.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    destroy() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }
        console.log('🧹 Overlay destroyed');
    }
}

// Initialize
function initializeOverlay() {
    try {
        // Clean up any existing overlay
        if (window.obsOverlay) {
            window.obsOverlay.destroy();
        }

        window.obsOverlay = new WorkingObsOverlay();

        console.log('🎉 Fancy overlay initialized successfully!');

    } catch (error) {
        console.error('❌ Failed to initialize overlay:', error);
    }
}

// Start when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOverlay);
} else {
    initializeOverlay();
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    if (window.obsOverlay) {
        window.obsOverlay.destroy();
    }
});

console.log('🎯 Fancy Overlay Script Loaded');
console.log('   URL: ?channel=CHANNEL_NAME&threshold=5');
console.log('   ✨ Fancy animated bubbles enabled');
console.log('   📡 WebSocket + Polling fallback');

// Global reference
window.WorkingObsOverlay = WorkingObsOverlay;