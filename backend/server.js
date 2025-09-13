// backend/autoscale-server.js - Autoscale-compatible with shared state
// Maintains performance while ensuring consistency across instances

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `auto_${Date.now()}`;

console.log(`🔄 AUTOSCALE-COMPATIBLE ClickMap Server - Instance: ${INSTANCE_ID}`);

// ========== AUTOSCALE CONFIGURATION ==========
const AUTOSCALE_CONFIG = {
    // Performance limits (per instance)
    MAX_RPS_PER_INSTANCE: 8000,       // Lower than ultra for stability
    EMERGENCY_MODE_THRESHOLD: 4000,   // Start load shedding earlier
    CIRCUIT_BREAKER_THRESHOLD: 12000, // Circuit breaker threshold
    
    // Shared state configuration
    REDIS_BATCH_SIZE: 100,             // Batch Redis operations
    REDIS_BATCH_TIMEOUT: 100,          // 100ms Redis batch timeout
    LOCAL_CACHE_TTL: 2000,             // 2s local cache before Redis sync
    CLUSTER_SYNC_INTERVAL: 1000,       // Sync clusters every 1s
    
    // Data management
    GLOBAL_DATA_TTL: 45000,            // 45s global TTL (longer than ultra)
    CLEANUP_FREQUENCY: 3000,           // Clean every 3s
    MAX_CLUSTERS_PER_CHANNEL: 25,      // Limit clusters for consistency
    
    // Broadcasting
    BROADCAST_INTERVAL: 500,           // 2 FPS (slower for consistency)
    PUBSUB_CHANNEL: 'clickmap_clusters',
    INSTANCE_HEARTBEAT: 10000,         // 10s heartbeat
};

// ========== REDIS SETUP WITH ERROR HANDLING ==========
let redis = null;
let redisPub = null;
let redisSub = null;
let redisConnected = false;

async function setupRedis() {
    if (!process.env.REDIS_URL) {
        console.warn('⚠️ No REDIS_URL - running in single-instance mode');
        return false;
    }
    
    try {
        // Main Redis client
        redis = createClient({
            url: process.env.REDIS_URL,
            socket: {
                connectTimeout: 2000,
                lazyConnect: true,
                reconnectStrategy: (retries) => {
                    if (retries > 5) return null;
                    return Math.min(retries * 200, 2000);
                }
            },
            // Optimized for high throughput
            commandsQueueMaxLength: 2000,
        });
        
        // Pub/Sub clients (separate connections)
        redisPub = createClient({ url: process.env.REDIS_URL });
        redisSub = createClient({ url: process.env.REDIS_URL });
        
        // Error handlers
        redis.on('error', (err) => {
            console.error('Redis error:', err.message);
            redisConnected = false;
        });
        
        redis.on('connect', () => {
            console.log('✅ Redis connected');
            redisConnected = true;
        });
        
        // Connect all clients
        await Promise.all([
            redis.connect(),
            redisPub.connect(), 
            redisSub.connect()
        ]);
        
        // Setup pub/sub for cluster synchronization
        await redisSub.subscribe(AUTOSCALE_CONFIG.PUBSUB_CHANNEL, (message) => {
            try {
                const data = JSON.parse(message);
                if (data.instanceId !== INSTANCE_ID) {
                    sharedState.handleRemoteClusterUpdate(data);
                }
            } catch (error) {
                console.error('PubSub message error:', error);
            }
        });
        
        console.log('✅ Redis pub/sub setup complete');
        return true;
        
    } catch (error) {
        console.error('❌ Redis setup failed:', error.message);
        console.log('🔄 Falling back to single-instance mode');
        redisConnected = false;
        return false;
    }
}

// ========== SHARED STATE MANAGER ==========
class AutoscaleSharedState {
    constructor() {
        // Local state for performance
        this.localChannelData = new Map();
        this.localClusters = new Map();
        
        // Redis batching for efficiency
        this.redisBatch = [];
        this.batchTimer = null;
        
        // Performance tracking
        this.requestCount = 0;
        this.lastReset = Date.now();
        this.redisOperations = 0;
        this.cacheHits = 0;
        
        // Instance management
        this.instanceStartTime = Date.now();
        this.lastHeartbeat = Date.now();
        
        this.startAutoscaleOptimizations();
        console.log('🔄 Autoscale shared state manager initialized');
    }
    
    startAutoscaleOptimizations() {
        // Batch Redis operations for efficiency
        setInterval(() => {
            this.flushRedisBatch();
        }, AUTOSCALE_CONFIG.REDIS_BATCH_TIMEOUT);
        
        // Sync clusters across instances
        setInterval(() => {
            this.syncClustersToRedis();
        }, AUTOSCALE_CONFIG.CLUSTER_SYNC_INTERVAL);
        
        // Cleanup old data
        setInterval(() => {
            this.performCleanup();
        }, AUTOSCALE_CONFIG.CLEANUP_FREQUENCY);
        
        // Instance heartbeat
        setInterval(() => {
            this.sendHeartbeat();
        }, AUTOSCALE_CONFIG.INSTANCE_HEARTBEAT);
        
        // Performance reporting
        setInterval(() => {
            this.logPerformance();
        }, 10000);
    }
    
    async sendHeartbeat() {
        if (!redisConnected) return;
        
        try {
            const heartbeat = {
                instanceId: INSTANCE_ID,
                timestamp: Date.now(),
                requestCount: this.requestCount,
                channels: this.localChannelData.size,
                uptime: Date.now() - this.instanceStartTime
            };
            
            await redis.setEx(`heartbeat:${INSTANCE_ID}`, 30, JSON.stringify(heartbeat));
            this.lastHeartbeat = Date.now();
            
        } catch (error) {
            console.error('Heartbeat error:', error);
        }
    }
    
    async addClick(channelId, userId, x, y) {
        this.requestCount++;
        
        // Always store locally first for performance
        if (!this.localChannelData.has(channelId)) {
            this.localChannelData.set(channelId, {
                userPositions: new Map(),
                lastUpdate: Date.now(),
                totalClicks: 0
            });
        }
        
        const localData = this.localChannelData.get(channelId);
        localData.userPositions.set(userId, { x, y, timestamp: Date.now() });
        localData.totalClicks++;
        localData.lastUpdate = Date.now();
        
        // Batch for Redis sync if connected
        if (redisConnected) {
            this.addToRedisBatch('click', { channelId, userId, x, y, timestamp: Date.now() });
        }
        
        return { accepted: true, cached: !redisConnected };
    }
    
    addToRedisBatch(operation, data) {
        this.redisBatch.push({ operation, data, timestamp: Date.now() });
        
        // Flush if batch is full
        if (this.redisBatch.length >= AUTOSCALE_CONFIG.REDIS_BATCH_SIZE) {
            this.flushRedisBatch();
        }
    }
    
    async flushRedisBatch() {
        if (this.redisBatch.length === 0 || !redisConnected) return;
        
        const batch = this.redisBatch.splice(0, AUTOSCALE_CONFIG.REDIS_BATCH_SIZE);
        
        try {
            const pipeline = redis.multi();
            
            for (const item of batch) {
                if (item.operation === 'click') {
                    const key = `clicks:${item.data.channelId}:${item.data.userId}`;
                    pipeline.hSet(key, {
                        x: item.data.x.toString(),
                        y: item.data.y.toString(),
                        timestamp: item.data.timestamp.toString()
                    });
                    pipeline.expire(key, Math.floor(AUTOSCALE_CONFIG.GLOBAL_DATA_TTL / 1000));
                }
            }
            
            await pipeline.exec();
            this.redisOperations += batch.length;
            
        } catch (error) {
            console.error('Redis batch flush error:', error);
            // Add failed operations back to batch for retry
            this.redisBatch.unshift(...batch);
        }
    }
    
    async syncClustersToRedis() {
        if (!redisConnected || this.localClusters.size === 0) return;
        
        try {
            for (const [channelId, clusters] of this.localClusters.entries()) {
                const clusterData = {
                    clusters: clusters,
                    instanceId: INSTANCE_ID,
                    timestamp: Date.now(),
                    totalUsers: this.localChannelData.get(channelId)?.userPositions.size || 0
                };
                
                await redis.setEx(
                    `clusters:${channelId}:${INSTANCE_ID}`,
                    Math.floor(AUTOSCALE_CONFIG.GLOBAL_DATA_TTL / 1000),
                    JSON.stringify(clusterData)
                );
            }
            
            // Broadcast to other instances
            if (redisPub) {
                await redisPub.publish(AUTOSCALE_CONFIG.PUBSUB_CHANNEL, JSON.stringify({
                    instanceId: INSTANCE_ID,
                    action: 'cluster_update',
                    channels: Array.from(this.localClusters.keys()),
                    timestamp: Date.now()
                }));
            }
            
        } catch (error) {
            console.error('Cluster sync error:', error);
        }
    }
    
    handleRemoteClusterUpdate(data) {
        // Handle updates from other instances
        console.log(`📡 Remote update from ${data.instanceId}: ${data.channels?.length || 0} channels`);
        
        // Trigger a refresh of merged data for affected channels
        if (data.channels) {
            for (const channelId of data.channels) {
                this.invalidateLocalCache(channelId);
            }
        }
    }
    
    invalidateLocalCache(channelId) {
        // Mark that we need to fetch fresh data from Redis for this channel
        if (this.localClusters.has(channelId)) {
            const clusters = this.localClusters.get(channelId);
            clusters._needsRefresh = true;
        }
    }
    
    async generateGlobalClusters(channelId) {
        // First generate local clusters
        const localClusters = this.generateLocalClusters(channelId);
        
        if (!redisConnected) {
            return localClusters;
        }
        
        try {
            // Get data from all instances
            const pattern = `clusters:${channelId}:*`;
            const keys = await redis.keys(pattern);
            
            const allInstanceData = [];
            const pipeline = redis.multi();
            
            for (const key of keys) {
                pipeline.get(key);
            }
            
            const results = await pipeline.exec();
            
            // Merge data from all instances
            const globalUserPositions = new Map();
            let totalUsers = 0;
            
            // Add local data
            const localData = this.localChannelData.get(channelId);
            if (localData) {
                for (const [userId, pos] of localData.userPositions.entries()) {
                    globalUserPositions.set(`${INSTANCE_ID}:${userId}`, pos);
                }
                totalUsers += localData.userPositions.size;
            }
            
            // Add remote data
            for (const result of results) {
                if (result[1]) { // Check if command succeeded
                    try {
                        const instanceData = JSON.parse(result[1]);
                        if (instanceData.instanceId !== INSTANCE_ID) {
                            // This is from another instance - we need to fetch its click data
                            const clickPattern = `clicks:${channelId}:*`;
                            const clickKeys = await redis.keys(clickPattern);
                            
                            // Sample some keys to avoid overwhelming Redis
                            const sampleSize = Math.min(500, clickKeys.length);
                            const sampledKeys = clickKeys.slice(0, sampleSize);
                            
                            const clickPipeline = redis.multi();
                            for (const clickKey of sampledKeys) {
                                clickPipeline.hGetAll(clickKey);
                            }
                            
                            const clickResults = await clickPipeline.exec();
                            
                            for (const clickResult of clickResults) {
                                if (clickResult[1] && clickResult[1].x && clickResult[1].y) {
                                    const uniqueKey = `${instanceData.instanceId}:${Date.now()}:${Math.random()}`;
                                    globalUserPositions.set(uniqueKey, {
                                        x: parseFloat(clickResult[1].x),
                                        y: parseFloat(clickResult[1].y),
                                        timestamp: parseInt(clickResult[1].timestamp)
                                    });
                                }
                            }
                        }
                    } catch (parseError) {
                        console.error('Parse error for instance data:', parseError);
                    }
                }
            }
            
            // Generate clusters from merged data
            const globalClusters = this.generateClustersFromPositions(
                Array.from(globalUserPositions.values()), 
                channelId
            );
            
            return globalClusters;
            
        } catch (error) {
            console.error('Global cluster generation error:', error);
            return localClusters;
        }
    }
    
    generateLocalClusters(channelId) {
        const data = this.localChannelData.get(channelId);
        if (!data || data.userPositions.size === 0) return [];
        
        const positions = Array.from(data.userPositions.values());
        return this.generateClustersFromPositions(positions, channelId);
    }
    
    generateClustersFromPositions(positions, channelId) {
        if (positions.length < 3) return [];
        
        const totalUsers = positions.length;
        
        // Ultra-simple grid-based clustering (optimized for autoscale)
        const gridSize = 15; // Slightly smaller grid for better clustering
        const grid = new Map();
        
        // Filter recent positions only
        const cutoff = Date.now() - AUTOSCALE_CONFIG.GLOBAL_DATA_TTL;
        const recentPositions = positions.filter(pos => 
            (pos.timestamp || Date.now()) > cutoff
        );
        
        if (recentPositions.length === 0) return [];
        
        // Assign to grid
        for (const pos of recentPositions) {
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
            .filter(cell => cell.count >= 2) // Lower threshold for autoscale
            .map((cell, index) => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / totalUsers) * 100),
                visualSize: Math.min(140, 35 + cell.count * 2),
                id: `auto_${channelId}_${index}_${Date.now()}`,
                instanceContribution: this.localChannelData.get(channelId)?.userPositions.size || 0
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, AUTOSCALE_CONFIG.MAX_CLUSTERS_PER_CHANNEL);
        
        // Mark top cluster
        if (clusters.length > 0) {
            clusters[0].isTop = true;
        }
        
        // Cache locally
        this.localClusters.set(channelId, clusters);
        
        return clusters;
    }
    
    async getHeatmapData(channelId) {
        const clusters = await this.generateGlobalClusters(channelId);
        const localData = this.localChannelData.get(channelId);
        
        return {
            clusters: clusters,
            totalClicks: localData?.totalClicks || 0,
            uniqueUsers: localData?.userPositions.size || 0,
            mode: redisConnected ? 'AUTOSCALE_SHARED' : 'AUTOSCALE_LOCAL',
            instanceId: INSTANCE_ID,
            timestamp: Date.now(),
            instanceCount: await this.getActiveInstanceCount(),
            globalUsers: await this.getGlobalUserCount(channelId)
        };
    }
    
    async getActiveInstanceCount() {
        if (!redisConnected) return 1;
        
        try {
            const keys = await redis.keys('heartbeat:*');
            return keys.length;
        } catch (error) {
            return 1;
        }
    }
    
    async getGlobalUserCount(channelId) {
        if (!redisConnected) {
            return this.localChannelData.get(channelId)?.userPositions.size || 0;
        }
        
        try {
            const keys = await redis.keys(`clicks:${channelId}:*`);
            return keys.length;
        } catch (error) {
            return this.localChannelData.get(channelId)?.userPositions.size || 0;
        }
    }
    
    performCleanup() {
        const now = Date.now();
        const cutoff = now - AUTOSCALE_CONFIG.GLOBAL_DATA_TTL;
        let cleaned = 0;
        
        // Clean local data
        for (const [channelId, data] of this.localChannelData.entries()) {
            const beforeSize = data.userPositions.size;
            
            for (const [userId, pos] of data.userPositions.entries()) {
                if (pos.timestamp < cutoff) {
                    data.userPositions.delete(userId);
                    cleaned++;
                }
            }
            
            // Remove empty channels
            if (data.userPositions.size === 0) {
                this.localChannelData.delete(channelId);
                this.localClusters.delete(channelId);
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned ${cleaned} old entries from local cache`);
        }
    }
    
    logPerformance() {
        const elapsed = Date.now() - this.lastReset;
        const currentRps = Math.round((this.requestCount * 1000) / elapsed);
        
        console.log(`🔄 AUTOSCALE Performance - Instance: ${INSTANCE_ID}`);
        console.log(`   RPS: ${currentRps}, Channels: ${this.localChannelData.size}, Redis Ops: ${this.redisOperations}`);
        console.log(`   Redis Connected: ${redisConnected}, Cache Hits: ${this.cacheHits}`);
        
        // Reset counters
        this.requestCount = 0;
        this.redisOperations = 0;
        this.cacheHits = 0;
        this.lastReset = Date.now();
    }
    
    clearAll() {
        this.localChannelData.clear();
        this.localClusters.clear();
        this.redisBatch = [];
        
        // Clear Redis data for this instance
        if (redisConnected) {
            redis.del(`heartbeat:${INSTANCE_ID}`).catch(err => {
                console.error('Error clearing heartbeat:', err);
            });
        }
        
        console.log('🧹 Autoscale state cleared');
    }
    
    getStats() {
        const elapsed = Date.now() - this.lastReset;
        const currentRps = Math.round((this.requestCount * 1000) / Math.max(elapsed, 1));
        
        return {
            instanceId: INSTANCE_ID,
            redisConnected: redisConnected,
            currentRps: currentRps,
            localChannels: this.localChannelData.size,
            localClusters: this.localClusters.size,
            redisBatchSize: this.redisBatch.length,
            redisOperations: this.redisOperations,
            cacheHits: this.cacheHits,
            uptime: Date.now() - this.instanceStartTime,
            memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        };
    }
}

// ========== INITIALIZE SYSTEM ==========
const sharedState = new AutoscaleSharedState();
let gameState = { running: false, version: 0 };

// Setup Redis
setupRedis();

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1kb' }));

// JWT verification (same as ultra version)
const jwtCache = new Map();
function verifyJWTFast(token) {
    const cached = jwtCache.get(token);
    if (cached && Date.now() - cached.timestamp < 300000) {
        return cached.payload;
    }
    
    try {
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        
        if (jwtCache.size >= 5000) {
            const oldestKey = jwtCache.keys().next().value;
            jwtCache.delete(oldestKey);
        }
        
        jwtCache.set(token, { payload, timestamp: Date.now() });
        return payload;
    } catch {
        return null;
    }
}

// ========== ENDPOINTS ==========

app.get('/health', (req, res) => {
    const stats = sharedState.getStats();
    res.json({
        status: 'autoscale-ready',
        ...stats,
        gameRunning: gameState.running,
        timestamp: Date.now()
    });
});

app.post('/click', async (req, res) => {
    if (!gameState.running) {
        return res.status(400).json({ success: false, error: 'Game not running' });
    }
    
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token' });
    }
    
    const payload = verifyJWTFast(token);
    if (!payload) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }
    
    const result = await sharedState.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    res.json({ 
        success: true, 
        mode: 'AUTOSCALE',
        instanceId: INSTANCE_ID,
        cached: result.cached
    });
});

app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel || 'default';
    const data = await sharedState.getHeatmapData(channelId);
    
    res.json({
        running: gameState.running,
        ...data,
        version: gameState.version
    });
});

app.post('/start', (req, res) => {
    sharedState.clearAll();
    gameState = { running: true, version: Date.now() };
    console.log('🚀 Autoscale game started');
    res.json({ success: true, version: gameState.version, mode: 'AUTOSCALE' });
});

app.post('/stop', (req, res) => {
    gameState = { running: false, version: Date.now() };
    console.log('⏹️ Autoscale game stopped');
    res.json({ success: true, version: gameState.version, mode: 'AUTOSCALE' });
});

app.post('/reset', (req, res) => {
    sharedState.clearAll();
    gameState.version = Date.now();
    console.log('🔄 Autoscale game reset');
    res.json({ success: true, version: gameState.version, mode: 'AUTOSCALE' });
});

// ========== WEBSOCKET WITH CONSISTENT DATA ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const wsClients = new Map();

let lastBroadcast = 0;

async function consistentBroadcast() {
    const now = Date.now();
    
    if (now - lastBroadcast < AUTOSCALE_CONFIG.BROADCAST_INTERVAL) {
        setTimeout(consistentBroadcast, AUTOSCALE_CONFIG.BROADCAST_INTERVAL);
        return;
    }
    
    lastBroadcast = now;
    
    for (const [channelId, clients] of wsClients.entries()) {
        if (clients.size === 0) continue;
        
        // Get GLOBAL data (merged from all instances)
        const data = await sharedState.getHeatmapData(channelId);
        
        const message = JSON.stringify({
            running: gameState.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.globalUsers, // Global user count
            version: gameState.version,
            timestamp: now,
            mode: data.mode,
            instanceCount: data.instanceCount
        });
        
        clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try { 
                    ws.send(message); 
                } catch {
                    clients.delete(ws);
                }
            }
        });
    }
    
    setTimeout(consistentBroadcast, AUTOSCALE_CONFIG.BROADCAST_INTERVAL);
}

consistentBroadcast();

wss.on('connection', (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
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

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🔄 AUTOSCALE-COMPATIBLE ClickMap Server');
    console.log(`🆔 Instance: ${INSTANCE_ID}`);
    console.log(`⚡ Port: ${PORT}`);
    console.log(`🔗 Redis: ${redisConnected ? 'Connected' : 'Disconnected (Local Mode)'}`);
    console.log('🔄 Autoscale Features:');
    console.log('  • Shared state across instances via Redis');
    console.log('  • Consistent cluster data for all users');
    console.log('  • Automatic instance discovery and sync');
    console.log('  • Graceful fallback to local mode');
    console.log('🎯 Ready for horizontal autoscaling');
});

process.on('SIGTERM', () => {
    console.log(`🔄 Shutting down autoscale instance ${INSTANCE_ID}...`);
    
    // Cleanup
    if (redisConnected && redis) {
        redis.del(`heartbeat:${INSTANCE_ID}`).catch(() => {});
        redis.disconnect();
    }
    if (redisPub) redisPub.disconnect();
    if (redisSub) redisSub.disconnect();
    
    httpServer.close(() => process.exit(0));
});

export default httpServer;
