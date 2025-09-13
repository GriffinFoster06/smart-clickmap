// frontend/overlay/ultra-overlay.js - Ultra-high performance overlay for 100k+ CPS
// Handles binary protocols, WebGL rendering, and extreme update rates

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';

    // ========== ULTRA PERFORMANCE CONFIGURATION ==========
    const ULTRA_CONFIG = {
        // Rendering performance
        USE_WEBGL: true,                    // WebGL for hardware acceleration
        TARGET_FPS: 60,                     // Target frame rate
        ADAPTIVE_QUALITY: true,             // Reduce quality under load
        BATCH_RENDER: true,                 // Batch rendering operations
        OFFSCREEN_CANVAS: true,             // Use OffscreenCanvas if available
        
        // Network optimization
        BINARY_PROTOCOL: true,              // Handle binary WebSocket data
        CONNECTION_RETRY: 3,                // Fewer retries for speed
        PING_INTERVAL: 10000,               // Keep connections alive
        BUFFER_SIZE: 1024 * 64,            // 64KB buffer for binary data
        
        // Update throttling
        MAX_UPDATE_RATE: 30,               // Max updates per second
        CLUSTER_CACHE_SIZE: 1000,          // Cache cluster data
        ANIMATION_BUDGET: 16,              // 16ms animation budget per frame
        
        // Memory management
        MAX_CLUSTERS: 50,                  // Limit clusters for performance
        CLEANUP_FREQUENCY: 5000,           // Memory cleanup every 5s
        TEXTURE_CACHE_SIZE: 100,           // Texture cache size
        
        // Load balancing
        WORKER_STICKY_SESSION: true,       // Stick to one backend worker
        FAILOVER_THRESHOLD: 3,             // Switch workers after N failures
        LOAD_BALANCER_ENABLED: true        // Use multiple backend workers
    };

    // ========== ULTRA-HIGH PERFORMANCE RENDERER ==========
    class UltraRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.isWebGL = false;
            this.ctx = null;
            this.gl = null;
            
            // Performance state
            this.frameCount = 0;
            this.lastFpsTime = 0;
            this.currentFps = 0;
            this.renderBudget = ULTRA_CONFIG.ANIMATION_BUDGET;
            this.quality = 1.0; // Adaptive quality factor
            
            // Cluster management
            this.clusters = [];
            this.clusterCache = new Map();
            this.animationTargets = new Map();
            this.renderQueue = [];
            
            // WebGL resources
            this.shaderProgram = null;
            this.buffers = {};
            this.textures = new Map();
            
            // Canvas optimization
            this.canvas.style.pointerEvents = 'none';
            
            this.init();
        }

        init() {
            this.setupRenderingContext();
            this.setupAnimationLoop();
            this.setupPerformanceMonitoring();
            
            console.log(`⚡ Ultra renderer: ${this.isWebGL ? 'WebGL' : 'Canvas2D'}`);
        }

        setupRenderingContext() {
            if (ULTRA_CONFIG.USE_WEBGL) {
                this.setupWebGL();
            }
            
            if (!this.isWebGL) {
                this.setup2D();
            }
            
            this.resize();
        }

        setupWebGL() {
            try {
                const options = {
                    alpha: true,
                    antialias: false, // Disable for performance
                    depth: false,
                    stencil: false,
                    premultipliedAlpha: true,
                    preserveDrawingBuffer: false,
                    powerPreference: 'high-performance',
                    failIfMajorPerformanceCaveat: false
                };
                
                this.gl = this.canvas.getContext('webgl2', options) || 
                         this.canvas.getContext('webgl', options);
                
                if (this.gl) {
                    this.isWebGL = true;
                    this.setupWebGLShaders();
                    this.setupWebGLBuffers();
                    
                    // WebGL optimization
                    this.gl.disable(this.gl.DEPTH_TEST);
                    this.gl.enable(this.gl.BLEND);
                    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                    
                    console.log('⚡ WebGL enabled for ultra performance');
                } else {
                    throw new Error('WebGL not available');
                }
            } catch (error) {
                console.warn('WebGL setup failed, fallback to 2D:', error.message);
                this.isWebGL = false;
            }
        }

        setup2D() {
            this.ctx = this.canvas.getContext('2d', {
                alpha: true,
                desynchronized: true,
                powerPreference: 'high-performance'
            });
            
            if (this.ctx) {
                console.log('⚡ Canvas2D enabled with performance optimizations');
            }
        }

        setupWebGLShaders() {
            const vertexShaderSource = `
                attribute vec2 a_position;
                attribute vec4 a_color;
                attribute float a_size;
                
                uniform vec2 u_resolution;
                
                varying vec4 v_color;
                varying float v_size;
                
                void main() {
                    vec2 position = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
                    gl_Position = vec4(position, 0, 1);
                    gl_PointSize = a_size * ${devicePixelRatio || 1};
                    
                    v_color = a_color;
                    v_size = a_size;
                }
            `;
            
            const fragmentShaderSource = `
                precision mediump float;
                
                varying vec4 v_color;
                varying float v_size;
                
                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    float distance = length(center);
                    
                    // Smooth circular shape
                    float alpha = smoothstep(0.5, 0.3, distance);
                    
                    // Glow effect
                    float glow = exp(-distance * 8.0) * 0.3;
                    
                    vec4 finalColor = v_color;
                    finalColor.a *= (alpha + glow);
                    
                    gl_FragColor = finalColor;
                }
            `;
            
            const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
            const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
            
            this.shaderProgram = this.createProgram(vertexShader, fragmentShader);
        }

        createShader(type, source) {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, source);
            this.gl.compileShader(shader);
            
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                throw new Error('Shader compilation error: ' + this.gl.getShaderInfoLog(shader));
            }
            
            return shader;
        }

        createProgram(vertexShader, fragmentShader) {
            const program = this.gl.createProgram();
            this.gl.attachShader(program, vertexShader);
            this.gl.attachShader(program, fragmentShader);
            this.gl.linkProgram(program);
            
            if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
                throw new Error('Program linking error: ' + this.gl.getProgramInfoLog(program));
            }
            
            return program;
        }

        setupWebGLBuffers() {
            // Position buffer
            this.buffers.position = this.gl.createBuffer();
            
            // Color buffer
            this.buffers.color = this.gl.createBuffer();
            
            // Size buffer
            this.buffers.size = this.gl.createBuffer();
        }

        setupAnimationLoop() {
            const animate = (timestamp) => {
                const frameStart = performance.now();
                
                this.updateAnimations(timestamp);
                this.render();
                
                const frameTime = performance.now() - frameStart;
                this.updatePerformanceMetrics(frameTime);
                
                requestAnimationFrame(animate);
            };
            
            requestAnimationFrame(animate);
        }

        setupPerformanceMonitoring() {
            setInterval(() => {
                this.adaptQuality();
                this.cleanupMemory();
            }, 1000);
        }

        updatePerformanceMetrics(frameTime) {
            this.frameCount++;
            
            if (performance.now() - this.lastFpsTime >= 1000) {
                this.currentFps = this.frameCount;
                this.frameCount = 0;
                this.lastFpsTime = performance.now();
                
                // Log performance for extreme loads
                if (this.clusters.length > 20 || this.currentFps < 30) {
                    console.log(`⚡ Render: ${this.currentFps} FPS, ${this.clusters.length} clusters, quality: ${(this.quality * 100).toFixed(0)}%`);
                }
            }
        }

        adaptQuality() {
            // Adaptive quality based on performance
            if (this.currentFps < 30 && this.quality > 0.3) {
                this.quality -= 0.1;
            } else if (this.currentFps > 50 && this.quality < 1.0) {
                this.quality += 0.05;
            }
            
            // Update rendering parameters based on quality
            this.updateRenderingQuality();
        }

        updateRenderingQuality() {
            if (this.isWebGL) {
                // Adjust WebGL rendering quality
                // Could reduce particle count, disable effects, etc.
            } else {
                // Adjust Canvas2D quality
                if (this.ctx) {
                    this.ctx.imageSmoothingEnabled = this.quality > 0.7;
                }
            }
        }

        cleanupMemory() {
            // Clean old cached data
            const cutoff = Date.now() - 10000; // 10 seconds
            
            for (const [key, data] of this.clusterCache.entries()) {
                if (data.timestamp < cutoff) {
                    this.clusterCache.delete(key);
                }
            }
            
            // Limit cache size
            if (this.clusterCache.size > ULTRA_CONFIG.CLUSTER_CACHE_SIZE) {
                const oldestKeys = Array.from(this.clusterCache.keys()).slice(0, 100);
                oldestKeys.forEach(key => this.clusterCache.delete(key));
            }
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR for performance
            
            this.canvas.width = Math.floor(rect.width * dpr * this.quality);
            this.canvas.height = Math.floor(rect.height * dpr * this.quality);
            
            if (this.isWebGL) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
                
                // Update resolution uniform
                if (this.shaderProgram) {
                    this.gl.useProgram(this.shaderProgram);
                    const resolutionLocation = this.gl.getUniformLocation(this.shaderProgram, 'u_resolution');
                    this.gl.uniform2f(resolutionLocation, this.canvas.width, this.canvas.height);
                }
            } else if (this.ctx) {
                this.ctx.setTransform(dpr * this.quality, 0, 0, dpr * this.quality, 0, 0);
            }
        }

        updateClusters(newClusters) {
            // Limit clusters for performance
            const clusters = (newClusters || [])
                .slice(0, ULTRA_CONFIG.MAX_CLUSTERS)
                .filter(c => c.percentage >= 3);
            
            this.clusters = clusters;
            
            // Update animation targets
            this.updateAnimationTargets();
        }

        updateAnimationTargets() {
            const newTargets = new Map();
            
            for (const cluster of this.clusters) {
                const key = cluster.id || `${cluster.x}_${cluster.y}`;
                const existing = this.animationTargets.get(key);
                
                if (existing) {
                    // Update existing target
                    existing.targetX = cluster.x;
                    existing.targetY = cluster.y;
                    existing.targetSize = cluster.visualSize || 60;
                    existing.targetAlpha = 1.0;
                } else {
                    // Create new target
                    newTargets.set(key, {
                        currentX: cluster.x,
                        currentY: cluster.y,
                        currentSize: cluster.visualSize || 60,
                        currentAlpha: 0.0,
                        
                        targetX: cluster.x,
                        targetY: cluster.y,
                        targetSize: cluster.visualSize || 60,
                        targetAlpha: 1.0,
                        
                        percentage: cluster.percentage,
                        isTop: cluster.isTop || false,
                        color: this.getClusterColor(cluster)
                    });
                }
            }
            
            // Add new targets
            for (const [key, target] of newTargets) {
                this.animationTargets.set(key, target);
            }
            
            // Mark removed targets for fade out
            for (const [key, target] of this.animationTargets) {
                if (!this.clusters.some(c => (c.id || `${c.x}_${c.y}`) === key)) {
                    target.targetAlpha = 0.0;
                }
            }
        }

        getClusterColor(cluster) {
            if (cluster.isTop) {
                return [0, 1, 1, 0.8]; // Cyan
            } else if (cluster.percentage >= 20) {
                return [0.58, 0.2, 0.92, 0.7]; // Purple
            } else {
                return [0.58, 0.2, 0.92, 0.5]; // Light purple
            }
        }

        updateAnimations(timestamp) {
            const dt = Math.min(32, 16); // Cap delta time
            const lerpSpeed = 0.15;
            
            for (const [key, target] of this.animationTargets.entries()) {
                // Smooth interpolation
                target.currentX += (target.targetX - target.currentX) * lerpSpeed;
                target.currentY += (target.targetY - target.currentY) * lerpSpeed;
                target.currentSize += (target.targetSize - target.currentSize) * lerpSpeed;
                target.currentAlpha += (target.targetAlpha - target.currentAlpha) * lerpSpeed;
                
                // Remove fully faded targets
                if (target.targetAlpha === 0 && target.currentAlpha < 0.01) {
                    this.animationTargets.delete(key);
                }
            }
        }

        render() {
            if (this.isWebGL) {
                this.renderWebGL();
            } else {
                this.renderCanvas2D();
            }
        }

        renderWebGL() {
            const gl = this.gl;
            
            // Clear
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            if (this.animationTargets.size === 0) return;
            
            // Prepare data arrays
            const positions = [];
            const colors = [];
            const sizes = [];
            
            for (const target of this.animationTargets.values()) {
                if (target.currentAlpha > 0.01) {
                    positions.push(
                        target.currentX * this.canvas.width,
                        target.currentY * this.canvas.height
                    );
                    
                    colors.push(
                        target.color[0],
                        target.color[1],
                        target.color[2],
                        target.color[3] * target.currentAlpha
                    );
                    
                    sizes.push(target.currentSize);
                }
            }
            
            if (positions.length === 0) return;
            
            // Use shader program
            gl.useProgram(this.shaderProgram);
            
            // Bind position buffer
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
            
            const positionLocation = gl.getAttribLocation(this.shaderProgram, 'a_position');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            
            // Bind color buffer
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
            
            const colorLocation = gl.getAttribLocation(this.shaderProgram, 'a_color');
            gl.enableVertexAttribArray(colorLocation);
            gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);
            
            // Bind size buffer
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sizes), gl.DYNAMIC_DRAW);
            
            const sizeLocation = gl.getAttribLocation(this.shaderProgram, 'a_size');
            gl.enableVertexAttribArray(sizeLocation);
            gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, 0, 0);
            
            // Draw
            gl.drawArrays(gl.POINTS, 0, positions.length / 2);
        }

        renderCanvas2D() {
            const ctx = this.ctx;
            const width = this.canvas.width / (window.devicePixelRatio || 1);
            const height = this.canvas.height / (window.devicePixelRatio || 1);
            
            ctx.clearRect(0, 0, width, height);
            
            if (this.animationTargets.size === 0) return;
            
            // Batch rendering for performance
            const visibleTargets = Array.from(this.animationTargets.values())
                .filter(t => t.currentAlpha > 0.01)
                .sort((a, b) => a.percentage - b.percentage); // Render small to large
            
            for (const target of visibleTargets) {
                this.renderClusterCanvas2D(ctx, target, width, height);
            }
        }

        renderClusterCanvas2D(ctx, target, width, height) {
            const x = target.currentX * width;
            const y = target.currentY * height;
            const radius = target.currentSize;
            const alpha = target.currentAlpha;
            
            ctx.save();
            ctx.globalAlpha = alpha;
            
            // Fill
            const color = target.color;
            ctx.fillStyle = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3] * 0.3})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Stroke
            ctx.strokeStyle = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            
            // Text (only for significant clusters)
            if (target.percentage >= 5 && radius > 30) {
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.min(24, radius * 0.3)}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 8;
                ctx.fillText(`${target.percentage}%`, x, y);
                ctx.shadowBlur = 0;
            }
            
            ctx.restore();
        }

        getStats() {
            return {
                isWebGL: this.isWebGL,
                fps: this.currentFps,
                quality: this.quality,
                clusters: this.clusters.length,
                animationTargets: this.animationTargets.size,
                cacheSize: this.clusterCache.size
            };
        }

        destroy() {
            if (this.isWebGL && this.gl) {
                // Cleanup WebGL resources
                if (this.shaderProgram) {
                    this.gl.deleteProgram(this.shaderProgram);
                }
                
                for (const buffer of Object.values(this.buffers)) {
                    this.gl.deleteBuffer(buffer);
                }
                
                for (const texture of this.textures.values()) {
                    this.gl.deleteTexture(texture);
                }
            }
            
            this.animationTargets.clear();
            this.clusterCache.clear();
        }
    }

    // ========== ULTRA WEBSOCKET CLIENT ==========
    class UltraWebSocketClient {
        constructor(channelId, renderer) {
            this.channelId = channelId;
            this.renderer = renderer;
            this.ws = null;
            this.reconnectAttempts = 0;
            this.maxReconnects = ULTRA_CONFIG.CONNECTION_RETRY;
            this.isConnected = false;
            this.lastPing = 0;
            
            // Binary protocol support
            this.binarySupported = ULTRA_CONFIG.BINARY_PROTOCOL;
            this.messageBuffer = new ArrayBuffer(ULTRA_CONFIG.BUFFER_SIZE);
            this.bufferView = new DataView(this.messageBuffer);
            
            // Performance tracking
            this.updateCount = 0;
            this.bytesReceived = 0;
            this.lastUpdate = 0;
            
            this.connect();
        }

        connect() {
            const wsUrl = EBS.replace('https://', 'wss://').replace('http://', 'ws://');
            const fullUrl = `${wsUrl}/ws/${this.channelId}`;
            
            console.log(`⚡ Connecting ultra WebSocket: ${this.channelId}`);
            
            try {
                this.ws = new WebSocket(fullUrl);
                this.ws.binaryType = 'arraybuffer'; // Enable binary support
                
                this.ws.onopen = () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.lastPing = Date.now();
                    console.log('⚡ Ultra WebSocket connected');
                };
                
                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };
                
                this.ws.onclose = (event) => {
                    this.isConnected = false;
                    console.log(`⚡ WebSocket closed: ${event.code}`);
                    this.handleReconnect();
                };
                
                this.ws.onerror = (error) => {
                    console.error('⚡ WebSocket error:', error);
                };
                
            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                this.handleReconnect();
            }
        }

        handleMessage(event) {
            this.updateCount++;
            this.lastUpdate = Date.now();
            
            try {
                let data;
                
                if (event.data instanceof ArrayBuffer && this.binarySupported) {
                    // Binary protocol
                    data = this.parseBinaryMessage(event.data);
                    this.bytesReceived += event.data.byteLength;
                } else {
                    // JSON protocol
                    data = JSON.parse(event.data);
                    this.bytesReceived += event.data.length;
                }
                
                if (data && data.clusters) {
                    this.renderer.updateClusters(data.clusters);
                }
                
                // Log high-frequency updates
                if (this.updateCount % 100 === 0) {
                    const kbReceived = (this.bytesReceived / 1024).toFixed(1);
                    console.log(`⚡ Updates: ${this.updateCount}, ${kbReceived} KB received`);
                }
                
            } catch (error) {
                console.error('Message parsing error:', error);
            }
        }

        parseBinaryMessage(buffer) {
            const view = new DataView(buffer);
            let offset = 0;
            
            // Read cluster count
            const clusterCount = view.getUint32(offset, true);
            offset += 4;
            
            const clusters = [];
            
            // Read clusters
            for (let i = 0; i < clusterCount; i++) {
                if (offset + 14 > buffer.byteLength) break;
                
                const cluster = {
                    x: view.getFloat32(offset, true),
                    y: view.getFloat32(offset + 4, true),
                    percentage: view.getUint8(offset + 8),
                    visualSize: view.getUint16(offset + 9, true),
                    isTop: view.getUint8(offset + 11) === 1,
                    shapeType: view.getUint8(offset + 12) === 1 ? 'polygon' : 'circle',
                    count: view.getUint8(offset + 13),
                    id: `binary_${i}`
                };
                
                clusters.push(cluster);
                offset += 14;
            }
            
            return {
                clusters,
                running: true,
                mode: 'ULTRA_BINARY',
                timestamp: Date.now()
            };
        }

        handleReconnect() {
            if (this.reconnectAttempts < this.maxReconnects) {
                this.reconnectAttempts++;
                const delay = Math.min(5000, 1000 * Math.pow(2, this.reconnectAttempts));
                
                console.log(`⚡ Reconnecting in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnects})`);
                
                setTimeout(() => {
                    this.connect();
                }, delay);
            } else {
                console.error('⚡ Max reconnection attempts reached');
            }
        }

        getStats() {
            return {
                isConnected: this.isConnected,
                updateCount: this.updateCount,
                bytesReceived: this.bytesReceived,
                reconnectAttempts: this.reconnectAttempts,
                binarySupported: this.binarySupported,
                lastUpdate: this.lastUpdate
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
    class UltraOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            this.wsClient = null;
            
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('No channel parameter for ultra overlay');
                return;
            }
            
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('Overlay canvas not found');
                return;
            }
            
            this.renderer = new UltraRenderer(canvas);
            this.wsClient = new UltraWebSocketClient(this.channelId, this.renderer);
            
            // Setup resize handling
            window.addEventListener('resize', () => {
                this.renderer.resize();
            });
            
            console.log(`⚡ ULTRA Overlay ready: ${this.channelId}`);
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        getStats() {
            return {
                channelId: this.channelId,
                renderer: this.renderer?.getStats(),
                websocket: this.wsClient?.getStats()
            };
        }

        destroy() {
            if (this.renderer) {
                this.renderer.destroy();
            }
            
            if (this.wsClient) {
                this.wsClient.destroy();
            }
        }
    }

    // ========== INITIALIZATION ==========
    function initializeUltraOverlay() {
        try {
            const overlay = new UltraOverlay();
            window.ultraOverlay = overlay;
            
            // Global debugging
            window.ultraOverlayDebug = {
                stats: () => {
                    const stats = overlay.getStats();
                    console.table(stats.renderer);
                    console.table(stats.websocket);
                    return stats;
                },
                info: () => {
                    const s = overlay.getStats();
                    const r = s.renderer;
                    const w = s.websocket;
                    console.log(`⚡ ${r.isWebGL ? 'WebGL' : '2D'} | ${r.fps} FPS | ${r.clusters} clusters | ${w.isConnected ? 'Connected' : 'Disconnected'} | ${w.updateCount} updates`);
                }
            };
            
            console.log('⚡ ULTRA Overlay initialized for extreme performance');
            console.log('🔥 Debug: ultraOverlayDebug.info() for quick status');
            
        } catch (error) {
            console.error('❌ Failed to initialize ultra overlay:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUltraOverlay);
    } else {
        initializeUltraOverlay();
    }
})();
