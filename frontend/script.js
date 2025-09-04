// frontend/script.js - Simplified main extension script that works with or without Twitch
import { HeatmapRenderer } from './heatmap.js';

class BulletproofExtension {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.renderer = null;
        this.pollInterval = null;
        this.websocket = null;
        this.isVisible = true;
        this.lastDataHash = '';
        this.consecutiveErrors = 0;
        this.maxRetries = 5;
        this.twitchReady = false;

        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.POLL_RATE = 1000;

        // Debug logging
        this.debug = true;

        this.log('🎯 Bulletproof ClickMap Extension v3.0.0 initializing...');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[EXTENSION] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[EXTENSION ERROR] ${message}`, err || '');
    }

    async init() {
        try {
            this.log('Setting up canvas...');
            this.setupCanvas();

            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.log('Setting up visibility optimization...');
            this.setupVisibilityOptimization();

            this.log('Setting up Twitch extension...');
            await this.setupTwitchExtension();

            this.log('Testing backend connection...');
            await this.testConnection();

            this.log('✅ Extension ready!');

        } catch (error) {
            this.error('Failed to initialize extension', error);
        }
    }

    async testConnection() {
        try {
            const response = await fetch(`${this.EBS}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }

            const data = await response.json();
            this.log(`✅ Backend connection OK - Version: ${data.version}`);
            return data;

        } catch (error) {
            this.error('Backend connection failed', error);
            throw error;
        }
    }

    setupCanvas() {
        const canvas = document.getElementById('heat');
        if (!canvas) {
            this.error('Heat canvas not found!');
            return;
        }

        this.renderer = new HeatmapRenderer(canvas);
        this.resizeCanvas();

        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        });

        this.log('✅ Canvas setup complete');
    }

    resizeCanvas() {
        if (this.renderer) {
            this.renderer.resize();
        }
    }

    setupEventListeners() {
        let clickTimeout = null;
        let clickCount = 0;

        // Click handler with debouncing and validation
        const handleClick = (event) => {
            if (!this.running || !this.authToken || !this.channelId) {
                this.log('Click ignored - not ready');
                return;
            }

            // Prevent spam clicking
            clearTimeout(clickTimeout);
            clickCount++;

            clickTimeout = setTimeout(() => {
                this.processClick(event);
                clickCount = 0;
            }, 50);
        };

        // Mouse clicks
        document.addEventListener('click', handleClick);

        // Touch support
        document.addEventListener('touchstart', (event) => {
            if (event.touches.length === 1) {
                event.preventDefault();
                const touch = event.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                };
                handleClick(syntheticEvent);
            }
        }, { passive: false });

        this.log('✅ Event listeners setup complete');
    }

    processClick(event) {
        try {
            const rect = document.body.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

            this.log(`Processing click at (${x.toFixed(3)}, ${y.toFixed(3)})`);

            // Visual feedback
            this.showClickFeedback(event.clientX, event.clientY);

            // Send to backend
            this.sendClick(x, y);

        } catch (error) {
            this.error('Failed to process click', error);
        }
    }

    showClickFeedback(clientX, clientY) {
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            left: ${clientX}px;
            top: ${clientY}px;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.5s ease-out forwards;
            background: rgba(255, 255, 255, 0.1);
        `;

        // Add animation if not exists
        if (!document.getElementById('click-animation-style')) {
            const style = document.createElement('style');
            style.id = 'click-animation-style';
            style.textContent = `
                @keyframes clickPulse {
                    0% { transform: scale(0); opacity: 1; }
                    100% { transform: scale(3); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(feedback);

        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 500);
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
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data.success) {
                this.log(`✅ Click sent successfully`);
            } else {
                throw new Error(data.error || 'Click failed');
            }

        } catch (error) {
            this.error('Failed to send click', error);
        }
    }

    async setupTwitchExtension() {
        return new Promise((resolve) => {
            // Check if Twitch is available with a reasonable timeout
            let attempts = 0;
            const maxAttempts = 30; // 3 seconds max

            const checkTwitch = () => {
                attempts++;

                if (typeof Twitch !== 'undefined' && Twitch.ext) {
                    this.log('✅ Twitch Extension Helper found');
                    this.twitchReady = true;
                    this.initializeTwitchHandlers();
                    resolve();
                } else if (attempts >= maxAttempts) {
                    this.log('⚠️ Twitch Extension Helper not available - running in standalone mode');
                    // Still resolve to continue initialization
                    this.startStandaloneMode();
                    resolve();
                } else {
                    setTimeout(checkTwitch, 100);
                }
            };

            checkTwitch();
        });
    }

    initializeTwitchHandlers() {
        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            this.log(`✅ Twitch auth: Channel ${this.channelId}`);

            // Start polling and WebSocket
            this.connectWebSocket();
            this.startPolling();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.connectWebSocket();
                this.startPolling();
            } else {
                this.stopPolling();
                this.disconnectWebSocket();
            }
        });

        this.log('✅ Twitch extension setup complete');
    }

    // Fallback mode for testing without Twitch
    startStandaloneMode() {
        this.log('🔧 Starting in standalone mode');

        // Use a test channel ID for demo purposes
        this.channelId = 'demo';
        this.authToken = 'demo-token';

        // Start polling immediately
        this.startPolling();

        this.log('✅ Standalone mode active');
    }

    connectWebSocket() {
        if (this.websocket || !this.channelId) return;

        try {
            const wsUrl = this.EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            this.websocket = new WebSocket(`${wsUrl}/ws/${this.channelId}`);

            this.websocket.onopen = () => {
                this.log('📡 WebSocket connected');
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    this.error('WebSocket message parse error', e);
                }
            };

            this.websocket.onerror = (error) => {
                this.error('WebSocket error', error);
                this.websocket = null;
            };

            this.websocket.onclose = () => {
                this.log('📡 WebSocket disconnected');
                this.websocket = null;

                // Retry connection after delay
                if (this.isVisible) {
                    setTimeout(() => this.connectWebSocket(), 5000);
                }
            };

        } catch (error) {
            this.error('WebSocket connection failed', error);
        }
    }

    disconnectWebSocket() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
            this.log('📡 WebSocket disconnected manually');
        }
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
                this.disconnectWebSocket();
            } else if (this.isVisible) {
                this.connectWebSocket();
                this.startPolling();
            }
        });

        this.log('✅ Visibility optimization setup complete');
    }

    startPolling() {
        if (this.pollInterval || !this.channelId) return;

        this.pollInterval = setInterval(() => this.pollHeatmapData(), this.POLL_RATE);
        this.pollHeatmapData(); // Initial poll

        this.log('✅ Polling started');
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            this.log('⏸️ Polling stopped');
        }
    }

    async pollHeatmapData() {
        // Skip polling if WebSocket is active
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateVisualization(data);
            this.consecutiveErrors = 0;

        } catch (error) {
            this.consecutiveErrors++;
            this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);
        }
    }

    updateVisualization(data) {
        try {
            this.running = data.running;

            if (this.renderer) {
                this.renderer.updateClusters(data.clusters || []);
            }

            // Update body classes
            document.body.classList.toggle('clickmap-active', this.running);
            document.body.classList.toggle('clickmap-has-data', (data.clusters || []).length > 0);

            // Debug info
            if ((data.clusters || []).length > 0) {
                this.log(`Updated: ${data.clusters.length} clusters, running: ${data.running}`);
            }

        } catch (error) {
            this.error('Failed to update visualization', error);
        }
    }

    destroy() {
        this.stopPolling();
        this.disconnectWebSocket();

        if (this.renderer) {
            this.renderer.destroy();
        }

        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.log('🧹 Extension destroyed');
    }
}

// Initialize extension immediately when loaded (but after DOM is ready)
function initializeExtension() {
    try {
        window.clickMapExtension = new BulletproofExtension();
    } catch (error) {
        console.error('❌ Failed to initialize ClickMap extension:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// Global reference
window.BulletproofExtension = BulletproofExtension;