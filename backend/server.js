import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Redis setup (optional)
const useRedis = !!process.env.REDIS_URL;
let redis;
let clicks; // Map<channelId, Map<userId, {x, y, timestamp, userId}>>

if (useRedis) {
    redis = Redis.createClient({
        url: process.env.REDIS_URL,
        retry_strategy: (times) => Math.min(times * 50, 2000)
    });

    redis.on('error', (err) => {
        console.error('Redis error:', err);
        // Don't crash the server on Redis errors
    });

    redis.on('connect', () => {
        console.log('✅ Redis connected');
    });

    try {
        await redis.connect();
    } catch (error) {
        console.error('❌ Redis connection failed, falling back to in-memory:', error);
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
    totalClicksReceived: 0,
    totalRequests: 0,
    errors: 0
};

// Express and WebSocket setup
const app = express();
const server = createServer(app);

// Enhanced CORS configuration - THIS IS CRITICAL
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: false,
    optionsSuccessStatus: 200 // For legacy browser support
}));

// Handle preflight requests explicitly
app.options('*', cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Enhanced security and performance headers
app.use((req, res, next) => {
    // CRITICAL: Ensure CORS headers are ALWAYS set
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');

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

// Request logging and stats
app.use((req, res, next) => {
    systemStats.totalRequests++;
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;

        // Log errors and slow requests
        if (status >= 400 || duration > 1000) {
            console.log(`${status >= 400 ? '❌' : '⚠️'} ${req.method} ${req.path} - ${status} (${duration}ms)`);
            if (status >= 400) {
                systemStats.errors++;
            }
        } else if (req.path !== '/health') {
            console.log(`✅ ${req.method} ${req.path} - ${status} (${duration}ms)`);
        }
    });

    next();
});

// Global error handler to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    // Log but don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    // Log but don't exit - keep server running
});

// --- WebSocket Management ---
const wsChannels = new Map(); // channelId -> Set<WebSocket>
let wss;

try {
    wss = new WebSocketServer({
        server,
        perMessageDeflate: false // Disable compression for better performance
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
                    channelId: channelId
                }
            }));

            console.log(`📡 WebSocket connected: ${channelId} (${wsChannels.get(channelId).size} total)`);

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
                // Remove the problematic connection
                if (wsChannels.has(channelId)) {
                    wsChannels.get(channelId).delete(ws);
                }
            });

        } catch (error) {
            console.error('WebSocket connection error:', error);
            ws.close(1011, 'Internal server error');
        }
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server error:', error);
    });

} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
}

/**
 * Broadcast message to all WebSocket connections for a channel
 */
function broadcastToChannel(channelId, data) {
    if (!wsChannels.has(channelId)) return;

    const message = JSON.stringify(data);
    const connections = wsChannels.get(channelId);
    const deadConnections = new Set();

    connections.forEach(ws => {
        try {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            } else {
                deadConnections.add(ws);
            }
        } catch (error) {
            console.error('WebSocket broadcast error:', error);
            deadConnections.add(ws);
        }
    });

    // Clean up dead connections
    deadConnections.forEach(ws => connections.delete(ws));
}

// --- Click Storage Functions ---

/**
 * Store a click (replaces any existing click from same user)
 */
async function storeUserClick(channelId, userId, x, y, timestamp) {
    try {
        const clickData = {
            x: parseFloat(x),
            y: parseFloat(y),
            timestamp: parseInt(timestamp),
            userId: userId
        };

        if (useRedis && redis && redis.isOpen) {
            const key = `click:${channelId}:${userId}`;
            await redis.hSet(key, clickData);
        } else {
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(userId, clickData);
        }

        systemStats.totalClicksReceived++;

    } catch (error) {
        console.error('❌ Click storage error:', error);
        // Fall back to in-memory storage
        if (!clicks.has(channelId)) {
            clicks.set(channelId, new Map());
        }
        clicks.get(channelId).set(userId, { x, y, timestamp, userId });
    }
}

/**
 * Get all clicks for a channel
 */
async function getChannelClicks(channelId) {
    try {
        let clicksArray = [];

        if (useRedis && redis && redis.isOpen) {
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
                    console.error('Error reading click data:', keyError);
                }
            }
        } else {
            if (clicks.has(channelId)) {
                clicksArray = Array.from(clicks.get(channelId).values());
            }
        }

        return clicksArray;

    } catch (error) {
        console.error('❌ Get clicks error:', error);
        // Fall back to in-memory
        return clicks.has(channelId) ? Array.from(clicks.get(channelId).values()) : [];
    }
}

/**
 * Clear all clicks for a channel
 */
async function clearChannelClicks(channelId) {
    try {
        if (useRedis && redis && redis.isOpen) {
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

    } catch (error) {
        console.error('❌ Clear channel clicks error:', error);
        // Fall back to in-memory clear
        if (clicks.has(channelId)) {
            clicks.get(channelId).clear();
        }
    }
}

/**
 * Clear all clicks for all channels
 */
async function clearAllClicks() {
    try {
        if (useRedis && redis && redis.isOpen) {
            const keys = await redis.keys('click:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
        } else {
            clicks.clear();
        }

        console.log('🗑️ Cleared all clicks');

    } catch (error) {
        console.error('❌ Clear all clicks error:', error);
        clicks.clear(); // Fall back to clearing in-memory
    }
}

// --- API Endpoints ---

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

        // Verify JWT
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
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

        // Store the click (replaces previous click from this user)
        await storeUserClick(channelId, userId, x, y, timestamp);

        // Broadcast real-time update to WebSocket clients
        broadcastToChannel(channelId, {
            type: 'click',
            data: {
                x, y,
                userId,
                timestamp,
                channelId
            }
        });

        res.status(200).json({
            success: true,
            message: 'Click stored successfully'
        });

    } catch (error) {
        console.error('❌ Click processing error:', error);

        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

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
                timestamp: Date.now()
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
            channelId: channelId
        });

    } catch (error) {
        console.error('❌ Heatmap generation error:', error);

        // Return safe default response instead of crashing
        res.status(200).json({
            running: isRunning,
            rawClicks: [],
            totalClicks: 0,
            uniqueUsers: 0,
            timestamp: Date.now(),
            error: 'Failed to load data'
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
            timestamp: Date.now()
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
            timestamp: Date.now()
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
            await clearChannelClicks(channelId);

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
            // Reset all channels
            await clearAllClicks();

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
        }

    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({ error: 'Failed to reset click data' });
    }
});

/**
 * GET /health - Health check
 */
app.get('/health', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            running: isRunning,
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            stats: systemStats
        };

        // Check Redis if enabled
        if (useRedis && redis) {
            try {
                if (redis.isOpen) {
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

// --- Error Handling ---
app.use((error, req, res, next) => {
    console.error('❌ Express error handler:', error);
    systemStats.errors++;

    // Send safe error response
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error',
            timestamp: Date.now()
        });
    }
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: Date.now()
    });
});

// --- Graceful Shutdown (FIXED) ---
let shutdownInProgress = false;

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    if (shutdownInProgress) {
        console.log('🔄 Shutdown already in progress...');
        return;
    }

    shutdownInProgress = true;
    console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close((err) => {
        if (err) {
            console.error('❌ Error closing server:', err);
        } else {
            console.log('🔒 HTTP server closed');
        }
    });

    // Close all WebSocket connections
    let totalClosed = 0;
    if (wss) {
        wss.clients.forEach(ws => {
            ws.close(1000, 'Server shutting down');
            totalClosed++;
        });
    }
    console.log(`🔌 Closed ${totalClosed} WebSocket connections`);

    // Close Redis connection
    if (useRedis && redis && redis.isOpen) {
        try {
            await redis.disconnect();
            console.log('🔴 Redis disconnected');
        } catch (error) {
            console.error('❌ Redis disconnect error:', error);
        }
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
}

// --- Start Server ---
server.listen(PORT, () => {
    console.log('\n🚀 Ex Machina Smart ClickMap Server READY');
    console.log(`📍 Port: ${PORT}`);
    console.log(`💾 Storage: ${useRedis ? 'Redis' : 'In-Memory'}`);
    console.log(`📡 WebSocket: ${wss ? 'Enabled' : 'Disabled'}`);
    console.log(`🔒 JWT Verification: Enabled`);
    console.log(`🌐 CORS: Enhanced configuration active`);
    console.log(`⚡ Status: ${isRunning ? 'Running' : 'Stopped'}`);
    console.log(`🛡️ Error Handling: Enhanced`);

    if (process.env.NODE_ENV === 'development') {
        console.log(`🛠️ Development mode active`);
    }

    console.log('🎯 Ready to receive clicks!\n');
});

// Keep the server alive (remove the 15-second force exit)
server.on('error', (error) => {
    console.error('❌ Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
    }
    // Don't exit on other errors - log and continue
});

// Periodic health logging (every 5 minutes)
setInterval(() => {
    const { totalRequests, errors, totalClicksReceived } = systemStats;
    const errorRate = totalRequests > 0 ? (errors / totalRequests * 100).toFixed(1) : 0;
    console.log(`📊 Stats: ${totalRequests} requests, ${errors} errors (${errorRate}%), ${totalClicksReceived} clicks stored`);
}, 300000);