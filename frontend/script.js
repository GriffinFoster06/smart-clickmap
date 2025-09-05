// frontend/script.js - Enhanced with robust WebSocket fallback
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
        this.wsRetryCount = 0;
        this.maxWsRetries = 3;
        this.useWebSocket = true; // Flag to disable WS after failures

        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.POLL_RATE = 1000;

        // Debug logging
        this.debug = true;

        this.log('🎯 Bulletproof ClickMap Extension v3.1.0 initializing...');
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

            this.log('Setting up Twitch extension...');
            this.setupTwitchExtension();

            this.log('Setting up visibility optimization...');
            this.setupVisibilityOptimization();

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

    setupTwitchExtension() {
        if (typeof Twitch === 'undefined' || !Twitch.ext) {
            this.error('Twitch Extension Helper not available');
            return;
        }

        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            this.log(`✅ Twitch auth: Channel ${this.channelId}`);

            // Start with HTTP polling immediately (more reliable)
            this.startPolling();

            // Try WebSocket as enhancement (but don't depend on it)
            if (this.useWebSocket) {
                this.connectWebSocket();
            }
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.startPolling(); // Always ensure polling is active
                if (this.useWebSocket) {
                    this.connectWebSocket();
                }
            } else {
                this.stopPolling();
                this.disconnectWebSocket();
            }
        });

        this.log('✅ Twitch extension setup complete');
    }

    connectWebSocket() {
        // Don't try WebSocket if we've failed too many times
        if (!this.useWebSocket || this.wsRetryCount >= this.maxWsRetries) {
            this.log('WebSocket disabled due to previous failures, using polling only');
            return;
        }

        if (this.websocket || !this.channelId) return;

        try {
            // More defensive URL construction
            let wsUrl;
            if (this.EBS.startsWith('https://')) {
                wsUrl = this.EBS.replace('https://', 'wss://');
            } else if (this.EBS.startsWith('http://')) {
                wsUrl = this.EBS.replace('http://', 'ws://');
            } else {
                wsUrl = `wss://${this.EBS}`;
            }

            const fullWsUrl = `${wsUrl}/ws/${this.channelId}`;
            this.log(`Attempting WebSocket connection to: ${fullWsUrl}`);

            this.websocket = new WebSocket(fullWsUrl);

            // Set a connection timeout
            const connectionTimeout = setTimeout(() => {
                if (this.websocket && this.websocket.readyState === WebSocket.CONNECTING) {
                    this.log('WebSocket connection timeout');
                    this.websocket.close();
                    this.handleWebSocketFailure();
                }
            }, 5000);

            this.websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                this.wsRetryCount = 0; // Reset on successful connection
                this.log('📡 WebSocket connected successfully');
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
                clearTimeout(connectionTimeout);
                this.error('WebSocket error', error);
                this.handleWebSocketFailure();
            };

            this.websocket.onclose = (event) => {
                clearTimeout(connectionTimeout);
                this.log(`📡 WebSocket disconnected: ${event.code} ${event.reason}`);
                this.websocket = null;

                // Only retry if we haven't exceeded max retries
                if (this.isVisible && this.wsRetryCount < this.maxWsRetries) {
                    setTimeout(() => {
                        this.wsRetryCount++;
                        this.connectWebSocket();
                    }, Math.min(5000 * this.wsRetryCount, 30000));
                } else if (this.wsRetryCount >= this.maxWsRetries) {
                    this.handleWebSocketFailure();
                }
            };

        } catch (error) {
            this.error('WebSocket connection failed', error);
            this.handleWebSocketFailure();
        }
    }

    handleWebSocketFailure() {
        this.wsRetryCount++;
        if (this.wsRetryCount >= this.maxWsRetries) {
            this.useWebSocket = false;
            this.log('⚠️ WebSocket permanently disabled, using HTTP polling only');

            // Ensure polling is active
            if (!this.pollInterval) {
                this.startPolling();
            }
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
                this.startPolling(); // Always restart polling
                if (this.useWebSocket) {
                    this.connectWebSocket();
                }
            }
        });

        this.log('✅ Visibility optimization setup complete');
    }

    startPolling() {
        if (this.pollInterval || !this.channelId) return;

        // Use more aggressive polling when WebSocket is disabled
        const pollRate = this.useWebSocket ? this.POLL_RATE : 500;

        this.pollInterval = setInterval(() => this.pollHeatmapData(), pollRate);
        this.pollHeatmapData(); // Initial poll

        this.log(`✅ Polling started (${pollRate}ms interval)`);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            this.log('⏸️ Polling stopped');
        }
    }

    async pollHeatmapData() {
        // Always poll if WebSocket is disabled, otherwise only poll as fallback
        if (this.useWebSocket && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateVisualization(data);
            this.consecutiveErrors = 0;

        } catch (error) {
            this.consecutiveErrors++;
            if (this.consecutiveErrors <= 3) {
                this.error(`Polling failed (${this.consecutiveErrors}/${this.maxRetries})`, error);
            }
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

// Initialize extension with error handling
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