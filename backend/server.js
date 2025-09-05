import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
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

// Enhanced CORS setup for Twitch extensions
app.use(cors({
    origin: [
        '*',
        'https://www.twitch.tv',
        'https://*.twitch.tv',
        'https://*.ext-twitch.tv',
        /\.ext-twitch\.tv$/
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Upgrade',
        'Connection',
        'Sec-WebSocket-Key',
        'Sec-WebSocket-Version',
        'Sec-WebSocket-Protocol',
        'Origin',
        'Cache-Control'
    ],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Enhanced headers for WebSocket and Twitch compatibility
app.use((req, res, next) => {
    // More permissive CORS for Twitch extensions
    const origin = req.headers.origin;
    if (origin && (origin.includes('twitch.tv') || origin.includes('ext-twitch.tv'))) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, UPGRADE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol');
    res.header('Access-Control-Allow-Credentials', 'false');

    // WebSocket specific headers
    res.header('Upgrade', 'websocket');
    res.header('Connection', 'Upgrade');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Health check with comprehensive diagnostics
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '3.2.2',
        uptime: process.uptime(),
        websocket: {
            enabled: !!wss,
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size,
            connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        environment: {
            node_env: process.env.NODE_ENV || 'unknown',
            port: PORT,
            render_service: process.env.RENDER_SERVICE_NAME || 'unknown',
            render_service_id: process.env.RENDER_SERVICE_ID || 'unknown'
        },
        game_data: {
            total_channels: gameState.clicks.size,
            total_clicks: Array.from(gameState.clicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0),
            channels: Array.from(gameState.clicks.entries()).map(([channel, clicks]) => ({
                channel,
                clicks: clicks.size
            }))
        }
    });
});

// WebSocket debug endpoint  
app.get('/ws-debug', (req, res) => {
    console.log('🔍 WebSocket Debug requested');

    const debug = {
        timestamp: new Date().toISOString(),
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0,
            integrated_with_http: true,
            ready_state: wss ? 'operational' : 'not_initialized'
        },
        connected_clients: {
            channels: connectedClients.size,
            total_connections: Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0),
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
        }
    };

    console.log('🔍 Debug result:', JSON.stringify(debug, null, 2));
    res.json(debug);
});

// WebSocket connection test helper
app.get('/ws-test/:channelId', (req, res) => {
    const { channelId } = req.params;
    const host = req.get('host');
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${host}/ws/${channelId}`;

    res.json({
        test_url: wsUrl,
        server_ready: !!httpServer && httpServer.listening,
        websocket_ready: !!wss,
        client_count: wss ? wss.clients.size : 0,
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

// [Previous endpoints remain the same: /start, /stop, /reset, /click, /heatmap]
// ... (keeping the existing endpoint code for brevity)

// START endpoint
app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');
    try {
        gameState.running = true;
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();
        console.log('✅ Game started successfully');
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

// Click handling
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

        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)})`);
        console.log(`   Total clicks in channel: ${gameState.clicks.get(channelId).size}`);

        const updatedData = getCurrentHeatmapData(channelId);
        console.log(`   📡 Broadcasting: ${updatedData.clusters.length} clusters to channel ${channelId}`);
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

// Enhanced heatmap endpoint
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%`);

    try {
        const data = getCurrentHeatmapData(channelId, threshold);

        if (data.totalClicks > 0) {
            console.log(`✅ Heatmap: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
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

// [Helper functions remain the same]
function getCurrentHeatmapData(channelId, threshold = 3) {
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        gameState.clicks.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = processClicksIntoClusters(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    const channelClicks = gameState.clicks.get(channelId);

    if (!channelClicks || channelClicks.size === 0) {
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
    const clusters = processClicksIntoClusters(points, threshold);

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

function processClicksIntoClusters(points, threshold) {
    if (points.length === 0) return [];

    const clusters = [];
    const gridSize = 0.1;
    const grid = new Map();

    points.forEach((point) => {
        const cellX = Math.floor(point.x / gridSize);
        const cellY = Math.floor(point.y / gridSize);
        const cellKey = `${cellX},${cellY}`;

        if (!grid.has(cellKey)) {
            grid.set(cellKey, []);
        }
        grid.get(cellKey).push(point);
    });

    let clusterId = 0;
    grid.forEach((cellPoints) => {
        const percentage = Math.round((cellPoints.length / points.length) * 100);

        if (percentage >= threshold) {
            const avgX = cellPoints.reduce((sum, p) => sum + p.x, 0) / cellPoints.length;
            const avgY = cellPoints.reduce((sum, p) => sum + p.y, 0) / cellPoints.length;

            clusters.push({
                id: clusterId++,
                x: avgX,
                y: avgY,
                count: cellPoints.length,
                percentage,
                isTop: false
            });
        }
    });

    clusters.sort((a, b) => b.percentage - a.percentage);
    if (clusters.length > 0) {
        clusters[0].isTop = true;
    }

    return clusters;
}

function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(data);
    let sentCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
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

    if (sentCount > 0) {
        console.log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters?.length || 0} clusters`);
    }
}

function broadcastToAll(data) {
    let totalSent = 0;
    connectedClients.forEach((clients, channelId) => {
        const channelData = channelId === 'all' ? data : getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
    });

    if (totalSent > 0) {
        console.log(`📡 Broadcast to all: ${totalSent} clients`);
    }
}

// ===== HTTP SERVER CREATION =====
console.log('🔧 Creating HTTP server...');
const httpServer = createServer(app);

// ===== ENHANCED WEBSOCKET SERVER INTEGRATION =====
console.log('🔧 Creating enhanced WebSocket server...');
let wss;
try {
    wss = new WebSocketServer({
        server: httpServer,
        perMessageDeflate: false,
        clientTracking: true,
        maxPayload: 16 * 1024, // 16KB max message size
        // Enhanced verification for Twitch compatibility
        verifyClient: (info) => {
            const origin = info.origin;
            console.log(`WebSocket connection attempt from origin: ${origin}`);

            // Allow Twitch origins and localhost for testing
            if (!origin) return true; // Allow no-origin connections
            if (origin.includes('twitch.tv') || origin.includes('ext-twitch.tv')) return true;
            if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;

            console.log(`WebSocket connection rejected for origin: ${origin}`);
            return false; // Reject other origins
        }
    });
    console.log('✅ Enhanced WebSocket server created');
} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// Enhanced WebSocket upgrade handling
httpServer.on('upgrade', (request, socket, head) => {
    console.log('🔗 WebSocket upgrade request received:');
    console.log(`   URL: ${request.url}`);
    console.log(`   Origin: ${request.headers.origin}`);
    console.log(`   User-Agent: ${request.headers['user-agent']?.substring(0, 50)}...`);

    // Handle both /ws/channelId and /ws?channel=channelId formats
    const isValidWsPath = request.url && (
        request.url.startsWith('/ws/') ||
        request.url.startsWith('/ws?')
    );

    if (isValidWsPath) {
        console.log('✅ Valid WebSocket path, handling upgrade...');
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log('❌ Invalid WebSocket path, closing connection');
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
    }
});

// Enhanced WebSocket connection handling
wss.on('connection', (ws, req) => {
    const startTime = Date.now();
    console.log(`🔗 NEW WEBSOCKET CONNECTION`);
    console.log(`   URL: ${req.url}`);
    console.log(`   Origin: ${req.headers.origin}`);

    // Extract channel ID from URL - support both formats
    let channelId = null;
    if (req.url) {
        // Format 1: /ws/channelId
        let match = req.url.match(/\/ws\/([^?&\/]+)/);
        if (match) {
            channelId = match[1];
        } else {
            // Format 2: /ws?channel=channelId
            const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
            channelId = urlParams.get('channel');
        }
    }

    if (!channelId) {
        console.error('❌ No channel ID found in WebSocket URL');
        ws.close(1008, 'Channel ID required: /ws/CHANNEL_ID or /ws?channel=CHANNEL_ID');
        return;
    }

    console.log(`   Channel: ${channelId}`);

    // Add to tracking
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    const clientCount = connectedClients.get(channelId).size;
    const totalClients = wss.clients.size;

    console.log(`✅ WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

    // Send initial data immediately
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
        console.log(`📨 Initial data sent: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Message from ${channelId}:`, data);

            // Echo back for testing
            ws.send(JSON.stringify({
                type: 'echo',
                received: data,
                timestamp: Date.now(),
                channelId: channelId
            }));
        } catch (error) {
            console.error('❌ Message parsing error:', error);
        }
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`🔒 WebSocket disconnected: ${channelId} after ${duration}ms`);
        console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
        console.log(`   Remaining clients in channel: ${clients ? clients.size : 0}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${channelId}:`, error);
    });

    // Enhanced keep-alive mechanism
    const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping(Buffer.from('heartbeat'));
            } catch (pingError) {
                console.error('❌ Keep-alive ping error:', pingError);
                clearInterval(keepAlive);
            }
        } else {
            clearInterval(keepAlive);
        }
    }, 30000); // 30 second keep-alive

    ws.on('close', () => {
        clearInterval(keepAlive);
    });

    ws.on('pong', (data) => {
        console.log(`🏓 Pong received from ${channelId}: ${data.toString()}`);
    });
});

// Enhanced error handling
wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
    console.error('   Stack:', error.stack);
});

// Process error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📝 Received SIGTERM, starting graceful shutdown...');

    connectedClients.forEach((clients, channelId) => {
        clients.forEach(ws => {
            try {
                ws.close(1000, 'Server shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });
    });

    httpServer.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v3.2.2 - ENHANCED WEBSOCKET COMPATIBILITY');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🔗 WebSocket URL Alt: wss://smart-clickmap-backend.onrender.com/ws?channel=[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🔍 Debug endpoint: https://smart-clickmap-backend.onrender.com/ws-debug`);
    console.log(`🧪 Test endpoint: https://smart-clickmap-backend.onrender.com/ws-test/167556274`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Final status verification
    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   HTTP server address: ${JSON.stringify(httpServer.address())}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   WebSocket clients: ${wss ? wss.clients.size : 0}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log(`   Single port mode: ${PORT}`);
        console.log('🎉 Enhanced server fully operational!');
    }, 1000);
});

export default httpServer;