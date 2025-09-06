import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// REDIS SETUP - Replace all in-memory storage
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 5000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

redis.on('error', (err) => console.error('Redis Client Error:', err));
redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

await redis.connect();

// REDIS GAME STATE MANAGER
class RedisGameState {
    constructor() {
        this.instanceId = process.env.RENDER_INSTANCE_ID || `instance-${Math.random().toString(36).substring(7)}`;
        console.log(`🏷️ Instance ID: ${this.instanceId}`);
    }

    async setRunning(running) {
        try {
            await redis.multi()
                .set('game:running', running.toString())
                .set('game:lastUpdate', Date.now().toString())
                .set(`game:lastModifiedBy`, this.instanceId)
                .exec();
            
            console.log(`🎮 Game state: ${running} (set by ${this.instanceId})`);
        } catch (error) {
            console.error('❌ Failed to set running state:', error);
            throw error;
        }
    }

    async isRunning() {
        try {
            const running = await redis.get('game:running');
            return running === 'true';
        } catch (error) {
            console.error('❌ Failed to get running state:', error);
            return false; // Fail safe
        }
    }

    async getLastUpdate() {
        try {
            const timestamp = await redis.get('game:lastUpdate');
            return timestamp ? parseInt(timestamp) : Date.now();
        } catch (error) {
            console.error('❌ Failed to get last update:', error);
            return Date.now();
        }
    }

    async getModifiedBy() {
        try {
            return await redis.get('game:lastModifiedBy') || 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    // CLICK DATA MANAGEMENT
    async addClick(channelId, userId, x, y) {
        try {
            const clickData = JSON.stringify({
                x: x,
                y: y,
                timestamp: Date.now(),
                instance: this.instanceId
            });

            // Store with 1 hour expiration to prevent memory bloat
            await redis.setex(`clicks:${channelId}:${userId}`, 3600, clickData);
            
            // Also increment total click counter for this channel
            await redis.incr(`stats:${channelId}:totalClicks`);
            await redis.expire(`stats:${channelId}:totalClicks`, 3600);

        } catch (error) {
            console.error('❌ Failed to add click:', error);
            throw error;
        }
    }

    async getChannelClicks(channelId) {
        try {
            const pattern = `clicks:${channelId}:*`;
            const keys = await redis.keys(pattern);
            
            if (keys.length === 0) {
                return new Map();
            }

            // Get all click data in one pipeline for efficiency
            const pipeline = redis.multi();
            keys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

            const clicks = new Map();
            keys.forEach((key, index) => {
                const userId = key.split(':')[2];
                const result = results[index];
                
                if (result && result[1]) { // Redis multi returns [error, result]
                    try {
                        const clickData = JSON.parse(result[1]);
                        clicks.set(userId, clickData);
                    } catch (parseError) {
                        console.error(`Failed to parse click data for ${userId}:`, parseError);
                    }
                }
            });

            return clicks;
        } catch (error) {
            console.error('❌ Failed to get channel clicks:', error);
            return new Map();
        }
    }

    async getAllChannelClicks() {
        try {
            const pattern = 'clicks:*';
            const keys = await redis.keys(pattern);
            
            if (keys.length === 0) {
                return new Map();
            }

            // Group keys by channel
            const channelGroups = new Map();
            keys.forEach(key => {
                const parts = key.split(':');
                const channelId = parts[1];
                const userId = parts[2];
                
                if (!channelGroups.has(channelId)) {
                    channelGroups.set(channelId, []);
                }
                channelGroups.get(channelId).push({ key, userId });
            });

            // Get all data in one pipeline
            const pipeline = redis.multi();
            keys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

            // Organize by channel
            const allClicks = new Map();
            let resultIndex = 0;

            for (const [channelId, channelKeys] of channelGroups.entries()) {
                const channelClicks = new Map();
                
                channelKeys.forEach(({ userId }) => {
                    const result = results[resultIndex++];
                    if (result && result[1]) {
                        try {
                            const clickData = JSON.parse(result[1]);
                            channelClicks.set(userId, clickData);
                        } catch (parseError) {
                            console.error(`Failed to parse click data for ${userId}:`, parseError);
                        }
                    }
                });

                if (channelClicks.size > 0) {
                    allClicks.set(channelId, channelClicks);
                }
            }

            return allClicks;
        } catch (error) {
            console.error('❌ Failed to get all clicks:', error);
            return new Map();
        }
    }

    async clearAllClicks() {
        try {
            const clickKeys = await redis.keys('clicks:*');
            const statKeys = await redis.keys('stats:*');
            const allKeys = [...clickKeys, ...statKeys];
            
            if (allKeys.length > 0) {
                await redis.del(allKeys);
                console.log(`🗑️ Cleared ${allKeys.length} click records (by ${this.instanceId})`);
            }
        } catch (error) {
            console.error('❌ Failed to clear clicks:', error);
            throw error;
        }
    }

    async getStats() {
        try {
            const channels = await redis.keys('stats:*:totalClicks');
            const stats = {
                totalChannels: 0,
                totalClicks: 0,
                channelBreakdown: []
            };

            if (channels.length === 0) {
                return stats;
            }

            const pipeline = redis.multi();
            channels.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

            channels.forEach((key, index) => {
                const channelId = key.split(':')[1];
                const result = results[index];
                const clicks = result && result[1] ? parseInt(result[1]) : 0;
                
                stats.totalChannels++;
                stats.totalClicks += clicks;
                stats.channelBreakdown.push({ channel: channelId, clicks });
            });

            return stats;
        } catch (error) {
            console.error('❌ Failed to get stats:', error);
            return { totalChannels: 0, totalClicks: 0, channelBreakdown: [] };
        }
    }

    async getInstanceInfo() {
        try {
            const modifiedBy = await this.getModifiedBy();
            const lastUpdate = await this.getLastUpdate();
            
            return {
                instanceId: this.instanceId,
                lastModifiedBy: modifiedBy,
                lastUpdate: lastUpdate,
                uptime: process.uptime(),
                pid: process.pid
            };
        } catch (error) {
            return {
                instanceId: this.instanceId,
                error: error.message
            };
        }
    }
}

// Initialize Redis game state
const gameState = new RedisGameState();

// Real-time performance monitoring
const PERFORMANCE_MONITORING = process.env.NODE_ENV !== 'production';
const performanceStats = {
    clickProcessingTimes: [],
    broadcastTimes: [],
    clusterCalculationTimes: [],
    totalRequests: 0,
    redisOperations: 0,
    startTime: Date.now()
};

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add WebSocket headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, UPGRADE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [${gameState.instanceId}]`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Enhanced health check with Redis status
app.get('/health', async (req, res) => {
    console.log('🏥 Health check called');
    
    try {
        const uptime = Date.now() - performanceStats.startTime;
        const instanceInfo = await gameState.getInstanceInfo();
        const stats = await gameState.getStats();
        const isRunning = await gameState.isRunning();
        
        // Test Redis connectivity
        const redisHealth = await redis.ping();
        
        res.json({
            status: 'ok',
            running: isRunning,
            timestamp: Date.now(),
            version: '4.3.0-redis-scale',
            uptime: Math.floor(uptime / 1000),
            instance: instanceInfo,
            redis: {
                connected: redisHealth === 'PONG',
                operations: performanceStats.redisOperations
            },
            websocket: {
                enabled: !!wss,
                clients: wss ? wss.clients.size : 0,
                channels: connectedClients.size,
                connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                    channel,
                    count: clients.size
                }))
            },
            performance: PERFORMANCE_MONITORING ? {
                totalRequests: performanceStats.totalRequests,
                redisOperations: performanceStats.redisOperations,
                requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100
            } : undefined,
            game_data: stats
        });
    } catch (error) {
        console.error('❌ Health check error:', error);
        res.status(500).json({
            status: 'error',
            error: error.message,
            instance: gameState.instanceId
        });
    }
});

// START endpoint with Redis
app.post('/start', async (req, res) => {
    console.log(`🚀 START endpoint called [${gameState.instanceId}]`);

    try {
        await gameState.setRunning(true);
        await gameState.clearAllClicks();
        
        console.log('✅ Game started successfully (REDIS)');

        // Broadcast to all connected clients
        broadcastToAll({
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start'
        });

        const instanceInfo = await gameState.getInstanceInfo();

        res.json({
            success: true,
            status: 'started',
            running: true,
            timestamp: Date.now(),
            instance: instanceInfo
        });

    } catch (error) {
        console.error('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session',
            details: error.message
        });
    }
});

// STOP endpoint with Redis
app.post('/stop', async (req, res) => {
    console.log(`⏹️ STOP endpoint called [${gameState.instanceId}]`);

    try {
        await gameState.setRunning(false);
        
        console.log('✅ Game stopped successfully (REDIS)');

        const currentData = await getCurrentHeatmapData('all');
        currentData.running = false;
        currentData.action = 'stop';

        broadcastToAll(currentData);

        const instanceInfo = await gameState.getInstanceInfo();

        res.json({
            success: true,
            status: 'stopped',
            running: false,
            timestamp: Date.now(),
            instance: instanceInfo
        });

    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session',
            details: error.message
        });
    }
});

// RESET endpoint with Redis
app.post('/reset', async (req, res) => {
    console.log(`🗑️ RESET endpoint called [${gameState.instanceId}]`);

    try {
        await gameState.clearAllClicks();
        
        console.log('✅ Data reset successfully (REDIS)');

        const isRunning = await gameState.isRunning();

        broadcastToAll({
            running: isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset'
        });

        const instanceInfo = await gameState.getInstanceInfo();

        res.json({
            success: true,
            status: 'reset',
            running: isRunning,
            timestamp: Date.now(),
            instance: instanceInfo
        });

    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data',
            details: error.message
        });
    }
});

// Real-time optimized click handling with Redis
app.post('/click', async (req, res) => {
    const startTime = performance.now();
    console.log(`🖱️ CLICK endpoint called - REDIS MODE [${gameState.instanceId}]`);

    try {
        performanceStats.totalRequests++;

        const isRunning = await gameState.isRunning();
        if (!isRunning) {
            console.log('   ❌ Game not running (Redis check)');
            return res.status(400).json({
                success: false,
                error: 'Game not running'
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log('   ❌ No token provided');
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`   ❌ Invalid coordinates: (${x}, ${y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click in Redis
        const clickProcessStart = performance.now();
        await gameState.addClick(channelId, uid, x, y);
        performanceStats.redisOperations++;
        
        const clickProcessTime = performance.now() - clickProcessStart;
        
        console.log(`✅ Click stored in Redis: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)}) in ${clickProcessTime.toFixed(2)}ms`);

        // Real-time broadcast
        const broadcastStart = performance.now();
        const updatedData = await getCurrentHeatmapData(channelId);
        const calculationTime = performance.now() - broadcastStart;
        
        console.log(`   📊 Cluster calculation: ${updatedData.clusters.length} clusters in ${calculationTime.toFixed(2)}ms`);
        
        const wsStart = performance.now();
        broadcastToChannel(channelId, updatedData);
        const broadcastTime = performance.now() - wsStart;
        
        console.log(`   📡 Real-time broadcast: ${broadcastTime.toFixed(2)}ms to channel ${channelId}`);

        // Performance monitoring
        const totalTime = performance.now() - startTime;
        if (PERFORMANCE_MONITORING) {
            performanceStats.clickProcessingTimes.push(totalTime);
            performanceStats.broadcastTimes.push(broadcastTime);
            performanceStats.clusterCalculationTimes.push(calculationTime);
            
            // Keep only last 100 measurements
            if (performanceStats.clickProcessingTimes.length > 100) {
                performanceStats.clickProcessingTimes.shift();
                performanceStats.broadcastTimes.shift();
                performanceStats.clusterCalculationTimes.shift();
            }
        }

        const channelClicks = await gameState.getChannelClicks(channelId);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: channelClicks.size,
            channelId: channelId,
            instance: gameState.instanceId,
            performance: PERFORMANCE_MONITORING ? {
                processingTime: totalTime,
                calculationTime: calculationTime,
                broadcastTime: broadcastTime,
                redisTime: clickProcessTime
            } : undefined
        });

        console.log(`🚀 REDIS click processing completed in ${totalTime.toFixed(2)}ms`);

    } catch (error) {
        console.error('❌ Click error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token or request',
            details: error.message
        });
    }
});

// Enhanced heatmap endpoint with Redis data
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}% [${gameState.instanceId}]`);

    try {
        const data = await getCurrentHeatmapData(channelId, threshold);

        if (data.totalClicks > 0) {
            console.log(`✅ Heatmap from Redis: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
        }

        res.json(data);

    } catch (error) {
        console.error('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data',
            details: error.message
        });
    }
});

// Get current heatmap data from Redis
async function getCurrentHeatmapData(channelId, threshold = 3) {
    try {
        const isRunning = await gameState.isRunning();
        const lastUpdate = await gameState.getLastUpdate();
        
        if (!channelId || channelId === 'all') {
            // Get all channels
            const allChannelData = await gameState.getAllChannelClicks();
            let allPoints = [];
            let totalClicks = 0;
            let totalUsers = 0;

            for (const [channel, channelClicks] of allChannelData.entries()) {
                totalClicks += channelClicks.size;
                totalUsers += channelClicks.size;

                Array.from(channelClicks.values()).forEach(point => {
                    allPoints.push(point);
                });
            }

            const clusters = processClicksIntoVisualClusters(allPoints, threshold);

            return {
                running: isRunning,
                clusters,
                totalClicks,
                uniqueUsers: totalUsers,
                coverage: Math.min(100, clusters.length * 10),
                threshold,
                lastUpdate,
                instance: gameState.instanceId
            };
        }

        // Handle specific channel
        const channelClicks = await gameState.getChannelClicks(channelId);

        if (!channelClicks || channelClicks.size === 0) {
            return {
                running: isRunning,
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                coverage: 0,
                threshold,
                lastUpdate,
                instance: gameState.instanceId
            };
        }

        const points = Array.from(channelClicks.values());
        const clusters = processClicksIntoVisualClusters(points, threshold);

        console.log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

        return {
            running: isRunning,
            clusters,
            totalClicks: points.length,
            uniqueUsers: channelClicks.size,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate,
            instance: gameState.instanceId
        };
    } catch (error) {
        console.error('❌ Failed to get heatmap data:', error);
        return {
            running: false,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: Date.now(),
            instance: gameState.instanceId,
            error: error.message
        };
    }
}

// [Include your existing clustering functions here - processClicksIntoVisualClusters, etc.]
// They remain the same, just working with data from Redis instead of memory

// WebSocket broadcasting functions (unchanged)
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(data);
    let sentCount = 0;
    let failedCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('WebSocket send error:', error);
                clients.delete(ws);
                failedCount++;
            }
        } else {
            clients.delete(ws);
            failedCount++;
        }
    });

    if (sentCount > 0) {
        console.log(`📡 Redis broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} clusters`);
        if (failedCount > 0) {
            console.log(`   ⚠️ Cleaned up ${failedCount} stale connections`);
        }
    }
}

function broadcastToAll(data) {
    let totalSent = 0;
    connectedClients.forEach(async (clients, channelId) => {
        const channelData = channelId === 'all' ? data : await getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
    });

    if (totalSent > 0) {
        console.log(`📡 Redis broadcast to all: ${totalSent} clients`);
    }
}

// [Include the rest of your WebSocket server setup and clustering functions]

console.log('🚀 ClickMap EBS v4.3.0 REDIS SCALE - Multi-instance ready!');
console.log(`📡 Instance ID: ${gameState.instanceId}`);
console.log(`🔗 Redis connected: ${redis.isReady}`);
console.log(`💾 All state now persisted in Redis for scaling`);

export default httpServer;
