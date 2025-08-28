import { OBSHeatmapRenderer, OBSClusterer } from './heatmap.js';

/**
 * OBS Overlay for Ex Machina Smart Click Maps
 * Lightweight standalone version for OBS Browser Source
 */
class OBSOverlay {
    constructor() {
        // Get channel ID from URL parameter
        this.channelId = new URLSearchParams(location.search).get('channel');

        if (!this.channelId) {
            this.showError('Channel parameter required. Use: ?channel=YOUR_CHANNEL_ID');
            return;
        }

        // Backend URL
        this.EBS = 'https://smart-clickmap-backend.onrender.com';

        // Setup canvas and renderer
        this.canvas = document.getElementById('cv');
        this.renderer = new OBSHeatmapRenderer(this.canvas);
        this.clusterer = new OBSClusterer();

        // State
        this.running = false;
        this.currentClusters = [];
        this.stats = { totalClicks: 0, uniqueUsers: 0 };

        this.setupCanvas();
        this.startPolling();

        console.log(`🎬 OBS Overlay initialized for channel: ${this.channelId}`);
    }

    /**
     * Setup canvas with proper sizing
     */
    setupCanvas() {
        const resize = () => {
            this.canvas.width = window.innerWidth || 1920;
            this.canvas.height = window.innerHeight || 1080;
            this.renderer.handleResize();
            this.renderClusters();
        };

        resize();
        window.addEventListener('resize', resize);
    }

    /**
     * Start polling for data
     */
    startPolling() {
        this.fetchData(); // Initial fetch

        setInterval(() => {
            this.fetchData();
        }, 1500); // Poll every 1.5 seconds for OBS
    }

    /**
     * Fetch data from backend
     */
    async fetchData() {
        try {
            const url = `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`;
            const response = await fetch(url, { cache: 'no-cache' });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.processData(data);

        } catch (error) {
            console.error('🎬 OBS Overlay fetch error:', error);
            this.showError(`Connection failed: ${error.message}`);
        }
    }

    /**
     * Process data from backend
     */
    processData(data) {
        try {
            // Update running status
            const wasRunning = this.running;
            this.running = data.running;

            // Update stats
            this.stats = {
                totalClicks: data.totalClicks || 0,
                uniqueUsers: data.uniqueUsers || 0
            };

            // Process click data
            if (data.rawClicks && Array.isArray(data.rawClicks)) {
                // New format: raw clicks for clustering
                this.updateClusters(data.rawClicks);
            }
            else if (data.blobs && Array.isArray(data.blobs)) {
                // Legacy format: pre-clustered blobs
                this.currentClusters = this.convertLegacyBlobs(data.blobs);
                this.renderClusters();
            }
            else {
                // No data
                this.currentClusters = [];
                this.renderClusters();
            }

            // Log status changes
            if (wasRunning !== this.running) {
                console.log(`🎬 OBS Overlay: ${this.running ? 'STARTED' : 'STOPPED'}`);
            }

        } catch (error) {
            console.error('🎬 OBS Overlay data processing error:', error);
        }
    }

    /**
     * Update clusters from raw click data
     */
    updateClusters(rawClicks) {
        try {
            const startTime = performance.now();

            // Use clusterer to generate polygon clusters
            this.currentClusters = this.clusterer.clusterPoints(rawClicks);

            const clusterTime = performance.now() - startTime;

            // Render the clusters
            this.renderClusters();

            if (this.currentClusters.length > 0) {
                console.log(`🎬 OBS: ${this.currentClusters.length} clusters (${clusterTime.toFixed(1)}ms)`);
            }

        } catch (error) {
            console.error('🎬 OBS clustering error:', error);
            this.currentClusters = [];
            this.renderClusters();
        }
    }

    /**
     * Convert legacy blob format to cluster format
     */
    convertLegacyBlobs(blobs) {
        return blobs.map((blob, index) => ({
            id: `legacy_${index}`,
            points: [{ x: blob.x, y: blob.y }],
            polygon: this.createLegacyPolygon(blob),
            centroid: { x: blob.x, y: blob.y },
            count: blob.count || 1,
            percentage: blob.pct || 0,
            isTop: blob.isTop || false,
            rank: blob.rank || null
        }));
    }

    /**
     * Create polygon from legacy blob
     */
    createLegacyPolygon(blob) {
        const radius = Math.max(0.03, Math.sqrt(blob.pct || 1) * 0.008);
        const segments = 8;
        const polygon = [];

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            polygon.push({
                x: blob.x + Math.cos(angle) * radius,
                y: blob.y + Math.sin(angle) * radius
            });
        }

        return polygon;
    }

    /**
     * Render clusters to canvas
     */
    renderClusters() {
        this.renderer.renderClusters(this.currentClusters);
    }

    /**
     * Show error message on canvas
     */
    showError(message) {
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Error styling
        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, this.canvas.height / 2 - 30, this.canvas.width, 60);

        // Error text
        ctx.fillStyle = '#ff4444';
        ctx.fillText(message, this.canvas.width / 2, this.canvas.height / 2);

        console.error('🎬 OBS Overlay Error:', message);
    }

    /**
     * Get current stats for debugging
     */
    getStats() {
        return {
            channelId: this.channelId,
            running: this.running,
            clusters: this.currentClusters.length,
            totalClicks: this.stats.totalClicks,
            uniqueUsers: this.stats.uniqueUsers,
            canvasSize: {
                width: this.canvas.width,
                height: this.canvas.height
            }
        };
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const overlay = new OBSOverlay();

    // Expose for debugging
    window.obsOverlay = overlay;

    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('🎬 OBS Overlay Global Error:', event.error);
    });

    // Performance monitoring
    let frameCount = 0;
    let lastFPSTime = performance.now();

    function updateFPS() {
        frameCount++;
        const now = performance.now();

        if (now - lastFPSTime >= 5000) { // Every 5 seconds
            const fps = Math.round(frameCount / (now - lastFPSTime) * 1000);
            console.log(`🎬 OBS Overlay Performance: ~${fps} FPS`);
            frameCount = 0;
            lastFPSTime = now;
        }

        requestAnimationFrame(updateFPS);
    }

    requestAnimationFrame(updateFPS);

    console.log('🎬 OBS Overlay ready');
});

// Handle page visibility for OBS
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('🎬 OBS Overlay: Hidden');
    } else {
        console.log('🎬 OBS Overlay: Visible');
    }
});