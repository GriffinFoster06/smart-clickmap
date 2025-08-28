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
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    console.log('✅ Redis connected');
} else {
    clicks = new Map();
    console.log('💾 Using in-memory storage (no Redis)');
}

// System state
let isRunning = false;
let systemStats = {
    startTime: Date.now(),
    totalClicksReceived: 0,
    totalUniqueUsers: 0,
    totalChannels: 0
};

// Express and WebSocket setup
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
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

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path !== '/health' || duration > 100) { // Skip health checks unless slow
            console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// --- WebSocket Management ---
const wsChannels = new Map(); // channelId -> Set<WebSocket>

wss.on('connection', (ws, req) => {
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
                console.log(`📡 Channel disconnected: ${channelId}`);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

/**
 * Broadcast message to all WebSocket connections for a channel
 */
function broadcastToChannel(channelId, data) {
    if (!wsChannels.has(channelId)) return;

    const message = JSON.stringify(data);
    const connections = wsChannels.get(channelId);

    connections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
            try {
                ws.send(message);
            } catch (error) {
                console.error('WebSocket broadcast error:', error);
                connections.delete(ws);
            }
        } else {
            connections.delete(ws);
        }
    });
}

// --- Click Storage Functions ---

/**
 * Store a click (replaces any existing click from same user)
 */
async function storeUserClick(channelId, userId, x, y, timestamp) {
    const clickData = {
        x: parseFloat(x),
        y: parseFloat(y),
        timestamp: parseInt(timestamp),
        userId: userId
    };

    if (useRedis) {
        const key = `click:${channelId}:${userId}`;
        await redis.hSet(key, clickData);
        // No expiration - clicks persist until manually reset
    } else {
        if (!clicks.has(channelId)) {
            clicks.set(channelId, new Map());
        }
        clicks.get(channelId).set(userId, clickData);
    }

    // Update stats
    systemStats.totalClicksReceived++;

    console.log(`💾 Stored click: Channel=${channelId}, User=${userId}, Pos=(${x.toFixed(3)}, ${y.toFixed(3)})`);
}

/**
 * Get all clicks for a channel
 */
async function getChannelClicks(channelId) {
    let clicksArray = [];

    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);

        for (const key of keys) {
            const clickData = await redis.hGetAll(key);
            if (clickData.x && clickData.y && clickData.userId) {
                clicksArray.push({
                    x: parseFloat(clickData.x),
                    y: parseFloat(clickData.y),
                    timestamp: parseInt(clickData.timestamp) || Date.now(),
                    userId: clickData.userId
                });
            }
        }
    } else {
        if (clicks.has(channelId)) {
            clicksArray = Array.from(clicks.get(channelId).values());
        }
    }

    return clicksArray;
}

/**
 * Clear all clicks for a channel
 */
async function clearChannelClicks(channelId) {
    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        if (clicks.has(channelId)) {
            clicks.get(channelId).clear();
        }
    }

    console.log(`🗑️  Cleared clicks for channel: ${channelId}`);
}

/**
 * Clear all clicks for all channels
 */
async function clearAllClicks() {
    if (useRedis) {
        const keys = await redis.keys('click:*');
        if (keys.length > 0) {
            await redis.del(keys);
        }
    } else {
        clicks.clear();
    }

    console.log('🗑️  Cleared all clicks');
}

/**
 * Get total statistics
 */
async function getTotalStats() {
    let totalClicks = 0;
    let totalUsers = 0;
    let totalChannels = 0;

    if (useRedis) {
        const keys = await redis.keys('click:*');
        totalClicks = keys.length;

        // Count unique users and channels
        const users = new Set();
        const channels = new Set();

        for (const key of keys) {
            const parts = key.split(':'); // click:channelId:userId
            if (parts.length === 3) {
                channels.add(parts[1]);
                users.add(parts[2]);
            }
        }

        totalUsers = users.size;
        totalChannels = channels.size;
    } else {
        totalChannels = clicks.size;

        clicks.forEach(channelMap => {
            totalClicks += channelMap.size;
        });

        // Count unique users across all channels
        const allUsers = new Set();
        clicks.forEach(channelMap => {
            channelMap.forEach(clickData => {
                allUsers.add(clickData.userId);
            });
        });
        totalUsers = allUsers.size;
    }

    return { totalClicks, totalUsers, totalChannels };
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
            message: 'Click stored successfully',
            data: { x, y, timestamp }
        });

    } catch (error) {
        console.error('Click processing error:', error);

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
                timestamp: Date.now(),
                message: 'No channel specified'
            });
        }

        // Get all clicks for this channel
        const rawClicks = await getChannelClicks(channelId);
        const uniqueUsers = new Set(rawClicks.map(c => c.userId)).size;

        // Return raw click data for client-side clustering
        res.json({
            running: isRunning,
            rawClicks: rawClicks, // Send raw clicks for Ex Machina clustering
            totalClicks: rawClicks.length,
            uniqueUsers: uniqueUsers,
            timestamp: Date.now(),
            channelId: channelId
        });

    } catch (error) {
        console.error('Heatmap generation error:', error);
        res.status(500).json({ error: 'Failed to generate heatmap' });
    }
});

/**
 * POST /start - Start click collection
 */
app.post('/start', (req, res) => {
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
});

/**
 * POST /stop - Stop click collection
 */
app.post('/stop', (req, res) => {
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
        console.error('Reset error:', error);
        res.status(500).json({ error: 'Failed to reset click data' });
    }
});

/**
 * GET /stats - Get system statistics
 */
app.get('/stats', async (req, res) => {
    try {
        const channelId = req.query.channel;

        if (channelId) {
            // Stats for specific channel
            const rawClicks = await getChannelClicks(channelId);
            const uniqueUsers = new Set(rawClicks.map(c => c.userId)).size;
            const wsConnections = wsChannels.get(channelId)?.size || 0;

            res.json({
                channelId: channelId,
                totalClicks: rawClicks.length,
                uniqueUsers: uniqueUsers,
                wsConnections: wsConnections,
                running: isRunning,
                timestamp: Date.now()
            });

        } else {
            // Global stats
            const stats = await getTotalStats();
            const totalWSConnections = Array.from(wsChannels.values()).reduce((sum, set) => sum + set.size, 0);

            res.json({
                running: isRunning,
                totalClicks: stats.totalClicks,
                totalUsers: stats.totalUsers,
                totalChannels: stats.totalChannels,
                activeChannels: wsChannels.size,
                totalWSConnections: totalWSConnections,
                systemStats: {
                    ...systemStats,
                    uptime: Date.now() - systemStats.startTime,
                    uptimeFormatted: formatUptime(Date.now() - systemStats.startTime)
                },
                memory: process.memoryUsage(),
                timestamp: Date.now()
            });
        }

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

/**
 * GET /health - Health check
 */
app.get('/health', async (req, res) => {
    try {
        const stats = await getTotalStats();

        const health = {
            status: 'healthy',
            running: isRunning,
            timestamp: Date.now(),
            uptime: process.uptime(),
            totalClicks: stats.totalClicks,
            totalChannels: stats.totalChannels,
            wsConnections: Array.from(wsChannels.values()).reduce((sum, set) => sum + set.size, 0),
            memory: process.memoryUsage()
        };

        // Check Redis if enabled
        if (useRedis) {
            try {
                const pong = await redis.ping();
                health.redis = pong === 'PONG' ? 'connected' : 'error';
            } catch (error) {
                health.redis = 'disconnected';
                health.status = 'degraded';
            }
        } else {
            health.redis = 'disabled';
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

/**
 * GET /channels - List active channels
 */
app.get('/channels', async (req, res) => {
    try {
        const channelData = [];

        // Get data for all channels with WebSocket connections
        for (const [channelId, connections] of wsChannels) {
            const rawClicks = await getChannelClicks(channelId);
            const uniqueUsers = new Set(rawClicks.map(c => c.userId)).size;

            channelData.push({
                channelId: channelId,
                totalClicks: rawClicks.length,
                uniqueUsers: uniqueUsers,
                wsConnections: connections.size,
                lastActivity: Math.max(...rawClicks.map(c => c.timestamp), 0) || null
            });
        }

        // Sort by activity
        channelData.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

        res.json({
            running: isRunning,
            totalChannels: channelData.length,
            channels: channelData,
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Channels list error:', error);
        res.status(500).json({ error: 'Failed to get channel list' });
    }
});

// --- Utility Functions ---
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// --- Error Handling ---
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        timestamp: Date.now()
    });
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        timestamp: Date.now()
    });
});

// --- Graceful Shutdown ---
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
        console.log('🔒 HTTP server closed');
    });

    // Close all WebSocket connections
    let totalClosed = 0;
    wsChannels.forEach((connections, channelId) => {
        connections.forEach(ws => {
            ws.close(1000, 'Server shutting down');
            totalClosed++;
        });
    });
    console.log(`🔌 Closed ${totalClosed} WebSocket connections`);

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

// Force exit after timeout
setTimeout(() => {
    console.error('⏰ Force shutdown after 15 seconds timeout');
    process.exit(1);
}, 15000);

// --- Start Server ---
server.listen(PORT, () => {
    console.log('\n🚀 Ex Machina Smart ClickMap Server');
    console.log(`📍 Port: ${PORT}`);
    console.log(`💾 Storage: ${useRedis ? 'Redis' : 'In-Memory'}`);
    console.log(`📡 WebSocket: Enabled`);
    console.log(`🔒 JWT Verification: Enabled`);
    console.log(`🌐 CORS: All origins allowed`);
    console.log(`⚡ Status: ${isRunning ? 'Running' : 'Stopped'}`);

    if (process.env.NODE_ENV === 'development') {
        console.log(`🛠️  Development mode active`);
    }

    console.log(''); // Empty line for readability
});