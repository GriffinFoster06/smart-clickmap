import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Enhanced error handling and logging
process.on('uncaughtException', (error) => {
    console.error('💥 UNCAUGHT EXCEPTION:', error);
    console.error('Stack:', error.stack);
    // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
    // Don't exit - keep server running  
});

// Redis setup with better error handling
const useRedis = !!process.env.REDIS_URL;
let redis;
let clicks; // Map<channelId, Map<userId, {x, y, timestamp, userId}>>
let redisConnected = false;

if (useRedis) {
    try {
        redis = Redis.createClient({ 
            url: process.env.REDIS_URL,
            socket: {
                reconnectStrategy: (retries) => Math.min(retries * 50, 500)
            }
        });
        
        redis.on('connect', () => {
            console.log('✅ Redis connecting...');
        });
        
        redis.on('ready', () => {
            console.log('✅ Redis connected and ready');
            redisConnected = true;
        });
        
        redis.on('error', (err) => {
            console.error('❌ Redis error:', err);
            redisConnected = false;
        });
        
        redis.on('end', () => {
            console.log('⚠️ Redis connection ended');
            redisConnected = false;
        });
        
        await redis.connect();
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
        console.log('📦 Falling back to in-memory storage');
        useRedis = false;
        clicks = new Map();
    }
} else {
    clicks = new Map();
    console.log('💾 Using in-memory storage (no Redis)');
}

// System state
let isRunning = false;
let systemStats = {
    startTime: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
    lastError: null
};

// Express and WebSocket setup
const app = express();
const server = createServer(app);

// Enhanced CORS with better error handling
app.use((req, res, next) => {
    // Always set CORS headers, even for errors
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Standard CORS middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

app.use(express.json({ 
    limit: '10mb',
    type: ['application/json', 'text/plain']
}));

// Enhanced error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Express error:', err);
    systemStats.totalErrors++;
    systemStats.lastError = {
        message: err.message,
        timestamp: Date.now(),
        path: req.path
    };
    
    // Always include CORS headers in error responses
    res.header('Access-Control-Allow-Origin', '*');
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        timestamp: Date.now()
    });
});

// Request logging and stats
app.use((req, res, next) => {
    systemStats.totalRequests++;
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO';
        const emoji = res.statusCode >= 500 ? '💥' : res.statusCode >= 400 ? '⚠️' : '✅';
        
        console.log(`${emoji} [${logLevel}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        
        if (res.statusCode >= 400) {
            systemStats.totalErrors++;
        }
    });
    
    next();
});

// Enhanced WebSocket setup
let wss;
const wsChannels = new Map(); // channelId -> Set<WebSocket>

try {
    wss = new WebSocketServer({ 
        server,
        verifyClient: (info) => {
            // Basic verification
            return true;
        }
    });

    wss.on('connection', (ws, req) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const channelId = url.searchParams.get('channel');
            
            if (!channelId) {
                ws.close(1008, 'Channel ID required in query param');
                return;
            }

            // Add to channel connections
            if (!wsChannels.has(channelId)) {
                wsChannels.set(channelId, new Set());
            }
            wsChannels.get(channelId).add(ws);

            // Send initial status
            ws.send(JSON.stringify({
                type: 'status',
                data: { 
                    running: isRunning, 
                    timestamp: Date.now(),
                    channelId: channelId,
                    serverStatus: 'healthy'
                }
            }));

            console.log(`📡 WebSocket connected: ${channelId} (${wsChannels.get(channelId).size} total)`);

            ws.on('close', () => {
                try {
                    if (wsChannels.has(channelId)) {
                        wsChannels.get(channelId).delete(ws);
                        if (wsChannels.get(channelId).size === 0) {
                            wsChannels.delete(channelId);
                            console.log(`📡 Channel disconnected: ${channelId}`);
                        }
                    }
                } catch (error) {
                    console.error('WebSocket close error:', error);
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
            
        } catch (error) {
            console.error('WebSocket connection error:', error);
            ws.close(1011, 'Internal server error');
        }
    });
    
} catch (error) {
    console.error('❌ WebSocket server setup failed:', error);
}

/**
 * Broadcast message to all WebSocket connections for a channel
 */
function broadcastToChannel(channelId, data) {
    if (!wsChannels.has(channelId)) return;
    
    const message = JSON.stringify(data);
    const connections = wsChannels.get(channelId);
    const deadConnections = [];
    
    connections.forEach(ws => {
        try {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            } else {
                deadConnections.push(ws);
            }
        } catch (error) {
            console.error('WebSocket broadcast error:', error);
            deadConnections.push(ws);
        }
    });
    
    // Clean up dead connections
    deadConnections.forEach(ws => connections.delete(ws));
}

// --- Enhanced Click Storage Functions ---

/**
 * Store a click with better error handling
 */
async function storeUserClick(channelId, userId, x, y, timestamp) {
    try {
        const clickData = { 
            x: parseFloat(x), 
            y: parseFloat(y), 
            timestamp: parseInt(timestamp), 
            userId: String(userId)
        };
        
        if (useRedis && redisConnected) {
            const key = `click:${channelId}:${userId}`;
            await redis.hSet(key, clickData);
        } else {
            // Fallback to in-memory storage
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(userId, clickData);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Store click error:', error);
        
        // Always try in-memory as fallback
        try {
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(userId, { x, y, timestamp, userId });
            return true;
        } catch (fallbackError) {
            console.error('❌ Fallback storage failed:', fallbackError);
            return false;
        }
    }
}

/**
 * Get all clicks for a channel with error handling
 */
async function getChannelClicks(channelId) {
    try {
        let clicksArray = [];
        
        if (useRedis && redisConnected) {
            try {
                const keys = await redis.keys(`click:${channelId}:*`);
                
                for (const key of keys) {
                    try {
                        const clickData = await redis.hGetAll(key);
                        if (clickData.x && clickData.y && clickData.userId) {
                            clicksArray.push({
                                x: parseFloat(clickData.x),
                                y: parseFloat(clickData.y),
                                timestamp: parseInt(clickData.timestamp) || Date.now(),
                                userId: String(clickData.userId)
                            });
                        }
                    } catch (keyError) {
                        console.error(`Error processing key ${key}:`, keyError);
                    }
                }
            } catch (redisError) {
                console.error('Redis query failed, using fallback:', redisError);
                redisConnected = false;
                // Fall through to in-memory fallback
            }
        }
        
        // Use in-memory storage if Redis failed or not available
        if ((!useRedis || !redisConnected) && clicks.has(channelId)) {
            clicksArray = Array.from(clicks.get(channelId).values());
        }
        
        return clicksArray;
        
    } catch (error) {
        console.error('❌ Get channel clicks error:', error);
        return [];
    }
}

/**
 * Clear clicks with error handling
 */
async function clearChannelClicks(channelId) {
    try {
        if (useRedis && redisConnected) {
            const keys = await redis.keys(`click:${channelId}:*`);
            if (keys.length > 0) {
                await redis.del(keys);
            }
        }
        
        // Always clear in-memory storage too
        if (clicks.has(channelId)) {
            clicks.get(channelId).clear();
        }
        
        return true;
    } catch (error) {
        console.error('❌ Clear channel clicks error:', error);
        
        // Try in-memory fallback
        try {
            if (clicks.has(channelId)) {
                clicks.get(channelId).clear();
            }
            return true;
        } catch (fallbackError) {
            console.error('❌ Fallback clear failed:', fallbackError);
            return false;
        }
    }
}

/**
 * Clear all clicks
 */
async function clearAllClicks() {
    try {
        if (useRedis && redisConnected) {
            const keys = await redis.keys('click:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
        }
        
        // Always clear in-memory storage too
        clicks.clear();
        
        return true;
    } catch (error) {
        console.error('❌ Clear all clicks error:', error);
        
        // Try in-memory fallback
        try {
            clicks.clear();
            return true;
        } catch (fallbackError) {
            console.error('❌ Fallback clear all failed:', fallbackError);
            return false;
        }
    }
}

// --- API Endpoints with Enhanced Error Handling ---

/**
 * POST /click - Submit a click coordinate
 */
app.post('/click', async (req, res) => {
    try {
        // Validate authorization
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Authorization required' });
        }
        
        // Verify JWT with error handling
        let payload;
        try {
            payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        } catch (jwtError) {
            console.error('JWT verification error:', jwtError);
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        const { x, y } = req.body;
        const userId = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;
        const timestamp = Date.now();

        // Validate input
        if (typeof x !== 'number' || typeof y !== 'number') {
            return res.status(400).json({ error: 'Coordinates must be numbers' });
        }

        if (x < 0 || x > 1 || y < 0 || y > 1) {
            return res.status(400).json({ error: 'Coordinates must be between 0 and 1' });
        }

        if (!userId || !channelId) {
            return res.status(400).json({ error: 'Invalid token: missing user or channel ID' });
        }

        // Check if system is running
        if (!isRunning) {
            return res.status(400).json({ error: 'Click mapping is not currently running' });
        }

        // Store the click
        const stored = await storeUserClick(channelId, userId, x, y, timestamp);
        
        if (!stored) {
            return res.status(500).json({ error: 'Failed to store click data' });
        }

        // Broadcast real-time update to WebSocket clients
        try {
            broadcastToChannel(channelId, {
                type: 'click',
                data: { x, y, userId, timestamp, channelId }
            });
        } catch (broadcastError) {
            console.error('Broadcast error:', broadcastError);
            // Don't fail the request if broadcast fails
        }

        res.status(200).json({ 
            success: true,
            message: 'Click stored successfully',
            data: { x, y, timestamp }
        });

    } catch (error) {
        console.error('❌ Click processing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /heatmap - Get heatmap data for a channel
 */
app.get('/heatmap', async (req, res) => {
    try {
        const channelId = req.query.channel;
        
        if (!channelId) {
            return res.json({
                running: isRunning,
                rawClicks: [],
                totalClicks: 0,
                uniqueUsers: 0,
                timestamp: Date.now(),
                message: 'No channel specified',
                serverStatus: 'healthy'
            });
        }

        // Get all clicks for this channel
        const rawClicks = await getChannelClicks(channelId);
        const uniqueUsers = new Set(rawClicks.map(c => c.userId)).size;

        // Return raw click data for client-side clustering
        res.json({
            running: isRunning,
            rawClicks: rawClicks,
            totalClicks: rawClicks.length,
            uniqueUsers: uniqueUsers,
            timestamp: Date.now(),
            channelId: channelId,
            serverStatus: 'healthy',
            redisStatus: useRedis ? (redisConnected ? 'connected' : 'disconnected') : 'disabled'
        });

    } catch (error) {
        console.error('❌ Heatmap generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate heatmap',
            serverStatus: 'error',
            timestamp: Date.now()
        });
    }
});

/**
 * POST /start - Start click collection
 */
app.post('/start', (req, res) => {
    try {
        const wasRunning = isRunning;
        isRunning = true;
        
        if (!wasRunning) {
            console.log('🚀 Ex Machina Click Mapping STARTED');
            
            // Broadcast to all connected channels
            wsChannels.forEach((connections, channelId) => {
                broadcastToChannel(channelId, {
                    type: 'status',
                    data: { 
                        running: true, 
                        timestamp: Date.now(),
                        message: 'Click mapping started'
                    }
                });
            });
        }
        
        res.json({
            success: true,
            running: isRunning,
            message: 'Click mapping started',
            timestamp: Date.now(),
            previouslyRunning: wasRunning
        });
        
    } catch (error) {
        console.error('❌ Start error:', error);
        res.status(500).json({ error: 'Failed to start mapping' });
    }
});

/**
 * POST /stop - Stop click collection
 */
app.post('/stop', (req, res) => {
    try {
        const wasRunning = isRunning;
        isRunning = false;
        
        if (wasRunning) {
            console.log('🛑 Ex Machina Click Mapping STOPPED');
            
            // Broadcast to all connected channels
            wsChannels.forEach((connections, channelId) => {
                broadcastToChannel(channelId, {
                    type: 'status',
                    data: { 
                        running: false, 
                        timestamp: Date.now(),
                        message: 'Click mapping stopped'
                    }
                });
            });
        }
        
        res.json({
            success: true,
            running: isRunning,
            message: 'Click mapping stopped',
            timestamp: Date.now(),
            previouslyRunning: wasRunning
        });
        
    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({ error: 'Failed to stop mapping' });
    }
});

/**
 * POST /reset - Clear click data
 */
app.post('/reset', async (req, res) => {
    try {
        const channelId = req.query.channel;
        
        if (channelId) {
            // Reset specific channel
            const cleared = await clearChannelClicks(channelId);
            
            if (cleared) {
                // Broadcast reset to specific channel
                broadcastToChannel(channelId, {
                    type: 'reset',
                    data: { 
                        channelId, 
                        timestamp: Date.now(),
                        message: 'Channel reset'
                    }
                });
                
                res.json({
                    success: true,
                    message: `Channel ${channelId} reset`,
                    channelId: channelId,
                    timestamp: Date.now()
                });
            } else {
                res.status(500).json({ error: 'Failed to reset channel data' });
            }
            
        } else {
            // Reset all channels
            const cleared = await clearAllClicks();
            
            if (cleared) {
                // Broadcast reset to all channels
                wsChannels.forEach((connections, channelId) => {
                    broadcastToChannel(channelId, {
                        type: 'reset',
                        data: { 
                            timestamp: Date.now(),
                            message: 'Global reset'
                        }
                    });
                });
                
                res.json({
                    success: true,
                    message: 'All channels reset',
                    timestamp: Date.now()
                });
            } else {
                res.status(500).json({ error: 'Failed to reset all data' });
            }
        }
        
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({ error: 'Failed to reset click data' });
    }
});

/**
 * GET /health - Enhanced health check
 */
app.get('/health', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            running: isRunning,
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            wsConnections: Array.from(wsChannels.values()).reduce((sum, set) => sum + set.size, 0),
            totalRequests: systemStats.totalRequests,
            totalErrors: systemStats.totalErrors,
            errorRate: systemStats.totalRequests > 0 ? (systemStats.totalErrors / systemStats.totalRequests * 100).toFixed(2) + '%' : '0%',
            lastError: systemStats.lastError
        };
        
        // Check Redis if enabled
        if (useRedis) {
            try {
                if (redisConnected) {
                    await redis.ping();
                    health.redis = 'connected';
                } else {
                    health.redis = 'disconnected';
                    health.status = 'degraded';
                }
            } catch (error) {
                health.redis = 'error';
                health.status = 'degraded';
            }
        } else {
            health.redis = 'disabled';
        }
        
        res.json(health);
        
    } catch (error) {
        console.error('❌ Health check error:', error);
        res.status(500).json({ 
            status: 'unhealthy',
            error: error.message,
            timestamp: Date.now()
        });
    }
});

// Catch all unhandled routes
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: Date.now(),
        availableEndpoints: ['/health', '/heatmap', '/click', '/start', '/stop', '/reset']
    });
});

// --- Enhanced Graceful Shutdown ---
async function gracefulShutdown(signal) {
    console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);
    
    try {
        // Stop accepting new connections
        server.close(() => {
            console.log('🔒 HTTP server closed');
        });
        
        // Close all WebSocket connections
        let totalClosed = 0;
        wsChannels.forEach((connections, channelId) => {
            connections.forEach(ws => {
                try {
                    ws.close(1001, 'Server shutting down');
                    totalClosed++;
                } catch (error) {
                    console.error('Error closing WebSocket:', error);
                }
            });
        });
        console.log(`🔌 Closed ${totalClosed} WebSocket connections`);
        
        // Close Redis connection
        if (useRedis && redis && redisConnected) {
            try {
                await redis.disconnect();
                console.log('🔴 Redis disconnected');
            } catch (error) {
                console.error('Redis disconnect error:', error);
            }
        }
        
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Shutdown error:', error);
        process.exit(1);
    }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Force exit after timeout
setTimeout(() => {
    console.error('⏰ Force shutdown after 15 seconds timeout');
    process.exit(1);
}, 15000);

// --- Start Server ---
const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.log('\n🚀 Ex Machina Smart ClickMap Server');
            console.log(`📍 Port: ${PORT}`);
            console.log(`💾 Storage: ${useRedis ? (redisConnected ? 'Redis (Connected)' : 'Redis (Connecting...)') : 'In-Memory'}`);
            console.log(`📡 WebSocket: ${wss ? 'Enabled' : 'Disabled'}`);
            console.log(`🔒 JWT Verification: Enabled`);
            console.log(`🌐 CORS: All origins allowed`);
            console.log(`⚡ Status: ${isRunning ? 'Running' : 'Stopped'}`);
            console.log(`🛡️ Error Handling: Enhanced`);
            
            if (process.env.NODE_ENV === 'development') {
                console.log(`🛠️ Development mode active`);
            }
            
            console.log('\n✅ Server is ready to handle requests');
            console.log(''); // Empty line for readability
        });
        
        server.on('error', (error) => {
            console.error('❌ Server error:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use`);
                process.exit(1);
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();