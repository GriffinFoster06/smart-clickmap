// frontend/debug.js - Debug functionality and initialization
class DebugManager {
    constructor() {
        this.isDebugMode = this.checkDebugMode();
        this.analytics = this.initAnalytics();
        this.init();
    }

    checkDebugMode() {
        return window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            new URLSearchParams(window.location.search).get('debug') === '1';
    }

    init() {
        this.setupErrorHandling();
        this.setupDebugPanel();
        this.setupRetryButton();
        this.logInitialization();

        if (this.isDebugMode) {
            this.enableDebugFeatures();
        }
    }

    setupErrorHandling() {
        // Unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('🔴 Unhandled promise rejection:', event.reason);
            this.analytics.trackError();

            // Don't show user-facing errors for network issues in production
            if (!this.isDebugMode) {
                event.preventDefault();
            }
        });

        // General errors
        window.addEventListener('error', (event) => {
            console.error('🔴 Unhandled error:', event.error || event.message);
            this.analytics.trackError();
        });
    }

    setupDebugPanel() {
        const debugPanel = document.getElementById('debug-panel');
        const debugToggle = document.getElementById('debug-toggle');

        if (debugToggle) {
            debugToggle.addEventListener('click', () => {
                if (debugPanel) {
                    debugPanel.style.display = 'none';
                }
            });
        }

        // Show debug panel in debug mode
        if (this.isDebugMode && debugPanel) {
            debugPanel.style.display = 'block';
        }
    }

    setupRetryButton() {
        const retryButton = document.getElementById('retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                location.reload();
            });
        }
    }

    enableDebugFeatures() {
        console.log('🐛 Debug mode enabled');

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey) {
                switch (e.key) {
                    case 'D':
                        this.toggleDebugPanel();
                        break;
                    case 'C':
                        console.clear();
                        console.log('🧹 Console cleared');
                        break;
                    case 'R':
                        if (window.ClickMapExtension && window.ClickMapExtension.destroy) {
                            window.ClickMapExtension.destroy();
                        }
                        location.reload();
                        break;
                    case 'A':
                        console.log('📊 Analytics:', this.analytics.getSessionData());
                        break;
                }
            }
        });

        // Performance monitoring
        this.startPerformanceMonitoring();

        // Log helpful debug info
        console.log('🎯 Smart ClickMap Extension v2.0.0 Debug Mode');
        console.log('⌨️  Keyboard Shortcuts:');
        console.log('   Ctrl+Shift+D: Toggle debug panel');
        console.log('   Ctrl+Shift+C: Clear console');
        console.log('   Ctrl+Shift+R: Reload extension');
        console.log('   Ctrl+Shift+A: Show analytics');
    }

    toggleDebugPanel() {
        const debugPanel = document.getElementById('debug-panel');
        if (debugPanel) {
            const isVisible = debugPanel.style.display !== 'none';
            debugPanel.style.display = isVisible ? 'none' : 'block';
        }
    }

    startPerformanceMonitoring() {
        if (typeof performance === 'undefined' || !performance.memory) return;

        let frameCount = 0;
        let lastTime = performance.now();

        const measureFPS = () => {
            frameCount++;
            const now = performance.now();

            if (now - lastTime >= 5000) { // Every 5 seconds
                const fps = Math.round((frameCount * 1000) / (now - lastTime));
                const memoryMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
                console.log(`📊 Performance: ${fps} FPS, ${memoryMB}MB memory`);

                frameCount = 0;
                lastTime = now;
            }

            requestAnimationFrame(measureFPS);
        };

        requestAnimationFrame(measureFPS);
    }

    updateDebugStats(stats) {
        if (!this.isDebugMode) return;

        this.updateDebugElement('debug-status', stats.status || '-');
        this.updateDebugElement('debug-channel', stats.channel || '-');
        this.updateDebugElement('debug-clicks', stats.clicks || 0);
        this.updateDebugElement('debug-clusters', stats.clusters || 0);
        this.updateDebugElement('debug-polls', stats.polls || 0);
        this.updateDebugElement('debug-last-poll', stats.lastPoll || '-');
    }

    updateDebugElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    initAnalytics() {
        return {
            startTime: Date.now(),
            interactions: 0,
            errors: 0,

            trackInteraction() {
                this.interactions++;
            },

            trackError() {
                this.errors++;
            },

            getSessionData() {
                return {
                    duration: Date.now() - this.startTime,
                    interactions: this.interactions,
                    errors: this.errors,
                    userAgent: navigator.userAgent.substring(0, 50),
                    timestamp: new Date().toISOString(),
                    debugMode: window.debugManager?.isDebugMode || false
                };
            }
        };
    }

    logInitialization() {
        console.log('🎯 Smart ClickMap Extension v2.0.0 loaded');
        console.log('🎨 HUD-style visualization with purple/cyan theming');
        console.log('📱 Touch and click interactions supported');
        console.log('♿ Accessibility features enabled');

        if (this.isDebugMode) {
            console.log('🔧 Debug mode active');
        }
    }
}

// Initialize debug manager
const debugManager = new DebugManager();

// Export for global access
window.debugManager = debugManager;
window.analytics = debugManager.analytics;