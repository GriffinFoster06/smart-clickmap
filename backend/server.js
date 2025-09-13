// backend/ultra-server.js - Extreme performance backend for 50k+ RPS
// Stripped down, optimized for raw speed over sophistication

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `ultra_${Date.now()}`;

console.log(`🚀 ULTRA HIGH PERFORMANCE ClickMap Server - Instance: ${INSTANCE_ID}`);

// ========== ULTRA PERFORMANCE CONFIGURATION ==========
const ULTRA_CONFIG = {
    // Extreme load shedding
    MAX_RPS_PER_INSTANCE: 10000,      // Hard limit per instance
    EMERGENCY_MODE_THRESHOLD: 5000,   // Start dropping requests
    CIRCUIT_BREAKER_THRESHOLD: 15000, // Stop accepting requests
    
    // Ultra-fast processing
    BATCH_SIZE: 200,                  // Large batches for efficiency
    BATCH_TIMEOUT: 50,                // 50ms max batch wait
    MIN_CLUSTER_SIZE: 5,              // Only significant clusters
    MAX_CLUSTERS: 20,                 // Hard limit on complexity
    
    // Memory management
    MAX_MEMORY_MB: 200,               // 200MB memory limit
    CLEANUP_FREQUENCY: 2000,          // Clean every 2 seconds
    DATA_TTL: 30000,                  // 30 second data TTL
    
    // Broadcasting optimization
    BROADCAST_INTERVAL: 200,          // 5 FPS updates (200ms)
    MAX_WEBSOCKET_CLIENTS: 1000,      // Limit WebSocket connections
    
    // Circuit breaker
    ERROR_THRESHOLD: 100,             // Errors before circuit break
    RECOVERY_TIME: 10000,             // 10s circuit breaker recovery
};

// ========== ULTRA-FAST DATA STRUCTURES ==========
class UltraFastDataStore {
    constructor() {
        // Use Maps for O(1) access, minimal memory allocation
        this.channelData = new Map();
        this.requestCount = 0;
        this.lastReset = Date.now();
        this.memoryUsage = 0;
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenTime = 0;
        this.errorCount = 0;
        
        this.startUltraOptimizations();
        console.log('⚡ Ultra-fast data store initialized');
    }
    
    startUltraOptimizations() {
        // Ultra-aggressive cleanup every 2 seconds
        setInterval(() => {
            this.ultraCleanup();
        }, ULTRA_CONFIG.CLEANUP_FREQUENCY);
        
        // Request count reset
        setInterval(() => {
            const now = Date.now();
            const elapsed = now - this.lastReset;
            const rps = Math.round((this.requestCount * 1000) / elapsed);
            
            console.log(`⚡ ULTRA: ${rps} RPS, ${this.channelData.size} channels, ${this.memoryUsage}MB`);
            
            // Emergency mode detection
            if (rps > ULTRA_CONFIG.EMERGENCY_MODE_THRESHOLD) {
                console.warn(`🚨 EMERGENCY MODE: ${rps} RPS > ${ULTRA_CONFIG.EMERGENCY_MODE_THRESHOLD}`);
            }
            
            // Circuit breaker
            if (rps > ULTRA_CONFIG.CIRCUIT_BREAKER_THRESHOLD || this.errorCount > ULTRA_CONFIG.ERROR_THRESHOLD) {
                this.circuitBreakerOpen = true;
                this.circuitBreakerOpenTime = now;
                console.error(`🚨 CIRCUIT BREAKER OPEN: ${rps} RPS, ${this.errorCount} errors`);
            }
            
            // Circuit breaker recovery
            if (this.circuitBreakerOpen && (now - this.circuitBreakerOpenTime) > ULTRA_CONFIG.RECOVERY_TIME) {
                this.circuitBreakerOpen = false;
                this.errorCount = 0;
                console.log('✅ Circuit breaker recovered');
            }
            
            this.requestCount = 0;
            this.lastReset = now;
        }, 1000);
    }
    
    ultraCleanup() {
        const now = Date.now();
        const cutoff = now - ULTRA_CONFIG.DATA_TTL;
        let cleaned = 0;
        
        // Aggressive cleanup of old data
        for (const [channelId, data] of this.channelData.entries()) {
            if (data.lastUpdate < cutoff) {
                this.channelData.delete(channelId);
                cleaned++;
                continue;
            }
            
            // Clean old clicks within channels
            const beforeSize = data.clicks.length;
            data.clicks = data.clicks.filter(click => click.timestamp > cutoff);
            cleaned += (beforeSize - data.clicks.length);
        }
        
        // Memory usage estimation (rough)
        this.memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        
        // Force cleanup if memory too high
        if (this.memoryUsage > ULTRA_CONFIG.MAX_MEMORY_MB) {
            const oldestChannels = Array.from(this.channelData.entries())
                .sort((a, b) => a[1].lastUpdate - b[1].lastUpdate)
                .slice(0, Math.floor(this.channelData.size * 0.3));
                
            for (const [channelId] of oldestChannels) {
                this.channelData.delete(channelId);
                cleaned++;
            }
            
            if (global.gc) global.gc();
            console.log(`🧹 Emergency cleanup: ${cleaned} items, ${this.memoryUsage}MB`);
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Ultra cleanup: ${cleaned} items removed`);
        }
    }
    
    shouldAcceptRequest() {
        // Circuit breaker check
        if (this.circuitBreakerOpen) {
            return false;
        }
        
        // Memory check
        if (this.memoryUsage > ULTRA_CONFIG.MAX_MEMORY_MB) {
            return Math.random() < 0.1; // Accept only 10% of requests
        }
        
        // Rate limiting
        const elapsed = Date.now() - this.lastReset;
        const currentRps = (this.requestCount * 1000) / Math.max(elapsed, 1);
        
        if (currentRps > ULTRA_CONFIG.MAX_RPS_PER_INSTANCE) {
            return Math.random() < 0.2; // Accept only 20% of requests
        }
        
        if (currentRps > ULTRA_CONFIG.EMERGENCY_MODE_THRESHOLD) {
            return Math.random() < 0.5; // Accept only 50% of requests
        }
        
        return true;
    }
    
    addClick(channelId, userId, x, y) {
        // Ultra-fast click processing
        this.requestCount++;
        
        if (!this.shouldAcceptRequest()) {
            return { accepted: false, reason: 'load_shedding' };
        }
        
        try {
            if (!this.channelData.has(channelId)) {
                this.channelData.set(channelId, {
                    clicks: [],
                    userPositions: new Map(),
                    lastUpdate: Date.now(),
                    clusters: []
                });
            }
            
            const data = this.channelData.get(channelId);
            
            // Store only latest position per user (memory efficient)
            data.userPositions.set(userId, { x, y, timestamp: Date.now() });
            data.lastUpdate = Date.now();
            
            // Add to clicks for batching
            data.clicks.push({ userId, x, y, timestamp: Date.now() });
            
            return { accepted: true, reason: 'success' };
            
        } catch (error) {
            this.errorCount++;
            console.error('Add click error:', error);
            return { accepted: false, reason: 'error' };
        }
    }
    
    generateUltraFastClusters(channelId) {
        const data = this.channelData.get(channelId);
        if (!data || data.userPositions.size < ULTRA_CONFIG.MIN_CLUSTER_SIZE) {
            return [];
        }
        
        // Convert to array for processing (fast)
        const positions = Array.from(data.userPositions.values());
        const totalUsers = positions.length;
        
        if (totalUsers === 0) return [];
        
        // Ultra-simple grid-based clustering (extremely fast)
        const gridSize = 20; // 20x20 grid
        const grid = new Map();
        
        // Assign positions to grid cells
        for (const pos of positions) {
            const gridX = Math.floor(pos.x * gridSize);
            const gridY = Math.floor(pos.y * gridSize);
            const key = `${gridX}_${gridY}`;
            
            if (!grid.has(key)) {
                grid.set(key, { 
                    x: pos.x, 
                    y: pos.y, 
                    count: 1,
                    sumX: pos.x,
                    sumY: pos.y
                });
            } else {
                const cell = grid.get(key);
                cell.count++;
                cell.sumX += pos.x;
                cell.sumY += pos.y;
                cell.x = cell.sumX / cell.count; // Average position
                cell.y = cell.sumY / cell.count;
            }
        }
        
        // Convert to clusters and filter significant ones
        const clusters = Array.from(grid.values())
            .filter(cell => cell.count >= ULTRA_CONFIG.MIN_CLUSTER_SIZE)
            .map(cell => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / totalUsers) * 100),
                visualSize: Math.min(150, 40 + cell.count * 2),
                id: `grid_${cell.x.toFixed(2)}_${cell.y.toFixed(2)}`
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, ULTRA_CONFIG.MAX_CLUSTERS);
        
        // Mark the top cluster
        if (clusters.length > 0) {
            clusters[0].isTop = true;
        }
        
        return clusters;
    }
    
    getHeatmapData(channelId) {
        if (!this.channelData.has(channelId)) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: 'ULTRA_PERFORMANCE',
                instanceId: INSTANCE_ID,
                timestamp: Date.now()
            };
        }
        
        const data = this.channelData.get(channelId);
        const clusters = this.generateUltraFastClusters(channelId);
        
        return {
            clusters: clusters,
            totalClicks: data.clicks.length,
            uniqueUsers: data.userPositions.size,
            mode: 'ULTRA_PERFORMANCE',
            instanceId: INSTANCE_ID,
            timestamp: Date.now(),
            memoryUsage: this.memoryUsage,
            rps: Math.round((this.requestCount * 1000) / Math.max(Date.now() - this.lastReset, 1))
        };
    }
    
    clearAll() {
        this.channelData.clear();
        this.requestCount = 0;
        this.errorCount = 0;
        if (global.gc) global.gc();
        console.log('🧹 Ultra store cleared');
    }
    
    getStats() {
        const elapsed = Date.now() - this.lastReset;
        const currentRps = Math.round((this.requestCount * 1000) / Math.max(elapsed, 1));
        
        return {
            channels: this.channelData.size,
            memoryUsage: this.memoryUsage,
            currentRps: currentRps,
            requestCount: this.requestCount,
            circuitBreakerOpen: this.circuitBreakerOpen,
            errorCount: this.errorCount,
            instanceId: INSTANCE_ID
        };
    }
}

// ========== ULTRA-FAST BATCHING PROCESSOR ==========
class UltraFastBatcher {
    constructor(dataStore) {
        this.dataStore = dataStore;
        this.batchQueue = [];
        this.isProcessing = false;
        this.processed = 0;
        
        this.startBatchProcessor();
        console.log('⚡ Ultra-fast batcher initialized');
    }
    
    startBatchProcessor() {
        // Process batches as fast as possible
        const processBatch = () => {
            if (this.batchQueue.length > 0 && !this.isProcessing) {
                this.processBatch();
            }
            
            // Use setTimeout for better performance than setInterval
            setTimeout(processBatch, 1);
        };
        
        processBatch();
    }
    
    addToBatch(channelId, userId, x, y) {
        this.batchQueue.push({ channelId, userId, x, y, timestamp: Date.now() });
        
        // Process immediately if batch is large enough
        if (this.batchQueue.length >= ULTRA_CONFIG.BATCH_SIZE) {
            this.processBatch();
        }
    }
    
    processBatch() {
        if (this.isProcessing || this.batchQueue.length === 0) return;
        
        this.isProcessing = true;
        const batch = this.batchQueue.splice(0, ULTRA_CONFIG.BATCH_SIZE);
        
        // Ultra-fast batch processing
        for (const item of batch) {
            const result = this.dataStore.addClick(item.channelId, item.userId, item.x, item.y);
            if (result.accepted) this.processed++;
        }
        
        this.isProcessing = false;
    }
    
    getStats() {
        return {
            queueSize: this.batchQueue.length,
            processed: this.processed,
            isProcessing: this.isProcessing
        };
    }
}

// ========== SIMPLE GAME STATE ==========
class SimpleGameState {
    constructor() {
        this.running = false;
        this.version = 0;
        this.startTime = 0;
    }
    
    isRunning() { return this.running; }
    
    start() {
        this.running = true;
        this.version = Date.now();
        this.startTime = Date.now();
        console.log('🚀 Ultra game started');
        return this.version;
    }
    
    stop() {
        this.running = false;
        this.version = Date.now();
        console.log('⏹️ Ultra game stopped');
        return this.version;
    }
    
    reset() {
        this.version = Date.now();
        console.log('🔄 Ultra game reset');
        return this.version;
    }
    
    getState() {
        return {
            running: this.running,
            version: this.version,
            instanceId: INSTANCE_ID,
            startTime: this.startTime
        };
    }
}

// Initialize ultra-fast components
const dataStore = new UltraFastDataStore();
const batcher = new UltraFastBatcher(dataStore);
const gameState = new SimpleGameState();

// ========== EXPRESS APP WITH EXTREME OPTIMIZATION ==========
const app = express();

// Ultra-fast middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1kb' })); // Tiny limit for speed

// JWT cache for ultra performance
const jwtCache = new Map();
const JWT_CACHE_SIZE = 10000;
const JWT_CACHE_TTL = 300000; // 5 minutes

function verifyJWTUltraFast(token) {
    // Check cache first
    const cached = jwtCache.get(token);
    if (cached && Date.now() - cached.timestamp < JWT_CACHE_TTL) {
        return cached.payload;
    }
    
    try {
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        
        // Cache result (with size limit)
        if (jwtCache.size >= JWT_CACHE_SIZE) {
            const oldestKey = jwtCache.keys().next().value;
            jwtCache.delete(oldestKey);
        }
        
        jwtCache.set(token, { payload, timestamp: Date.now() });
        return payload;
    } catch {
        return null;
    }
}

// ========== ULTRA-FAST ENDPOINTS ==========

// Health check - minimal response
app.get('/health', (req, res) => {
    const stats = dataStore.getStats();
    res.json({
        status: 'ultra',
        ...stats,
        timestamp: Date.now()
    });
});

// Ultra-fast click endpoint
app.post('/click', (req, res) => {
    // Immediate load shedding
    if (!dataStore.shouldAcceptRequest()) {
        return res.status(503).json({ 
            success: false, 
            error: 'Server overloaded',
            retry: false 
        });
    }
    
    if (!gameState.isRunning()) {
        return res.status(400).json({ 
            success: false, 
            error: 'Game not running' 
        });
    }
    
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'No token' 
        });
    }
    
    const payload = verifyJWTUltraFast(token);
    if (!payload) {
        return res.status(401).json({ 
            success: false, 
            error: 'Invalid token' 
        });
    }
    
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' || 
        x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid coordinates' 
        });
    }
    
    // Add to batch instead of processing immediately
    batcher.addToBatch(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    // Always return success immediately (fire and forget for speed)
    res.json({ success: true, mode: 'ULTRA' });
});

// Simplified heatmap endpoint
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel || 'default';
    const data = dataStore.getHeatmapData(channelId);
    const state = gameState.getState();
    
    res.json({
        running: state.running,
        ...data,
        version: state.version
    });
});

// Control endpoints
app.post('/start', (req, res) => {
    dataStore.clearAll();
    const version = gameState.start();
    res.json({ success: true, version, mode: 'ULTRA' });
});

app.post('/stop', (req, res) => {
    const version = gameState.stop();
    res.json({ success: true, version, mode: 'ULTRA' });
});

app.post('/reset', (req, res) => {
    dataStore.clearAll();
    const version = gameState.reset();
    res.json({ success: true, version, mode: 'ULTRA' });
});

// Ultra stats endpoint
app.get('/ultra-stats', (req, res) => {
    const dataStats = dataStore.getStats();
    const batchStats = batcher.getStats();
    const gameStats = gameState.getState();
    
    res.json({
        dataStore: dataStats,
        batcher: batchStats,
        gameState: gameStats,
        jwtCacheSize: jwtCache.size,
        timestamp: Date.now()
    });
});

// ========== ULTRA-FAST WEBSOCKET WITH THROTTLING ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    perMessageDeflate: false, // Disable compression for speed
    maxPayload: 1024 * 16     // 16KB max message
});
const wsClients = new Map();

let lastBroadcast = 0;
let broadcastCount = 0;

function ultraFastBroadcast() {
    const now = Date.now();
    
    // Throttle broadcasts to reduce load
    if (now - lastBroadcast < ULTRA_CONFIG.BROADCAST_INTERVAL) {
        setTimeout(ultraFastBroadcast, ULTRA_CONFIG.BROADCAST_INTERVAL);
        return;
    }
    
    lastBroadcast = now;
    broadcastCount++;
    
    let totalClients = 0;
    
    for (const [channelId, clients] of wsClients.entries()) {
        if (clients.size === 0) continue;
        
        // Limit clients per channel
        if (clients.size > ULTRA_CONFIG.MAX_WEBSOCKET_CLIENTS) {
            const clientArray = Array.from(clients);
            const toRemove = clientArray.slice(ULTRA_CONFIG.MAX_WEBSOCKET_CLIENTS);
            toRemove.forEach(ws => {
                ws.close(1008, 'Too many clients');
                clients.delete(ws);
            });
        }
        
        totalClients += clients.size;
        
        const data = dataStore.getHeatmapData(channelId);
        const state = gameState.getState();
        
        // Ultra-minimal message
        const message = JSON.stringify({
            running: state.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.uniqueUsers,
            version: state.version,
            timestamp: now
        });
        
        // Broadcast to all clients
        clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try { 
                    ws.send(message); 
                } catch {
                    clients.delete(ws);
                }
            } else {
                clients.delete(ws);
            }
        });
    }
    
    // Log performance every 100 broadcasts
    if (broadcastCount % 100 === 0) {
        console.log(`📡 Broadcast #${broadcastCount}: ${totalClients} clients, ${wsClients.size} channels`);
    }
    
    setTimeout(ultraFastBroadcast, ULTRA_CONFIG.BROADCAST_INTERVAL);
}

ultraFastBroadcast();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
    // Limit total WebSocket connections
    let totalConnections = 0;
    for (const clients of wsClients.values()) {
        totalConnections += clients.size;
    }
    
    if (totalConnections >= ULTRA_CONFIG.MAX_WEBSOCKET_CLIENTS) {
        ws.close(1008, 'Server overloaded');
        return;
    }
    
    if (!wsClients.has(channelId)) {
        wsClients.set(channelId, new Set());
    }
    wsClients.get(channelId).add(ws);
    
    ws.on('close', () => {
        const clients = wsClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                wsClients.delete(channelId);
            }
        }
    });
    
    ws.on('error', () => {});
});

// ========== START ULTRA SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ULTRA HIGH PERFORMANCE ClickMap Server');
    console.log(`⚡ Instance: ${INSTANCE_ID}`);
    console.log(`🔥 Port: ${PORT}`);
    console.log('⚡ ULTRA Performance Features:');
    console.log(`  • ${ULTRA_CONFIG.MAX_RPS_PER_INSTANCE} RPS capacity per instance`);
    console.log(`  • ${ULTRA_CONFIG.EMERGENCY_MODE_THRESHOLD} RPS emergency mode threshold`);
    console.log(`  • ${ULTRA_CONFIG.CIRCUIT_BREAKER_THRESHOLD} RPS circuit breaker`);
    console.log(`  • ${ULTRA_CONFIG.BATCH_SIZE} batch size processing`);
    console.log(`  • ${ULTRA_CONFIG.MAX_CLUSTERS} max clusters for performance`);
    console.log(`  • ${ULTRA_CONFIG.BROADCAST_INTERVAL}ms broadcast interval`);
    console.log('🚨 Ready for EXTREME LOAD');
});

process.on('SIGTERM', () => {
    console.log(`🚀 Shutting down ultra instance ${INSTANCE_ID}...`);
    httpServer.close(() => process.exit(0));
});

export default httpServer;
