import { HeatmapRenderer } from './heatmap.js';

class SmartClickMap {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.blobs = [];
        this.stats = { totalClicks: 0, uniqueUsers: 0 };

        this.canvas = document.getElementById('heat');
        this.renderer = new HeatmapRenderer(this.canvas);

        this.EBS = 'https://smart-clickmap-backend.onrender.com';
        this.wsUrl = this.EBS.replace('https://', 'wss://');

        this.ws = null;
        this.pollInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        this.clickBuffer = []; // Buffer clicks when offline
        this.isOnline = navigator.onLine;

        this.setupEventListeners();
        this.setupResizeHandler();
    }

    async initialize() {
        // Wait for Twitch extension authorization
        return new Promise((resolve) => {
            if (window.Twitch && window.Twitch.ext) {
                Twitch.ext.onAuthorized((auth) => {
                    this.authToken = auth.token;
                    this.channelId = auth.channelId;
                    this.startConnection();
                    resolve();
                });

                Twitch.ext.onContext((context) => {
                    // Handle context changes (like fullscreen)
                    this.handleContextChange(context);
                });
            } else {
                // Fallback for testing
                console.warn('Twitch extension not available, running in test mode');
                this.channelId = 'test_channel';
                this.startPolling(); // Fallback to polling
                resolve();
            }
        });
    }

    setupEventListeners() {
        // Click handling with improved feedback
        document.addEventListener('click', (ev) => this.handleClick(ev));
        document.addEventListener('touchstart', (ev) => this.handleTouch(ev));

        // Network status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.renderer.stopAnimation();
            } else {
                this.renderer.startAnimation();
            }
        });

        // Keyboard shortcuts for testing
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'c' && ev.ctrlKey) {
                this.renderer.clear();
            }
            if (ev.key === 's' && ev.ctrlKey) {
                this.cycleColorScheme();
                ev.preventDefault();
            }
        });
    }

    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.resizeCanvas();
            }, 250);
        });
        this.resizeCanvas();
    }

    resizeCanvas() {
        const canvas = this.canvas;
        const rect = document.body.getBoundingClientRect();

        canvas.width = rect.width || window.innerWidth;
        canvas.height = rect.height || window.innerHeight;

        // Redraw current state
        this.renderer.drawBlobs(this.blobs);
    }

    cycleColorScheme() {
        const schemes = ['plasma', 'ocean', 'fire'];
        const current = this.renderer.settings.colorScheme;
        const currentIndex = schemes.indexOf(current);
        const nextIndex = (currentIndex + 1) % schemes.length;

        this.renderer.updateSettings({ colorScheme: schemes[nextIndex] });
        this.showNotification(`Color scheme: ${schemes[nextIndex]}`);
    }

    showNotification(message, duration = 2000) {
        // Create temporary notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(100, 65, 165, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 14px;
            z-index: 1000;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.transition = 'opacity 0.3s';
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    }

    startConnection() {
        this.connectWebSocket();
        this.startPolling(); // Fallback polling
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const wsUrl = `${this.wsUrl}?channel=${encodeURIComponent(this.channelId)}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('🔗 WebSocket connected');
                this.reconnectAttempts = 0;
                this.showNotification('Real-time updates active');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('WebSocket message parsing error:', e);
                }
            };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', event.code);
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectAttempts++;

            setTimeout(() => {
                if (this.isOnline) {
                    console.log(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
                    this.connectWebSocket();
                }
            }, delay);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'click':
                // Real-time click feedback
                this.renderer.createClickEffect(
                    data.data.x,
                    data.data.y,
                    0.8
                );
                break;

            case 'status':
                this.running = data.data.running;
                this.showNotification(
                    this.running ? 'Click mapping started!' : 'Click mapping stopped'
                );
                break;

            case 'reset':
                this.renderer.clear();
                this.blobs = [];
                this.stats = { totalClicks: 0, uniqueUsers: 0 };
                this.showNotification('Map reset');
                break;

            case 'heatmap_update':
                this.updateHeatmap(data.data);
                break;
        }
    }

    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(async () => {
            try {
                await this.fetchHeatmap();
            } catch (error) {
                console.error('Polling failed:', error);
            }
        }, 2000); // Poll every 2 seconds
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async fetchHeatmap() {
        try {
            const url = this.channelId ?
                `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}` :
                `${this.EBS}/heatmap`;

            const response = await fetch(url, {
                headers: this.authToken ? {
                    'Authorization': `Bearer ${this.authToken}`
                } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.updateHeatmap(data);

        } catch (error) {
            console.error('Failed to fetch heatmap:', error);
            // Continue silently, don't show errors to users
        }
    }

    updateHeatmap(data) {
        const wasRunning = this.running;
        this.running = data.running;
        this.blobs = data.blobs || [];
        this.stats = {
            totalClicks: data.totalClicks || 0,
            uniqueUsers: data.uniqueUsers || 0
        };

        // Show status change notifications
        if (wasRunning !== this.running) {
            this.showNotification(
                this.running ? 'Click mapping active' : 'Click mapping paused',
                1000
            );
        }

        // Update renderer settings if provided
        if (data.settings) {
            this.renderer.updateSettings({
                fadeTime: data.settings.fadeTime
            });
        }

        // Update visualization
        this.renderer.drawBlobs(this.blobs);
    }

    async sendClick(x, y) {
        if (!this.running || !this.authToken) {
            return;
        }

        const clickData = { x, y };

        try {
            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(clickData)
            });

            if (response.ok) {
                // Immediate visual feedback
                this.renderer.createClickEffect(x, y, 1);
            } else {
                console.warn('Click failed:', response.status);
                // Add to buffer for retry
                this.clickBuffer.push({ ...clickData, timestamp: Date.now() });
            }

        } catch (error) {
            console.error('Click send failed:', error);
            // Buffer click for when connection is restored
            this.clickBuffer.push({ ...clickData, timestamp: Date.now() });
        }
    }

    async flushClickBuffer() {
        if (this.clickBuffer.length === 0) return;

        const clicks = [...this.clickBuffer];
        this.clickBuffer = [];

        // Send buffered clicks (limit to prevent spam)
        const recentClicks = clicks
            .filter(click => Date.now() - click.timestamp < 30000) // Only last 30 seconds
            .slice(-10); // Max 10 clicks

        for (const click of recentClicks) {
            await this.sendClick(click.x, click.y);
            await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
        }
    }

    handleClick(event) {
        if (event.target !== document.body && event.target !== this.canvas) {
            return; // Only handle clicks on the overlay area
        }

        const rect = document.body.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        // Boundary check
        if (x < 0 || x > 1 || y < 0 || y > 1) return;

        this.sendClick(x, y);
    }

    handleTouch(event) {
        event.preventDefault();
        const touch = event.touches[0];
        const rect = document.body.getBoundingClientRect();
        const x = (touch.clientX - rect.left) / rect.width;
        const y = (touch.clientY - rect.top) / rect.height;

        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            this.sendClick(x, y);
        }
    }

    handleContextChange(context) {
        // Handle fullscreen, theater mode changes
        setTimeout(() => this.resizeCanvas(), 100);
    }

    handleOnline() {
        this.isOnline = true;
        this.showNotification('Connection restored');
        this.connectWebSocket();
        this.flushClickBuffer();
    }

    handleOffline() {
        this.isOnline = false;
        this.showNotification('Offline - clicks will be buffered');
    }

    destroy() {
        this.stopPolling();
        this.renderer.stopAnimation();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Initialize the application
const clickMap = new SmartClickMap();
clickMap.initialize().catch(console.error);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    clickMap.destroy();
});

// Export for testing/debugging
window.clickMap = clickMap;