import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Simple in-memory storage
const gameState = {
    running: false,
    clicks: new Map(), // channelId → Map(userId → { x, y, timestamp })
    lastUpdate: Date.now()
};

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();

// CORS setup - more permissive for WebSocket upgrades
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add WebSocket upgrade handling headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upgrade, Connection');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Health check
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '3.1.0',
        uptime: process.uptime(),
        websocket: 'enabled',
        totalChannels: gameState.clicks.size,
        totalClicks: Array.from(gameState.clicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0),
        clients: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
            channel,
            count: clients.size
        })),
        channels: Array.from(gameState.clicks.entries()).map(([channel, clicks]) => ({
            channel,
            clicks: clicks.size
        }))
    });
});

// START endpoint
app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');

    try {
        gameState.running = true;
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Game started successfully');

        // Broadcast to all connected clients
        broadcastToAll({
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start'
        });

        res.json({
            success: true,
            status: 'started',
            running: true,
            timestamp: gameState.lastUpdate
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

// STOP endpoint
app.post('/stop', (req, res) => {
    console.log('⏹️ STOP endpoint called');

    try {
        gameState.running = false;
        gameState.lastUpdate = Date.now();

        console.log('✅ Game stopped successfully');

        const currentData = getCurrentHeatmapData('all');
        currentData.running = false;
        currentData.action = 'stop';

        broadcastToAll(currentData);

        res.json({
            success: true,
            status: 'stopped',
            running: false,
            timestamp: gameState.lastUpdate
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

// RESET endpoint
app.post('/reset', (req, res) => {
    console.log('🗑️ RESET endpoint called');

    try {
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Data reset successfully');

        broadcastToAll({
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset'
        });

        res.json({
            success: true,
            status: 'reset',
            running: gameState.running,
            timestamp: gameState.lastUpdate
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

// Click handling with enhanced logging
app.post('/click', (req, res) => {
    console.log('🖱️ CLICK endpoint called');

    try {
        if (!gameState.running) {
            console.log('   ❌ Game not running');
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

        console.log(`   Token payload:`, {
            user_id: payload.user_id,
            opaque_user_id: payload.opaque_user_id,
            channel_id: payload.channel_id,
            finalUid: uid,
            finalChannelId: channelId
        });

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`   ❌ Invalid coordinates: (${x}, ${y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
            console.log(`   📝 Created new channel: ${channelId}`);
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        console.log(`✅ Click stored:`);
        console.log(`   Channel: ${channelId}`);
        console.log(`   User: ${uid}`);
        console.log(`   Position: (${x.toFixed(3)}, ${y.toFixed(3)})`);
        console.log(`   Total clicks in channel: ${gameState.clicks.get(channelId).size}`);
        console.log(`   All channels:`, Array.from(gameState.clicks.keys()));

        // Get updated data and broadcast immediately
        const updatedData = getCurrentHeatmapData(channelId);
        console.log(`   📡 Broadcasting update: ${updatedData.clusters.length} clusters to channel ${channelId}`);
        broadcastToChannel(channelId, updatedData);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0,
            channelId: channelId
        });

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
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint called:`);
    console.log(`   Channel: ${channelId || 'NOT PROVIDED (will aggregate all)'}`);
    console.log(`   Threshold: ${threshold}%`);
    console.log(`   Query params:`, req.query);
    console.log(`   Full URL: ${req.url}`);
    console.log(`   Available channels:`, Array.from(gameState.clicks.keys()));

    try {
        const data = getCurrentHeatmapData(channelId, threshold);

        console.log(`✅ Heatmap data prepared:`);
        console.log(`   Target channel: ${channelId || 'ALL'}`);
        console.log(`   Total clicks: ${data.totalClicks}`);
        console.log(`   Unique users: ${data.uniqueUsers}`);
        console.log(`   Clusters: ${data.clusters.length}`);
        console.log(`   Running: ${data.running}`);
        console.log(`   Threshold: ${data.threshold}%`);

        // Log cluster details for debugging
        if (data.clusters.length > 0) {
            console.log(`   📍 Cluster details:`);
            data.clusters.forEach(c => {
                console.log(`     - ID: ${c.id}, ${c.percentage}% at (${c.x.toFixed(3)}, ${c.y.toFixed(3)}), Count: ${c.count}${c.isTop ? ' (TOP)' : ''}`);
            });
        } else if (data.totalClicks > 0) {
            console.log(`   🐛 POTENTIAL BUG: ${data.totalClicks} clicks but 0 clusters! Check threshold.`);
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

// WebSocket test endpoint
app.get('/ws-test/:channelId', (req, res) => {
    const { channelId } = req.params;
    const clients = connectedClients.get(channelId);

    res.json({
        channelId,
        connected: !!clients,
        clientCount: clients ? clients.size : 0,
        allChannels: Array.from(connectedClients.keys()),
        totalClients: Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0),
        gameData: {
            running: gameState.running,
            totalChannels: gameState.clicks.size,
            channelClicks: gameState.clicks.has(channelId) ? gameState.clicks.get(channelId).size : 0
        }
    });
});

// FIXED: Get current heatmap data with proper clustering for all cases
function getCurrentHeatmapData(channelId, threshold = 3) {
    console.log(`🔍 getCurrentHeatmapData called: channel=${channelId}, threshold=${threshold}%`);

    // If no specific channel requested, aggregate all channels WITH clustering
    if (!channelId || channelId === 'all') {
        console.log(`🔍 Aggregating data from all channels`);

        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        // Collect all points from all channels
        gameState.clicks.forEach((channelClicks, channel) => {
            console.log(`   📊 Channel ${channel}: ${channelClicks.size} clicks`);
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            // Add all points to the aggregate
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        console.log(`🔍 Aggregated: ${allPoints.length} total points from ${gameState.clicks.size} channels`);

        // Process ALL points into clusters
        const clusters = processClicksIntoClusters(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,  // ✅ Now includes clusters from all channels
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    // Handle specific channel
    console.log(`🔍 Getting data for specific channel: ${channelId}`);
    const channelClicks = gameState.clicks.get(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        console.log(`🔍 Channel ${channelId} has no clicks`);
        return {
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    const points = Array.from(channelClicks.values());
    console.log(`🔍 Channel ${channelId} has ${points.length} points`);
    const clusters = processClicksIntoClusters(points, threshold);

    console.log(`🔍 Channel ${channelId} result: ${points.length} points → ${clusters.length} clusters`);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: gameState.lastUpdate
    };
}

// Enhanced clustering function with comprehensive logging
function processClicksIntoClusters(points, threshold) {
    console.log(`🧮 CLUSTERING START: ${points.length} points, threshold ${threshold}%`);

    if (points.length === 0) {
        console.log(`🧮 CLUSTERING: No points to process`);
        return [];
    }

    const clusters = [];
    const gridSize = 0.1; // 10% of screen
    const grid = new Map();

    // Group points into grid cells
    points.forEach((point, index) => {
        const cellX = Math.floor(point.x / gridSize);
        const cellY = Math.floor(point.y / gridSize);
        const cellKey = `${cellX},${cellY}`;

        if (!grid.has(cellKey)) {
            grid.set(cellKey, []);
        }
        grid.get(cellKey).push(point);

        console.log(`🧮 Point ${index}: (${point.x.toFixed(3)}, ${point.y.toFixed(3)}) → Cell ${cellKey}`);
    });

    console.log(`🧮 CLUSTERING: Created ${grid.size} grid cells`);

    // Convert grid cells to clusters
    let clusterId = 0;
    grid.forEach((cellPoints, cellKey) => {
        const percentage = Math.round((cellPoints.length / points.length) * 100);

        console.log(`🧮 Cell ${cellKey}: ${cellPoints.length} points = ${percentage}% (threshold: ${threshold}%)`);

        if (percentage >= threshold) {
            const avgX = cellPoints.reduce((sum, p) => sum + p.x, 0) / cellPoints.length;
            const avgY = cellPoints.reduce((sum, p) => sum + p.y, 0) / cellPoints.length;

            const cluster = {
                id: clusterId++,
                x: avgX,
                y: avgY,
                count: cellPoints.length,
                percentage,
                isTop: false
            };

            clusters.push(cluster);
            console.log(`✅ CLUSTER CREATED: ID ${cluster.id}, ${percentage}% at (${avgX.toFixed(3)}, ${avgY.toFixed(3)}), ${cellPoints.length} points`);
        } else {
            console.log(`❌ CLUSTER FILTERED: Cell ${cellKey} has ${percentage}% < ${threshold}%`);
        }
    });

    // Sort by percentage and mark top cluster
    clusters.sort((a, b) => b.percentage - a.percentage);
    if (clusters.length > 0) {
        clusters[0].isTop = true;
        console.log(`🏆 TOP CLUSTER: #${clusters[0].id} with ${clusters[0].percentage}%`);
    }

    console.log(`🧮 CLUSTERING COMPLETE: ${clusters.length} final clusters`);
    return clusters;
}

// WebSocket broadcasting
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) {
        console.log(`📡 No WebSocket clients for channel ${channelId}`);
        return;
    }

    const message = JSON.stringify(data);
    let sentCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('WebSocket send error:', error);
                clients.delete(ws);
            }
        } else {
            clients.delete(ws);
        }
    });

    console.log(`📡 Broadcast to channel ${channelId}: ${sentCount}/${clients.size} clients, ${data.clusters.length} clusters`);
}

function broadcastToAll(data) {
    let totalSent = 0;
    let totalChannels = 0;

    connectedClients.forEach((clients, channelId) => {
        const channelData = channelId === 'all' ? data : getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
        totalChannels++;
    });

    console.log(`📡 Broadcast to all: ${totalSent} clients across ${totalChannels} channels`);
}

// HTTP server
const server = createServer(app);

// WebSocket server with improved configuration
const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
    verifyClient: (info) => {
        console.log(`🔗 WebSocket verification: ${info.req.url} from ${info.req.headers.origin || 'unknown'}`);
        return true;
    }
});

console.log('🔧 WebSocket server configured');

wss.on('connection', (ws, req) => {
    console.log(`🔗 New WebSocket connection from ${req.socket.remoteAddress}`);
    console.log(`📍 WebSocket URL: ${req.url}`);

    try {
        // More robust channel ID extraction
        const url = new URL(req.url, `http://${req.headers.host}`);
        console.log(`🔍 Parsed URL: ${url.pathname}`);

        // Handle both /ws/channelId and /ws?channel=channelId formats
        let channelId = null;

        // First try path-based channel ID
        const pathParts = url.pathname.split('/').filter(part => part.length > 0);
        console.log(`🔍 Path parts:`, pathParts);

        if (pathParts.length >= 2 && pathParts[0] === 'ws') {
            channelId = pathParts[1];
            console.log(`📍 Channel ID from path: ${channelId}`);
        }

        // Fallback to query parameter
        if (!channelId) {
            channelId = url.searchParams.get('channel');
            console.log(`📍 Channel ID from query: ${channelId}`);
        }

        if (!channelId) {
            console.error('❌ No channel ID provided in WebSocket connection');
            ws.close(1000, 'Channel ID required');
            return;
        }

        // Add client to channel
        if (!connectedClients.has(channelId)) {
            connectedClients.set(channelId, new Set());
        }
        connectedClients.get(channelId).add(ws);

        console.log(`📡 WebSocket connected: Channel ${channelId} (${connectedClients.get(channelId).size} total for this channel)`);
        console.log(`📊 Total channels: ${connectedClients.size}, Total clients: ${Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0)}`);

        // Send initial data immediately
        try {
            const initialData = getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
            console.log(`📨 Sent initial data to channel ${channelId}: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
        } catch (error) {
            console.error('❌ Error sending initial data:', error);
        }

        // Handle WebSocket messages
        ws.on('message', (message) => {
            try {
                console.log(`📨 WebSocket message from ${channelId}:`, message.toString());
            } catch (error) {
                console.error('❌ WebSocket message error:', error);
            }
        });

        ws.on('close', (code, reason) => {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            console.log(`📡 WebSocket disconnected: Channel ${channelId}, Code: ${code}, Reason: ${reason || 'none'}`);
        });

        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for channel ${channelId}:`, error);
        });

        // Send ping periodically to keep connection alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.ping();
                } catch (error) {
                    console.error('❌ WebSocket ping error:', error);
                    clearInterval(pingInterval);
                }
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);

        ws.on('close', () => {
            clearInterval(pingInterval);
        });

    } catch (error) {
        console.error('❌ WebSocket connection setup error:', error);
        ws.close(1000, 'Server error');
    }
});

wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📝 Received SIGTERM, starting graceful shutdown...');

    // Close all WebSocket connections
    connectedClients.forEach((clients, channelId) => {
        clients.forEach(ws => {
            try {
                ws.close(1000, 'Server shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });
    });

    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

server.listen(PORT, () => {
    console.log('🚀 ClickMap EBS v3.1.0 BULLETPROOF + FIXED CLUSTERING');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🎯 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}/ws/[channelId]`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log('🔧 WebSocket server ready for connections');
    console.log('🐛 Debug logging enabled - clustering issues should now be visible');
});

export default server;