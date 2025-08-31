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

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add headers for WebSocket support
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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Health check with comprehensive diagnostics
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '3.2.0',
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

// WebSocket production debug endpoint
app.get('/ws-debug', (req, res) => {
    console.log('🔍 WebSocket Debug requested');
    
    const debug = {
        timestamp: new Date().toISOString(),
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0,
            ready_state: wss ? 'initialized' : 'not_initialized',
            options: wss ? {
                port: wss.options.port,
                server: !!wss.options.server,
                clientTracking: wss.options.clientTracking
            } : null
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
            environment: process.env.NODE_ENV || 'development'
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
        instructions: [
            'Test in browser console:',
            `const ws = new WebSocket('${wsUrl}');`,
            `ws.onopen = () => console.log('✅ Connected');`,
            `ws.onerror = (e) => console.log('❌ Error:', e);`,
            `ws.onclose = (e) => console.log('🔒 Closed:', e.code, e.reason);`,
            `ws.onmessage = (e) => console.log('📨 Message:', e.data);`
        ]
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

        // Get updated data and broadcast immediately
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

// Enhanced heatmap endpoint with detailed logging
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

// Get current heatmap data with proper clustering
function getCurrentHeatmapData(channelId, threshold = 3) {
    // If no specific channel requested, aggregate all channels
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

    // Handle specific channel
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

// Enhanced clustering with debug logging
function processClicksIntoClusters(points, threshold) {
    if (points.length === 0) return [];

    const clusters = [];
    const gridSize = 0.1;
    const grid = new Map();

    // Group points into grid cells
    points.forEach((point) => {
        const cellX = Math.floor(point.x / gridSize);
        const cellY = Math.floor(point.y / gridSize);
        const cellKey = `${cellX},${cellY}`;

        if (!grid.has(cellKey)) {
            grid.set(cellKey, []);
        }
        grid.get(cellKey).push(point);
    });

    // Convert grid cells to clusters
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

    // Sort by percentage and mark top cluster
    clusters.sort((a, b) => b.percentage - a.percentage);
    if (clusters.length > 0) {
        clusters[0].isTop = true;
    }

    return clusters;
}

// WebSocket broadcasting
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
        console.log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} clusters`);
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

// HTTP server
const httpServer = createServer(app);

// ===== RENDER.COM PROVEN WEBSOCKET APPROACH =====
// Based on working example from Render.com community

console.log('🔧 Creating WebSocket server using Render.com proven approach...');

// Method 1: Simple WebSocket.Server (Render.com proven working method)
let wss;
try {
    wss = new WebSocketServer({ 
        port: PORT + 1, // Use separate port for WebSocket (common Render pattern)
        perMessageDeflate: false,
        clientTracking: true
    });
    console.log(`✅ WebSocket server created on port ${PORT + 1} (separate port method)`);
} catch (portError) {
    console.log('⚠️ Separate port failed, trying server integration...');
    
    // Method 2: Integrate with HTTP server
    try {
        wss = new WebSocketServer({ 
            server: httpServer,
            perMessageDeflate: false,
            clientTracking: true
        });
        console.log('✅ WebSocket server integrated with HTTP server');
    } catch (integrationError) {
        console.error('❌ Both WebSocket methods failed:', portError, integrationError);
    }
}

if (wss) {
    wss.on('connection', (ws, req) => {
        const startTime = Date.now();
        console.log(`🔗 NEW WEBSOCKET CONNECTION`);
        console.log(`   URL: ${req.url}`);
        console.log(`   Origin: ${req.headers.origin}`);
        console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);

        // Extract channel ID from URL
        let channelId = null;
        if (req.url) {
            // Handle /ws/channelId or /?channel=channelId
            const match = req.url.match(/\/ws\/([^?]+)/) || req.url.match(/[?&]channel=([^&]+)/);
            if (match) {
                channelId = match[1];
                console.log(`   Channel: ${channelId}`);
            }
        }

        if (!channelId) {
            console.error('❌ No channel ID found');
            ws.close(1008, 'Channel ID required in URL: /ws/CHANNEL_ID');
            return;
        }

        // Add to tracking
        if (!connectedClients.has(channelId)) {
            connectedClients.set(channelId, new Set());
        }
        connectedClients.get(channelId).add(ws);

        const clientCount = connectedClients.get(channelId).size;
        const totalClients = wss.clients.size;

        console.log(`✅ Connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

        // Send initial data
        try {
            const initialData = getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
            console.log(`📨 Initial data sent: ${initialData.clusters.length} clusters`);
        } catch (error) {
            console.error('❌ Error sending initial data:', error);
        }

        // Handle messages
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                console.log(`📨 Message from ${channelId}:`, data);
                
                // Echo for testing
                ws.send(JSON.stringify({
                    type: 'echo',
                    received: data,
                    timestamp: Date.now()
                }));
            } catch (error) {
                console.error('❌ Message error:', error);
            }
        });

        // Handle close
        ws.on('close', (code, reason) => {
            const duration = Date.now() - startTime;
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            console.log(`🔒 Disconnected: ${channelId} after ${duration}ms (Code: ${code})`);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`❌ WebSocket error for ${channelId}:`, error);
        });

        // Keep-alive pings
        const keepAlive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            } else {
                clearInterval(keepAlive);
            }
        }, 30000);

        ws.on('close', () => clearInterval(keepAlive));
    });

    wss.on('error', (error) => {
        console.error('❌ WebSocket server error:', error);
    });

    console.log('🎉 WebSocket server event handlers configured');
} else {
    console.error('❌ WebSocket server could not be created!');
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start HTTP server
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v3.2.0 RENDER.COM WEBSOCKET DIAGNOSIS');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🔍 Debug: https://smart-clickmap-backend.onrender.com/ws-debug`);
    console.log(`🧪 Test: https://smart-clickmap-backend.onrender.com/ws-test/167556274`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Status verification
    setTimeout(() => {
        console.log('🔍 SERVER STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   HTTP server address: ${JSON.stringify(httpServer.address())}`);
        console.log(`   WebSocket server ready: ${!!wss}`);
        console.log(`   WebSocket clients: ${wss ? wss.clients.size : 0}`);
    }, 1000);
});

export default httpServer;