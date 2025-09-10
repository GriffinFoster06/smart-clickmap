// frontend/script.js - HTTP-only click collection extension
// Fixed version that actually works with backend

class HTTPClickCollector {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.userId = '';
        this.running = false;
        this.isVisible = true;
        this.consecutiveErrors = 0;
        this.maxRetries = 5;
        this.twitchReady = false;

        this.EBS = 'https://smart-clickmap-backend.onrender.com';

        // Click processing settings
        this.clickQueue = [];
        this.isProcessingQueue = false;
        this.lastClickTime = 0;
        this.minClickInterval = 100; // Prevent click spam

        // Debug logging
        this.debug = true;

        console.log('🎯 HTTP Click Collector initializing...');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[CLICK COLLECTOR] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[CLICK COLLECTOR ERROR] ${message}`, err || '');
    }

    async init() {
        try {
            this.log('Setting up Twitch extension...');
            await this.setupTwitchExtension();

            this.log('Testing backend connection...');
            await this.testConnection();

            this.log('Setting up click listeners...');
            this.setupClickListeners();

            this.log('Starting click queue processor...');
            this.startClickQueueProcessor();

            this.log('Starting status polling...');
            this.startStatusPolling();

            this.log('✅ HTTP click collector ready!');

        } catch (error) {
            this.error('Failed to initialize click collector', error);
            this.showError('Failed to initialize click collector');
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

    async setupTwitchExtension() {
        return new Promise((resolve, reject) => {
            const maxAttempts = 50; // 5 seconds total
            let attempts = 0;

            const checkTwitch = () => {
                attempts++;

                if (typeof Twitch !== 'undefined' && Twitch.ext) {
                    this.log('✅ Twitch Extension Helper found');
                    this.twitchReady = true;
                    this.initializeTwitchHandlers();
                    resolve();
                } else if (attempts >= maxAttempts) {
                    this.error('Twitch Extension Helper not available after maximum attempts');
                    reject(new Error('Twitch Extension Helper not available'));
                } else {
                    setTimeout(checkTwitch, 100);
                }
            };

            checkTwitch();
        });
    }

    initializeTwitchHandlers() {
        try {
            Twitch.ext.onAuthorized((auth) => {
                this.authToken = auth.token;
                this.channelId = auth.channelId;
                this.userId = auth.userId || auth.opaqueUserId;

                this.log(`✅ Twitch auth: Channel ${this.channelId}, User: ${this.userId}`);

                // Check if session is running immediately after auth
                this.checkRunningStatus();
            });

            Twitch.ext.onVisibilityChanged((isVisible) => {
                this.isVisible = isVisible;
                this.log(`Visibility changed: ${isVisible}`);

                if (isVisible) {
                    this.checkRunningStatus();
                    this.consecutiveErrors = 0;
                }
            });

            this.log('✅ Twitch extension handlers setup complete');
        } catch (error) {
            this.error('Error setting up Twitch handlers', error);
        }
    }

    setupClickListeners() {
        // HTTP CLICK HANDLER - Direct processing
        const handleClick = (event) => {
            if (!this.running || !this.authToken || !this.channelId) {
                this.log('Click ignored - not ready (running=' + this.running + ', authToken=' + !!this.authToken + ', channelId=' + !!this.channelId + ')');
                return;
            }

            const now = performance.now();

            // Prevent click spam
            if (now - this.lastClickTime < this.minClickInterval) {
                return;
            }

            this.lastClickTime = now;

            // Add to queue for processing
            this.queueClick(event);
        };

        // Mouse clicks
        document.addEventListener('click', handleClick, { passive: false });

        // Touch support for mobile
        document.addEventListener('touchstart', (event) => {
            if (event.touches.length === 1) {
                event.preventDefault();
                const touch = event.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    timeStamp: event.timeStamp
                };
                handleClick(syntheticEvent);
            }
        }, { passive: false });

        document.addEventListener('touchend', (event) => {
            if (event.changedTouches.length === 1) {
                const touch = event.changedTouches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    timeStamp: event.timeStamp
                };
                handleClick(syntheticEvent);
            }
        }, { passive: false });

        this.log('✅ Click event listeners setup complete');
    }

    queueClick(event) {
        try {
            const rect = document.body.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

            // Add to processing queue
            this.clickQueue.push({
                x: x,
                y: y,
                clientX: event.clientX,
                clientY: event.clientY,
                timestamp: Date.now()
            });

            this.log(`Queued click at (${x.toFixed(3)}, ${y.toFixed(3)}) - Queue size: ${this.clickQueue.length}`);

            // Show immediate visual feedback
            this.showClickFeedback(event.clientX, event.clientY);

        } catch (error) {
            this.error('Failed to queue click', error);
        }
    }

    startClickQueueProcessor() {
        // Process queue frequently using requestAnimationFrame
        const processQueue = () => {
            if (this.clickQueue.length > 0 && !this.isProcessingQueue) {
                this.processClickQueue();
            }
            requestAnimationFrame(processQueue);
        };

        requestAnimationFrame(processQueue);
        this.log('✅ Click queue processor started');
    }

    async processClickQueue() {
        if (this.isProcessingQueue || this.clickQueue.length === 0) return;

        this.isProcessingQueue = true;

        // Process all queued clicks
        const clicksToProcess = [...this.clickQueue];
        this.clickQueue = []; // Clear queue immediately

        this.log(`Processing ${clicksToProcess.length} queued clicks`);

        // Send clicks in parallel
        const promises = clicksToProcess.map(click => this.sendClick(click.x, click.y));

        try {
            await Promise.allSettled(promises);
        } catch (error) {
            this.error('Error processing click queue', error);
        }

        this.isProcessingQueue = false;
    }

    showClickFeedback(clientX, clientY) {
        const feedback = document.createElement('div');
        feedback.style.cssText = `
            position: fixed;
            left: ${clientX}px;
            top: ${clientY}px;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(0, 255, 255, 0.9);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.6s ease-out forwards;
            background: rgba(0, 255, 255, 0.2);
            box-shadow: 0 0 15px rgba(0, 255, 255, 0.5);
        `;

        // Add animation if not exists
        if (!document.getElementById('click-animation-style')) {
            const style = document.createElement('style');
            style.id = 'click-animation-style';
            style.textContent = `
                @keyframes clickPulse {
                    0% { 
                        transform: scale(0); 
                        opacity: 1; 
                        border-color: rgba(0, 255, 255, 1);
                    }
                    50% { 
                        border-color: rgba(147, 51, 234, 0.8);
                    }
                    100% { 
                        transform: scale(3); 
                        opacity: 0; 
                        border-color: rgba(0, 255, 255, 0);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(feedback);

        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 600);
    }

    async sendClick(x, y) {
        try {
            if (!this.authToken) {
                throw new Error('No auth token available');
            }

            const response = await fetch(`${this.EBS}/click`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    x: x,
                    y: y,
                    channelId: this.channelId,
                    userId: this.userId
                })
            });

            this.log(`Click response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data.success) {
                this.log(`✅ Click sent successfully`);
                this.consecutiveErrors = 0;
            } else {
                throw new Error(data.error || 'Click failed');
            }

        } catch (error) {
            this.consecutiveErrors++;
            this.error(`Failed to send click (${this.consecutiveErrors}/${this.maxRetries})`, error);

            // If too many consecutive errors, check status
            if (this.consecutiveErrors >= 3) {
                this.checkRunningStatus();
            }

            // Show user feedback for persistent errors
            if (this.consecutiveErrors >= 5) {
                this.showError('Connection issues - clicks may not be registering');
            }
        }
    }

    startStatusPolling() {
        // Check running status every 3 seconds
        const pollStatus = () => {
            this.checkRunningStatus();
        };

        setInterval(pollStatus, 3000);
        this.log('✅ Status polling started');
    }

    async checkRunningStatus() {
        try {
            const url = this.channelId ?
                `${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}` :
                `${this.EBS}/heatmap`;

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const wasRunning = this.running;
            this.running = data.running;

            // Update body classes for styling
            document.body.classList.toggle('clickmap-active', this.running);
            document.body.classList.toggle('clickmap-inactive', !this.running);

            if (wasRunning !== this.running) {
                this.log(`Session status changed: ${this.running ? 'ACTIVE' : 'INACTIVE'}`);

                // Clear click queue if session stopped
                if (!this.running) {
                    this.clickQueue = [];
                }

                // Update UI
                this.updateStatusDisplay();
            }

        } catch (error) {
            this.error('Failed to check running status', error);
        }
    }

    updateStatusDisplay() {
        // Update any status indicators in the UI
        const statusElements = document.querySelectorAll('[data-clickmap-status]');
        statusElements.forEach(el => {
            el.textContent = this.running ? 'ACTIVE' : 'INACTIVE';
            el.className = this.running ? 'status-active' : 'status-inactive';
        });
    }

    showError(message) {
        console.error(`USER ERROR: ${message}`);

        // Try to show in error overlay if it exists
        const errorOverlay = document.getElementById('error-overlay');
        const errorMessage = document.getElementById('error-message');

        if (errorOverlay && errorMessage) {
            errorMessage.textContent = message;
            errorOverlay.style.display = 'block';

            // Auto-hide after 5 seconds
            setTimeout(() => {
                errorOverlay.style.display = 'none';
            }, 5000);
        }
    }

    hideError() {
        const errorOverlay = document.getElementById('error-overlay');
        if (errorOverlay) {
            errorOverlay.style.display = 'none';
        }
    }

    // Public methods for debugging
    getStatus() {
        return {
            running: this.running,
            authToken: !!this.authToken,
            channelId: this.channelId,
            userId: this.userId,
            queueSize: this.clickQueue.length,
            isProcessing: this.isProcessingQueue,
            consecutiveErrors: this.consecutiveErrors,
            twitchReady: this.twitchReady,
            isVisible: this.isVisible
        };
    }

    forceCheck() {
        this.checkRunningStatus();
    }

    destroy() {
        this.clickQueue = [];
        this.isProcessingQueue = false;
        this.log('🧹 HTTP click collector destroyed');
    }
}

// Initialize extension with error handling
function initializeHTTPExtension() {
    try {
        window.clickMapExtension = new HTTPClickCollector();

        // Setup retry button if it exists
        const retryButton = document.getElementById('retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                location.reload();
            });
        }

        console.log('🎯 HTTP Click Collection Extension loaded successfully');

    } catch (error) {
        console.error('❌ Failed to initialize HTTP Click Collector:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHTTPExtension);
} else {
    initializeHTTPExtension();
}

// Global reference for debugging
window.HTTPClickCollector = HTTPClickCollector;