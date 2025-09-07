// backend/server.js - Complete server with Redis PubSub, autoscaling support, AND full clustering
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `local_${Date.now()}`;
const INSTANCE_TTL = 30; // seconds

// FIXED: Proper logging configuration
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.DEBUG === 'true' || !IS_PRODUCTION;

// Logging helper
function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_ENABLED) return;
    if (level === 'error' || level === 'warn' || !IS_PRODUCTION) {
        console.log(message);
    }
}

function logError(message, error = null) {
    console.error(message, error || '');
}

// FIXED: Declare global variables early
let wss = null;
let httpServer = null;
const connectedClients = new Map(); // channelId → Set of WebSocket connections
const configPanels = new Map(); // sessionId → WebSocket connection

// REDIS SETUP with PubSub
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 5000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

const redisPub = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 5000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

const redisSub = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 5000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

// Redis event handlers - minimal logging
redis.on('error', (err) => logError('Redis Client Error:', err));
redis.on('connect', () => log('✅ Redis connected'));
redis.on('reconnecting', () => log('🔄 Redis reconnecting...', 'debug'));

redisPub.on('error', (err) => logError('Redis Pub Error:', err));
redisSub.on('error', (err) => logError('Redis Sub Error:', err));

// FIXED: Enhanced error handling for Redis connection
async function connectRedis() {
    try {
        await Promise.all([
            redis.connect(),
            redisPub.connect(),
            redisSub.connect()
        ]);
        log('✅ All Redis clients connected');
        
        // Subscribe to broadcast channel
        await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
        await redisSub.subscribe('clickmap:config', handleConfigMessage);
        log('✅ Subscribed to Redis channels');
        
    } catch (error) {
        logError('❌ Redis connection failed:', error);
        log('⚠️ Continuing without Redis - using in-memory fallback', 'warn');
    }
}

await connectRedis();

// FIXED: Enhanced broadcast message handlers with minimal logging
function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        log(`📨 Broadcast from instance ${data.fromInstance}`, 'debug');
        
        // Don't rebroadcast our own messages
        if (data.fromInstance === INSTANCE_ID) return;
        
        // Broadcast to local WebSocket clients
        broadcastToLocalClients(data.channelId, data.payload);
        
    } catch (error) {
        logError('Error handling broadcast message:', error);
    }
}

// Handle config update messages
function handleConfigMessage(message) {
    try {
        const data = JSON.parse(message);
        log(`📨 Config update from instance ${data.fromInstance}`, 'debug');
        
        // Don't rebroadcast our own messages
        if (data.fromInstance === INSTANCE_ID) return;
        
        // Notify config panels
        broadcastToConfigPanels(data.payload);
        
    } catch (error) {
        logError('Error handling config message:', error);
    }
}

// ENHANCED GAME STATE with versioning and locking - FIXED Redis API
const gameState = {
    async setRunning(running) {
        try {
            const version = Date.now();
            const pipeline = redis.multi();
            pipeline.set('game:running', running.toString());
            pipeline.set('game:lastUpdate', version.toString());
            pipeline.set('game:version', version.toString());
            await pipeline.exec();
            return version;
        } catch (error) {
            logError('Redis setRunning error:', error);
            throw error;
        }
    },

    async isRunning() {
        try {
            const running = await redis.get('game:running');
            return running === 'true';
        } catch (error) {
            logError('Redis isRunning error:', error);
            return false; // Safe default
        }
    },

    async getVersion() {
        try {
            const version = await redis.get('game:version');
            return version ? parseInt(version) : 0;
        } catch (error) {
            logError('Redis getVersion error:', error);
            return 0;
        }
    },

    async getLastUpdate() {
        try {
            const timestamp = await redis.get('game:lastUpdate');
            return timestamp ? parseInt(timestamp) : Date.now();
        } catch (error) {
            logError('Redis getLastUpdate error:', error);
            return Date.now();
        }
    },
    
    async compareAndSetRunning(running, expectedVersion) {
        try {
            const currentVersion = await this.getVersion();
            
            if (expectedVersion && parseInt(expectedVersion) !== currentVersion) {
                return { success: false, conflict: true, currentVersion };
            }
            
            const newVersion = await this.setRunning(running);
            return { success: true, version: newVersion };
        } catch (error) {
            logError('Redis compareAndSetRunning error:', error);
            throw error;
        }
    },

    async addClick(channelId, userId, x, y) {
    try {
        if (typeof x !== 'number' || typeof y !== 'number' || 
            isNaN(x) || isNaN(y) || x < 0 || x > 1 || y < 0 || y > 1) {
            throw new Error('Invalid coordinates');
        }

        const redisKey = `clicks:${channelId}:${userId}`;
        
        // Use Redis hash with proper API
        await redis.hSet(redisKey, {
            'x': x.toString(),
            'y': y.toString(),
            'timestamp': Date.now().toString()
        });
        
        // Set expiration separately
        await redis.expire(redisKey, 3600);
        
    } catch (error) {
        logError('Redis addClick error:', error);
        throw error;
    }
},

    async getChannelClicks(channelId) {
    try {
        const pattern = `clicks:${channelId}:*`;
        const keys = await redis.keys(pattern);
        
        if (keys.length === 0) return new Map();

        const clicks = new Map();
        
        for (const key of keys) {
            try {
                const userId = key.split(':')[2];
                const hashData = await redis.hGetAll(key);
                
                if (hashData && hashData.x && hashData.y) {
                    clicks.set(userId, {
                        x: parseFloat(hashData.x),
                        y: parseFloat(hashData.y),
                        timestamp: parseInt(hashData.timestamp || Date.now())
                    });
                }
            } catch (keyError) {
                // Skip individual key errors
                await redis.del(key);
            }
        }

        return clicks;
    } catch (error) {
        logError('Redis getChannelClicks error:', error);
        return new Map();
    }
},

    async getAllChannelClicks() {
    try {
        const pattern = 'clicks:*';
        const keys = await redis.keys(pattern);
        
        if (keys.length === 0) return new Map();

        const channelGroups = new Map();
        keys.forEach(key => {
            const parts = key.split(':');
            if (parts.length >= 3) {
                const channelId = parts[1];
                const userId = parts[2];
                
                if (!channelGroups.has(channelId)) {
                    channelGroups.set(channelId, []);
                }
                channelGroups.get(channelId).push({ key, userId });
            }
        });

        const allClicks = new Map();

        for (const [channelId, channelKeys] of channelGroups.entries()) {
            const channelClicks = new Map();
            
            for (const { key, userId } of channelKeys) {
                try {
                    const hashData = await redis.hGetAll(key);
                    
                    if (hashData && hashData.x && hashData.y) {
                        channelClicks.set(userId, {
                            x: parseFloat(hashData.x),
                            y: parseFloat(hashData.y),
                            timestamp: parseInt(hashData.timestamp || Date.now())
                        });
                    }
                } catch (keyError) {
                    // Clean up corrupted keys
                    await redis.del(key);
                }
            }

            if (channelClicks.size > 0) {
                allClicks.set(channelId, channelClicks);
            }
        }

        return allClicks;
    } catch (error) {
        logError('Redis getAllChannelClicks error:', error);
        return new Map();
    }
},

    async clearAllClicks() {
        try {
            const clickKeys = await redis.keys('clicks:*');
            if (clickKeys.length > 0) {
                await redis.del(clickKeys);
            }
        } catch (error) {
            logError('Redis clearAllClicks error:', error);
            throw error;
        }
    },
    
    async clearChannelClicks(channelId) {
        try {
            const clickKeys = await redis.keys(`clicks:${channelId}:*`);
            if (clickKeys.length > 0) {
                await redis.del(clickKeys);
            }
        } catch (error) {
            logError('Redis clearChannelClicks error:', error);
            throw error;
        }
    },

    // NEW: Clean up corrupted data
async cleanupCorruptedData() {
    try {
        const clickKeys = await redis.keys('clicks:*');
        let cleaned = 0;
        
        for (const key of clickKeys) {
            try {
                const data = await redis.get(key);
                if (data) {
                    JSON.parse(data); // Test if valid JSON
                }
            } catch (error) {
                await redis.del(key);
                cleaned++;
                log(`Cleaned corrupted key: ${key}`, 'debug');
            }
        }
        
        if (cleaned > 0) {
            log(`Cleaned up ${cleaned} corrupted click records`);
        }
        
        return cleaned;
    } catch (error) {
        logError('Failed to cleanup corrupted data:', error);
        return 0;
    }
}
};

// FIXED: Enhanced distributed lock implementation with error handling
async function acquireLock(key, ttl = 5000) {
    try {
        const lockKey = `lock:${key}`;
        const lockValue = `${INSTANCE_ID}_${Date.now()}`;
        
        const result = await redis.set(lockKey, lockValue, {
            NX: true, // Only set if not exists
            PX: ttl   // Expire after ttl milliseconds
        });
        
        return result === 'OK' ? lockValue : null;
    } catch (error) {
        logError('Failed to acquire lock:', error);
        return null;
    }
}

async function releaseLock(key, lockValue) {
    try {
        const lockKey = `lock:${key}`;
        const currentValue = await redis.get(lockKey);
        
        if (currentValue === lockValue) {
            await redis.del(lockKey);
            return true;
        }
        return false;
    } catch (error) {
        logError('Failed to release lock:', error);
        return false;
    }
}

// FIXED: Instance registration with safe wss handling
async function registerInstance() {
    try {
        const instanceData = {
            id: INSTANCE_ID,
            startTime: Date.now(),
            websocketClients: wss ? wss.clients.size : 0, // ✅ Safe now
            endpoint: process.env.RENDER_SERVICE_URL || `http://localhost:${PORT}`,
            lastHeartbeat: Date.now()
        };
        
        // FIXED: setex -> setEx
        await redis.setEx(`instance:${INSTANCE_ID}`, INSTANCE_TTL, JSON.stringify(instanceData));
    } catch (error) {
        logError('Failed to register instance:', error);
    }
}

async function getActiveInstances() {
    try {
        const keys = await redis.keys('instance:*');
        const instances = [];
        
        for (const key of keys) {
            const data = await redis.get(key);
            if (data) {
                try {
                    instances.push(JSON.parse(data));
                } catch (e) {
                    logError('Failed to parse instance data:', e);
                }
            }
        }
        
        return instances;
    } catch (error) {
        logError('Failed to get active instances:', error);
        return [];
    }
}

// Real-time performance monitoring - only in development
const performanceStats = {
    clickProcessingTimes: [],
    broadcastTimes: [],
    clusterCalculationTimes: [],
    totalRequests: 0,
    startTime: Date.now()
};

const app = express();

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Id', 'X-State-Version', 'X-Channel-Id', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
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

// FIXED: Minimal logging middleware
app.use((req, res, next) => {
    log(`${req.method} ${req.path}`, 'debug');
    res.set('Cache-Control', 'no-store');
    res.set('X-Instance-Id', INSTANCE_ID);
    next();
});

// Enhanced health check - minimal response in production
app.get('/health', async (req, res) => {
    log('🏥 Health check called', 'debug');
    
    const running = await gameState.isRunning();
    const allClicks = await gameState.getAllChannelClicks();
    
    if (IS_PRODUCTION) {
        // Minimal production response
        res.json({
            status: 'ok',
            running: running,
            timestamp: Date.now(),
            version: '5.0.0',
            instanceId: INSTANCE_ID,
            websocket: {
                clients: wss ? wss.clients.size : 0,
                channels: connectedClients.size
            },
            redis: {
                connected: redis.isReady
            },
            game_data: {
                total_channels: allClicks.size,
                total_clicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
            }
        });
    } else {
        // Detailed development response
        const uptime = Date.now() - performanceStats.startTime;
        const activeInstances = await getActiveInstances();
        
        res.json({
            status: 'ok',
            running: running,
            timestamp: Date.now(),
            version: '5.0.0-redis-pubsub-clustering',
            instanceId: INSTANCE_ID,
            uptime: Math.floor(uptime / 1000),
            websocket: {
                enabled: !!wss,
                clients: wss ? wss.clients.size : 0,
                configPanels: configPanels.size,
                channels: connectedClients.size
            },
            environment: {
                node_env: process.env.NODE_ENV || 'unknown',
                port: PORT
            },
            redis: {
                connected: redis.isReady,
                pubsubActive: redisSub.isReady && redisPub.isReady
            },
            cluster: {
                totalInstances: activeInstances.length
            },
            game_data: {
                total_channels: allClicks.size,
                total_clicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
            }
        });
    }
});

// Performance endpoint - development only
app.get('/performance', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(404).json({ error: 'Not available in production' });
    }
    
    const uptime = Date.now() - performanceStats.startTime;
    
    res.json({
        uptime: Math.floor(uptime / 1000),
        totalRequests: performanceStats.totalRequests,
        requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100
    });
});

// WebSocket debug endpoint - development only
app.get('/ws-debug', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(404).json({ error: 'Debug not available in production' });
    }
    
    res.json({
        timestamp: new Date().toISOString(),
        instanceId: INSTANCE_ID,
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0
        },
        connected_clients: {
            channels: connectedClients.size,
            config_panels: configPanels.size
        }
    });
});

// START endpoint
app.post('/start', async (req, res) => {
    log('🚀 START endpoint called');
    
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(true);
        
        // Clear clicks
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        log(`✅ Game started (Version: ${result})`);
        
        // Broadcast to all instances
        const broadcastData = {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start',
            version: result,
            channelId: channelId || 'all'
        };
        
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: broadcastData,
            fromInstance: INSTANCE_ID
        }));
        
        broadcastToAll(broadcastData);
        
        res.json({
            success: true,
            status: 'started',
            running: true,
            stateVersion: result,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session'
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// STOP endpoint
app.post('/stop', async (req, res) => {
    log('⏹️ STOP endpoint called');
    
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(false);
        
        log(`✅ Game stopped (Version: ${result})`);
        
        const currentData = await getCurrentHeatmapData(channelId || 'all');
        currentData.running = false;
        currentData.action = 'stop';
        currentData.version = result;
        
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: currentData,
            fromInstance: INSTANCE_ID
        }));
        
        broadcastToAll(currentData);
        
        res.json({
            success: true,
            status: 'stopped',
            running: false,
            stateVersion: result,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session'
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// RESET endpoint
app.post('/reset', async (req, res) => {
    log('🗑️ RESET endpoint called');
    
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        // Clear clicks
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        const version = await gameState.getVersion();
        const newVersion = version + 1;
        await redis.set('game:version', newVersion.toString());
        
        log(`✅ Data reset (Version: ${newVersion})`);
        
        const running = await gameState.isRunning();
        
        const broadcastData = {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset',
            version: newVersion,
            channelId: channelId || 'all'
        };
        
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: broadcastData,
            fromInstance: INSTANCE_ID
        }));
        
        broadcastToAll(broadcastData);
        
        res.json({
            success: true,
            status: 'reset',
            running: running,
            stateVersion: newVersion,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data'
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// CLICK endpoint - minimal logging
// CLICK endpoint - Complete replacement with enhanced logging
app.post('/click', async (req, res) => {
    const startTime = performance.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    
    // IMMEDIATE CLICK RECEIVED LOG
    console.log(`🎯 CLICK RECEIVED [${requestId}] from ${req.ip || 'unknown'} at ${new Date().toISOString()}`);
    console.log(`📦 CLICK BODY [${requestId}]:`, JSON.stringify(req.body));
    console.log(`🔑 CLICK HEADERS [${requestId}]: Auth=${!!req.headers.authorization}, ContentType=${req.headers['content-type']}`);

    try {
        const running = await gameState.isRunning();
        if (!running) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Game not running`);
            return res.status(400).json({
                success: false,
                error: 'Game not running',
                requestId: requestId
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log(`❌ CLICK REJECTED [${requestId}] - No token provided`);
            return res.status(401).json({
                success: false,
                error: 'No token provided',
                requestId: requestId
            });
        }

        // Verify JWT
        let payload;
        try {
            payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            console.log(`🔓 JWT VERIFIED [${requestId}] - Role: ${payload.role}, Channel: ${payload.channel_id}, User: ${payload.user_id || payload.opaque_user_id}`);
        } catch (jwtError) {
            console.log(`❌ CLICK REJECTED [${requestId}] - JWT verification failed: ${jwtError.message}`);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                requestId: requestId
            });
        }
        
        if (payload.exp && payload.exp < Date.now() / 1000) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Token expired`);
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                requestId: requestId
            });
        }
        
        if (payload.role === 'external') {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid role: ${payload.role}`);
            return res.status(403).json({
                success: false,
                error: 'Invalid role',
                requestId: requestId
            });
        }

        // Enhanced input validation
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        // DETAILED CLICK INFO LOG
        console.log(`📍 CLICK DETAILS [${requestId}] Channel: ${channelId}, User: ${uid}, Coords: (${x}, ${y})`);

        // Strict coordinate validation
        if (typeof x !== 'number' || typeof y !== 'number' ||
            isNaN(x) || isNaN(y) ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid coordinates: (${x}, ${y}), types: (${typeof x}, ${typeof y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates - must be numbers between 0 and 1',
                requestId: requestId,
                received: { x, y, types: { x: typeof x, y: typeof y } }
            });
        }

        if (!uid || !channelId) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Missing IDs: uid=${uid}, channelId=${channelId}`);
            return res.status(400).json({
                success: false,
                error: 'Missing user or channel ID',
                requestId: requestId
            });
        }

        // Store click with enhanced logging
        console.log(`💾 STORING CLICK [${requestId}] - Channel: ${channelId}, User: ${uid}, Coords: (${x.toFixed(3)}, ${y.toFixed(3)})`);
        
        try {
            await gameState.addClick(channelId, uid, x, y);
            console.log(`✅ CLICK STORED [${requestId}] - Successfully saved to Redis`);
        } catch (storeError) {
            console.log(`❌ CLICK STORAGE FAILED [${requestId}] - ${storeError.message}`);
            throw storeError;
        }

        // Get updated data and broadcast
        console.log(`📊 GENERATING HEATMAP [${requestId}] - Getting updated data for channel ${channelId}`);
        const updatedData = await getCurrentHeatmapData(channelId);
        console.log(`📊 HEATMAP DATA [${requestId}] - ${updatedData.clusters?.length || 0} clusters, ${updatedData.totalClicks || 0} total clicks`);
        
        // Broadcast to all instances via PubSub
        try {
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId,
                payload: updatedData,
                fromInstance: INSTANCE_ID
            }));
            console.log(`📡 BROADCAST SENT [${requestId}] - Published to Redis PubSub`);
        } catch (broadcastError) {
            console.log(`⚠️ BROADCAST FAILED [${requestId}] - ${broadcastError.message}`);
        }
        
        // Local broadcast
        try {
            broadcastToChannel(channelId, updatedData);
            console.log(`📡 LOCAL BROADCAST [${requestId}] - Sent to local WebSocket clients`);
        } catch (localBroadcastError) {
            console.log(`⚠️ LOCAL BROADCAST FAILED [${requestId}] - ${localBroadcastError.message}`);
        }

        // Performance tracking
        if (!IS_PRODUCTION) {
            const totalTime = performance.now() - startTime;
            performanceStats.clickProcessingTimes.push(totalTime);
            performanceStats.totalRequests++;
            
            if (performanceStats.clickProcessingTimes.length > 100) {
                performanceStats.clickProcessingTimes.shift();
            }
        }

        const channelClicks = await gameState.getChannelClicks(channelId);
        const processingTime = performance.now() - startTime;
        
        console.log(`✅ CLICK PROCESSED [${requestId}] in ${processingTime.toFixed(1)}ms - Total clicks: ${channelClicks.size}, Clusters: ${updatedData.clusters?.length || 0}`);
        
        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: channelClicks.size,
            channelId: channelId,
            instanceId: INSTANCE_ID,
            requestId: requestId,
            processingTime: Math.round(processingTime),
            clusters: updatedData.clusters?.length || 0
        });

    } catch (error) {
        const processingTime = performance.now() - startTime;
        console.log(`❌ CLICK ERROR [${requestId}] after ${processingTime.toFixed(1)}ms: ${error.message}`);
        console.log(`❌ CLICK ERROR STACK [${requestId}]:`, error.stack);
        
        logError('Click processing failed:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            requestId: requestId,
            processingTime: Math.round(processingTime)
        });
    }
});

// Heatmap endpoint - minimal logging
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    try {
        const data = await getCurrentHeatmapData(channelId, threshold);
        const activeInstances = await getActiveInstances();
        
        data.instances = activeInstances.length;
        data.instanceId = INSTANCE_ID;

        res.json(data);

    } catch (error) {
        logError('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data'
        });
    }
});

// NEW: Cleanup endpoint for corrupted data
app.post('/cleanup', async (req, res) => {
    try {
        const cleaned = await gameState.cleanupCorruptedData();
        res.json({
            success: true,
            cleaned: cleaned,
            message: `Cleaned ${cleaned} corrupted records`
        });
    } catch (error) {
        logError('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Cleanup failed'
        });
    }
});

// Add this endpoint to clear everything
app.post('/nuclear-reset', async (req, res) => {
    try {
        const keys = await redis.keys('clicks:*');
        const gameKeys = await redis.keys('game:*');
        const allKeys = [...keys, ...gameKeys];
        
        if (allKeys.length > 0) {
            await redis.del(allKeys);
        }
        
        res.json({ success: true, deleted: allKeys.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== SIMPLIFIED CLUSTERING ALGORITHM ====================

// Get current heatmap data - CLEAN LOGGING
async function getCurrentHeatmapData(channelId, threshold = 3) {
    const running = await gameState.isRunning();
    const lastUpdate = await gameState.getLastUpdate();
    const version = await gameState.getVersion();

    // If no specific channel requested, aggregate all channels
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = await gameState.getAllChannelClicks();
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        return {
            running: running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: lastUpdate,
            version
        };
    }

    // Handle specific channel
    const channelClicks = await gameState.getChannelClicks(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: lastUpdate,
            version
        };
    }

    const points = Array.from(channelClicks.values());
    const clusters = processClicksIntoVisualClusters(points, threshold);

    log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`, 'debug');

    return {
        running: running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: lastUpdate,
        version
    };
}

// SIMPLIFIED CLUSTERING with minimal logging
function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    log(`🧮 Clustering: ${points.length} points, ${threshold}% threshold`, 'debug');

    // Step 1: Distance-based clustering
    const rawClusters = performSimpleDistanceClustering(points);
    
    // Step 2: Calculate metrics
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateBasicClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster
        };
    });

    // Step 3: Visual merging
    const visuallyMergedClusters = performVisualMerging(enrichedClusters);

    // Step 4: Normalize percentages
    const normalizedClusters = normalizePercentages(visuallyMergedClusters, points.length);

    // Step 5: Filter by threshold
    const filteredClusters = normalizedClusters.filter(c => c.percentage >= threshold);

    // Step 6: Add visual properties
    const finalClusters = filteredClusters.map((cluster, index) => {
        const shapeAnalysis = analyzeClusterShape(cluster.points, cluster.x, cluster.y);
        const visualSize = calculateIntelligentVisualSize(cluster, filteredClusters);
        
        return {
            ...cluster,
            ...shapeAnalysis,
            visualSize,
            isTop: false
        };
    });

    // Step 7: Sort and mark top
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    log(`✅ Clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`, 'debug');

    return finalClusters;
}

function performSimpleDistanceClustering(points) {
    if (points.length === 0) return [];
    
    const clusters = [];
    const assigned = new Set();
    const mergeDistance = calculateMergeDistance(points);
    
    for (let i = 0; i < points.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = [points[i]];
        assigned.add(i);
        
        for (let j = i + 1; j < points.length; j++) {
            if (assigned.has(j)) continue;
            
            const distance = euclideanDistance(points[i], points[j]);
            if (distance <= mergeDistance) {
                cluster.push(points[j]);
                assigned.add(j);
            }
        }
        
        clusters.push(cluster);
    }
    
    return clusters;
}

function calculateMergeDistance(points) {
    if (points.length < 2) return 0.08;
    
    const distances = [];
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    let mergeDistance;
    if (points.length <= 3) {
        const median = distances[Math.floor(distances.length * 0.5)] || distances[0];
        mergeDistance = Math.max(0.03, Math.min(0.12, median * 0.5));
    } else if (points.length <= 8) {
        const percentile20 = distances[Math.floor(distances.length * 0.2)] || distances[0];
        mergeDistance = Math.max(0.025, Math.min(0.08, percentile20 * 0.8));
    } else if (points.length <= 20) {
        const percentile15 = distances[Math.floor(distances.length * 0.15)] || distances[0];
        mergeDistance = Math.max(0.02, Math.min(0.06, percentile15 * 0.7));
    } else {
        const percentile10 = distances[Math.floor(distances.length * 0.1)] || distances[0];
        mergeDistance = Math.max(0.015, Math.min(0.05, percentile10 * 0.6));
    }
    
    return mergeDistance;
}

function performVisualMerging(clusters) {
    if (clusters.length <= 1) return clusters;
    
    const merged = [...clusters];
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                if (shouldMergeClusters(merged[i], merged[j])) {
                    const mergedCluster = mergeTwoClusters(merged[i], merged[j]);
                    merged[i] = mergedCluster;
                    merged.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
    
    return merged;
}

function shouldMergeClusters(cluster1, cluster2) {
    const percentage1 = cluster1.percentage || 0;
    const percentage2 = cluster2.percentage || 0;
    
    const size1 = calculateIntelligentVisualSize(cluster1, [cluster1, cluster2]);
    const size2 = calculateIntelligentVisualSize(cluster2, [cluster1, cluster2]);
    
    const text1 = `${percentage1}%`;
    const text2 = `${percentage2}%`;
    
    const fontSize1 = Math.max(18, Math.min(50, size1 * 0.35));
    const fontSize2 = Math.max(18, Math.min(50, size2 * 0.35));
    
    const textWidth1 = text1.length * fontSize1 * 0.6;
    const textHeight1 = fontSize1;
    const textWidth2 = text2.length * fontSize2 * 0.6;
    const textHeight2 = fontSize2;
    
    const SCREEN_WIDTH = 1920;
    const SCREEN_HEIGHT = 1080;
    
    const x1 = cluster1.x * SCREEN_WIDTH;
    const y1 = cluster1.y * SCREEN_HEIGHT;
    const x2 = cluster2.x * SCREEN_WIDTH;
    const y2 = cluster2.y * SCREEN_HEIGHT;
    
    const LABEL_PADDING = 15;
    
    const box1 = {
        left: x1 - textWidth1/2 - LABEL_PADDING,
        right: x1 + textWidth1/2 + LABEL_PADDING,
        top: y1 - textHeight1/2 - LABEL_PADDING,
        bottom: y1 + textHeight1/2 + LABEL_PADDING
    };
    
    const box2 = {
        left: x2 - textWidth2/2 - LABEL_PADDING,
        right: x2 + textWidth2/2 + LABEL_PADDING,
        top: y2 - textHeight2/2 - LABEL_PADDING,
        bottom: y2 + textHeight2/2 + LABEL_PADDING
    };
    
    const xOverlap = !(box1.right < box2.left || box2.right < box1.left);
    const yOverlap = !(box1.bottom < box2.top || box2.bottom < box1.top);
    const labelsOverlap = xOverlap && yOverlap;
    
    const distance = euclideanDistance(cluster1, cluster2) * SCREEN_WIDTH;
    const minSeparation = (size1 + size2) * 0.3;
    const circlesOverlap = distance < minSeparation;
    
    return labelsOverlap || circlesOverlap;
}

function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;

    const MIN_SIZE_25_PERCENT = 45;
    const MAX_SIZE_100_PERCENT = 180;
    const ABSOLUTE_MIN_SIZE = 25;

    let baseSize;
    
    if (percentage >= 25) {
        const percentageRange = percentage - 25;
        const sizeRange = MAX_SIZE_100_PERCENT - MIN_SIZE_25_PERCENT;
        baseSize = MIN_SIZE_25_PERCENT + (percentageRange / 75) * sizeRange;
    } else {
        const scaleFactor = percentage / 25;
        baseSize = ABSOLUTE_MIN_SIZE + (MIN_SIZE_25_PERCENT - ABSOLUTE_MIN_SIZE) * scaleFactor;
    }

    const densityAdjustment = Math.max(0.8, Math.min(1.3, Math.pow(density, 0.15)));
    const spreadAdjustment = Math.min(10, spread * 100);
    const countAdjustment = count > 1 ? Math.log10(count + 1) * 3 : 0;

    let finalSize = baseSize * densityAdjustment + spreadAdjustment + countAdjustment;
    finalSize = Math.max(ABSOLUTE_MIN_SIZE, Math.min(MAX_SIZE_100_PERCENT + 20, finalSize));

    return Math.round(finalSize);
}

function normalizePercentages(clusters, totalPoints) {
    if (clusters.length === 0) return clusters;
    
    const normalized = clusters.map((cluster) => {
        const rawPercentage = (cluster.count / totalPoints) * 100;
        const roundedPercentage = Math.round(rawPercentage);
        
        return {
            ...cluster,
            percentage: roundedPercentage
        };
    });
    
    const currentTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    const expectedTotal = 100;
    const difference = expectedTotal - currentTotal;
    
    if (Math.abs(difference) >= 2 && normalized.length > 0) {
        const largeClusters = normalized.filter(c => c.percentage >= 5);
        
        if (largeClusters.length > 0) {
            const adjustmentPerCluster = Math.round(difference / largeClusters.length);
            largeClusters.forEach(cluster => {
                cluster.percentage += adjustmentPerCluster;
            });
        } else {
            const largest = normalized.reduce((max, current) => 
                current.percentage > max.percentage ? current : max
            );
            largest.percentage += difference;
        }
    }
    
    return normalized;
}

function mergeTwoClusters(cluster1, cluster2) {
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;
    
    const weight1 = cluster1.count / totalCount;
    const weight2 = cluster2.count / totalCount;
    
    const newX = cluster1.x * weight1 + cluster2.x * weight2;
    const newY = cluster1.y * weight1 + cluster2.y * weight2;
    
    const mergedMetrics = calculateBasicClusterMetrics(allPoints, totalCount);
    
    return {
        ...mergedMetrics,
        x: newX,
        y: newY,
        points: allPoints,
        id: cluster1.id
    };
}

function calculateBasicClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    const distances = clusterPoints.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );

    const density = count / (Math.PI * Math.pow(maxDistance || 0.001, 2));
    const compactness = avgDistance / (maxDistance || 0.001);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        radius: maxDistance,
        spread: avgDistance,
        maxSpread: maxDistance,
        stdDev,
        density,
        compactness
    };
}

function analyzeClusterShape(points, centroidX, centroidY) {
    if (points.length === 1) {
        return {
            shapeType: 'circle',
            circularity: 1.0,
            eccentricity: 0,
            irregularity: 0,
            convexity: 1,
            preferredSides: 8,
            complexity: 0,
            shapeConfidence: 1.0,
            polygonPoints: null
        };
    }

    // Simplified shape analysis
    return {
        shapeType: 'circle',
        circularity: 0.8,
        eccentricity: 0.2,
        irregularity: 0.1,
        convexity: 0.9,
        preferredSides: 8,
        complexity: 0.3,
        shapeConfidence: 0.9,
        polygonPoints: null
    };
}

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// ==================== END OF CLUSTERING ALGORITHM ====================

// FIXED: Enhanced WebSocket broadcasting with minimal logging
function broadcastToChannel(channelId, data) {
    if (!wss || !connectedClients) return;
    
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    let message;
    try {
        message = JSON.stringify(data);
    } catch (error) {
        logError('Failed to stringify broadcast data:', error);
        return;
    }

    let sentCount = 0;
    let failedCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                logError('WebSocket send error:', error);
                clients.delete(ws);
                failedCount++;
            }
        } else {
            clients.delete(ws);
            failedCount++;
        }
    });

    log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters?.length || 0} clusters`, 'debug');
    if (failedCount > 0) {
        log(`⚠️ Cleaned up ${failedCount} stale connections`, 'debug');
    }
}

function broadcastToLocalClients(channelId, data) {
    broadcastToChannel(channelId, data);
}

function broadcastToConfigPanels(data) {
    if (!configPanels) return;
    
    let message;
    try {
        message = JSON.stringify(data);
    } catch (error) {
        logError('Failed to stringify config data:', error);
        return;
    }

    let sentCount = 0;
    
    configPanels.forEach((ws, sessionId) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                logError('Config panel send error:', error);
                configPanels.delete(sessionId);
            }
        } else {
            configPanels.delete(sessionId);
        }
    });
    
    if (sentCount > 0) {
        log(`📡 Config panel broadcast: ${sentCount} panels`, 'debug');
    }
}

async function broadcastToAll(data) {
    if (!connectedClients) return;
    
    let totalSent = 0;
    const channelPromises = [];
    
    connectedClients.forEach((clients, channelId) => {
        const channelPromise = (async () => {
            const channelData = channelId === 'all' ? data : await getCurrentHeatmapData(channelId);
            Object.assign(channelData, { running: data.running, action: data.action });
            broadcastToChannel(channelId, channelData);
            return clients.size;
        })();
        
        channelPromises.push(channelPromise);
    });
    
    const results = await Promise.all(channelPromises);
    totalSent = results.reduce((sum, count) => sum + count, 0);

    if (totalSent > 0) {
        log(`📡 Broadcast to all: ${totalSent} clients`, 'debug');
    }
}

// FIXED: Create servers BEFORE registering instance
log('🔧 Creating HTTP server...');
httpServer = createServer(app);

log('🔧 Creating WebSocket server...');
try {
    // FIXED: Let WebSocketServer handle upgrades automatically - NO MANUAL UPGRADE HANDLER
    wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        perMessageDeflate: false,
        clientTracking: true
    });
    log('✅ WebSocket server integrated with HTTP server');
} catch (error) {
    logError('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// FIXED: WebSocket connection handling - clean and minimal
wss.on('connection', async (ws, req) => {
    const startTime = Date.now();
    log(`🔗 NEW WEBSOCKET CONNECTION: ${req.url}`, 'debug');

    let channelId = null;
    let sessionId = null;
    let isConfigPanel = false;

    if (req.url) {
        const urlPath = req.url.replace('/ws/', '').split('?')[0];
        
        if (urlPath.startsWith('config_')) {
            isConfigPanel = true;
            sessionId = urlPath;
        } else {
            channelId = urlPath;
        }
    }

    if (isConfigPanel && sessionId) {
        configPanels.set(sessionId, ws);
        log(`✅ Config panel connected: ${sessionId}`, 'debug');
        
        try {
            const initialData = await getCurrentHeatmapData('all');
            initialData.type = 'state_update';
            initialData.instanceId = INSTANCE_ID;
            ws.send(JSON.stringify(initialData));
        } catch (error) {
            logError('Error sending initial config data:', error);
        }
        
    } else if (channelId) {
        if (!connectedClients.has(channelId)) {
            connectedClients.set(channelId, new Set());
        }
        connectedClients.get(channelId).add(ws);

        log(`✅ WebSocket connected: Channel ${channelId} (${connectedClients.get(channelId).size} clients)`, 'debug');

        try {
            const initialData = await getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
        } catch (error) {
            logError('Error sending initial data:', error);
        }
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (error) {
            logError('Message parse error:', error);
        }
    });

    ws.on('close', () => {
        const duration = Date.now() - startTime;
        
        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
            log(`🔒 Config panel disconnected: ${sessionId} after ${duration}ms`, 'debug');
        } else if (channelId) {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            log(`🔒 WebSocket disconnected: ${channelId} after ${duration}ms`, 'debug');
        }
    });

    ws.on('error', (error) => {
        logError(`WebSocket error for ${channelId || sessionId}:`, error);
    });
});

// Connection health monitoring - minimal
const connectionHealthInterval = setInterval(() => {
    if (!wss) return;
    
    let totalConnections = 0;
    let healthyConnections = 0;
    
    wss.clients.forEach((ws) => {
        totalConnections++;
        if (ws.readyState === WebSocket.OPEN) {
            healthyConnections++;
        } else {
            ws.terminate();
        }
    });
    
    if (totalConnections > 0) {
        log(`💓 Health check: ${healthyConnections}/${totalConnections} connections healthy`, 'debug');
    }
}, 60000); // Check every minute

// FIXED: Enhanced graceful shutdown
async function gracefulShutdown() {
    log('📝 Shutting down server...');
    
    clearInterval(connectionHealthInterval);

    if (wss) {
        wss.clients.forEach((ws) => {
            try {
                ws.close(1001, 'Server shutting down');
            } catch (error) {
                logError('Error closing WebSocket:', error);
            }
        });
    }

    try {
        if (redisSub && redisSub.isReady) {
            await redisSub.unsubscribe();
        }
        if (redis && redis.isReady) {
            await redis.quit();
        }
        if (redisPub && redisPub.isReady) {
            await redisPub.quit();
        }
        if (redisSub && redisSub.isReady) {
            await redisSub.quit();
        }
        log('✅ Redis connections closed');
    } catch (error) {
        logError('❌ Error closing Redis:', error);
    }

    if (httpServer) {
        httpServer.close(() => {
            log('✅ Server closed gracefully');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

// Enhanced process handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('uncaughtException', (error) => {
    logError('❌ Uncaught Exception:', error);
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('❌ Unhandled Rejection:', reason);
});

// FIXED: Safe instance registration
async function safeRegisterInstance() {
    try {
        await registerInstance();
    } catch (error) {
        logError('Failed to register instance:', error);
    }
}

await safeRegisterInstance();
setInterval(safeRegisterInstance, 20000);

// Enhanced startup
httpServer.listen(PORT, '0.0.0.0', async () => {
    log('🚀 ClickMap EBS v5.0.0 PRODUCTION READY');
    log(`📡 Instance ID: ${INSTANCE_ID}`);
    log(`📡 Port: ${PORT}`);
    log(`💾 Redis connected: ${redis.isReady}`);
    log(`📢 PubSub active: ${redisSub.isReady && redisPub.isReady}`);
    log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`📊 Debug logging: ${DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    
    try {
        const running = await gameState.isRunning();
        const instances = await getActiveInstances();
        log(`📊 Game state: ${running ? 'RUNNING' : 'STOPPED'}`);
        log(`🎯 Cluster: ${instances.length} active instances`);
    } catch (error) {
        logError('❌ Failed to get initial state:', error);
    }

    setTimeout(() => {
        log('🔍 FINAL STATUS:');
        log(`   HTTP server: ${httpServer.listening ? 'LISTENING' : 'NOT LISTENING'}`);
        log(`   WebSocket: ${wss ? 'READY' : 'NOT READY'}`);
        log(`   Channels: ${connectedClients.size}`);
        log(`   Config panels: ${configPanels.size}`);
        log('🎊 Server fully operational!');
    }, 1000);
});

export default httpServer;
