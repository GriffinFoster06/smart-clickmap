import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Simple in-memory storage for now - Redis can be added later
const gameState = {
    running: false,
    clicks: new Map(), // channelId → Map(userId → { x, y, timestamp })
    lastUpdate: Date.now()
};

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();

// CORS setup - be very explicit
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Health check - always works
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '3.0.0',
        uptime: process.uptime()
    });
});

// START endpoint - bulletproof
app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');

    try {
        gameState.running = true;
        gameState.clicks.clear(); // Clear all clicks when starting
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

// STOP endpoint - bulletproof
app.post('/stop', (req, res) => {
    console.log('⏹️ STOP endpoint called');

    try {
        gameState.running = false;
        gameState.lastUpdate = Date.now();

        console.log('✅ Game stopped successfully');

        // Get current data before broadcasting
        const currentData = getCurrentHeatmapData('all');
        currentData.running = false;
        currentData.action = 'stop';

        // Broadcast to all connected clients
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

// RESET endpoint - bulletproof
app.post('/reset', (req, res) => {
    console.log('🗑️ RESET endpoint called');

    try {
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Data reset successfully');

        // Broadcast reset to all clients
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

// Click handling - bulletproof
app.post('/click', (req, res) => {
    console.log('🖱️ CLICK endpoint called');

    try {
        if (!gameState.running) {
            return res.status(400).json({
                success: false,
                error: 'Game not running'
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
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
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(2)}, ${y.toFixed(2)})`);

        // Get updated data and broadcast immediately
        const updatedData = getCurrentHeatmapData(channelId);
        broadcastToChannel(channelId, updatedData);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0
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

// Heatmap data endpoint
app.get('/heatmap', (req, res) => {
    console.log('📊 HEATMAP endpoint called');

    try {
        const channelId = req.query.channel;
        const threshold = parseInt(req.query.threshold) || 3;

        const data = getCurrentHeatmapData(channelId, threshold);

        console.log(`✅ Heatmap data sent: ${data.totalClicks} clicks, ${data.clusters.length} clusters`);

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

// Get current heatmap data
function getCurrentHeatmapData(channelId, threshold = 3) {
    if (!channelId || channelId === 'all') {
        // Return aggregate data for all channels
        let totalClicks = 0;
        let totalUsers = 0;

        gameState.clicks.forEach(channelClicks => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;
        });

        return {
            running: gameState.running,
            clusters: [],
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: 0,
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

// Simple clustering algorithm
function processClicksIntoClusters(points, threshold) {
    if (points.length === 0) return [];

    const clusters = [];
    const gridSize = 0.1; // 10% of screen
    const grid = new Map();

    // Group points into grid cells
    points.forEach(point => {
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
    grid.forEach((cellPoints, cellKey) => {
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

    console.log(`📡 Broadcast to channel ${channelId}: ${sentCount} clients`);
}

function broadcastToAll(data) {
    let totalSent = 0;
    connectedClients.forEach((clients, channelId) => {
        const channelData = channelId === 'all' ? data : getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
    });
    console.log(`📡 Broadcast to all: ${totalSent} total clients`);
}

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({
    server,
    path: '/ws'
});

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');
    const channelId = pathParts[pathParts.length - 1];

    if (!channelId || channelId === 'ws') {
        ws.close(1000, 'Channel ID required');
        return;
    }

    // Add client to channel
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    console.log(`📡 WebSocket connected: ${channelId} (${connectedClients.get(channelId).size} total)`);

    // Send initial data immediately
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
    } catch (error) {
        console.error('Error sending initial data:', error);
    }

    ws.on('close', () => {
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`📡 WebSocket disconnected: ${channelId}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

server.listen(PORT, () => {
    console.log('🚀 ClickMap EBS v3.0.0 BULLETPROOF');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🎯 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
});

export default server;