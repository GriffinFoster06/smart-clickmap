// frontend/overlay/ultra-overlay.js - Extreme performance overlay for 50k+ RPS
// Minimal, blazing fast renderer that can handle massive loads

(function() {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';

    // ========== ULTRA PERFORMANCE CONFIG ==========
    const ULTRA_CONFIG = {
        // Rendering performance
        TARGET_FPS: 60,
        MAX_CLUSTERS: 25,              // Hard limit to prevent slowdown
        MIN_CLUSTER_SIZE: 3,           // Only show significant clusters
        
        // Update throttling
        MAX_UPDATE_RATE: 5,            // 5 updates per second max
        UPDATE_COOLDOWN: 200,          // 200ms between updates
        BATCH_UPDATES: true,           // Batch multiple updates
        
        // Visual optimization  
        SIMPLE_SHAPES_ONLY: true,      // No complex polygons
        DISABLE_GLOW: false,           // Keep glow for top cluster only
        FAST_TEXT_RENDERING: true,     // Optimized text rendering
        REDUCED_PRECISION: true,       // Less precise positioning for speed
        
        // Memory management
        REUSE_OBJECTS: true,           // Object pooling
        CLEANUP_FREQUENCY: 5000,       // Clean up every 5 seconds
        MAX_MEMORY_USAGE: 50,          // 50MB memory limit (estimated)
        
        // Connection management
        WEBSOCKET_TIMEOUT: 10000,      // 10 second timeout
        MAX_RECONNECTS: 3,             // Limited reconnection attempts
        FALLBACK_TO_HTTP: true         // Fall back to HTTP polling if WS fails
    };

    console.log('🚀 Ultra-High Performance Overlay Loading...');

    // ========== ULTRA-FAST RENDERER ==========
    class UltraFastRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', {
                alpha: true,
                desynchronized: true,
                powerPreference: 'high-performance'
            });

            // Ensure overlay never blocks interactions
            this.canvas.style.pointerEvents = 'none';
            
            // Performance tracking
            this.frameCount = 0;
            this.lastFpsTime = 0;
            this.currentFps = 0;
            this.renderTime = 0;
            this.lastRenderTime = 0;
            
            // Data state
            this.clusters = [];
            this.lastUpdateTime = 0;
            this.updateCount = 0;
            
            // Object pool for memory efficiency
            this.clusterPool = [];
            this.maxPoolSize = 100;
            
            // Pre-calculated values
            this.width = 0;
            this.height = 0;
            this.dpr = 1;
            
            this.setupCanvas();
            this.startRenderLoop();
            
            console.log('⚡ Ultra-fast renderer initialized');
        }

        setupCanvas() {
            this.resize();
            
            // Optimize canvas context
            this.ctx.imageSmoothingEnabled = !ULTRA_CONFIG.FAST_TEXT_RENDERING;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            this.dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR for performance
            
            this.canvas.width = Math.floor(rect.width * this.dpr);
            this.canvas.height = Math.floor(rect.height * this.dpr);
            
            this.width = rect.width;
            this.height = rect.height;
            
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            
            // Re-optimize context after resize
            this.ctx.imageSmoothingEnabled = !ULTRA_CONFIG.FAST_TEXT_RENDERING;
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';
        }

        startRenderLoop() {
            const render = (timestamp) => {
                const frameStart = performance.now();
                
                this.render();
                
                const frameTime = performance.now() - frameStart;
                this.updateFPS();
                
                // Track render performance
                this.renderTime = frameTime;
                
                // Log performance warnings
                if (frameTime > 16.67) { // Slower than 60 FPS
                    console.warn(`⚠️ Slow frame: ${frameTime.toFixed(2)}ms (${this.clusters.length} clusters)`);
                }
                
                requestAnimationFrame(render);
            };
            
            requestAnimationFrame(render);
        }

        updateFPS() {
            this.frameCount++;
            const now = performance.now();
            
            if (now - this.lastFpsTime >= 1000) {
                this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
                this.frameCount = 0;
                this.lastFpsTime = now;
                
                // Log performance every 5 seconds
                if (Date.now() - this.lastRenderTime > 5000) {
                    console.log(`⚡ Render: ${this.currentFps} FPS, ${this.clusters.length} clusters, ${this.renderTime.toFixed(1)}ms`);
                    this.lastRenderTime = Date.now();
                }
            }
        }

        updateClusters(newClusters) {
            const now = Date.now();
            this.updateCount++;
            
            // Throttle updates for performance
            if (now - this.lastUpdateTime < ULTRA_CONFIG.UPDATE_COOLDOWN) {
                return false;
            }
            
            this.lastUpdateTime = now;
            
            // Filter and limit clusters for performance
            let clusters = (newClusters || [])
                .filter(c => c.percentage >= ULTRA_CONFIG.MIN_CLUSTER_SIZE)
                .slice(0, ULTRA_CONFIG.MAX_CLUSTERS);
            
            // Sort by percentage (highest first)
            clusters.sort((a, b) => b.percentage - a.percentage);
            
            // Mark top cluster
            if (clusters.length > 0) {
                clusters[0].isTop = true;
            }
            
            this.clusters = clusters;
            
            // Log significant updates
            if (this.updateCount % 10 === 0 || clusters.length > 15) {
                console.log(`⚡ Update #${this.updateCount}: ${clusters.length} clusters`);
            }
            
            return true;
        }

        render() {
            const ctx = this.ctx;
            
            // Clear canvas
            ctx.clearRect(0, 0, this.width, this.height);
            
            if (this.clusters.length === 0) return;
            
            // Render clusters with ultra-fast method
            this.renderClustersUltraFast();
        }

        renderClustersUltraFast() {
            const ctx = this.ctx;
            
            // Batch similar operations for performance
            for (let i = 0; i < this.clusters.length; i++) {
                const cluster = this.clusters[i];
                const isTop = cluster.isTop || false;
                
                const x = cluster.x * this.width;
                const y = cluster.y * this.height;
                const radius = Math.min(120, Math.max(30, cluster.visualSize || (40 + cluster.percentage * 1.5)));
                
                // Color selection (fast)
                const colors = this.getColorsUltraFast(cluster, isTop);
                
                // Draw shape (always circle for maximum performance)
                this.drawCircleUltraFast(x, y, radius, colors, isTop);
                
                // Draw text for significant clusters only
                if (cluster.percentage >= 5 && radius >= 35) {
                    this.drawTextUltraFast(x, y, cluster.percentage, radius, isTop);
                }
            }
        }

        getColorsUltraFast(cluster, isTop) {
            // Pre-calculated color sets for speed
            if (isTop) {
                return {
                    fill: 'rgba(0, 255, 255, 0.25)',
                    border: 'rgba(0, 255, 255, 0.9)',
                    text: '#ffffff'
                };
            } else if (cluster.percentage >= 20) {
                return {
                    fill: 'rgba(147, 51, 234, 0.3)',
                    border: 'rgba(147, 51, 234, 0.9)',
                    text: '#ffffff'
                };
            } else {
                return {
                    fill: 'rgba(147, 51, 234, 0.2)',
                    border: 'rgba(147, 51, 234, 0.7)',
                    text: '#ffffff'
                };
            }
        }

        drawCircleUltraFast(x, y, radius, colors, isTop) {
            const ctx = this.ctx;
            
            // Fill
            ctx.fillStyle = colors.fill;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Border
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = isTop ? 4 : 2.5;
            ctx.stroke();
            
            // Glow effect for top cluster only (minimal performance impact)
            if (isTop && !ULTRA_CONFIG.DISABLE_GLOW) {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 255, 255, 0.6)';
                ctx.shadowBlur = 12;
                ctx.strokeStyle = colors.border;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }
        }

        drawTextUltraFast(x, y, percentage, radius, isTop) {
            const ctx = this.ctx;
            
            // Calculate font size efficiently
            const fontSize = Math.max(16, Math.min(32, radius * 0.4));
            
            ctx.save();
            
            // Shadow for readability
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            
            // Text properties
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            
            // Draw percentage
            const text = `${percentage}%`;
            ctx.fillText(text, x, y);
            
            // Outline for top cluster
            if (isTop) {
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
                ctx.lineWidth = 1;
                ctx.strokeText(text, x, y);
            }
            
            ctx.restore();
        }

        // Object pooling for memory efficiency
        getPooledCluster() {
            if (ULTRA_CONFIG.REUSE_OBJECTS && this.clusterPool.length > 0) {
                return this.clusterPool.pop();
            }
            return {};
        }

        returnToPool(cluster) {
            if (ULTRA_CONFIG.REUSE_OBJECTS && this.clusterPool.length < this.maxPoolSize) {
                // Clear cluster data
                Object.keys(cluster).forEach(key => delete cluster[key]);
                this.clusterPool.push(cluster);
            }
        }

        // Performance monitoring
        getStats() {
            return {
                fps: this.currentFps,
                clusters: this.clusters.length,
                renderTime: this.renderTime,
                updateCount: this.updateCount,
                poolSize: this.clusterPool.length,
                memoryEstimate: this.clusters.length * 0.1 // Rough estimate in MB
            };
        }

        destroy() {
            this.clusters = [];
            this.clusterPool = [];
        }
    }

    // ========== ULTRA-FAST WEBSOCKET CLIENT ==========
    class UltraWebSocketClient {
        constructor(channelId, renderer) {
            this.channelId = channelId;
            this.renderer = renderer;
            this.ws = null;
            this.isConnected = false;
            this.reconnectAttempts = 0;
            this.lastMessage = 0;
            this.messageCount = 0;
            this.fallbackMode = false;
            
            // Performance tracking
            this.bytesReceived = 0;
            this.updateRate = 0;
            this.lastRateCheck = Date.now();
            
            this.connect();
        }

        connect() {
            if (this.fallbackMode) {
                this.startHTTPFallback();
                return;
            }
            
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            const fullUrl = `${wsUrl}/ws/${this.channelId}`;
            
            console.log(`⚡ Connecting ultra WebSocket: ${this.channelId}`);
            
            try {
                this.ws = new WebSocket(fullUrl);
                
                const timeout = setTimeout(() => {
                    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                        console.warn('⚠️ WebSocket timeout, falling back to HTTP');
                        this.ws.close();
                        this.fallbackMode = true;
                        this.startHTTPFallback();
                    }
                }, ULTRA_CONFIG.WEBSOCKET_TIMEOUT);
                
                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('⚡ Ultra WebSocket connected');
                };
                
                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
                
                this.ws.onclose = (event) => {
                    clearTimeout(timeout);
                    this.isConnected = false;
                    console.log(`⚡ WebSocket closed: ${event.code}`);
                    
                    if (event.code === 1008 || event.code === 1011) {
                        // Server overloaded or error - switch to HTTP
                        console.log('⚠️ Server overloaded, switching to HTTP polling');
                        this.fallbackMode = true;
                        this.startHTTPFallback();
                    } else {
                        this.handleReconnect();
                    }
                };
                
                this.ws.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('⚡ WebSocket error:', error);
                };
                
            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                this.fallbackMode = true;
                this.startHTTPFallback();
            }
        }

        startHTTPFallback() {
            console.log('🔄 Starting HTTP fallback polling');
            
            const poll = async () => {
                try {
                    const response = await fetch(`${EBS}/heatmap?channel=${this.channelId}`);
                    
                    if (response.ok) {
                        const data = await response.json();
                        this.handleData(data);
                    }
                    
                } catch (error) {
                    console.error('HTTP polling error:', error);
                }
                
                // Poll every 500ms in HTTP mode (less frequent than WebSocket)
                setTimeout(poll, 500);
            };
            
            poll();
        }

        handleMessage(rawData) {
            this.messageCount++;
            this.lastMessage = Date.now();
            this.bytesReceived += rawData.length;
            
            try {
                const data = JSON.parse(rawData);
                this.handleData(data);
                
                // Update rate calculation
                this.updateRate = this.calculateUpdateRate();
                
            } catch (error) {
                console.error('Message parsing error:', error);
            }
        }

        handleData(data) {
            if (data && data.clusters) {
                const updated = this.renderer.updateClusters(data.clusters);
                
                // Log high-frequency updates
                if (this.messageCount % 50 === 0) {
                    const kbReceived = (this.bytesReceived / 1024).toFixed(1);
                    console.log(`⚡ Messages: ${this.messageCount}, ${kbReceived} KB, ${this.updateRate.toFixed(1)} updates/sec`);
                }
            }
        }

        calculateUpdateRate() {
            const now = Date.now();
            const elapsed = now - this.lastRateCheck;
            
            if (elapsed >= 5000) { // Calculate every 5 seconds
                const rate = (this.messageCount * 1000) / elapsed;
                this.messageCount = 0;
                this.lastRateCheck = now;
                return rate;
            }
            
            return this.updateRate;
        }

        handleReconnect() {
            if (this.reconnectAttempts >= ULTRA_CONFIG.MAX_RECONNECTS) {
                console.error('⚡ Max reconnects reached, switching to HTTP');
                this.fallbackMode = true;
                this.startHTTPFallback();
                return;
            }
            
            this.reconnectAttempts++;
            const delay = Math.min(5000, 1000 * Math.pow(2, this.reconnectAttempts));
            
            console.log(`⚡ Reconnecting in ${delay}ms (${this.reconnectAttempts}/${ULTRA_CONFIG.MAX_RECONNECTS})`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        }

        getStats() {
            return {
                isConnected: this.isConnected,
                messageCount: this.messageCount,
                bytesReceived: this.bytesReceived,
                updateRate: this.updateRate,
                reconnectAttempts: this.reconnectAttempts,
                fallbackMode: this.fallbackMode
            };
        }

        destroy() {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
        }
    }

    // ========== ULTRA OVERLAY CONTROLLER ==========
    class UltraOverlayController {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.client = null;
            this.performanceMonitor = null;
            
            // Performance monitoring
            this.startTime = Date.now();
            this.memoryWarnings = 0;
            
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('No channel parameter - overlay ready for any channel');
                this.channelId = 'global';
            }
            
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('Overlay canvas not found');
                return;
            }
            
            // Initialize components
            this.renderer = new UltraFastRenderer(canvas);
            this.client = new UltraWebSocketClient(this.channelId, this.renderer);
            
            // Setup resize handling
            window.addEventListener('resize', () => {
                this.renderer.resize();
            });
            
            // Start performance monitoring
            this.startPerformanceMonitoring();
            
            console.log(`⚡ ULTRA Overlay ready: ${this.channelId}`);
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        startPerformanceMonitoring() {
            setInterval(() => {
                this.monitorPerformance();
            }, ULTRA_CONFIG.CLEANUP_FREQUENCY);
        }

        monitorPerformance() {
            // Memory monitoring (rough estimate)
            const rendererStats = this.renderer?.getStats();
            const clientStats = this.client?.getStats();
            
            if (rendererStats && rendererStats.memoryEstimate > ULTRA_CONFIG.MAX_MEMORY_USAGE) {
                this.memoryWarnings++;
                console.warn(`⚠️ High memory usage: ~${rendererStats.memoryEstimate}MB (warning #${this.memoryWarnings})`);
                
                // Force cleanup if too many warnings
                if (this.memoryWarnings > 5) {
                    this.forceCleanup();
                }
            }
            
            // Log comprehensive stats every minute
            const uptime = Math.round((Date.now() - this.startTime) / 1000);
            if (uptime % 60 === 0) {
                console.log('⚡ ULTRA Performance Summary:');
                console.table({
                    'FPS': rendererStats?.fps || 0,
                    'Clusters': rendererStats?.clusters || 0,
                    'Render Time': `${rendererStats?.renderTime?.toFixed(1) || 0}ms`,
                    'Updates/sec': clientStats?.updateRate?.toFixed(1) || 0,
                    'Messages': clientStats?.messageCount || 0,
                    'Memory Est': `${rendererStats?.memoryEstimate || 0}MB`,
                    'Uptime': `${uptime}s`
                });
            }
        }

        forceCleanup() {
            console.log('🧹 Force cleanup triggered');
            
            // Clear renderer data
            if (this.renderer) {
                this.renderer.clusters = [];
                this.renderer.clusterPool = [];
            }
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            this.memoryWarnings = 0;
        }

        getStats() {
            return {
                channelId: this.channelId,
                uptime: Date.now() - this.startTime,
                memoryWarnings: this.memoryWarnings,
                renderer: this.renderer?.getStats(),
                client: this.client?.getStats()
            };
        }

        destroy() {
            if (this.renderer) {
                this.renderer.destroy();
            }
            
            if (this.client) {
                this.client.destroy();
            }
            
            console.log('🧹 Ultra overlay destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initializeUltraOverlay() {
        try {
            const overlay = new UltraOverlayController();
            window.ultraOverlay = overlay;
            
            // Debug utilities
            window.ultraDebug = {
                stats: () => {
                    const stats = overlay.getStats();
                    console.table(stats.renderer);
                    console.table(stats.client);
                    return stats;
                },
                
                info: () => {
                    const s = overlay.getStats();
                    const r = s.renderer;
                    const c = s.client;
                    console.log(`⚡ Ultra: ${r?.fps || 0} FPS | ${r?.clusters || 0} clusters | ${c?.updateRate?.toFixed(1) || 0} updates/sec | ${c?.fallbackMode ? 'HTTP' : 'WebSocket'}`);
                    return s;
                },
                
                forceCleanup: () => overlay.forceCleanup()
            };
            
            console.log('🚀 ULTRA Overlay initialized for extreme performance');
            console.log('🔧 Debug: ultraDebug.info() for quick status');
            
        } catch (error) {
            console.error('❌ Failed to initialize ultra overlay:', error);
        }
    }

    // Initialize when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUltraOverlay);
    } else {
        initializeUltraOverlay();
    }

})();
