// frontend/script.js - Main Twitch extension script with HUD-style visualization
import { HeatmapRenderer } from './heatmap.js';

class ClickMapExtension {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.renderer = null;
        this.pollInterval = null;
        this.isVisible = true;
        this.lastDataHash = '';

        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.POLL_RATE = 1000; // 1 second polling

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupTwitchExtension();
        this.setupVisibilityOptimization();

        console.log('🎯 Smart ClickMap Extension v2.0.0 initialized');
    }

    setupCanvas() {
        const canvas = document.getElementById('heat');
        if (!canvas) {
            console.error('❌ Heat canvas not found');
            return;
        }

        this.renderer = new HeatmapRenderer(canvas);
        this.resizeCanvas();

        // Handle window resize
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        });
    }

    resizeCanvas() {
        if (!this.renderer) return;
        this.renderer.resize();
    }

    setupEventListeners() {
        let clickTimeout = null;

        // Main click handler
        document.addEventListener('click', (event) => {
            if (!this.running || !this.authToken) return;

            // Debounce rapid clicks
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }

            clickTimeout = setTimeout(() => {
                this.handleClick(event);
            }, 50);
        });

        // Touch support for mobile
        document.addEventListener('touchstart', (event) => {
            if (!this.running || !this.authToken || event.touches.length > 1) return;

            event.preventDefault();
            const touch = event.touches[0];
            const syntheticEvent = {
                clientX: touch.clientX,
                clientY: touch.clientY
            };

            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }

            clickTimeout = setTimeout(() => {
                this.handleClick(syntheticEvent);
            }, 50);
        }, { passive: false });
    }

    handleClick(event) {
        const rect = document.body.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

        // Visual feedback for the click
        this.showClickFeedback(event.clientX, event.clientY);

        // Send click to backend
        this.sendClick(x, y);
    }

    showClickFeedback(clientX, clientY) {
        // Create temporary visual feedback element
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            left: ${clientX}px;
            top: ${clientY}px;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(147, 51, 234, 0.8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.6s ease-out forwards;
        `;

        // Add CSS animation
        if (!document.getElementById('click-feedback-style')) {
            const style = document.createElement('style');
            style.id = 'click-feedback-style';
            style.textContent = `
                @keyframes clickPulse {
                    0% { transform: scale(0); opacity: 1; }
                    100% { transform: scale(3); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(feedback);

        // Remove after animation
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 600);
    }

    async sendClick(x, y) {
        try {
            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ x, y })
            });

            if (!response.ok) {
                console.warn('⚠️ Click submission failed:', response.status);
            }
        } catch (error) {
            console.error('❌ Click submission error:', error);
        }
    }

    setupTwitchExtension() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            console.error('❌ Twitch Extension Helper not loaded');
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            console.log('✅ Extension authorized for channel:', this.channelId);
            this.startPolling();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            if (isVisible) {
                this.startPolling();
            } else {
                this.stopPolling();
            }
        });
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else if (this.isVisible) {
                this.startPolling();
            }
        });

        // Intersection observer for off-screen detection
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (entry.intersectionRatio === 0) {
                    this.stopPolling();
                } else if (this.isVisible) {
                    this.startPolling();
                }
            }, { threshold: 0 });

            observer.observe(document.body);
        }
    }

    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => {
            this.pollHeatmapData();
        }, this.POLL_RATE);

        // Initial poll
        this.pollHeatmapData();
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async pollHeatmapData() {
        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
            if (!response.ok) {
                console.warn('⚠️ Heatmap poll failed:', response.status);
                return;
            }

            const data = await response.json();
            const dataHash = this.hashData(data);

            // Only update if data has changed
            if (dataHash !== this.lastDataHash) {
                this.lastDataHash = dataHash;
                this.updateVisualization(data);
            }

        } catch (error) {
            console.error('❌ Heatmap polling error:', error);
        }
    }

    hashData(data) {
        // Simple hash for change detection
        return JSON.stringify({
            running: data.running,
            clusters: data.clusters?.map(c => ({
                x: Math.round(c.x * 1000),
                y: Math.round(c.y * 1000),
                p: c.percentage
            })) || []
        });
    }

    updateVisualization(data) {
        this.running = data.running;

        if (!this.renderer) return;

        // Update renderer with HUD-style clusters
        this.renderer.updateClusters(data.clusters || []);

        // Update body classes for CSS styling
        document.body.classList.toggle('clickmap-active', this.running);
        document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

        // Debug info (only in dev)
        if (window.location.hostname === 'localhost') {
            const visibleClusters = (data.clusters || []).filter(c => c.percentage >= 3);
            if (visibleClusters.length > 0) {
                console.log('📊 Visible clusters:', visibleClusters.map(c => `${c.percentage}%`).join(', '));
            }
        }
    }

    destroy() {
        this.stopPolling();
        if (this.renderer) {
            this.renderer.destroy();
        }
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
    }
}

// Initialize extension when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new ClickMapExtension();
    });
} else {
    new ClickMapExtension();
}

// Global reference for debugging
window.ClickMapExtension = ClickMapExtension;