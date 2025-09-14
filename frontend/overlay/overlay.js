// frontend/overlay/overlay.js - OPTIMAL client with MUCH BIGGER, readable percentages
// Only modifying the overlay renderer, not touching frontend/heatmap.js

(function () {
    'use strict';

    const EBS = 'https://smart-clickmap-backend.onrender.com';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // OPTIMAL PERFORMANCE SETTINGS
    const PRIMARY_POLL_INTERVAL = 8000; // 8 seconds - matches server broadcasts
    const FALLBACK_POLL_INTERVAL = 15000; // 15 seconds when WebSocket fails
    const WEBSOCKET_RECONNECT_DELAY = 2000; // 2 seconds between reconnect attempts
    const MAX_RECONNECT_ATTEMPTS = 10;
    const HEARTBEAT_INTERVAL = 25000; // 25 seconds - client heartbeat
    
    // CLIENT-SIDE PERFORMANCE OPTIMIZATIONS
    const RESPONSE_CACHE_TTL = 4000; // 4 second cache
    const MAX_CACHE_ENTRIES = 20;
    const responseCache = new Map();

    // ========== ENHANCED PERFORMANCE RENDERER WITH MASSIVE TEXT ==========
    class OptimalPerformanceRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { 
                alpha: true,
                desynchronized: true,
                powerPreference: 'high-performance',
                willReadFrequently: false
            });

            this.canvas.style.pointerEvents = 'none';
            this.PERCENTAGE_THRESHOLD = 3;
            this.MIN_VISUAL_SIZE = 45;
            this.MAX_VISUAL_SIZE = 200;
            
            this.springs = new Map();
            this.targets = new Map();
            this.animationId = null;
            this.lastTs = 0;
            this.reduced = REDUCED_MOTION;

            this.lastRenderTime = 0;
            this.frameCount = 0;
            this.fps = 60;
            this.skipFrames = 0;
            this.maxClusters = 20;
            this.renderQuality = 1.0;
            this.lastClusterCount = 0;

            this.resize();
            this.start();
            
            console.log('🎨 OPTIMAL renderer with MASSIVE readable text initialized');
        }

        _spring(value = 0, omega = 8, zeta = 0.8) { 
            return { x: value, v: 0, o: omega, z: zeta, t: value }; 
        }
        
        _stepSpring(s, dt) {
            const f = -s.o * s.o * (s.x - s.t) - 2 * s.z * s.o * s.v;
            s.v += f * dt; 
            s.x += s.v * dt; 
            return s.x;
        }
        
        _hashSeed(x, y, pct, count) {
            let h = 2166136261 >>> 0;
            const mix = (n) => { h ^= (n | 0); h = Math.imul(h, 16777619); };
            mix((x * 1e6) | 0); mix((y * 1e6) | 0);
            mix(((pct || 0) * 100) | 0); mix(count | 0);
            return (h >>> 0) / 4294967295;
        }
        
        _wobble(t, seed, base = 1.0, amp = 0.05) {
            if (this.reduced || this.renderQuality < 0.7) return base;
            const a1 = Math.sin(t * 0.5 + seed * 3.14159);
            return base * (1.0 + amp * a1);
        }

        start() {
            if (this.reduced) return;
            if (this.animationId) return;
            
            const loop = (ts) => {
                if (!this.lastTs) this.lastTs = ts;
                const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
                this.lastTs = ts;

                this.frameCount++;
                const shouldSkip = this.frameCount % (this.skipFrames + 1) !== 0;
                
                if (!shouldSkip) {
                    if (ts - this.lastRenderTime > 1000) {
                        this.fps = Math.round(this.frameCount * 1000 / (ts - this.lastRenderTime));
                        this.frameCount = 0;
                        this.lastRenderTime = ts;
                        this.adjustRenderQuality();
                    }

                    for (const [key, s] of this.springs.entries()) {
                        const t = this.targets.get(key);
                        if (!t) continue;
                        s.x.t = t.x; s.y.t = t.y; s.r.t = t.r; s.p.t = t.p;
                        this._stepSpring(s.x, dt); this._stepSpring(s.y, dt);
                        this._stepSpring(s.r, dt); this._stepSpring(s.p, dt);
                    }

                    this.render(ts / 1000);
                }
                
                this.animationId = requestAnimationFrame(loop);
            };
            this.animationId = requestAnimationFrame(loop);
        }

        adjustRenderQuality() {
            const clusterCount = this.targets.size;
            
            if (clusterCount <= 5) {
                this.renderQuality = 1.0;
                this.skipFrames = 0;
            } else if (clusterCount <= 10) {
                this.renderQuality = 0.8;
                this.skipFrames = 0;
            } else if (clusterCount <= 15) {
                this.renderQuality = 0.6;
                this.skipFrames = 1;
            } else {
                this.renderQuality = 0.4;
                this.skipFrames = 2;
            }
            
            if (this.fps < 30) {
                this.renderQuality *= 0.7;
                this.skipFrames = Math.min(this.skipFrames + 1, 3);
            } else if (this.fps > 50) {
                this.renderQuality = Math.min(this.renderQuality * 1.1, 1.0);
                this.skipFrames = Math.max(this.skipFrames - 1, 0);
            }
        }

        stop() { 
            if (this.animationId) cancelAnimationFrame(this.animationId); 
            this.animationId = null; 
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.render(performance.now() / 1000);
        }

        updateClusters(newClusters) {
            let filtered = (newClusters || [])
                .filter(c => (c.percentage || 0) >= this.PERCENTAGE_THRESHOLD);

            if (filtered.length > this.maxClusters) {
                filtered = filtered
                    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
                    .slice(0, this.maxClusters);
            }

            const nextTargets = new Map();
            
            for (const c of filtered) {
                const visualRadius = c.visualSize || this.fastSizeCalculation(c);
                const complexity = Math.min(c.complexity || 0, 0.5);
                const sides = Math.min(c.preferredSides || 8, 12);

                const key = c.id ?? `${(c.x * 1000 | 0)}_${(c.y * 1000 | 0)}_${c.count | 0}`;
                nextTargets.set(key, { 
                    x: c.x, y: c.y, r: visualRadius, p: c.percentage || 0, 
                    count: c.count || 1, complexity: complexity, sides: sides,
                    shapeType: c.shapeType || 'circle', isTop: c.isTop || false
                });

                if (!this.springs.has(key)) {
                    const seed = this._hashSeed(c.x, c.y, c.percentage || 0, c.count || 1);
                    this.springs.set(key, {
                        x: this._spring(c.x, 6, 0.8),
                        y: this._spring(c.y, 6, 0.8),
                        r: this._spring(visualRadius, 8, 0.7),
                        p: this._spring(c.percentage || 0, 5, 0.9),
                        seed, complexity: complexity, sides: sides,
                        shapeType: c.shapeType || 'circle'
                    });
                }
            }
            
            for (const key of [...this.springs.keys()]) {
                if (!nextTargets.has(key)) this.springs.delete(key);
            }
            this.targets = nextTargets;
            this.lastClusterCount = filtered.length;

            if (this.reduced) {
                for (const [key, s] of this.springs.entries()) {
                    const t = this.targets.get(key);
                    if (!t) continue;
                    s.x.x = s.x.t = t.x; s.x.v = 0;
                    s.y.x = s.y.t = t.y; s.y.v = 0;
                    s.r.x = s.r.t = t.r; s.r.v = 0;
                    s.p.x = s.p.t = t.p; s.p.v = 0;
                }
                this.render(performance.now() / 1000);
            }
        }

        fastSizeCalculation(cluster) {
            const baseSize = 50;
            const percentage = cluster.percentage || 0;
            const activityBonus = Math.sqrt(percentage / 100) * 80;
            return Math.max(baseSize, Math.min(200, baseSize + activityBonus));
        }

        render(tSec = 0) {
            const W = this.canvas.width / (window.devicePixelRatio || 1);
            const H = this.canvas.height / (window.devicePixelRatio || 1);
            this.ctx.clearRect(0, 0, W, H);

            const drawables = [];
            for (const [key, s] of this.springs.entries()) {
                const target = this.targets.get(key);
                drawables.push({ 
                    key, cx: s.x.x * W, cy: s.y.x * H, radius: s.r.x, 
                    percentage: s.p.x, seed: s.seed, complexity: s.complexity || 0,
                    sides: s.sides || 8, shapeType: s.shapeType || 'circle',
                    isTop: target?.isTop || false
                });
            }
            
            drawables.sort((a, b) => a.percentage - b.percentage);

            for (let i = 0; i < drawables.length; i++) {
                const d = drawables[i];
                const isTop = i === drawables.length - 1;
                d.isTop = isTop;

                const wobbleAmp = this.renderQuality > 0.7 ? 0.04 : 0;
                const r = this.reduced ? d.radius : d.radius * this._wobble(tSec, d.seed, 1.0, wobbleAmp);

                const colors = this.getSimpleColors(d, isTop);

                if (this.renderQuality > 0.8 && d.complexity > 0.3 && d.shapeType === 'polygon') {
                    this.renderSimplePolygon(d.cx, d.cy, r, colors, d.sides);
                } else {
                    this.renderOptimizedCircle(d.cx, d.cy, r, colors, isTop);
                }

                // ENHANCED: Use the new MASSIVE text renderer
                this.renderMassiveText(d.cx, d.cy, Math.round(d.percentage), r, isTop);
            }
        }

        getSimpleColors(drawable, isTop) {
            if (isTop) {
                return {
                    fill: 'rgba(0, 255, 255, 0.2)',
                    border: 'rgba(0, 255, 255, 0.85)'
                };
            } else {
                return {
                    fill: 'rgba(147, 51, 234, 0.18)',
                    border: 'rgba(147, 51, 234, 0.8)'
                };
            }
        }

        renderOptimizedCircle(cx, cy, radius, colors, isTop) {
            const ctx = this.ctx;
            
            ctx.fillStyle = colors.fill;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = colors.border;
            ctx.lineWidth = isTop ? 3 : 2.5;
            ctx.stroke();

            if (this.renderQuality > 0.8) {
                ctx.strokeStyle = colors.border.replace('0.85', '0.3').replace('0.8', '0.3');
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(cx, cy, Math.max(2, radius - 6), 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        renderSimplePolygon(cx, cy, radius, colors, sides) {
            const ctx = this.ctx;
            
            ctx.beginPath();
            for (let i = 0; i <= sides; i++) {
                const a = (i / sides) * Math.PI * 2;
                const x = cx + Math.cos(a) * radius;
                const y = cy + Math.sin(a) * radius;
                if (i === 0) ctx.moveTo(x, y); 
                else ctx.lineTo(x, y);
            }
            ctx.closePath();

            ctx.fillStyle = colors.fill;
            ctx.fill();
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // 🔥 NEW: MASSIVE, super-readable text rendering
        renderMassiveText(cx, cy, percentage, radius, isTop) {
            const ctx = this.ctx;
            const str = `${percentage}%`;
            
            // 🚀 HUGE TEXT: Increased multiplier from 0.3 to 0.75 (2.5x bigger!)
            const fontSize = Math.max(35, Math.min(75, radius * 0.75));
            
            ctx.save();
            
            // 🔥 MASSIVE SHADOW SYSTEM for extreme readability
            
            // Layer 1: Huge black background shadow
            ctx.shadowColor = 'rgba(0, 0, 0, 1.0)'; // Pure black
            ctx.shadowBlur = fontSize * 0.6; // HUGE blur
            ctx.shadowOffsetX = 6; // Big offset
            ctx.shadowOffsetY = 6;
            
            ctx.fillStyle = '#ffffff';
            ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`; // Extra bold
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(str, cx, cy);
            
            // Layer 2: Medium black shadow for depth
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = fontSize * 0.4;
            ctx.shadowOffsetX = 4;
            ctx.shadowOffsetY = 4;
            ctx.fillText(str, cx, cy);
            
            // Layer 3: Close shadow for definition
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = fontSize * 0.2;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.fillText(str, cx, cy);
            
            // Reset shadow for outlines
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // 🎯 MASSIVE OUTLINE SYSTEM
            
            // Outermost black outline (super thick)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
            ctx.lineWidth = Math.max(8, fontSize * 0.15); // Proportional thick outline
            ctx.strokeText(str, cx, cy);
            
            // Second black outline (medium thick)
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = Math.max(6, fontSize * 0.12);
            ctx.strokeText(str, cx, cy);
            
            // Colored outline
            const outlineColor = isTop ? 'rgba(0, 255, 255, 1.0)' : 'rgba(147, 51, 234, 1.0)';
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = Math.max(4, fontSize * 0.08);
            ctx.strokeText(str, cx, cy);
            
            // Inner colored outline for more definition
            ctx.strokeStyle = isTop ? 'rgba(0, 255, 255, 0.8)' : 'rgba(147, 51, 234, 0.8)';
            ctx.lineWidth = Math.max(2, fontSize * 0.05);
            ctx.strokeText(str, cx, cy);
            
            // Final bright white text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(str, cx, cy);
            
            // 🌟 EXTRA GLOW for top cluster
            if (isTop) {
                ctx.shadowColor = 'rgba(0, 255, 255, 0.8)';
                ctx.shadowBlur = fontSize * 0.5;
                ctx.fillText(str, cx, cy);
                
                // Extra bright highlight
                ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
                ctx.shadowBlur = fontSize * 0.3;
                ctx.fillText(str, cx, cy);
            }
            
            // 💎 FINAL HIGHLIGHT for extreme visibility
            ctx.shadowBlur = 0;
            ctx.fillStyle = isTop ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.8)';
            ctx.fillText(str, cx, cy);
            
            ctx.restore();
        }

        setThreshold(threshold) { this.PERCENTAGE_THRESHOLD = threshold; }
        getFPS() { return this.fps; }
        getRenderQuality() { return this.renderQuality; }
        getClusterCount() { return this.lastClusterCount; }
        destroy() { this.stop(); }
    }

    // ========== OPTIMAL HYBRID OVERLAY CONTROLLER ==========
    class OptimalHybridOverlay {
        constructor() {
            this.channelId = this.getChannelFromUrl();
            this.renderer = null;
            
            // DUAL TRANSPORT SYSTEM - WebSocket primary, HTTP fallback
            this.websocket = null;
            this.wsConnected = false;
            this.wsReconnectAttempts = 0;
            this.wsReconnectTimer = null;
            this.wsHeartbeatTimer = null;
            this.lastWsMessage = 0;
            
            // HTTP polling fallback
            this.httpPollInterval = null;
            this.httpStatusInterval = null;
            this.lastHttpPoll = 0;
            
            // State management
            this.isGameRunning = false;
            this.lastKnownState = null;
            this.lastUpdate = 0;
            this.hasEverHadData = false;
            this.updateCount = 0;
            this.lastProcessedResetId = null;
            this.consecutiveErrors = 0;
            
            // Performance tracking
            this.transportMode = 'connecting'; // connecting, websocket, http
            this.messageStats = {
                wsMessages: 0,
                httpPolls: 0,
                dataUpdates: 0,
                errors: 0
            };
            
            // Page visibility optimization
            this.isPageVisible = !document.hidden;
            this.setupVisibilityTracking();

            console.log('🎯 OPTIMAL hybrid overlay with MASSIVE text initializing...');
            this.init();
        }

        async init() {
            if (!this.channelId) {
                console.log('❌ Missing channel parameter');
                return;
            }
            
            this.setupRenderer();
            
            if (this.isPageVisible) {
                // Start with WebSocket, fallback to HTTP if needed
                await this.initializeWebSocket();
                await this.checkInitialStatus();
            }
            
            console.log(`🎯 OPTIMAL overlay with MASSIVE text ready: ${this.channelId}`);
        }

        // ========== WEBSOCKET MANAGEMENT ==========
        
        async initializeWebSocket() {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                return; // Already connected
            }
            
            try {
                const wsUrl = `${EBS.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/${this.channelId}`;
                console.log(`🔌 Connecting WebSocket to: ${wsUrl}`);
                
                this.websocket = new WebSocket(wsUrl);
                this.setupWebSocketHandlers();
                
            } catch (error) {
                console.error('WebSocket initialization failed:', error);
                this.fallbackToHttp();
            }
        }

        setupWebSocketHandlers() {
            this.websocket.onopen = () => {
                console.log('✅ WebSocket connected');
                this.wsConnected = true;
                this.wsReconnectAttempts = 0;
                this.transportMode = 'websocket';
                this.consecutiveErrors = 0;
                
                // Stop HTTP polling when WebSocket works
                this.stopHttpPolling();
                
                // Start heartbeat
                this.startWebSocketHeartbeat();
                
                // Update UI
                document.body.classList.add('ws-connected');
                document.body.classList.remove('ws-disconnected');
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.lastWsMessage = Date.now();
                    this.messageStats.wsMessages++;
                    
                    this.handleMessage(data, 'websocket');
                    
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            };

            this.websocket.onclose = (event) => {
                console.log(`🔌 WebSocket closed: Code ${event.code}, Reason: ${event.reason}`);
                this.wsConnected = false;
                this.transportMode = 'http';
                
                this.stopWebSocketHeartbeat();
                
                // Update UI
                document.body.classList.remove('ws-connected');
                document.body.classList.add('ws-disconnected');
                
                // Immediate fallback to HTTP
                this.fallbackToHttp();
                
                // Attempt reconnection
                this.scheduleWebSocketReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.consecutiveErrors++;
                this.messageStats.errors++;
            };
        }

        startWebSocketHeartbeat() {
            this.stopWebSocketHeartbeat();
            
            this.wsHeartbeatTimer = setInterval(() => {
                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    try {
                        this.websocket.send(JSON.stringify({ 
                            type: 'heartbeat',
                            timestamp: Date.now()
                        }));
                    } catch (error) {
                        console.error('Heartbeat send failed:', error);
                    }
                } else {
                    this.stopWebSocketHeartbeat();
                }
            }, HEARTBEAT_INTERVAL);
        }

        stopWebSocketHeartbeat() {
            if (this.wsHeartbeatTimer) {
                clearInterval(this.wsHeartbeatTimer);
                this.wsHeartbeatTimer = null;
            }
        }

        scheduleWebSocketReconnect() {
            if (this.wsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log('⚠️ Max WebSocket reconnect attempts reached, staying on HTTP');
                return;
            }
            
            if (this.wsReconnectTimer) {
                clearTimeout(this.wsReconnectTimer);
            }
            
            const delay = Math.min(WEBSOCKET_RECONNECT_DELAY * Math.pow(2, this.wsReconnectAttempts), 30000);
            
            this.wsReconnectTimer = setTimeout(async () => {
                this.wsReconnectAttempts++;
                console.log(`🔄 WebSocket reconnect attempt ${this.wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
                await this.initializeWebSocket();
            }, delay);
        }

        // ========== HTTP FALLBACK SYSTEM ==========
        
        fallbackToHttp() {
            console.log('📡 Falling back to HTTP polling');
            this.transportMode = 'http';
            this.startHttpPolling();
        }

        startHttpPolling() {
            this.stopHttpPolling();
            
            // Primary polling for active state
            this.httpPollInterval = setInterval(() => {
                if (this.isPageVisible && !this.wsConnected) {
                    this.httpPoll();
                }
            }, this.isGameRunning ? PRIMARY_POLL_INTERVAL : FALLBACK_POLL_INTERVAL);
            
            // Status checks for inactive state
            this.httpStatusInterval = setInterval(() => {
                if (this.isPageVisible && !this.wsConnected && !this.isGameRunning) {
                    this.checkInitialStatus();
                }
            }, FALLBACK_POLL_INTERVAL);
            
            // Initial poll
            this.httpPoll();
        }

        stopHttpPolling() {
            if (this.httpPollInterval) {
                clearInterval(this.httpPollInterval);
                this.httpPollInterval = null;
            }
            
            if (this.httpStatusInterval) {
                clearInterval(this.httpStatusInterval);
                this.httpStatusInterval = null;
            }
        }

        async httpPoll() {
            if (this.wsConnected) {
                // WebSocket is working, stop HTTP polling
                this.stopHttpPolling();
                return;
            }
            
            try {
                const data = await this.cachedFetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
                this.lastHttpPoll = Date.now();
                this.messageStats.httpPolls++;
                
                this.handleMessage(data, 'http');
                this.consecutiveErrors = 0;
                
            } catch (error) {
                this.consecutiveErrors++;
                console.warn(`HTTP poll failed (${this.consecutiveErrors}/5):`, error.message);
                
                if (this.consecutiveErrors >= 5) {
                    // Switch to slower polling on persistent errors
                    this.stopHttpPolling();
                    setTimeout(() => {
                        if (!this.wsConnected) {
                            this.startHttpPolling();
                        }
                    }, FALLBACK_POLL_INTERVAL);
                }
            }
        }

        // ========== UNIFIED MESSAGE HANDLING ==========
        
        handleMessage(data, source) {
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const gameRunning = data?.running === true;
            const action = data?.action;
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true;
            const stickyReset = data?.stickyReset === true;
            const startWithClear = data?.startWithClear === true; 
            const resetSignalId = data?.resetSignalId;
            
            this.updateCount++;
            this.messageStats.dataUpdates++;
            
            // RESET HANDLING - Now includes START with clear
            if (action === 'reset' || action === 'start' && (allDataCleared || startWithClear) || allDataCleared || hardReset || stickyReset) {
                const clearType = action === 'start' ? 'START+CLEAR' : 'RESET';
                console.log(`🗑️ ${clearType} via ${source}: ${action}, cleared=${allDataCleared}, hard=${hardReset}, sticky=${stickyReset}, startClear=${startWithClear}`);
                
                if (resetSignalId && this.lastProcessedResetId === resetSignalId) {
                    return; // Duplicate reset/start signal
                }
                
                if (resetSignalId) {
                    this.lastProcessedResetId = resetSignalId;
                    setTimeout(() => {
                        if (this.lastProcessedResetId === resetSignalId) {
                            this.lastProcessedResetId = null;
                        }
                    }, 30000);
                }
                
                // Clear visualization
                if (this.renderer) {
                    this.renderer.updateClusters([]);
                    if (this.renderer.springs) this.renderer.springs.clear();
                    if (this.renderer.targets) this.renderer.targets.clear();
                }
                
                // Clear caches
                responseCache.clear();
                
                this.isGameRunning = gameRunning;
                this.lastKnownState = null;
                
                document.body.classList.remove('clickmap-has-data');
                document.body.classList.toggle('clickmap-active', gameRunning);
                
                // For start with clear, show active state
                if (action === 'start' && startWithClear) {
                    document.body.classList.add('clickmap-active');
                    console.log('🎮 Started with fresh clickmap');
                }
                
                // Adjust polling based on new state
                if (!this.wsConnected) {
                    this.stopHttpPolling();
                    this.startHttpPolling();
                }
                
                return;
            }
            
            // Regular START handling (without clear)
            if (action === 'start' && !allDataCleared && !startWithClear) {
                console.log(`🎮 START via ${source} (keeping existing data)`);
            }
            
            // STATE CHANGES
            if (gameRunning !== this.isGameRunning) {
                console.log(`🎮 State change via ${source}: ${this.isGameRunning} → ${gameRunning}`);
                this.isGameRunning = gameRunning;
                
                // Adjust polling frequency
                if (!this.wsConnected) {
                    this.stopHttpPolling();
                    this.startHttpPolling();
                }
            }
            
            if (clusters.length > 0) {
                this.hasEverHadData = true;
            }

            this.updateVisualization(data, source);
        }

        // ========== SHARED UTILITIES ==========
        
        async cachedFetch(url) {
            const cached = responseCache.get(url);
            if (cached && (Date.now() - cached.timestamp) < RESPONSE_CACHE_TTL) {
                return cached.data;
            }

            const response = await fetch(url, { 
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            responseCache.set(url, { data, timestamp: Date.now() });
            
            // Manage cache size
            if (responseCache.size > MAX_CACHE_ENTRIES) {
                const oldestEntry = Array.from(responseCache.entries())
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
                responseCache.delete(oldestEntry[0]);
            }
            
            return data;
        }

        async checkInitialStatus() {
            try {
                const data = await this.cachedFetch(`${EBS}/heatmap?channel=${encodeURIComponent(this.channelId)}`);
                
                console.log(`📊 Initial status: running=${data?.running}, clusters=${data?.clusters?.length || 0}`);
                
                this.isGameRunning = data?.running === true;
                this.updateVisualization(data, 'initial');

            } catch (error) {
                console.log('❌ Initial status check failed:', error.message);
            }
        }

        updateVisualization(data, source) {
            if (!this.renderer) return;
            
            const clusters = Array.isArray(data) ? data : (data?.clusters || []);
            const allDataCleared = data?.allDataCleared === true;
            const hardReset = data?.hardReset === true;
            const stickyReset = data?.stickyReset === true;
            const startWithClear = data?.startWithClear === true;
            const action = data?.action;
            
            this.lastUpdate = Date.now();
            
            // Clear visualization for any clearing action (reset or start with clear)
            if (source.includes('reset') || allDataCleared || hardReset || stickyReset || startWithClear || (action === 'start' && allDataCleared)) {
                console.log(`🎨 Clearing visualization for: ${action || 'reset'}`);
                this.renderer.updateClusters([]);
            } else {
                this.renderer.updateClusters(clusters);
            }
            
            // Update CSS classes
            const isActive = data?.running !== false;
            const hasData = clusters.length > 0;
            
            document.body.classList.toggle('clickmap-active', isActive);
            document.body.classList.toggle('clickmap-has-data', hasData);
            
            // Special handling for clearing actions
            if (source.includes('reset') || allDataCleared || hardReset || stickyReset || startWithClear || (action === 'start' && allDataCleared)) {
                document.body.classList.remove('clickmap-has-data');
                
                // Force reflow for immediate visual update
                document.body.offsetHeight;
                
                // For start with clear, ensure active state is set
                if (action === 'start' && (startWithClear || allDataCleared)) {
                    document.body.classList.add('clickmap-active');
                }
            }
            
            this.lastKnownState = data;
        }

        setupVisibilityTracking() {
            document.addEventListener('visibilitychange', () => {
                this.isPageVisible = !document.hidden;
                
                if (this.isPageVisible) {
                    console.log('👁️ Page visible - resuming');
                    if (!this.wsConnected) {
                        this.startHttpPolling();
                    }
                    // Try to reconnect WebSocket if it's been down
                    if (!this.wsConnected && this.wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        this.initializeWebSocket();
                    }
                } else {
                    console.log('🫥 Page hidden - pausing HTTP');
                    this.stopHttpPolling();
                }
            });
        }

        getChannelFromUrl() {
            const params = new URLSearchParams(window.location.search);
            return params.get('channel') || params.get('c');
        }

        setupRenderer() {
            const canvas = document.getElementById('overlay-canvas');
            if (!canvas) {
                console.error('❌ Canvas not found');
                return;
            }
            
            this.renderer = new OptimalPerformanceRenderer(canvas);
            const threshold = new URLSearchParams(window.location.search).get('threshold');
            if (threshold) this.renderer.setThreshold(parseInt(threshold, 10));
        }

        getStatus() {
            return {
                channelId: this.channelId,
                transportMode: this.transportMode,
                wsConnected: this.wsConnected,
                wsReconnectAttempts: this.wsReconnectAttempts,
                updateCount: this.updateCount,
                isGameRunning: this.isGameRunning,
                hasEverHadData: this.hasEverHadData,
                isPageVisible: this.isPageVisible,
                lastUpdate: this.lastUpdate,
                lastWsMessage: this.lastWsMessage,
                lastHttpPoll: this.lastHttpPoll,
                consecutiveErrors: this.consecutiveErrors,
                messageStats: { ...this.messageStats },
                performance: {
                    fps: this.renderer ? this.renderer.getFPS() : 0,
                    renderQuality: this.renderer ? this.renderer.getRenderQuality() : 1,
                    clusterCount: this.renderer ? this.renderer.getClusterCount() : 0
                },
                cacheSize: responseCache.size,
                textEnhancements: 'MASSIVE - 2.5x bigger with extreme readability'
            };
        }

        destroy() {
            if (this.websocket) {
                this.websocket.close();
            }
            this.stopHttpPolling();
            this.stopWebSocketHeartbeat();
            if (this.wsReconnectTimer) {
                clearTimeout(this.wsReconnectTimer);
            }
            if (this.renderer) {
                this.renderer.destroy();
            }
            responseCache.clear();
            console.log('🧹 OPTIMAL overlay with MASSIVE text destroyed');
        }
    }

    // ========== INITIALIZATION ==========
    function initialize() {
        try {
            const overlay = new OptimalHybridOverlay();
            window.optimalOverlay = overlay;
            console.log('🎯 OPTIMAL hybrid overlay with MASSIVE text loaded');
            
            // Performance monitoring
            setInterval(() => {
                const status = overlay.getStatus();
                console.log(`📊 Transport: ${status.transportMode}, Updates: ${status.messageStats.dataUpdates}, FPS: ${status.performance.fps}, ${status.textEnhancements}`);
            }, 30000);
            
        } catch (error) { 
            console.error('Failed to initialize optimal overlay:', error); 
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Clean response cache periodically
    setInterval(() => {
        const now = Date.now();
        for (const [url, cached] of responseCache.entries()) {
            if (now - cached.timestamp > RESPONSE_CACHE_TTL * 2) {
                responseCache.delete(url);
            }
        }
    }, RESPONSE_CACHE_TTL);

})();
