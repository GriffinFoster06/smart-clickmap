// frontend/script.js - Bulletproof main extension script with robust WebSocket handling
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
        this.wsRetryDelay = 1000;
        this.useWebSockets = true;

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

            // Start with WebSocket attempt, fallback to polling
            this.startDataConnection();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.startDataConnection();
            } else {
                this.stopDataConnection();
            }
        });

        this.log('✅ Twitch extension setup complete');
    }

    startDataConnection() {
        if (!this.channelId) {
            this.log('No channel ID available for data connection');
            return;
        }

        // Always start polling as primary method
        this.startPolling();

        // Try WebSocket as enhancement (if enabled and not failed too many times)
        if (this.useWebSockets && this.wsRetryCount < this.maxWsRetries) {
            this.connectWebSocket();
        } else {
            this.log('WebSocket disabled, using polling only');
        }
    }

    stopDataConnection() {
        this.stopPolling();
        this.disconnectWebSocket();
    }

    connectWebSocket() {
        if (this.websocket || !this.channelId || !this.useWebSockets) return;

        try {
            // Multiple URL formats to try
            const wsBaseUrls = [
                this.EBS.replace('https://', 'wss://').replace('http://', 'ws://'),
                this.EBS.replace('https://', 'wss://').replace('http://', 'wss://') // ensure wss
            ];

            const wsUrls = [];
            for (const baseUrl of wsBaseUrls) {
                wsUrls.push(`${baseUrl}/ws/${this.channelId}`);
                wsUrls.push(`${baseUrl}/ws?channel=${encodeURIComponent(this.channelId)}`);
            }

            this.attemptWebSocketConnection(wsUrls, 0);

        } catch (error) {
            this.error('WebSocket connection setup failed', error);
            this.wsRetryCount++;
            this.scheduleWebSocketRetry();
        }
    }

    attemptWebSocketConnection(urls, index) {
        if (index >= urls.length) {
            this.error('All WebSocket URLs failed');
            this.wsRetryCount++;
            this.scheduleWebSocketRetry();
            return;
        }

        const url = urls[index];
        this.log(`Attempting WebSocket connection to: ${url}`);

        try {
            const ws = new WebSocket(url);

            const connectionTimeout = setTimeout(() => {
                this.log(`WebSocket connection timeout for ${url}`);
                ws.close();
                this.attemptWebSocketConnection(urls, index + 1);
            }, 5000);

            ws.onopen = () => {
                clearTimeout(connectionTimeout);
                this.websocket = ws;
                this.wsRetryCount = 0; // Reset retry count on successful connection
                this.log(`📡 WebSocket connected to: ${url}`);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.updateVisualization(data);
                } catch (e) {
                    this.error('WebSocket message parse error', e);
                }
            };

            ws.onerror = (error) => {
                clearTimeout(connectionTimeout);
                this.log(`WebSocket error for ${url}:`, error.type || 'Unknown error');
                // Don't increment retry count here, let onclose handle it
            };

            ws.onclose = (event) => {
                clearTimeout(connectionTimeout);
                if (this.websocket === ws) {
                    this.websocket = null;
                }

                this.log(`WebSocket closed for ${url}: Code ${event.code}, Reason: ${event.reason || 'None'}`);

                // If this was our active connection, try next URL or schedule retry
                if (index < urls.length - 1) {
                    this.attemptWebSocketConnection(urls, index + 1);
                } else {
                    this.wsRetryCount++;
                    this.scheduleWebSocketRetry();
                }
            };

        } catch (error) {
            this.error(`Failed to create WebSocket for ${url}`, error);
            this.attemptWebSocketConnection(urls, index + 1);
        }
    }

    scheduleWebSocketRetry() {
        if (this.wsRetryCount >= this.maxWsRetries) {
            this.log(`WebSocket disabled after ${this.maxWsRetries} failed attempts`);
            this.useWebSockets = false;
            return;
        }

        const delay = this.wsRetryDelay * Math.pow(2, this.wsRetryCount - 1); // Exponential backoff
        this.log(`Scheduling WebSocket retry ${this.wsRetryCount}/${this.maxWsRetries} in ${delay}ms`);

        setTimeout(() => {
            if (this.isVisible && this.channelId && this.useWebSockets) {
                this.connectWebSocket();
            }
        }, delay);
    }

    disconnectWebSocket() {
        if (this.websocket) {
            this.websocket.close(1000, 'Extension disconnecting');
            this.websocket = null;
            this.log('📡 WebSocket disconnected manually');
        }
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopDataConnection();
            } else if (this.isVisible) {
                this.startDataConnection();
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
                this.log(`Updated: ${data.clusters.length} clusters, running: ${data.running}, source: ${this.websocket ? 'WebSocket' : 'Polling'}`);
            }

        } catch (error) {
            this.error('Failed to update visualization', error);
        }
    }

    destroy() {
        this.stopDataConnection();

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