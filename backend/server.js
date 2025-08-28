import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('🚨 UNCAUGHT EXCEPTION:', error);
    console.error('Stack:', error.stack);
    // Don't exit immediately, log and continue
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
    // Don't exit immediately, log and continue
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

        redis.on('error', (err) => {
            console.error('❌ Redis error:', err);
            redisConnected = false;
        });

        redis.on('connect', () => {
            console.log('✅ Redis connecting...');
        });

        redis.on('ready', () => {
            console.log('✅ Redis connected and ready');
            redisConnected = true;
        });

        redis.on('reconnecting', () => {
            console.log('🔄 Redis reconnecting...');
            redisConnected = false;
        });

        await redis.connect();
    } catch (error) {
        console.error('❌ Redis connection failed:', error);
        useRedis = false;
        clicks = new Map();
    }
} else {
    clicks = new Map();
    console.log('💾 Using in-memory storage');
}

// System state
let isRunning = false;
let systemStats = {
    startTime: Date.now(),
    totalRequests: 0,
    errors: 0,
    crashes: 0
};

// Express and WebSocket setup
const app = express();
const server = createServer(app);

// Enhanced CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, postman, etc.)
        if (!origin) return callback(null, true);

        // Allow all origins for now (you can restrict this later)
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Enhanced security headers
app.use((req, res, next) => {
    // Essential CORS headers (backup)
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // Other security headers
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-XSS-Protection': '1; mode=block'
    });
    next();
});

// Request tracking middleware
app.use((req, res, next) => {
    systemStats.totalRequests++;
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;

        if (res.statusCode >= 400) {
            systemStats.errors++;
        }

        // Only log non-health check requests or slow requests
        if (req.path !== '/health' || duration > 100 || res.statusCode >= 400) {
            const status = res.statusCode >= 400 ? '❌' : '✅';
            console.log(`${status} [${res.statusCode}] ${req.method} ${req.path} - ${duration}ms`);
        }
    });
    next();
});

// Enhanced error handling middleware
app.use((error, req, res, next) => {
    console.error('🚨 EXPRESS ERROR:', error);
    systemStats.errors++;

    res.status(500).json({
        error: 'Internal server error',
        timestamp: Date.now(),
        requestId: Math.random().toString(36).substring(7)
    });
});

// --- WebSocket Management with better error handling ---
let wss;
const wsChannels = new Map(); // channelId -> Set<WebSocket>

try {
    wss = new WebSocketServer({
        server,
        perMessageDeflate: false, // Disable compression to reduce memory usage
        maxPayload: 1024 * 1024   // 1MB max message size
    });

    wss.on('connection', (ws, req) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const channelId = url.searchParams.get('channel');

            if (!channelId) {
                ws.close(1008, 'Channel ID required');
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
                    channelId: channelId
                }
            }));

            console.log(`📡 WebSocket: ${channelId} connected (${wsChannels.get(channelId).size} total)`);

            ws.on('close', () => {
                if (wsChannels.has(channelId)) {
                    wsChannels.get(channelId).delete(ws);
                    if (wsChannels.get(channelId).size === 0) {
                        wsChannels.delete(channelId);
                    }
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                if (wsChannels.has(channelId)) {
                    wsChannels.get(channelId).delete(ws);
                }
            });

        } catch (error) {
            console.error('WebSocket connection error:', error);
            ws.close(1011, 'Server error');
        }
    });

    wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
    });

} catch (error) {
    console.error('Failed to create WebSocket server:', error);
}

/**
 * Broadcast message with error handling
 */
function broadcastToChannel(channelId, data) {
    if (!wsChannels.has(channelId)) return;

    try {
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
                console.error('WebSocket send error:', error);
                deadConnections.push(ws);
            }
        });

        // Clean up dead connections
        deadConnections.forEach(ws => connections.delete(ws));

    } catch (error) {
        console.error('Broadcast error:', error);
    }
}

// --- Click Storage Functions with better error handling ---

/**
 * Store a click with error handling
 */
async function storeUserClick(channelId, userId, x, y, timestamp) {
    try {
        const clickData = {
            x: parseFloat(x),
            y: parseFloat(y),
            timestamp: parseInt(timestamp),
            userId: userId
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
        console.error('Store click error:', error);
        return false;
    }
}

/**
 * Get all clicks for a channel with error handling
 */
async function getChannelClicks(channelId) {
    try {
        let clicksArray = [];

        if (useRedis && redisConnected) {
            const keys = await redis.keys(`click:${channelId}:*`);

            for (const key of keys) {
                try {
                    const clickData = await redis.hGetAll(key);
                    if (clickData.x && clickData.y && clickData.userId) {
                        clicksArray.push({
                            x: parseFloat(clickData.x),
                            y: parseFloat(clickData.y),
                            timestamp: parseInt(clickData.timestamp) || Date.now(),
                            userId: clickData.userId
                        });
                    }
                } catch (keyError) {
                    console.error(`Error reading key ${key}:`, keyError);
                }
            }
        } else {
            // Fallback to in-memory
            if (clicks.has(channelId)) {
                clicksArray = Array.from(clicks.get(channelId).values());
            }
        }

        return clicksArray;
    } catch (error) {
        console.error('Get channel clicks error:', error);
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
        } else {
            if (clicks.has(channelId)) {
                clicks.get(channelId).clear();
            }
        }
        console.log(`🗑️ Cleared clicks for channel: ${channelId}`);
        return true;
    } catch (error) {
        console.error('Clear channel clicks error:', error);
        return false;
    }
}

// --- API Endpoints with better error handling ---

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

        // Verify JWT with better error handling
        let payload;
        try {
            payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        } catch (jwtError) {
            console.error('JWT verification error:', jwtError.message);
            return res.status(401).json({ error: 'Invalid or expired token' });
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
            return res.status(500).json({ error: 'Failed to store click' });
        }

        // Broadcast real-time update
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
        console.error('Click processing error:', error);
        systemStats.errors++;
        return res.status(500).json({ error: 'Internal server error' });
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
                message: 'No channel specified'
            });
        }

        // Get all clicks for this channel
        const rawClicks = await getChannelClicks(channelId);
        const uniqueUsers = new Set(rawClicks.map(c => c.userId)).size;

        // Return data
        res.json({
            running: isRunning,
            rawClicks: rawClicks,
            totalClicks: rawClicks.length,
            uniqueUsers: uniqueUsers,
            timestamp: Date.now(),
            channelId: channelId
        });

    } catch (error) {
        console.error('Heatmap generation error:', error);
        systemStats.errors++;
        res.status(500).json({
            error: 'Failed to generate heatmap',
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
            console.log('🚀 Click Mapping STARTED');

            // Broadcast to all channels
            wsChannels.forEach((connections, channelId) => {
                broadcastToChannel(channelId, {
                    type: 'status',
                    data: { running: true, timestamp: Date.now() }
                });
            });
        }

        res.json({
            success: true,
            running: isRunning,
            message: 'Click mapping started',
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Start error:', error);
        res.status(500).json({ error: 'Failed to start' });
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
            console.log('🛑 Click Mapping STOPPED');

            // Broadcast to all channels
            wsChannels.forEach((connections, channelId) => {
                broadcastToChannel(channelId, {
                    type: 'status',
                    data: { running: false, timestamp: Date.now() }
                });
            });
        }

        res.json({
            success: true,
            running: isRunning,
            message: 'Click mapping stopped',
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Stop error:', error);
        res.status(500).json({ error: 'Failed to stop' });
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
                broadcastToChannel(channelId, {
                    type: 'reset',
                    data: { channelId, timestamp: Date.now() }
                });
            }

            res.json({
                success: cleared,
                message: cleared ? `Channel ${channelId} reset` : 'Failed to reset channel',
                timestamp: Date.now()
            });

        } else {
            // Reset all channels
            let totalCleared = 0;

            if (useRedis && redisConnected) {
                try {
                    const keys = await redis.keys('click:*');
                    if (keys.length > 0) {
                        await redis.del(keys);
                        totalCleared = keys.length;
                    }
                } catch (redisError) {
                    console.error('Redis reset error:', redisError);
                }
            } else {
                clicks.forEach(channelMap => {
                    totalCleared += channelMap.size;
                });
                clicks.clear();
            }

            // Broadcast to all channels
            wsChannels.forEach((connections, channelId) => {
                broadcastToChannel(channelId, {
                    type: 'reset',
                    data: { timestamp: Date.now() }
                });
            });

            console.log(`🗑️ Reset complete: ${totalCleared} clicks cleared`);

            res.json({
                success: true,
                message: `All channels reset (${totalCleared} clicks cleared)`,
                timestamp: Date.now()
            });
        }

    } catch (error) {
        console.error('Reset error:', error);
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
            system: {
                totalRequests: systemStats.totalRequests,
                errors: systemStats.errors,
                errorRate: systemStats.totalRequests > 0 ? (systemStats.errors / systemStats.totalRequests * 100).toFixed(2) + '%' : '0%'
            },
            websockets: {
                totalConnections: Array.from(wsChannels.values()).reduce((sum, set) => sum + set.size, 0),
                activeChannels: wsChannels.size
            }
        };

        // Check Redis if enabled
        if (useRedis) {
            try {
                if (redisConnected) {
                    const pong = await redis.ping();
                    health.redis = pong === 'PONG' ? 'connected' : 'error';
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

        // Check if error rate is too high
        if (systemStats.errors / systemStats.totalRequests > 0.1) {
            health.status = 'degraded';
        }

        res.json(health);

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: Date.now()
        });
    }
});

// Handle 404s
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: Date.now()
    });
});

// --- Enhanced Graceful Shutdown ---
let shutdownInProgress = false;

async function gracefulShutdown(signal) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close((err) => {
        if (err) {
            console.error('Error closing HTTP server:', err);
        } else {
            console.log('🔒 HTTP server closed');
        }
    });

    // Close WebSocket connections
    if (wss) {
        try {
            let totalClosed = 0;
            wsChannels.forEach((connections, channelId) => {
                connections.forEach(ws => {
                    try {
                        ws.close(1000, 'Server shutting down');
                        totalClosed++;
                    } catch (error) {
                        console.error('Error closing WebSocket:', error);
                    }
                });
            });
            console.log(`🔌 Closed ${totalClosed} WebSocket connections`);

            wss.close(() => {
                console.log('🔌 WebSocket server closed');
            });
        } catch (error) {
            console.error('Error closing WebSocket server:', error);
        }
    }

    // Close Redis connection
    if (useRedis && redis) {
        try {
            await redis.disconnect();
            console.log('🔴 Redis disconnected');
        } catch (error) {
            console.error('Redis disconnect error:', error);
        }
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Force exit after longer timeout
const forceExitTimeout = setTimeout(() => {
    console.error('⏰ Force shutdown after 30 seconds timeout');
    process.exit(1);
}, 30000); // Increased from 15 to 30 seconds

// Clear timeout if we shut down gracefully
process.on('exit', () => {
    clearTimeout(forceExitTimeout);
});

// --- Start Server ---
const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.log('\n🚀 Ex Machina Smart ClickMap Server');
            console.log(`📍 Port: ${PORT}`);
            console.log(`💾 Storage: ${useRedis ? (redisConnected ? 'Redis (Connected)' : 'Redis (Connecting...)') : 'In-Memory'}`);
            console.log(`📡 WebSocket: ${wss ? 'Enabled' : 'Disabled'}`);
            console.log(`🔒 JWT Verification: Enabled`);
            console.log(`🌐 CORS: Enhanced (All origins)`);
            console.log(`⚡ Status: ${isRunning ? 'Running' : 'Stopped'}`);
            console.log(`🛡️ Error Handling: Enhanced`);

            if (process.env.NODE_ENV === 'development') {
                console.log(`🛠️ Development mode active`);
            }

            console.log(''); // Empty line for readability
        });

        server.on('error', (error) => {
            console.error('Server error:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use`);
                process.exit(1);
            }
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();