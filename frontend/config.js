import { ExMachinaRenderer, ExMachinaClusterer } from './heatmap.js';

/**
 * Ex Machina Configuration Panel
 * Broadcaster controls for the Smart Click Maps system
 */
class ExMachinaConfigPanel {
    constructor() {
        this.EBS = 'https://smart-clickmap-backend.onrender.com';

        // Initialize preview renderer
        const previewCanvas = document.getElementById('mini');
        this.previewRenderer = new ExMachinaRenderer(previewCanvas);
        this.clusterer = new ExMachinaClusterer({
            epsilon: 0.08,
            minPts: 3,
            maxClusters: 8,
            minPercentage: 8
        });

        // UI Elements
        this.elements = {
            statusText: document.getElementById('status-text'),
            statusIndicator: document.getElementById('status-indicator'),
            clicks: document.getElementById('clicks'),
            users: document.getElementById('users'),
            blobs: document.getElementById('blobs'),
            startBtn: document.getElementById('start'),
            stopBtn: document.getElementById('stop'),
            resetBtn: document.getElementById('reset')
        };

        // State
        this.isRunning = false;
        this.stats = { totalClicks: 0, uniqueUsers: 0, clusters: 0 };
        this.currentClusters = [];

        // Setup
        this.setupEventListeners();
        this.startPolling();

        console.log('Ex Machina Config Panel initialized');
    }

    /**
     * Setup event listeners for controls
     */
    setupEventListeners() {
        // Control buttons
        this.elements.startBtn.onclick = () => this.startMapping();
        this.elements.stopBtn.onclick = () => this.stopMapping();
        this.elements.resetBtn.onclick = () => this.resetMapping();

        // Preview canvas resize
        window.addEventListener('resize', () => {
            this.previewRenderer.handleResize();
            this.renderPreview();
        });
    }

    /**
     * Start polling for data updates
     */
    startPolling() {
        this.fetchData(); // Initial fetch

        setInterval(() => {
            this.fetchData();
        }, 2000); // Poll every 2 seconds
    }

    /**
     * Fetch current data from server
     */
    async fetchData() {
        try {
            // Get global stats
            const statsResponse = await fetch(`${this.EBS}/stats`);
            const statsData = await statsResponse.json();

            // Get sample heatmap data for preview (use first active channel)
            let previewData = null;
            if (statsData.totalChannels > 0) {
                const channelsResponse = await fetch(`${this.EBS}/channels`);
                const channelsData = await channelsResponse.json();

                if (channelsData.channels && channelsData.channels.length > 0) {
                    const firstChannel = channelsData.channels[0];
                    const heatmapResponse = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(firstChannel.channelId)}`);
                    previewData = await heatmapResponse.json();
                }
            }

            this.updateDisplay(statsData, previewData);

        } catch (error) {
            console.error('Failed to fetch Ex Machina data:', error);
            this.showError('Failed to connect to server');
        }
    }

    /**
     * Update the display with new data
     */
    updateDisplay(statsData, previewData) {
        // Update running status
        const wasRunning = this.isRunning;
        this.isRunning = statsData.running;

        if (wasRunning !== this.isRunning) {
            console.log(`Ex Machina status changed: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`);
        }

        // Update status display
        this.elements.statusText.textContent = this.isRunning ? 'Running' : 'Stopped';
        this.elements.statusIndicator.className =
            `status-indicator ${this.isRunning ? 'running' : 'stopped'}`;

        // Update statistics
        this.elements.clicks.textContent = statsData.totalClicks?.toLocaleString() || '0';
        this.elements.users.textContent = statsData.totalUsers?.toLocaleString() || '0';

        // Update button states
        this.elements.startBtn.disabled = this.isRunning;
        this.elements.stopBtn.disabled = !this.isRunning;

        // Add pulsing effect when active and has clicks
        if (this.isRunning && statsData.totalClicks > 0) {
            this.elements.statusIndicator.classList.add('pulse');
        } else {
            this.elements.statusIndicator.classList.remove('pulse');
        }

        // Update preview with real data
        if (previewData && previewData.rawClicks) {
            this.updatePreview(previewData.rawClicks);
        } else {
            // Clear preview if no data
            this.currentClusters = [];
            this.elements.blobs.textContent = '0';
            this.renderPreview();
        }
    }

    /**
     * Update preview with clustering
     */
    updatePreview(rawClicks) {
        try {
            // Generate clusters for preview
            this.currentClusters = this.clusterer.clusterPoints(rawClicks);

            // Update cluster count display
            this.elements.blobs.textContent = this.currentClusters.length.toString();

            // Render preview
            this.renderPreview();

        } catch (error) {
            console.error('Preview clustering error:', error);
            this.currentClusters = [];
            this.elements.blobs.textContent = '0';
            this.renderPreview();
        }
    }

    /**
     * Render the preview canvas
     */
    renderPreview() {
        this.previewRenderer.renderClusters(this.currentClusters);
    }

    /**
     * Start click mapping
     */
    async startMapping() {
        if (this.elements.startBtn.disabled) return;

        this.setLoading(true);

        try {
            const response = await fetch(`${this.EBS}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showSuccess('Ex Machina Click Mapping Started!');
                console.log('✅ Click mapping started');
            } else {
                throw new Error(data.message || 'Failed to start');
            }

        } catch (error) {
            console.error('Start mapping error:', error);
            this.showError('Failed to start click mapping');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Stop click mapping
     */
    async stopMapping() {
        if (this.elements.stopBtn.disabled) return;

        this.setLoading(true);

        try {
            const response = await fetch(`${this.EBS}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showSuccess('Ex Machina Click Mapping Stopped');
                console.log('🛑 Click mapping stopped');
            } else {
                throw new Error(data.message || 'Failed to stop');
            }

        } catch (error) {
            console.error('Stop mapping error:', error);
            this.showError('Failed to stop click mapping');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Reset/clear all click data
     */
    async resetMapping() {
        if (!confirm('🗑️ Clear all click data?\n\nThis will permanently remove all viewer clicks from all channels.')) {
            return;
        }

        this.setLoading(true);

        try {
            const response = await fetch(`${this.EBS}/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showSuccess('All click data cleared');
                console.log('🗑️ All data reset');

                // Clear preview immediately
                this.currentClusters = [];
                this.renderPreview();
            } else {
                throw new Error(data.message || 'Failed to reset');
            }

        } catch (error) {
            console.error('Reset mapping error:', error);
            this.showError('Failed to reset click data');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Set loading state for buttons
     */
    setLoading(loading) {
        const buttons = [this.elements.startBtn, this.elements.stopBtn, this.elements.resetBtn];

        buttons.forEach(btn => {
            if (loading) {
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
                btn.disabled = true;
            } else {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                // Re-enable based on running state
                this.elements.startBtn.disabled = this.isRunning;
                this.elements.stopBtn.disabled = !this.isRunning;
                this.elements.resetBtn.disabled = false;
            }
        });
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    /**
     * Show error message
     */
    showError(message) {
        this.showNotification(message, 'error');
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'ex-machina-notification';
        notification.textContent = message;

        // Base styles
        Object.assign(notification.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            padding: '12px 20px',
            borderRadius: '6px',
            color: 'white',
            fontFamily: '"Segoe UI", Arial, sans-serif',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: '10000',
            maxWidth: '300px',
            wordWrap: 'break-word',
            transform: 'translateX(110%)',
            transition: 'transform 0.3s ease',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)'
        });

        // Type-specific colors
        if (type === 'success') {
            notification.style.background = 'rgba(72, 187, 120, 0.9)';
            notification.style.borderLeft = '4px solid #48bb78';
        } else if (type === 'error') {
            notification.style.background = 'rgba(245, 101, 101, 0.9)';
            notification.style.borderLeft = '4px solid #f56565';
        } else {
            notification.style.background = 'rgba(66, 153, 225, 0.9)';
            notification.style.borderLeft = '4px solid #4299e1';
        }

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Animate out and remove
        setTimeout(() => {
            notification.style.transform = 'translateX(110%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Add dynamic styles for better visual feedback
    const style = document.createElement('style');
    style.textContent = `
        .pulse {
            animation: ex-machina-pulse 2s ease-in-out infinite;
        }
        
        @keyframes ex-machina-pulse {
            0%, 100% {
                opacity: 1;
                box-shadow: 0 0 0 0 rgba(72, 187, 120, 0.7);
            }
            50% {
                opacity: 0.8;
                box-shadow: 0 0 0 8px rgba(72, 187, 120, 0);
            }
        }
        
        .status-indicator.running {
            background: #48bb78;
        }
        
        .status-indicator.stopped {
            background: #f56565;
        }
        
        button:disabled {
            opacity: 0.6 !important;
            cursor: not-allowed !important;
        }
        
        button:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
    `;
    document.head.appendChild(style);

    // Initialize the config panel
    const configPanel = new ExMachinaConfigPanel();

    // Expose for debugging
    if (new URLSearchParams(location.search).has('debug')) {
        window.exMachinaConfig = configPanel;
        console.log('Ex Machina Config Panel debug mode enabled');
    }
});