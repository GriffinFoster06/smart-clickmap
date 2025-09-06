// frontend/script.js - Click collection only extension (no display)
// Displays handled by separate overlay files

class ClickCollectorExtension {
    constructor() {
        this.authToken = '';
        this.channelId = '';
        this.running = false;
        this.isVisible = true;
        this.consecutiveErrors = 0;
        this.maxRetries = 5;
        this.twitchReady = false;

        this.EBS = 'https://smart-clickmap-backend.onrender.com';

        // Debug logging
        this.debug = true;

        this.log('🎯 ClickMap Collector v3.0.0 initializing...');
        this.init();
    }

    log(message) {
        if (this.debug) {
            console.log(`[COLLECTOR] ${message}`);
        }
    }

    error(message, err = null) {
        console.error(`[COLLECTOR ERROR] ${message}`, err || '');
    }

    async init() {
        try {
            this.log('Setting up event listeners...');
            this.setupEventListeners();

            this.log('Setting up visibility optimization...');
            this.setupVisibilityOptimization();

            this.log('Setting up Twitch extension...');
            await this.setupTwitchExtension();

            this.log('Testing backend connection...');
            await this.testConnection();

            this.log('✅ Click collector ready!');

        } catch (error) {
            this.error('Failed to initialize click collector', error);
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
            border: 2px solid rgba(147, 51, 234, 0.8);
            border-radius: 50%;
            pointer-events: none;
            z-index: 10001;
            margin: -10px 0 0 -10px;
            animation: clickPulse 0.5s ease-out forwards;
            background: rgba(147, 51, 234, 0.1);
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
        Twitch.ext.onAuthorized((auth) => {
            this.authToken = auth.token;
            this.channelId = auth.channelId;

            this.log(`✅ Twitch auth: Channel ${this.channelId}`);

            // Check if session is running
            this.checkRunningStatus();
        });

        Twitch.ext.onVisibilityChanged((isVisible) => {
            this.isVisible = isVisible;
            this.log(`Visibility changed: ${isVisible}`);

            if (isVisible) {
                this.checkRunningStatus();
            }
        });

        this.log('✅ Twitch extension setup complete');
    }

    async checkRunningStatus() {
        try {
            const response = await fetch(`${this.EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.running = data.running;

            // Update body classes for styling
            document.body.classList.toggle('clickmap-active', this.running);
            document.body.classList.toggle('clickmap-inactive', !this.running);

            this.log(`Session status: ${this.running ? 'ACTIVE' : 'INACTIVE'}`);

        } catch (error) {
            this.error('Failed to check running status', error);
        }
    }

    setupVisibilityOptimization() {
        // Pause when tab is not visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.log('Tab hidden - pausing');
            } else if (this.isVisible) {
                this.log('Tab visible - resuming');
                this.checkRunningStatus();
            }
        });

        this.log('✅ Visibility optimization setup complete');
    }

    destroy() {
        this.log('🧹 Click collector destroyed');
    }
}

// Initialize extension with error handling
function initializeExtension() {
    try {
        window.clickMapExtension = new ClickCollectorExtension();
    } catch (error) {
        console.error('❌ Failed to initialize ClickMap collector:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// Global reference
window.ClickCollectorExtension = ClickCollectorExtension;
