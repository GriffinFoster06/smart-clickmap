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

// Redis event handlers
redis.on('error', (err) => console.error('Redis Client Error:', err));
redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

redisPub.on('error', (err) => console.error('Redis Pub Error:', err));
redisSub.on('error', (err) => console.error('Redis Sub Error:', err));

// FIXED: Enhanced error handling for Redis connection
async function connectRedis() {
    try {
        await Promise.all([
            redis.connect(),
            redisPub.connect(),
            redisSub.connect()
        ]);
        console.log('✅ All Redis clients connected');
        
        // Subscribe to broadcast channel
        await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
        await redisSub.subscribe('clickmap:config', handleConfigMessage);
        console.log('✅ Subscribed to Redis channels');
        
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
        console.log('⚠️ Continuing without Redis - using in-memory fallback');
    }
}

await connectRedis();

// FIXED: Enhanced broadcast message handlers with error handling
function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        console.log(`📨 Broadcast message from instance ${data.fromInstance}`);
        
        // Don't rebroadcast our own messages
        if (data.fromInstance === INSTANCE_ID) return;
        
        // Broadcast to local WebSocket clients
        broadcastToLocalClients(data.channelId, data.payload);
        
    } catch (error) {
        console.error('Error handling broadcast message:', error);
    }
}

// Handle config update messages
function handleConfigMessage(message) {
    try {
        const data = JSON.parse(message);
        console.log(`📨 Config update from instance ${data.fromInstance}`);
        
        // Don't rebroadcast our own messages
        if (data.fromInstance === INSTANCE_ID) return;
        
        // Notify config panels
        broadcastToConfigPanels(data.payload);
        
    } catch (error) {
        console.error('Error handling config message:', error);
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
            console.error('Redis setRunning error:', error);
            throw error;
        }
    },

    async isRunning() {
        try {
            const running = await redis.get('game:running');
            return running === 'true';
        } catch (error) {
            console.error('Redis isRunning error:', error);
            return false; // Safe default
        }
    },

    async getVersion() {
        try {
            const version = await redis.get('game:version');
            return version ? parseInt(version) : 0;
        } catch (error) {
            console.error('Redis getVersion error:', error);
            return 0;
        }
    },

    async getLastUpdate() {
        try {
            const timestamp = await redis.get('game:lastUpdate');
            return timestamp ? parseInt(timestamp) : Date.now();
        } catch (error) {
            console.error('Redis getLastUpdate error:', error);
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
            console.error('Redis compareAndSetRunning error:', error);
            throw error;
        }
    },

    async addClick(channelId, userId, x, y) {
        try {
            const clickData = JSON.stringify({ x, y, timestamp: Date.now() });
            // FIXED: setex -> setEx
            await redis.setEx(`clicks:${channelId}:${userId}`, 3600, clickData);
        } catch (error) {
            console.error('Redis addClick error:', error);
            throw error;
        }
    },

    async getChannelClicks(channelId) {
        try {
            const pattern = `clicks:${channelId}:*`;
            const keys = await redis.keys(pattern);
            
            if (keys.length === 0) return new Map();

            const pipeline = redis.multi();
            keys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

            const clicks = new Map();
            keys.forEach((key, index) => {
                const userId = key.split(':')[2];
                const result = results[index];
                
                if (result && result[1]) {
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
            console.error('Redis getChannelClicks error:', error);
            return new Map(); // Safe default
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
                const channelId = parts[1];
                const userId = parts[2];
                
                if (!channelGroups.has(channelId)) {
                    channelGroups.set(channelId, []);
                }
                channelGroups.get(channelId).push({ key, userId });
            });

            const pipeline = redis.multi();
            keys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

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
            console.error('Redis getAllChannelClicks error:', error);
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
            console.error('Redis clearAllClicks error:', error);
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
            console.error('Redis clearChannelClicks error:', error);
            throw error;
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
        console.error('Failed to acquire lock:', error);
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
        console.error('Failed to release lock:', error);
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
        console.error('Failed to register instance:', error);
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
                    console.error('Failed to parse instance data:', e);
                }
            }
        }
        
        return instances;
    } catch (error) {
        console.error('Failed to get active instances:', error);
        return [];
    }
}

// Real-time performance monitoring
const PERFORMANCE_MONITORING = process.env.NODE_ENV !== 'production';
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

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Instance: ${INSTANCE_ID}`);
    res.set('Cache-Control', 'no-store');
    res.set('X-Instance-Id', INSTANCE_ID);
    next();
});

// Enhanced health check with real-time performance stats
app.get('/health', async (req, res) => {
    console.log('🏥 Health check called');
    
    const uptime = Date.now() - performanceStats.startTime;
    const avgProcessingTime = performanceStats.clickProcessingTimes.length > 0 ? 
        performanceStats.clickProcessingTimes.reduce((a, b) => a + b, 0) / performanceStats.clickProcessingTimes.length : 0;
    const avgBroadcastTime = performanceStats.broadcastTimes.length > 0 ?
        performanceStats.broadcastTimes.reduce((a, b) => a + b, 0) / performanceStats.broadcastTimes.length : 0;
    const avgCalculationTime = performanceStats.clusterCalculationTimes.length > 0 ?
        performanceStats.clusterCalculationTimes.reduce((a, b) => a + b, 0) / performanceStats.clusterCalculationTimes.length : 0;
    
    const running = await gameState.isRunning();
    const allClicks = await gameState.getAllChannelClicks();
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
            channels: connectedClients.size,
            connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        performance: PERFORMANCE_MONITORING ? {
            totalRequests: performanceStats.totalRequests,
            averageProcessingTime: Math.round(avgProcessingTime * 100) / 100,
            averageBroadcastTime: Math.round(avgBroadcastTime * 100) / 100,
            averageCalculationTime: Math.round(avgCalculationTime * 100) / 100,
            requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100,
            realTimeMode: true
        } : undefined,
        environment: {
            node_env: process.env.NODE_ENV || 'unknown',
            port: PORT,
            render_service: process.env.RENDER_SERVICE_NAME || 'unknown',
            render_service_id: INSTANCE_ID
        },
        redis: {
            connected: redis.isReady,
            pubsubActive: redisSub.isReady && redisPub.isReady
        },
        cluster: {
            totalInstances: activeInstances.length,
            instances: activeInstances.map(i => ({
                id: i.id,
                clients: i.websocketClients,
                uptime: Date.now() - i.startTime
            }))
        },
        game_data: {
            total_channels: allClicks.size,
            total_clicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0),
            channels: Array.from(allClicks.entries()).map(([channel, clicks]) => ({
                channel,
                clicks: clicks.size
            }))
        }
    });
});

// Real-time performance monitoring endpoint
app.get('/performance', (req, res) => {
    if (!PERFORMANCE_MONITORING) {
        return res.status(404).json({ error: 'Performance monitoring disabled' });
    }
    
    const uptime = Date.now() - performanceStats.startTime;
    const recentProcessingTimes = performanceStats.clickProcessingTimes.slice(-20);
    const recentBroadcastTimes = performanceStats.broadcastTimes.slice(-20);
    
    res.json({
        realTimeMode: true,
        uptime: Math.floor(uptime / 1000),
        totalRequests: performanceStats.totalRequests,
        requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100,
        averages: {
            clickProcessing: performanceStats.clickProcessingTimes.length > 0 ? 
                Math.round((performanceStats.clickProcessingTimes.reduce((a, b) => a + b, 0) / performanceStats.clickProcessingTimes.length) * 100) / 100 : 0,
            broadcasting: performanceStats.broadcastTimes.length > 0 ?
                Math.round((performanceStats.broadcastTimes.reduce((a, b) => a + b, 0) / performanceStats.broadcastTimes.length) * 100) / 100 : 0,
            clusterCalculation: performanceStats.clusterCalculationTimes.length > 0 ?
                Math.round((performanceStats.clusterCalculationTimes.reduce((a, b) => a + b, 0) / performanceStats.clusterCalculationTimes.length) * 100) / 100 : 0
        },
        recent: {
            clickProcessing: recentProcessingTimes.map(t => Math.round(t * 100) / 100),
            broadcasting: recentBroadcastTimes.map(t => Math.round(t * 100) / 100)
        },
        thresholds: {
            clickProcessing: { target: 10, warning: 50, critical: 100 },
            broadcasting: { target: 5, warning: 20, critical: 50 },
            clusterCalculation: { target: 15, warning: 100, critical: 200 }
        }
    });
});

// WebSocket debug endpoint  
app.get('/ws-debug', (req, res) => {
    console.log('🔍 WebSocket Debug requested');

    const debug = {
        timestamp: new Date().toISOString(),
        instanceId: INSTANCE_ID,
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0,
            integrated_with_http: true,
            ready_state: wss ? 'operational' : 'not_initialized'
        },
        connected_clients: {
            channels: connectedClients.size,
            config_panels: configPanels.size,
            total_connections: Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0) + configPanels.size,
            by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        server_info: {
            listening: !!httpServer && httpServer.listening,
            address: httpServer ? httpServer.address() : null,
            port: PORT,
            single_port_mode: true,
            environment: process.env.NODE_ENV || 'development'
        },
        redis: {
            connected: redis.isReady,
            pubsub: redisSub.isReady && redisPub.isReady
        }
    };

    console.log('🔍 Debug result:', JSON.stringify(debug, null, 2));
    res.json(debug);
});

// WebSocket connection test helper
app.get('/ws-test/:channelId', (req, res) => {
    const { channelId } = req.params;
    const wsUrl = `wss://${req.get('host')}/ws/${channelId}`;

    res.json({
        test_url: wsUrl,
        server_ready: !!httpServer && httpServer.listening,
        websocket_ready: !!wss,
        client_count: wss ? wss.clients.size : 0,
        redis_ready: redis.isReady,
        instance_id: INSTANCE_ID,
        instructions: [
            'Test WebSocket connection in browser console:',
            `const ws = new WebSocket('${wsUrl}');`,
            `ws.onopen = () => console.log('✅ Connected to ${channelId}');`,
            `ws.onerror = (e) => console.log('❌ Connection error:', e);`,
            `ws.onclose = (e) => console.log('🔒 Connection closed:', e.code, e.reason);`,
            `ws.onmessage = (e) => console.log('📨 Message received:', e.data);`
        ]
    });
});

// START endpoint with distributed locking and pubsub
app.post('/start', async (req, res) => {
    console.log('🚀 START endpoint called');
    
    const sessionId = req.headers['x-session-id'];
    const expectedVersion = req.headers['x-state-version'];
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    // Acquire distributed lock
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress',
            retry: true
        });
    }
    
    try {
        // Check version conflict
        const result = await gameState.compareAndSetRunning(true, expectedVersion);
        
        if (!result.success) {
            return res.status(409).json({
                success: false,
                conflict: true,
                message: 'State was modified by another instance',
                currentVersion: result.currentVersion
            });
        }
        
        // Clear clicks
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        console.log(`✅ Game started successfully (Instance: ${INSTANCE_ID}, Version: ${result.version})`);
        
        // Broadcast to all instances via Redis PubSub
        const broadcastData = {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start',
            version: result.version,
            channelId: channelId || 'all'
        };
        
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: broadcastData,
            fromInstance: INSTANCE_ID
        }));
        
        // Notify config panels
        await redisPub.publish('clickmap:config', JSON.stringify({
            type: 'state_update',
            state: broadcastData,
            version: result.version,
            fromInstance: INSTANCE_ID
        }));
        
        // Local broadcast
        broadcastToAll(broadcastData);
        
        res.json({
            success: true,
            status: 'started',
            running: true,
            stateVersion: result.version,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        console.error('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session',
            details: error.message
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// STOP endpoint with distributed locking
app.post('/stop', async (req, res) => {
    console.log('⏹️ STOP endpoint called');
    
    const sessionId = req.headers['x-session-id'];
    const expectedVersion = req.headers['x-state-version'];
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    // Acquire distributed lock
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress',
            retry: true
        });
    }
    
    try {
        // Check version conflict
        const result = await gameState.compareAndSetRunning(false, expectedVersion);
        
        if (!result.success) {
            return res.status(409).json({
                success: false,
                conflict: true,
                message: 'State was modified by another instance',
                currentVersion: result.currentVersion
            });
        }
        
        console.log(`✅ Game stopped successfully (Instance: ${INSTANCE_ID}, Version: ${result.version})`);
        
        const currentData = await getCurrentHeatmapData(channelId || 'all');
        currentData.running = false;
        currentData.action = 'stop';
        currentData.version = result.version;
        
        // Broadcast to all instances
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: currentData,
            fromInstance: INSTANCE_ID
        }));
        
        // Notify config panels
        await redisPub.publish('clickmap:config', JSON.stringify({
            type: 'state_update',
            state: currentData,
            version: result.version,
            fromInstance: INSTANCE_ID
        }));
        
        // Local broadcast
        broadcastToAll(currentData);
        
        res.json({
            success: true,
            status: 'stopped',
            running: false,
            stateVersion: result.version,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session',
            details: error.message
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// RESET endpoint with distributed locking
app.post('/reset', async (req, res) => {
    console.log('🗑️ RESET endpoint called');
    
    const sessionId = req.headers['x-session-id'];
    const expectedVersion = req.headers['x-state-version'];
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    // Acquire distributed lock
    const lock = await acquireLock('game:control', 5000);
    
    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress',
            retry: true
        });
    }
    
    try {
        // Clear clicks
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        const version = await gameState.getVersion();
        const newVersion = version + 1;
        await redis.set('game:version', newVersion.toString());
        
        console.log(`✅ Data reset successfully (Instance: ${INSTANCE_ID}, Version: ${newVersion})`);
        
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
        
        // Broadcast to all instances
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId || 'all',
            payload: broadcastData,
            fromInstance: INSTANCE_ID
        }));
        
        // Notify config panels
        await redisPub.publish('clickmap:config', JSON.stringify({
            type: 'state_update',
            state: broadcastData,
            version: newVersion,
            fromInstance: INSTANCE_ID
        }));
        
        // Local broadcast
        broadcastToAll(broadcastData);
        
        res.json({
            success: true,
            status: 'reset',
            running: running,
            stateVersion: newVersion,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data',
            details: error.message
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// Real-time optimized click handling endpoint with full JWT validation
app.post('/click', async (req, res) => {
    const startTime = performance.now();
    console.log('🖱️ CLICK endpoint called - REDIS MODE');

    try {
        const running = await gameState.isRunning();
        if (!running) {
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

        // Verify JWT
        let payload;
        try {
            payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        } catch (jwtError) {
            console.log('   ❌ Invalid JWT:', jwtError.message);
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
        
        // Validate JWT claims
        if (payload.exp && payload.exp < Date.now() / 1000) {
            console.log('   ❌ Token expired');
            return res.status(401).json({
                success: false,
                error: 'Token expired'
            });
        }
        
        // Validate role (should not be 'external' for viewer clicks)
        if (payload.role === 'external') {
            console.log('   ❌ Invalid role for click submission');
            return res.status(403).json({
                success: false,
                error: 'Invalid role'
            });
        }

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
        const clickProcessTime = performance.now() - clickProcessStart;
        
        console.log(`✅ Click stored in Redis: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)}) in ${clickProcessTime.toFixed(2)}ms`);

        // Get channel clicks for logging
        const channelClicks = await gameState.getChannelClicks(channelId);
        console.log(`   Total clicks in channel: ${channelClicks.size}`);

        // REAL-TIME OPTIMIZATION: Immediately calculate and broadcast updates
        const broadcastStart = performance.now();
        const updatedData = await getCurrentHeatmapData(channelId);
        const calculationTime = performance.now() - broadcastStart;
        
        console.log(`   📊 Cluster calculation: ${updatedData.clusters.length} clusters in ${calculationTime.toFixed(2)}ms`);
        
        // Broadcast to all instances via PubSub
        await redisPub.publish('clickmap:broadcast', JSON.stringify({
            channelId: channelId,
            payload: updatedData,
            fromInstance: INSTANCE_ID
        }));
        
        // Immediate local WebSocket broadcast
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
            performanceStats.totalRequests++;
            
            // Keep only last 100 measurements for rolling average
            if (performanceStats.clickProcessingTimes.length > 100) {
                performanceStats.clickProcessingTimes.shift();
                performanceStats.broadcastTimes.shift();
                performanceStats.clusterCalculationTimes.shift();
            }
        }

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: channelClicks.size,
            channelId: channelId,
            instanceId: INSTANCE_ID,
            performance: PERFORMANCE_MONITORING ? {
                processingTime: totalTime,
                calculationTime: calculationTime,
                broadcastTime: broadcastTime
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

// Enhanced heatmap endpoint with detailed logging
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;
    const sessionId = req.headers['x-session-id'];

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%, session=${sessionId}`);

    try {
        const data = await getCurrentHeatmapData(channelId, threshold);
        const activeInstances = await getActiveInstances();
        
        data.instances = activeInstances.length;
        data.instanceId = INSTANCE_ID;

        if (data.totalClicks > 0) {
            console.log(`✅ Heatmap from Redis: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
            
            // Debug percentage math
            const totalPercentage = data.clusters.reduce((sum, c) => sum + c.percentage, 0);
            console.log(`   📊 Percentage check: ${data.clusters.map(c => c.percentage + '%').join(' + ')} = ${totalPercentage}%`);
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

// ==================== YOUR FULL CLUSTERING ALGORITHM ====================

// Get current heatmap data with FIXED VISUAL-BASED CLUSTERING
async function getCurrentHeatmapData(channelId, threshold = 3) {
    const running = await gameState.isRunning();
    const lastUpdate = await gameState.getLastUpdate();
    const version = await gameState.getVersion();

    // If no specific channel requested, aggregate all channels
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        // Collect all points from all channels
        const allChannelData = await gameState.getAllChannelClicks();
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            // Add all points to the aggregate
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        // Process ALL points into clusters
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

    console.log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

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

// FIXED CLUSTERING ALGORITHM with proper sizing and merging
function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧮 FIXED VISUAL clustering: ${points.length} points, ${threshold}% threshold`);

    // Step 1: Conservative distance-based clustering to prevent overlaps
    const rawClusters = performSimpleDistanceClustering(points);
    console.log(`   1️⃣ Distance clustering: ${points.length} points → ${rawClusters.length} raw clusters`);
    
    // Step 2: Calculate metrics for each cluster
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateBasicClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster
        };
    });

    // Step 3: Visual merging with proper size-aware logic
    const visuallyMergedClusters = performVisualMerging(enrichedClusters);
    console.log(`   2️⃣ Visual merging: ${enrichedClusters.length} → ${visuallyMergedClusters.length} clusters`);

    // Step 4: Accurate percentage normalization
    const normalizedClusters = normalizePercentages(visuallyMergedClusters, points.length);
    console.log(`   3️⃣ Percentage normalization: ${normalizedClusters.map(c => c.percentage + '%').join(', ')}`);

    // Step 5: Filter by threshold
    const filteredClusters = normalizedClusters.filter(c => c.percentage >= threshold);
    console.log(`   4️⃣ Threshold filter (${threshold}%): ${normalizedClusters.length} → ${filteredClusters.length} clusters`);

    // Step 6: Calculate proper visual sizes and shapes
    const finalClusters = filteredClusters.map((cluster, index) => {
        const shapeAnalysis = analyzeClusterShape(cluster.points, cluster.x, cluster.y);
        const visualSize = calculateIntelligentVisualSize(cluster, filteredClusters);
        
        return {
            ...cluster,
            ...shapeAnalysis,
            visualSize,
            isTop: false // Will be set after sorting
        };
    });

    // Step 7: Sort by percentage and mark top cluster
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    console.log(`✅ FIXED clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`);
    finalClusters.forEach((c, i) => {
        console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks, ${c.visualSize}px, ${c.shapeType})`);
    });

    return finalClusters;
}

// FIXED DISTANCE CLUSTERING - Better distance calculation to prevent nested clusters
function performSimpleDistanceClustering(points) {
    if (points.length === 0) return [];
    
    const clusters = [];
    const assigned = new Set();
    
    // Calculate conservative merge distance
    const mergeDistance = calculateMergeDistance(points);
    console.log(`   🔗 Using merge distance: ${mergeDistance.toFixed(4)}`);
    
    for (let i = 0; i < points.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = [points[i]];
        assigned.add(i);
        
        // Find nearby points to merge (but be conservative)
        for (let j = i + 1; j < points.length; j++) {
            if (assigned.has(j)) continue;
            
            const distance = euclideanDistance(points[i], points[j]);
            if (distance <= mergeDistance) {
                cluster.push(points[j]);
                assigned.add(j);
                console.log(`   ✅ Merged points: distance ${distance.toFixed(4)} <= ${mergeDistance.toFixed(4)}`);
            }
        }
        
        clusters.push(cluster);
    }
    
    console.log(`   📊 Distance clustering: ${points.length} points → ${clusters.length} clusters`);
    
    return clusters;
}

// FIXED merge distance calculation
function calculateMergeDistance(points) {
    if (points.length < 2) return 0.08; // Reasonable default
    
    // Calculate all pairwise distances
    const distances = [];
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    // More conservative distance calculation to prevent over-clustering
    let mergeDistance;
    
    if (points.length <= 3) {
        // Very small datasets: use median distance * 0.5
        const median = distances[Math.floor(distances.length * 0.5)] || distances[0];
        mergeDistance = Math.max(0.03, Math.min(0.12, median * 0.5));
    } else if (points.length <= 8) {
        // Small datasets: use 20th percentile
        const percentile20 = distances[Math.floor(distances.length * 0.2)] || distances[0];
        mergeDistance = Math.max(0.025, Math.min(0.08, percentile20 * 0.8));
    } else if (points.length <= 20) {
        // Medium datasets: use 15th percentile
        const percentile15 = distances[Math.floor(distances.length * 0.15)] || distances[0];
        mergeDistance = Math.max(0.02, Math.min(0.06, percentile15 * 0.7));
    } else {
        // Large datasets: use 10th percentile
        const percentile10 = distances[Math.floor(distances.length * 0.1)] || distances[0];
        mergeDistance = Math.max(0.015, Math.min(0.05, percentile10 * 0.6));
    }
    
    console.log(`   🎯 Merge distance for ${points.length} points: ${mergeDistance.toFixed(4)} (prevents over-clustering)`);
    
    return mergeDistance;
}

// VISUAL MERGING with proper size-aware logic
function performVisualMerging(clusters) {
    if (clusters.length <= 1) return clusters;
    
    console.log(`🔄 Visual merging: Starting with ${clusters.length} clusters`);
    
    const merged = [...clusters];
    let changed = true;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        console.log(`   🔄 Merge iteration ${iterations}`);
        
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                if (shouldMergeClusters(merged[i], merged[j])) {
                    console.log(`   🔗 Merging clusters: ${merged[i].percentage}% (${merged[i].count} clicks) + ${merged[j].percentage}% (${merged[j].count} clicks)`);
                    
                    // Merge cluster j into cluster i
                    const mergedCluster = mergeTwoClusters(merged[i], merged[j]);
                    merged[i] = mergedCluster;
                    merged.splice(j, 1);
                    
                    console.log(`   ✅ Result: ${mergedCluster.percentage}% (${mergedCluster.count} clicks)`);
                    
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
    
    console.log(`🔄 Visual merging complete: ${clusters.length} → ${merged.length} clusters after ${iterations} iterations`);
    
    return merged;
}

// FIXED merging logic - Only merge when labels would actually overlap
function shouldMergeClusters(cluster1, cluster2) {
    const percentage1 = cluster1.percentage || 0;
    const percentage2 = cluster2.percentage || 0;
    
    // Calculate actual visual sizes using the same logic as final rendering
    const size1 = calculateIntelligentVisualSize(cluster1, [cluster1, cluster2]);
    const size2 = calculateIntelligentVisualSize(cluster2, [cluster1, cluster2]);
    
    // Calculate label dimensions based on percentage text
    const text1 = `${percentage1}%`;
    const text2 = `${percentage2}%`;
    
    // Font size calculation (matching renderer logic)
    const fontSize1 = Math.max(18, Math.min(50, size1 * 0.35));
    const fontSize2 = Math.max(18, Math.min(50, size2 * 0.35));
    
    // Estimated text dimensions (rough but consistent)
    const textWidth1 = text1.length * fontSize1 * 0.6;
    const textHeight1 = fontSize1;
    const textWidth2 = text2.length * fontSize2 * 0.6;
    const textHeight2 = fontSize2;
    
    console.log(`🔍 Merge check: Cluster1(${percentage1}%, ${size1}px, label:${textWidth1.toFixed(0)}x${textHeight1.toFixed(0)}) vs Cluster2(${percentage2}%, ${size2}px, label:${textWidth2.toFixed(0)}x${textHeight2.toFixed(0)})`);

    // Convert to screen coordinates (assuming 1920x1080 reference)
    const SCREEN_WIDTH = 1920;
    const SCREEN_HEIGHT = 1080;
    
    const x1 = cluster1.x * SCREEN_WIDTH;
    const y1 = cluster1.y * SCREEN_HEIGHT;
    const x2 = cluster2.x * SCREEN_WIDTH;
    const y2 = cluster2.y * SCREEN_HEIGHT;
    
    // Calculate label bounding boxes with padding
    const LABEL_PADDING = 15; // Padding around labels
    
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
    
    // Check for actual label overlap
    const xOverlap = !(box1.right < box2.left || box2.right < box1.left);
    const yOverlap = !(box1.bottom < box2.top || box2.bottom < box1.top);
    const labelsOverlap = xOverlap && yOverlap;
    
    // Also check for cluster circle overlap (shouldn't have clusters inside clusters)
    const distance = euclideanDistance(cluster1, cluster2) * SCREEN_WIDTH; // Convert to pixels
    const minSeparation = (size1 + size2) * 0.3; // Clusters should be at least 30% of combined radius apart
    const circlesOverlap = distance < minSeparation;
    
    const shouldMerge = labelsOverlap || circlesOverlap;
    
    console.log(`   📏 Distance: ${distance.toFixed(1)}px, Min separation: ${minSeparation.toFixed(1)}px`);
    console.log(`   📋 Labels overlap: ${labelsOverlap}, Circles overlap: ${circlesOverlap}`);
    console.log(`   ⚖️ Should merge: ${shouldMerge}`);
    
    return shouldMerge;
}

// FIXED VISUAL SIZE calculation with proper percentage scaling
function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;

    // FIXED SIZE BOUNDS - Proper scaling from 25% minimum
    const MIN_SIZE_25_PERCENT = 45;  // Size at 25% 
    const MAX_SIZE_100_PERCENT = 180; // Size at 100%
    const ABSOLUTE_MIN_SIZE = 25;     // Absolute minimum for tiny clusters

    console.log(`📏 Calculating size for ${percentage}% cluster (${count} clicks)`);

    // PROPER PERCENTAGE-BASED SCALING
    let baseSize;
    
    if (percentage >= 25) {
        // Linear scaling from 25% to 100%
        const percentageRange = percentage - 25; // 0-75 range
        const sizeRange = MAX_SIZE_100_PERCENT - MIN_SIZE_25_PERCENT; // Size difference
        baseSize = MIN_SIZE_25_PERCENT + (percentageRange / 75) * sizeRange;
        console.log(`   📊 Main scaling: ${percentage}% → ${baseSize.toFixed(1)}px (25-100% range)`);
    } else {
        // Smaller scaling for clusters below 25%
        const scaleFactor = percentage / 25; // 0.0 to 1.0
        baseSize = ABSOLUTE_MIN_SIZE + (MIN_SIZE_25_PERCENT - ABSOLUTE_MIN_SIZE) * scaleFactor;
        console.log(`   📊 Small scaling: ${percentage}% → ${baseSize.toFixed(1)}px (below 25%)`);
    }

    // Minor adjustments for density and spread (but don't override percentage scaling)
    const densityAdjustment = Math.max(0.8, Math.min(1.3, Math.pow(density, 0.15))); // Very mild
    const spreadAdjustment = Math.min(10, spread * 100); // Max +10px
    const countAdjustment = count > 1 ? Math.log10(count + 1) * 3 : 0; // Max +3px per magnitude

    // Apply minor adjustments
    let finalSize = baseSize * densityAdjustment + spreadAdjustment + countAdjustment;

    // ENFORCE BOUNDS
    finalSize = Math.max(ABSOLUTE_MIN_SIZE, Math.min(MAX_SIZE_100_PERCENT + 20, finalSize));

    console.log(`   ✅ Final size: ${finalSize.toFixed(1)}px (density: ${densityAdjustment.toFixed(2)}x, spread: +${spreadAdjustment.toFixed(1)}px, count: +${countAdjustment.toFixed(1)}px)`);

    return Math.round(finalSize);
}

// ENHANCED PERCENTAGE NORMALIZATION - More accurate percentage calculation
function normalizePercentages(clusters, totalPoints) {
    if (clusters.length === 0) return clusters;
    
    console.log(`🧮 Normalizing percentages for ${clusters.length} clusters from ${totalPoints} total points`);
    
    // Recalculate percentages based on actual point counts
    const normalized = clusters.map((cluster, index) => {
        const rawPercentage = (cluster.count / totalPoints) * 100;
        const roundedPercentage = Math.round(rawPercentage);
        
        console.log(`   Cluster ${index}: ${cluster.count}/${totalPoints} = ${rawPercentage.toFixed(2)}% → ${roundedPercentage}%`);
        
        return {
            ...cluster,
            percentage: roundedPercentage
        };
    });
    
    // Handle rounding errors - ensure percentages sum reasonably
    const currentTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    const expectedTotal = 100;
    const difference = expectedTotal - currentTotal;
    
    console.log(`   📊 Percentage sum: ${currentTotal}% (expected: ${expectedTotal}%, difference: ${difference}%)`);
    
    // Only adjust if difference is significant and we have clusters
    if (Math.abs(difference) >= 2 && normalized.length > 0) {
        // Distribute the difference proportionally among larger clusters
        const largeClusters = normalized.filter(c => c.percentage >= 5);
        
        if (largeClusters.length > 0) {
            const adjustmentPerCluster = Math.round(difference / largeClusters.length);
            largeClusters.forEach(cluster => {
                cluster.percentage += adjustmentPerCluster;
            });
            
            console.log(`   🔧 Adjusted ${largeClusters.length} large clusters by ${adjustmentPerCluster}% each`);
        } else {
            // If no large clusters, adjust the biggest one
            const largest = normalized.reduce((max, current) => 
                current.percentage > max.percentage ? current : max
            );
            largest.percentage += difference;
            
            console.log(`   🔧 Adjusted largest cluster by ${difference}%`);
        }
    }
    
    const finalTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    console.log(`   ✅ Final percentage sum: ${finalTotal}%`);
    
    return normalized;
}

// Merge two clusters into one
function mergeTwoClusters(cluster1, cluster2) {
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;
    
    // Calculate new centroid (weighted by cluster sizes)
    const weight1 = cluster1.count / totalCount;
    const weight2 = cluster2.count / totalCount;
    
    const newX = cluster1.x * weight1 + cluster2.x * weight2;
    const newY = cluster1.y * weight1 + cluster2.y * weight2;
    
    // Recalculate metrics for merged cluster
    const mergedMetrics = calculateBasicClusterMetrics(allPoints, totalCount);
    
    return {
        ...mergedMetrics,
        x: newX,
        y: newY,
        points: allPoints,
        id: cluster1.id // Keep first cluster's ID
    };
}

// Calculate basic cluster metrics
function calculateBasicClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    // Calculate centroid
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    // Calculate spread
    const distances = clusterPoints.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );

    // Basic shape metrics
    const density = count / (Math.PI * Math.pow(maxDistance || 0.001, 2));
    const compactness = avgDistance / (maxDistance || 0.001);
    
    // Rough size estimation for visual merging
    const estimatedSize = Math.max(60, Math.min(250, 80 + percentage * 2 + maxDistance * 200));

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
        compactness,
        estimatedSize
    };
}

// INTELLIGENT SHAPE ANALYSIS - Determine optimal representation
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

    // Calculate shape metrics
    const shapeMetrics = calculateAdvancedShapeMetrics(points, centroidX, centroidY);
    
    // Circularity test
    const circularityScore = calculateCircularityScore(points, centroidX, centroidY, shapeMetrics);
    
    // Decision making
    const useCircle = shouldUseCircularRepresentation(circularityScore, shapeMetrics, points.length);
    
    if (useCircle) {
        return {
            shapeType: 'circle',
            circularity: circularityScore,
            eccentricity: shapeMetrics.eccentricity,
            irregularity: shapeMetrics.irregularity,
            convexity: shapeMetrics.convexity,
            preferredSides: 8,
            complexity: shapeMetrics.complexity,
            shapeConfidence: 1 - shapeMetrics.irregularity,
            polygonPoints: null
        };
    } else {
        // Generate intelligent polygon
        const polygonShape = generateIntelligentPolygon(points, centroidX, centroidY, shapeMetrics);
        return {
            shapeType: polygonShape.type,
            circularity: circularityScore,
            eccentricity: shapeMetrics.eccentricity,
            irregularity: shapeMetrics.irregularity,
            convexity: shapeMetrics.convexity,
            preferredSides: polygonShape.sides,
            complexity: shapeMetrics.complexity,
            shapeConfidence: polygonShape.confidence,
            polygonPoints: polygonShape.points,
            shapeOrientation: polygonShape.orientation
        };
    }
}

// ADVANCED SHAPE METRICS calculation
function calculateAdvancedShapeMetrics(points, centroidX, centroidY) {
    // Calculate distances from centroid
    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );

    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    // Standard deviation of distances
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const distanceStdDev = Math.sqrt(distanceVariance);

    // Eccentricity calculation
    const eccentricity = calculateEccentricity(points);
    
    // Convex hull analysis
    const hull = calculateConvexHull(points);
    const hullArea = calculatePolygonArea(hull);
    const boundingArea = calculateBoundingArea(points);
    const convexity = hullArea / (boundingArea || 0.001);
    
    // Irregularity measure
    const irregularity = Math.min(1, (distanceStdDev / avgDistance) + (1 - convexity) * 0.5);
    
    // Overall complexity score
    const complexity = (irregularity * 0.4) + (eccentricity * 0.4) + ((1 - convexity) * 0.2);

    return {
        avgDistance,
        maxDistance,
        minDistance,
        distanceStdDev,
        eccentricity,
        convexity,
        irregularity,
        complexity,
        hull,
        hullArea,
        boundingArea
    };
}

// CIRCULARITY SCORE calculation
function calculateCircularityScore(points, centroidX, centroidY, metrics) {
    if (points.length === 1) return 1.0;

    // Distance consistency
    const distanceConsistency = 1 - Math.min(1, metrics.distanceStdDev / metrics.avgDistance);
    
    // Convexity score
    const convexityScore = metrics.convexity;
    
    // Aspect ratio score
    const aspectRatioScore = 1 - Math.min(1, metrics.eccentricity);
    
    // Area efficiency
    const areaEfficiency = metrics.hullArea / (Math.PI * Math.pow(metrics.maxDistance, 2));
    
    // Weighted combination
    const circularity = (
        distanceConsistency * 0.4 +
        convexityScore * 0.25 +
        aspectRatioScore * 0.25 +
        Math.min(1, areaEfficiency) * 0.1
    );

    return Math.max(0, Math.min(1, circularity));
}

// Should use circular representation?
function shouldUseCircularRepresentation(circularityScore, metrics, pointCount) {
    const CIRCULARITY_THRESHOLD = 0.7;
    const LOW_COMPLEXITY_THRESHOLD = 0.3;
    const MIN_POINTS_FOR_POLYGON = 3;
    
    if (pointCount < MIN_POINTS_FOR_POLYGON) return true;
    if (circularityScore >= CIRCULARITY_THRESHOLD) return true;
    if (metrics.complexity <= LOW_COMPLEXITY_THRESHOLD) return true;
    if (circularityScore >= 0.5 && metrics.irregularity <= 0.4) return true;
    
    return false;
}

// Generate intelligent polygon
function generateIntelligentPolygon(points, centroidX, centroidY, metrics) {
    const pointCount = points.length;
    
    let polygonType, sides, confidence;
    
    if (pointCount <= 4) {
        polygonType = 'simple_polygon';
        sides = Math.max(pointCount, 4);
        confidence = 0.8;
    } else if (metrics.convexity >= 0.8 && metrics.irregularity <= 0.5) {
        polygonType = 'regular_polygon';
        sides = calculateOptimalSides(metrics, pointCount);
        confidence = 0.9 - metrics.irregularity;
    } else if (metrics.eccentricity > 0.6) {
        polygonType = 'elliptical_polygon';
        sides = Math.max(6, Math.min(12, Math.floor(pointCount * 0.8)));
        confidence = 0.8;
    } else {
        polygonType = metrics.convexity >= 0.6 ? 'adaptive_polygon' : 'hull_polygon';
        sides = Math.max(5, Math.min(16, Math.floor(pointCount * 0.7)));
        confidence = 0.7 + metrics.convexity * 0.2;
    }

    // Generate polygon points
    let polygonPoints;
    let orientation = 0;
    
    switch (polygonType) {
        case 'hull_polygon':
            polygonPoints = generateHullBasedPolygon(points, metrics.hull);
            break;
        case 'elliptical_polygon':
            const ellipseParams = calculateEllipseParameters(points, centroidX, centroidY);
            polygonPoints = generateEllipticalPolygon(centroidX, centroidY, ellipseParams, sides);
            orientation = ellipseParams.orientation;
            break;
        case 'adaptive_polygon':
            polygonPoints = generateAdaptivePolygon(points, centroidX, centroidY, sides, metrics);
            break;
        default:
            polygonPoints = generateRegularPolygon(centroidX, centroidY, metrics.maxDistance, sides);
            break;
    }

    return {
        type: polygonType,
        sides: sides,
        points: polygonPoints,
        confidence: confidence,
        orientation: orientation
    };
}

// Utility functions
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateEccentricity(points) {
    if (points.length < 2) return 0;

    const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

    let cxx = 0, cyy = 0, cxy = 0;
    for (const point of points) {
        const dx = point.x - meanX;
        const dy = point.y - meanY;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }

    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;

    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;

    if (discriminant < 0) return 0;

    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;

    const minLambda = Math.min(lambda1, lambda2);
    const maxLambda = Math.max(lambda1, lambda2);

    if (maxLambda === 0) return 0;
    return 1 - (minLambda / maxLambda);
}

function calculateConvexHull(points) {
    if (points.length < 3) return points;

    let bottom = points[0];
    for (const point of points) {
        if (point.y < bottom.y || (point.y === bottom.y && point.x < bottom.x)) {
            bottom = point;
        }
    }

    const sortedPoints = points.filter(p => p !== bottom).sort((a, b) => {
        const angleA = Math.atan2(a.y - bottom.y, a.x - bottom.x);
        const angleB = Math.atan2(b.y - bottom.y, b.x - bottom.x);
        return angleA - angleB;
    });

    const hull = [bottom];
    for (const point of sortedPoints) {
        while (hull.length > 1 && crossProduct(hull[hull.length-2], hull[hull.length-1], point) <= 0) {
            hull.pop();
        }
        hull.push(point);
    }

    return hull;
}

function crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function calculatePolygonArea(points) {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

function calculateBoundingArea(points) {
    if (points.length === 0) return 0;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    
    return width * height;
}

// Placeholder polygon generation functions (simplified)
function calculateOptimalSides(metrics, pointCount) {
    const complexityFactor = Math.min(1, metrics.complexity * 2);
    const countFactor = Math.min(1, pointCount / 20);
    const baseSides = 6;
    const additionalSides = Math.floor((complexityFactor + countFactor) * 6);
    return Math.max(4, Math.min(14, baseSides + additionalSides));
}

function generateHullBasedPolygon(points, hull) {
    if (!hull || hull.length < 3) {
        const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        const avgDistance = points.reduce((sum, p) => 
            sum + Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2)), 0) / points.length;
        return generateRegularPolygon(centroidX, centroidY, avgDistance, 6);
    }
    return hull;
}

function generateRegularPolygon(centerX, centerY, radius, sides) {
    const points = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        points.push({
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        });
    }
    
    return points;
}

function calculateEllipseParameters(points, centerX, centerY) {
    // Simplified ellipse calculation
    let cxx = 0, cyy = 0, cxy = 0;
    
    for (const point of points) {
        const dx = point.x - centerX;
        const dy = point.y - centerY;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }
    
    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;
    
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) {
        const avgDist = Math.sqrt(cxx + cyy);
        return { majorAxis: avgDist, minorAxis: avgDist, orientation: 0 };
    }
    
    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    const lambda2 = (trace - Math.sqrt(discriminant)) / 2;
    
    const majorAxis = Math.sqrt(Math.max(lambda1, lambda2)) * 2;
    const minorAxis = Math.sqrt(Math.min(lambda1, lambda2)) * 2;
    
    let orientation = 0;
    if (Math.abs(cxy) > 1e-10) {
        orientation = Math.atan2(lambda1 - cxx, cxy);
    }
    
    return { majorAxis, minorAxis, orientation };
}

function generateEllipticalPolygon(centerX, centerY, ellipseParams, sides) {
    const points = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        const localX = ellipseParams.majorAxis * Math.cos(angle);
        const localY = ellipseParams.minorAxis * Math.sin(angle);
        
        const rotatedX = localX * Math.cos(ellipseParams.orientation) - localY * Math.sin(ellipseParams.orientation);
        const rotatedY = localX * Math.sin(ellipseParams.orientation) + localY * Math.cos(ellipseParams.orientation);
        
        points.push({
            x: centerX + rotatedX,
            y: centerY + rotatedY
        });
    }
    
    return points;
}

function generateAdaptivePolygon(points, centerX, centerY, sides, metrics) {
    const polygonPoints = [];
    const angleStep = (2 * Math.PI) / sides;
    
    for (let i = 0; i < sides; i++) {
        const angle = i * angleStep;
        const idealRadius = calculateDirectionalRadius(points, centerX, centerY, angle, metrics.maxDistance);
        
        const x = centerX + idealRadius * Math.cos(angle);
        const y = centerY + idealRadius * Math.sin(angle);
        
        polygonPoints.push({ x, y });
    }
    
    return polygonPoints;
}

function calculateDirectionalRadius(points, centerX, centerY, direction, maxRadius) {
    const directionVector = { x: Math.cos(direction), y: Math.sin(direction) };
    let maxProjection = 0;
    
    for (const point of points) {
        const toPoint = { x: point.x - centerX, y: point.y - centerY };
        const projection = toPoint.x * directionVector.x + toPoint.y * directionVector.y;
        
        if (projection > 0) {
            maxProjection = Math.max(maxProjection, projection);
        }
    }
    
    return Math.max(maxRadius * 0.3, Math.min(maxRadius, maxProjection * 1.1));
}

// ==================== END OF CLUSTERING ALGORITHM ====================

// Enhanced WebSocket broadcasting function with performance optimization
function broadcastToChannel(channelId, data) {
    if (!wss || !connectedClients) return;
    
    const broadcastStart = performance.now();
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    // REAL-TIME OPTIMIZATION: Pre-stringify message once
    let message;
    try {
        message = JSON.stringify(data);
    } catch (error) {
        console.error('Failed to stringify broadcast data:', error);
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
                console.error('WebSocket send error:', error);
                clients.delete(ws);
                failedCount++;
            }
        } else {
            clients.delete(ws);
            failedCount++;
        }
    });

    const broadcastTime = performance.now() - broadcastStart;
    
    if (sentCount > 0) {
        console.log(`📡 Real-time broadcast to ${channelId}: ${sentCount} clients, ${data.clusters?.length || 0} clusters in ${broadcastTime.toFixed(2)}ms`);
        if (failedCount > 0) {
            console.log(`   ⚠️ Cleaned up ${failedCount} stale connections`);
        }
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
        console.error('Failed to stringify config data:', error);
        return;
    }

    let sentCount = 0;
    
    configPanels.forEach((ws, sessionId) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('Config panel send error:', error);
                configPanels.delete(sessionId);
            }
        } else {
            configPanels.delete(sessionId);
        }
    });
    
    if (sentCount > 0) {
        console.log(`📡 Config panel broadcast: ${sentCount} panels`);
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
        console.log(`📡 Broadcast to all: ${totalSent} clients`);
    }
}

// FIXED: Create servers BEFORE registering instance
console.log('🔧 Creating HTTP server...');
httpServer = createServer(app);

console.log('🔧 Creating WebSocket server integrated with HTTP server...');
try {
    wss = new WebSocketServer({
        server: httpServer,
        perMessageDeflate: false,
        clientTracking: true
    });
    console.log('✅ WebSocket server integrated with HTTP server on single port');
} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// Handle WebSocket upgrade requests explicitly
httpServer.on('upgrade', (request, socket, head) => {
    console.log('🔗 WebSocket upgrade request received:');
    console.log(`   URL: ${request.url}`);

    if (request.url && request.url.startsWith('/ws/')) {
        console.log('✅ Valid WebSocket path, handling upgrade...');
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log('❌ Invalid WebSocket path, closing connection');
        socket.destroy();
    }
});

// Enhanced WebSocket connection handling for real-time performance
wss.on('connection', async (ws, req) => {
    const startTime = Date.now();
    console.log(`🔗 NEW REAL-TIME WEBSOCKET CONNECTION`);
    console.log(`   URL: ${req.url}`);

    let channelId = null;
    let sessionId = null;
    let isConfigPanel = false;

    if (req.url) {
        const match = req.url.match(/\/ws\/([^?&\/]+)/);
        if (match) {
            const identifier = match[1];
            
            // Check if it's a config panel
            if (identifier.startsWith('config_')) {
                isConfigPanel = true;
                sessionId = identifier;
                console.log(`   Config panel: ${sessionId}`);
            } else {
                channelId = identifier;
                console.log(`   Channel: ${channelId}`);
            }
        }
    }

    if (isConfigPanel && sessionId) {
        // Track config panel
        configPanels.set(sessionId, ws);
        console.log(`✅ Config panel connected: ${sessionId} (Total: ${configPanels.size})`);
        
        // Send initial state
        const initialData = await getCurrentHeatmapData('all');
        initialData.type = 'state_update';
        initialData.instanceId = INSTANCE_ID;
        ws.send(JSON.stringify(initialData));
        
    } else if (channelId) {
        // Track channel client
        if (!connectedClients.has(channelId)) {
            connectedClients.set(channelId, new Set());
        }
        connectedClients.get(channelId).add(ws);

        const clientCount = connectedClients.get(channelId).size;
        const totalClients = wss.clients.size;

        console.log(`✅ Real-time WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

        // REAL-TIME OPTIMIZATION: Send initial data immediately with minimal delay
        const sendStart = performance.now();
        try {
            const initialData = await getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
            const sendTime = performance.now() - sendStart;
            console.log(`📨 Initial data sent in ${sendTime.toFixed(2)}ms: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
        } catch (error) {
            console.error('❌ Error sending initial data:', error);
        }
    }

    // Handle messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else if (data.type === 'config_panel') {
                console.log('Config panel identified:', data.sessionId);
            }
            
        } catch (error) {
            console.error('Message parse error:', error);
        }
    });

    // Enhanced connection handling for real-time reliability
    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        
        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
            console.log(`🔒 Config panel disconnected: ${sessionId} after ${duration}ms`);
        } else if (channelId) {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            console.log(`🔒 Real-time WebSocket disconnected: ${channelId} after ${duration}ms (code: ${code})`);
        }
    });

    // Enhanced error handling
    ws.on('error', (error) => {
        console.error(`❌ Real-time WebSocket error for ${channelId || sessionId}:`, error);
    });

    // Optional: Real-time ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Real-time connection health monitoring
const connectionHealthInterval = setInterval(() => {
    if (!wss) return;
    
    let totalConnections = 0;
    let healthyConnections = 0;
    
    wss.clients.forEach((ws) => {
        totalConnections++;
        if (ws.isAlive === false) {
            ws.terminate();
            console.log('🧹 Terminated unhealthy WebSocket connection');
        } else {
            healthyConnections++;
            ws.isAlive = false;
            ws.ping();
        }
    });
    
    if (totalConnections > 0) {
        console.log(`💓 Real-time health check: ${healthyConnections}/${totalConnections} connections healthy`);
    }
}, 30000); // Check every 30 seconds

// FIXED: Enhanced graceful shutdown
async function gracefulShutdown() {
    console.log('📝 Shutting down real-time server...');
    
    // Clear intervals
    if (typeof connectionHealthInterval !== 'undefined') {
        clearInterval(connectionHealthInterval);
    }

    // Close WebSocket connections
    if (wss) {
        wss.clients.forEach((ws) => {
            try {
                ws.close(1001, 'Server shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });
    }

    // Close Redis connections
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
        console.log('✅ Redis connections closed');
    } catch (error) {
        console.error('❌ Error closing Redis:', error);
    }

    if (PERFORMANCE_MONITORING) {
        const uptime = Date.now() - performanceStats.startTime;
        console.log(`📊 Final performance stats:`);
        console.log(`   Total requests: ${performanceStats.totalRequests}`);
        console.log(`   Uptime: ${Math.floor(uptime / 1000)}s`);
        console.log(`   Requests/sec: ${Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100}`);
    }

    if (httpServer) {
        httpServer.close(() => {
            console.log('✅ Server closed gracefully');
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
    console.error('❌ Uncaught Exception:', error);
    // Don't exit immediately, try graceful shutdown
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Log but don't exit for promise rejections
});

// FIXED: Safe instance registration and server startup
async function safeRegisterInstance() {
    try {
        await registerInstance();
    } catch (error) {
        console.error('Failed to register instance:', error);
    }
}

// NOW register instance (after servers are created)
await safeRegisterInstance();
setInterval(safeRegisterInstance, 20000);

// Enhanced startup
httpServer.listen(PORT, '0.0.0.0', async () => {
    console.log('🚀 ClickMap EBS v5.0.0 REDIS PUBSUB WITH FULL CLUSTERING');
    console.log(`📡 Instance ID: ${INSTANCE_ID}`);
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 Real-time WebSocket: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`💾 Redis connected: ${redis.isReady}`);
    console.log(`📢 PubSub active: ${redisSub.isReady && redisPub.isReady}`);
    console.log(`⚡ Performance monitoring: ${PERFORMANCE_MONITORING ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🎯 Target latency: <10ms click processing, <5ms broadcasting`);
    console.log(`🔄 Features: Redis PubSub, distributed locking, state versioning, full clustering algorithm`);
    
    try {
        const running = await gameState.isRunning();
        console.log(`📊 Game state from Redis: ${running ? 'RUNNING' : 'STOPPED'}`);
        
        const instances = await getActiveInstances();
        console.log(`🎯 Cluster: ${instances.length} active instances`);
    } catch (error) {
        console.error('❌ Failed to get initial state from Redis:', error);
    }

    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log(`   Config panels: ${configPanels.size}`);
        console.log(`   Redis ready: ${redis.isReady}`);
        console.log(`   PubSub ready: ${redisSub.isReady && redisPub.isReady}`);
        console.log('🎊 Redis-powered real-time clustering server with autoscaling fully operational!');
    }, 1000);
});

export default httpServer;
