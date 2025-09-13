// backend/fixed-server.js - WORKING backend that starts simple, adds Redis as enhancement
// Focuses on WORKING FIRST, then optimizing for autoscale

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `fixed_${Date.now()}`;

console.log(`🔧 FIXED ClickMap Server - Instance: ${INSTANCE_ID}`);
console.log(`🔑 JWT Secret length: ${SECRET.length} bytes`);

// ========== SIMPLE, WORKING CONFIGURATION ==========
const CONFIG = {
    // Basic performance settings (conservative)
    MAX_RPS_PER_INSTANCE: 5000,
    EMERGENCY_THRESHOLD: 3000,
    
    // Data management (simple)
    DATA_TTL: 60000,              // 1 minute TTL
    CLEANUP_FREQUENCY: 10000,     // Clean every 10 seconds
    MAX_CLUSTERS: 20,             // Reasonable limit
    
    // Broadcasting
    BROADCAST_INTERVAL: 1000,     // 1 second (reliable)
    
    // Redis (optional enhancement)
    REDIS_ENABLED: false,         // Will be set to true if Redis works
    REDIS_TIMEOUT: 3000,          // 3 second timeout
    REDIS_RETRY_DELAY: 5000,      // 5 second retry delay
};

// ========== WORKING DATA STORE (REDIS OPTIONAL) ==========
class WorkingDataStore {
    constructor() {
        // Local storage that always works
        this.localData = new Map(); // channelId -> { users: Map, totalClicks: 0, lastUpdate: timestamp }
        this.localClusters = new Map(); // channelId -> clusters[]
        
        // Performance tracking
        this.requestCount = 0;
        this.lastReset = Date.now();
        this.errorCount = 0;
        
        // Redis enhancement (optional)
        this.redis = null;
        this.redisConnected = false;
        this.redisQueue = [];
        
        // Circuit breaker
        this.circuitOpen = false;
        this.circuitOpenTime = 0;
        
        this.init();
        console.log('✅ Working data store initialized (local mode)');
    }
    
    async init() {
        // Start local operations immediately
        this.startLocalOperations();
        
        // Try to enable Redis enhancement (don't block if it fails)
        if (process.env.REDIS_URL) {
            this.tryEnableRedis();
        }
    }
    
    startLocalOperations() {
        // Cleanup timer
        setInterval(() => {
            this.cleanup();
        }, CONFIG.CLEANUP_FREQUENCY);
        
        // Performance monitoring
        setInterval(() => {
            this.logPerformance();
        }, 10000);
        
        // Circuit breaker reset
        setInterval(() => {
            if (this.circuitOpen && (Date.now() - this.circuitOpenTime) > 30000) {
                this.circuitOpen = false;
                this.errorCount = 0;
                console.log('✅ Circuit breaker reset');
            }
        }, 30000);
    }
    
    async tryEnableRedis() {
        try {
            console.log('🔄 Attempting Redis connection...');
            
            this.redis = createClient({
                url: process.env.REDIS_URL,
                socket: {
                    connectTimeout: CONFIG.REDIS_TIMEOUT,
                    lazyConnect: true
                }
            });
            
            this.redis.on('error', (err) => {
                console.warn('⚠️ Redis error (non-fatal):', err.message);
                this.redisConnected = false;
                CONFIG.REDIS_ENABLED = false;
            });
            
            this.redis.on('connect', () => {
                console.log('✅ Redis connected - enabling shared state');
                this.redisConnected = true;
                CONFIG.REDIS_ENABLED = true;
                this.startRedisOperations();
            });
            
            // Try to connect (with timeout)
            const connectPromise = this.redis.connect();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Redis connection timeout')), CONFIG.REDIS_TIMEOUT);
            });
            
            await Promise.race([connectPromise, timeoutPromise]);
            
        } catch (error) {
            console.warn('⚠️ Redis initialization failed (continuing in local mode):', error.message);
            this.redisConnected = false;
            CONFIG.REDIS_ENABLED = false;
            
            // Retry later
            setTimeout(() => {
                this.tryEnableRedis();
            }, CONFIG.REDIS_RETRY_DELAY);
        }
    }
    
    startRedisOperations() {
        if (!CONFIG.REDIS_ENABLED) return;
        
        // Sync to Redis periodically
        setInterval(() => {
            this.syncToRedis();
        }, 2000);
        
        console.log('✅ Redis operations started');
    }
    
    async syncToRedis() {
        if (!CONFIG.REDIS_ENABLED || !this.redisConnected) return;
        
        try {
            // Simple sync: store our local data in Redis with instance ID
            for (const [channelId, data] of this.localData.entries()) {
                const redisKey = `channel:${channelId}:${INSTANCE_ID}`;
                const redisData = {
                    instanceId: INSTANCE_ID,
                    userCount: data.users.size,
                    totalClicks: data.totalClicks,
                    lastUpdate: data.lastUpdate,
                    clusters: this.localClusters.get(channelId) || []
                };
                
                await this.redis.setEx(redisKey, 120, JSON.stringify(redisData)); // 2 minute expiry
            }
            
        } catch (error) {
            console.warn('⚠️ Redis sync failed (non-fatal):', error.message);
            // Don't disable Redis entirely, just skip this sync
        }
    }
    
    async getGlobalData(channelId) {
        if (!CONFIG.REDIS_ENABLED || !this.redisConnected) {
            // Return local data only
            return this.getLocalData(channelId);
        }
        
        try {
            // Get data from all instances for this channel
            const pattern = `channel:${channelId}:*`;
            const keys = await this.redis.keys(pattern);
            
            if (keys.length === 0) {
                return this.getLocalData(channelId);
            }
            
            // Fetch all instance data
            const pipeline = this.redis.multi();
            for (const key of keys) {
                pipeline.get(key);
            }
            
            const results = await pipeline.exec();
            
            // Merge data from all instances
            let globalUserCount = 0;
            let globalTotalClicks = 0;
            const allClusters = [];
            const instanceCount = results.length;
            
            for (const result of results) {
                if (result[0] === null && result[1]) { // Command succeeded
                    try {
                        const instanceData = JSON.parse(result[1]);
                        globalUserCount += instanceData.userCount || 0;
                        globalTotalClicks += instanceData.totalClicks || 0;
                        
                        if (instanceData.clusters) {
                            allClusters.push(...instanceData.clusters);
                        }
                    } catch (parseError) {
                        console.warn('⚠️ Failed to parse instance data:', parseError.message);
                    }
                }
            }
            
            // Merge clusters intelligently (simple approach)
            const mergedClusters = this.mergeClusters(allClusters);
            
            return {
                clusters: mergedClusters,
                totalClicks: globalTotalClicks,
                uniqueUsers: globalUserCount,
                mode: 'SHARED',
                instanceCount: instanceCount,
                instanceId: INSTANCE_ID
            };
            
        } catch (error) {
            console.warn('⚠️ Global data fetch failed, using local:', error.message);
            return this.getLocalData(channelId);
        }
    }
    
    mergeClusters(allClusters) {
        if (allClusters.length === 0) return [];
        
        // Simple grid-based merging
        const gridSize = 15;
        const grid = new Map();
        
        for (const cluster of allClusters) {
            const gridX = Math.floor(cluster.x * gridSize);
            const gridY = Math.floor(cluster.y * gridSize);
            const key = `${gridX}_${gridY}`;
            
            if (!grid.has(key)) {
                grid.set(key, {
                    x: cluster.x,
                    y: cluster.y,
                    count: cluster.count || 1,
                    sumX: cluster.x * (cluster.count || 1),
                    sumY: cluster.y * (cluster.count || 1)
                });
            } else {
                const existing = grid.get(key);
                const newCount = cluster.count || 1;
                existing.sumX += cluster.x * newCount;
                existing.sumY += cluster.y * newCount;
                existing.count += newCount;
                existing.x = existing.sumX / existing.count;
                existing.y = existing.sumY / existing.count;
            }
        }
        
        // Convert back to clusters
        const merged = Array.from(grid.values())
            .filter(cell => cell.count >= 2)
            .map((cell, index) => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / Math.max(allClusters.length, 1)) * 100),
                visualSize: Math.min(150, 40 + cell.count * 2),
                id: `merged_${index}_${Date.now()}`
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, CONFIG.MAX_CLUSTERS);
        
        if (merged.length > 0) {
            merged[0].isTop = true;
        }
        
        return merged;
    }
    
    getLocalData(channelId) {
        const data = this.localData.get(channelId);
        const clusters = this.localClusters.get(channelId) || [];
        
        return {
            clusters: clusters,
            totalClicks: data?.totalClicks || 0,
            uniqueUsers: data?.users.size || 0,
            mode: CONFIG.REDIS_ENABLED ? 'LOCAL_WITH_REDIS' : 'LOCAL_ONLY',
            instanceCount: 1,
            instanceId: INSTANCE_ID
        };
    }
    
    canAcceptRequest() {
        // Circuit breaker check
        if (this.circuitOpen) return false;
        
        // Simple rate limiting
        const elapsed = Date.now() - this.lastReset;
        const currentRps = (this.requestCount * 1000) / Math.max(elapsed, 1);
        
        if (currentRps > CONFIG.MAX_RPS_PER_INSTANCE) {
            this.circuitOpen = true;
            this.circuitOpenTime = Date.now();
            console.warn(`🚨 Circuit breaker opened at ${currentRps} RPS`);
            return false;
        }
        
        if (currentRps > CONFIG.EMERGENCY_THRESHOLD) {
            return Math.random() < 0.7; // Accept 70% of requests
        }
        
        return true;
    }
    
    addClick(channelId, userId, x, y) {
        this.requestCount++;
        
        if (!this.canAcceptRequest()) {
            return { success: false, reason: 'rate_limited' };
        }
        
        try {
            // Ensure channel exists
            if (!this.localData.has(channelId)) {
                this.localData.set(channelId, {
                    users: new Map(),
                    totalClicks: 0,
                    lastUpdate: Date.now()
                });
            }
            
            const data = this.localData.get(channelId);
            
            // Store user position (one per user)
            data.users.set(userId, { x, y, timestamp: Date.now() });
            data.totalClicks++;
            data.lastUpdate = Date.now();
            
            // Generate clusters locally
            this.generateClusters(channelId);
            
            return { success: true, reason: 'accepted' };
            
        } catch (error) {
            this.errorCount++;
            console.error('❌ Add click error:', error);
            return { success: false, reason: 'error' };
        }
    }
    
    generateClusters(channelId) {
        const data = this.localData.get(channelId);
        if (!data || data.users.size < 2) {
            this.localClusters.set(channelId, []);
            return;
        }
        
        const positions = Array.from(data.users.values());
        const totalUsers = positions.length;
        
        // Simple grid clustering
        const gridSize = 10;
        const grid = new Map();
        
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
                cell.x = cell.sumX / cell.count;
                cell.y = cell.sumY / cell.count;
            }
        }
        
        // Convert to clusters
        const clusters = Array.from(grid.values())
            .filter(cell => cell.count >= 2)
            .map((cell, index) => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / totalUsers) * 100),
                visualSize: Math.min(120, 40 + cell.count * 2),
                id: `local_${channelId}_${index}_${Date.now()}`
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, CONFIG.MAX_CLUSTERS);
        
        if (clusters.length > 0) {
            clusters[0].isTop = true;
        }
        
        this.localClusters.set(channelId, clusters);
    }
    
    cleanup() {
        const now = Date.now();
        const cutoff = now - CONFIG.DATA_TTL;
        let cleaned = 0;
        
        for (const [channelId, data] of this.localData.entries()) {
            // Clean old user positions
            for (const [userId, pos] of data.users.entries()) {
                if (pos.timestamp < cutoff) {
                    data.users.delete(userId);
                    cleaned++;
                }
            }
            
            // Remove empty channels
            if (data.users.size === 0) {
                this.localData.delete(channelId);
                this.localClusters.delete(channelId);
            } else {
                // Regenerate clusters after cleanup
                this.generateClusters(channelId);
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} old positions`);
        }
    }
    
    logPerformance() {
        const elapsed = Date.now() - this.lastReset;
        const currentRps = Math.round((this.requestCount * 1000) / elapsed);
        
        console.log(`📊 Performance - Instance: ${INSTANCE_ID}`);
        console.log(`   RPS: ${currentRps}, Channels: ${this.localData.size}`);
        console.log(`   Redis: ${CONFIG.REDIS_ENABLED ? 'Enabled' : 'Disabled'}, Errors: ${this.errorCount}`);
        
        this.requestCount = 0;
        this.errorCount = 0;
        this.lastReset = Date.now();
    }
    
    async getHeatmapData(channelId) {
        if (CONFIG.REDIS_ENABLED) {
            return await this.getGlobalData(channelId);
        } else {
            return this.getLocalData(channelId);
        }
    }
    
    clearAll() {
        this.localData.clear();
        this.localClusters.clear();
        this.requestCount = 0;
        this.errorCount = 0;
        console.log('🧹 Data cleared');
    }
    
    getStats() {
        const elapsed = Date.now() - this.lastReset;
        const currentRps = Math.round((this.requestCount * 1000) / Math.max(elapsed, 1));
        
        return {
            instanceId: INSTANCE_ID,
            currentRps: currentRps,
            channels: this.localData.size,
            clusters: Array.from(this.localClusters.values()).reduce((sum, clusters) => sum + clusters.length, 0),
            redisEnabled: CONFIG.REDIS_ENABLED,
            redisConnected: this.redisConnected,
            circuitOpen: this.circuitOpen,
            errorCount: this.errorCount,
            mode: CONFIG.REDIS_ENABLED ? 'ENHANCED' : 'BASIC'
        };
    }
}

// ========== SIMPLE GAME STATE ==========
class SimpleGameState {
    constructor() {
        this.running = false;
        this.version = 0;
    }
    
    start() {
        this.running = true;
        this.version = Date.now();
        console.log('🚀 Game started');
        return this.version;
    }
    
    stop() {
        this.running = false;
        this.version = Date.now();
        console.log('⏹️ Game stopped');
        return this.version;
    }
    
    reset() {
        this.version = Date.now();
        console.log('🔄 Game reset');
        return this.version;
    }
    
    isRunning() {
        return this.running;
    }
    
    getState() {
        return {
            running: this.running,
            version: this.version,
            instanceId: INSTANCE_ID
        };
    }
}

// Initialize components
const dataStore = new WorkingDataStore();
const gameState = new SimpleGameState();

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '2kb' }));

// Simple JWT cache
const jwtCache = new Map();
function verifyJWT(token) {
    try {
        // Check cache first
        const cached = jwtCache.get(token);
        if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
            return cached.payload;
        }
        
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        
        // Cache result
        if (jwtCache.size >= 1000) {
            const oldestKey = jwtCache.keys().next().value;
            jwtCache.delete(oldestKey);
        }
        
        jwtCache.set(token, { payload, timestamp: Date.now() });
        return payload;
        
    } catch (error) {
        console.warn('JWT verification failed:', error.message);
        return null;
    }
}

// ========== ENDPOINTS ==========

app.get('/health', (req, res) => {
    const stats = dataStore.getStats();
    const gameStats = gameState.getState();
    
    res.json({
        status: 'healthy',
        ...stats,
        ...gameStats,
        timestamp: Date.now()
    });
});

app.post('/click', async (req, res) => {
    try {
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
                error: 'No token provided' 
            });
        }
        
        const payload = verifyJWT(token);
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
        
        const result = dataStore.addClick(
            payload.channel_id,
            payload.user_id || payload.opaque_user_id,
            x, y
        );
        
        res.json({
            success: result.success,
            mode: CONFIG.REDIS_ENABLED ? 'ENHANCED' : 'BASIC',
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        console.error('❌ Click endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.get('/heatmap', async (req, res) => {
    try {
        const channelId = req.query.channel || 'default';
        const data = await dataStore.getHeatmapData(channelId);
        const gameStats = gameState.getState();
        
        res.json({
            running: gameStats.running,
            ...data,
            version: gameStats.version,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('❌ Heatmap endpoint error:', error);
        res.status(500).json({
            running: false,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            error: 'Internal server error'
        });
    }
});

// Control endpoints
app.post('/start', (req, res) => {
    try {
        dataStore.clearAll();
        const version = gameState.start();
        res.json({ 
            success: true, 
            version,
            mode: CONFIG.REDIS_ENABLED ? 'ENHANCED' : 'BASIC'
        });
    } catch (error) {
        console.error('❌ Start endpoint error:', error);
        res.status(500).json({ success: false, error: 'Failed to start' });
    }
});

app.post('/stop', (req, res) => {
    try {
        const version = gameState.stop();
        res.json({ success: true, version });
    } catch (error) {
        console.error('❌ Stop endpoint error:', error);
        res.status(500).json({ success: false, error: 'Failed to stop' });
    }
});

app.post('/reset', (req, res) => {
    try {
        dataStore.clearAll();
        const version = gameState.reset();
        res.json({ success: true, version });
    } catch (error) {
        console.error('❌ Reset endpoint error:', error);
        res.status(500).json({ success: false, error: 'Failed to reset' });
    }
});

// ========== WEBSOCKET ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    perMessageDeflate: false
});

const wsClients = new Map();

async function broadcast() {
    for (const [channelId, clients] of wsClients.entries()) {
        if (clients.size === 0) continue;
        
        try {
            const data = await dataStore.getHeatmapData(channelId);
            const gameStats = gameState.getState();
            
            const message = JSON.stringify({
                running: gameStats.running,
                clusters: data.clusters,
                totalClicks: data.totalClicks,
                uniqueUsers: data.uniqueUsers,
                version: gameStats.version,
                mode: data.mode,
                instanceCount: data.instanceCount || 1,
                timestamp: Date.now()
            });
            
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(message);
                    } catch (error) {
                        clients.delete(ws);
                    }
                }
            });
            
        } catch (error) {
            console.error('❌ Broadcast error for channel', channelId, ':', error.message);
        }
    }
    
    setTimeout(broadcast, CONFIG.BROADCAST_INTERVAL);
}

// Start broadcasting
broadcast();

wss.on('connection', (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
    if (!wsClients.has(channelId)) {
        wsClients.set(channelId, new Set());
    }
    wsClients.get(channelId).add(ws);
    
    console.log(`📡 WebSocket connected: ${channelId} (${wsClients.get(channelId).size} clients)`);
    
    ws.on('close', () => {
        const clients = wsClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                wsClients.delete(channelId);
            }
        }
    });
    
    ws.on('error', (error) => {
        console.warn('⚠️ WebSocket error (non-fatal):', error.message);
    });
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🔧 FIXED ClickMap Server Started');
    console.log(`🆔 Instance: ${INSTANCE_ID}`);
    console.log(`⚡ Port: ${PORT}`);
    console.log(`🔗 Redis: ${CONFIG.REDIS_ENABLED ? 'Enabled' : 'Disabled (will retry)'}`);
    console.log('🎯 Server Features:');
    console.log('  • Always works (local mode)');
    console.log('  • Redis enhancement when available');
    console.log('  • Proper error handling');
    console.log('  • Circuit breaker protection');
    console.log('✅ Ready to accept connections');
});

process.on('SIGTERM', () => {
    console.log(`🔧 Shutting down fixed instance ${INSTANCE_ID}...`);
    
    if (dataStore.redis && dataStore.redisConnected) {
        dataStore.redis.disconnect();
    }
    
    httpServer.close(() => process.exit(0));
});

export default httpServer;
