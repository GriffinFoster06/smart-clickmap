// backend/server.js - FIXED CONNECTIVITY with real-time priority
// Ensures WebSocket and HTTP connections work properly

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';
import { performance } from 'perf_hooks';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `local_${Date.now()}`;

// ========== CONFIGURATION ==========
const CONFIG = {
    // Time windows
    MAX_CLICK_AGE_MS: 5000,        // Ignore clicks older than 5 seconds
    CURRENT_WINDOW_MS: 10000,      // Only keep last 10 seconds of data
    BROADCAST_INTERVAL: 5000,      // Broadcast every 5 seconds
    
    // Load management
    SAMPLING_RATES: {
        LOW: 1,       // < 100/s: Accept all
        MEDIUM: 3,    // 100-1000/s: 1 in 3
        HIGH: 10,     // 1000-5000/s: 1 in 10
        EXTREME: 100  // > 5000/s: 1 in 100
    },
    
    // Memory management
    MAX_POINTS_PER_CHANNEL: 5000,
    CLEANUP_INTERVAL: 2000,
    
    // Grid settings
    GRID_SIZE: 30,
    GRID_THRESHOLD: 1000
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.DEBUG === 'true' || !IS_PRODUCTION;

function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_ENABLED) return;
    console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(message, error = null) {
    console.error(`[${new Date().toISOString()}] ${message}`, error || '');
}

// ========== GAME STATE ==========
const gameState = {
    running: true,
    version: Date.now(),
    lastStateChange: Date.now(),
    
    setRunning(value) {
        this.running = value;
        this.version = Date.now();
        this.lastStateChange = Date.now();
        log(`Game state: ${value ? 'RUNNING' : 'STOPPED'} (v${this.version})`);
        return this.version;
    },
    
    reset() {
        this.version = Date.now();
        this.lastStateChange = Date.now();
        log(`Game RESET (v${this.version})`);
        return this.version;
    }
};

// ========== CLICK ENGINE ==========
class ClickEngine {
    constructor() {
        // Data storage
        this.currentClicks = new Map(); // channelId -> Map of clicks
        this.gridAggregators = new Map(); // channelId -> GridAggregator
        
        // Performance tracking
        this.clicksPerSecond = 0;
        this.totalReceived = 0;
        this.totalDropped = 0;
        this.currentLoad = 'LOW';
        this.samplingRate = 1;
        
        // JWT cache
        this.jwtCache = new Map();
        this.maxJWTCache = 5000;
        
        // Start tasks
        this.startCleanupTask();
        this.startMetricsTask();
        
        log('✅ Click engine initialized');
    }
    
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }
        
        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            if (this.jwtCache.size >= this.maxJWTCache) {
                const firstKey = this.jwtCache.keys().next().value;
                this.jwtCache.delete(firstKey);
            }
            
            this.jwtCache.set(token, { payload, exp: payload.exp });
            return payload;
        } catch {
            return null;
        }
    }
    
    addClick(channelId, userId, x, y) {
        if (!gameState.running) {
            this.totalDropped++;
            return false;
        }
        
        this.totalReceived++;
        
        // Sampling
        if (this.samplingRate > 1 && Math.random() > (1 / this.samplingRate)) {
            this.totalDropped++;
            return false;
        }
        
        // High load - use grid
        if (this.currentLoad === 'HIGH' || this.currentLoad === 'EXTREME') {
            if (!this.gridAggregators.has(channelId)) {
                this.gridAggregators.set(channelId, new GridAggregator());
            }
            this.gridAggregators.get(channelId).addClick(x, y);
            return true;
        }
        
        // Normal load - store clicks
        if (!this.currentClicks.has(channelId)) {
            this.currentClicks.set(channelId, new Map());
        }
        
        const channelClicks = this.currentClicks.get(channelId);
        
        // Limit size
        if (channelClicks.size >= CONFIG.MAX_POINTS_PER_CHANNEL) {
            const toRemove = Math.floor(channelClicks.size * 0.2);
            const keys = Array.from(channelClicks.keys()).slice(0, toRemove);
            keys.forEach(key => channelClicks.delete(key));
        }
        
        const clickId = `${userId}_${Date.now()}_${Math.random()}`;
        channelClicks.set(clickId, {
            x, y,
            timestamp: Date.now(),
            userId
        });
        
        return true;
    }
    
    getHeatmapData(channelId) {
        // Empty if not running
        if (!gameState.running) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: 'STOPPED'
            };
        }
        
        // Get all channels if no specific channel
        if (!channelId) {
            const allPoints = [];
            
            // Collect from all channels
            for (const [_, channelClicks] of this.currentClicks) {
                allPoints.push(...Array.from(channelClicks.values()));
            }
            
            // Include grid data if any
            for (const [_, grid] of this.gridAggregators) {
                const gridPoints = grid.getHeatmap();
                gridPoints.forEach(cell => {
                    for (let i = 0; i < Math.min(cell.count, 10); i++) {
                        allPoints.push({
                            x: cell.x + (Math.random() - 0.5) * 0.02,
                            y: cell.y + (Math.random() - 0.5) * 0.02
                        });
                    }
                });
            }
            
            if (allPoints.length === 0) {
                return {
                    clusters: [],
                    totalClicks: 0,
                    uniqueUsers: 0,
                    mode: this.currentLoad
                };
            }
            
            const clusters = this.fastClustering(allPoints);
            return {
                clusters,
                totalClicks: allPoints.length,
                uniqueUsers: Math.floor(allPoints.length * 0.8),
                mode: this.currentLoad
            };
        }
        
        // Grid mode for specific channel
        if (this.gridAggregators.has(channelId)) {
            const grid = this.gridAggregators.get(channelId);
            const clusters = this.gridToClusters(grid.getHeatmap());
            return {
                clusters,
                totalClicks: grid.total,
                uniqueUsers: Math.floor(grid.total * 0.7),
                mode: 'GRID'
            };
        }
        
        // Normal mode
        const channelClicks = this.currentClicks.get(channelId);
        if (!channelClicks || channelClicks.size === 0) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: this.currentLoad
            };
        }
        
        const points = Array.from(channelClicks.values());
        const clusters = this.fastClustering(points);
        const uniqueUsers = new Set(points.map(p => p.userId)).size;
        
        return {
            clusters,
            totalClicks: points.length,
            uniqueUsers,
            mode: this.currentLoad
        };
    }
    
    fastClustering(points) {
        if (points.length === 0) return [];
        
        const gridSize = 20;
        const grid = {};
        
        points.forEach(p => {
            const key = `${Math.floor(p.x * gridSize)}_${Math.floor(p.y * gridSize)}`;
            if (!grid[key]) {
                grid[key] = { sumX: 0, sumY: 0, count: 0 };
            }
            grid[key].sumX += p.x;
            grid[key].sumY += p.y;
            grid[key].count++;
        });
        
        const total = points.length;
        const clusters = Object.values(grid)
            .map(cell => ({
                x: cell.sumX / cell.count,
                y: cell.sumY / cell.count,
                count: cell.count,
                percentage: Math.round((cell.count / total) * 100)
            }))
            .filter(c => c.percentage >= 3)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 15);
        
        return clusters.map((c, i) => ({
            ...c,
            visualSize: Math.min(180, 40 + Math.sqrt(c.percentage) * 40),
            id: `cluster_${i}`,
            isTop: i === 0,
            shapeType: c.percentage > 20 ? 'polygon' : 'circle',
            complexity: Math.min(0.5, c.percentage / 100),
            preferredSides: 8
        }));
    }
    
    gridToClusters(gridData) {
        const total = gridData.reduce((sum, cell) => sum + cell.count, 0);
        if (total === 0) return [];
        
        return gridData
            .map(cell => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / total) * 100)
            }))
            .filter(c => c.percentage >= 3)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 10)
            .map((c, i) => ({
                ...c,
                visualSize: Math.min(180, 40 + Math.sqrt(c.percentage) * 40),
                id: `grid_${i}`,
                isTop: i === 0,
                shapeType: 'circle',
                complexity: 0,
                preferredSides: 6
            }));
    }
    
    clearAll() {
        log('🧹 Clearing all click data');
        this.currentClicks.clear();
        this.gridAggregators.clear();
        this.totalReceived = 0;
        this.totalDropped = 0;
    }
    
    clearChannel(channelId) {
        log(`🧹 Clearing channel ${channelId}`);
        this.currentClicks.delete(channelId);
        this.gridAggregators.delete(channelId);
    }
    
    startCleanupTask() {
        setInterval(() => {
            if (!gameState.running) return;
            
            const now = Date.now();
            const cutoff = now - CONFIG.CURRENT_WINDOW_MS;
            
            for (const [channelId, clicks] of this.currentClicks.entries()) {
                for (const [key, click] of clicks.entries()) {
                    if (click.timestamp < cutoff) {
                        clicks.delete(key);
                    }
                }
                
                if (clicks.size === 0) {
                    this.currentClicks.delete(channelId);
                }
            }
            
            if (this.currentLoad !== 'HIGH' && this.currentLoad !== 'EXTREME') {
                this.gridAggregators.clear();
            }
        }, CONFIG.CLEANUP_INTERVAL);
    }
    
    startMetricsTask() {
        setInterval(() => {
            const cps = this.totalReceived;
            
            if (cps < 100) {
                this.currentLoad = 'LOW';
                this.samplingRate = CONFIG.SAMPLING_RATES.LOW;
            } else if (cps < 1000) {
                this.currentLoad = 'MEDIUM';
                this.samplingRate = CONFIG.SAMPLING_RATES.MEDIUM;
            } else if (cps < 5000) {
                this.currentLoad = 'HIGH';
                this.samplingRate = CONFIG.SAMPLING_RATES.HIGH;
            } else {
                this.currentLoad = 'EXTREME';
                this.samplingRate = CONFIG.SAMPLING_RATES.EXTREME;
            }
            
            if (cps > 0) {
                const dropRate = this.totalDropped > 0 ? 
                    ((this.totalDropped / (this.totalDropped + cps)) * 100).toFixed(1) : 0;
                log(`📊 ${this.currentLoad}: ${cps}/s (${dropRate}% dropped, 1:${this.samplingRate})`);
            }
            
            this.clicksPerSecond = cps;
            this.totalReceived = 0;
            this.totalDropped = 0;
        }, 1000);
    }
}

// ========== GRID AGGREGATOR ==========
class GridAggregator {
    constructor(gridSize = CONFIG.GRID_SIZE) {
        this.gridSize = gridSize;
        this.grid = new Float32Array(gridSize * gridSize);
        this.total = 0;
    }
    
    addClick(x, y) {
        const gridX = Math.min(this.gridSize - 1, Math.floor(x * this.gridSize));
        const gridY = Math.min(this.gridSize - 1, Math.floor(y * this.gridSize));
        this.grid[gridY * this.gridSize + gridX]++;
        this.total++;
    }
    
    getHeatmap() {
        const cells = [];
        const cellSize = 1 / this.gridSize;
        
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const count = this.grid[y * this.gridSize + x];
                if (count > 0) {
                    cells.push({
                        x: (x + 0.5) * cellSize,
                        y: (y + 0.5) * cellSize,
                        count
                    });
                }
            }
        }
        
        return cells;
    }
    
    clear() {
        this.grid.fill(0);
        this.total = 0;
    }
}

// ========== REDIS (OPTIONAL) ==========
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 1000,
        lazyConnect: true,
        reconnectStrategy: () => null
    }
});

redis.on('error', () => {});
redis.connect().catch(() => log('📴 Redis unavailable - memory only mode'));

// ========== INITIALIZE ==========
const clickEngine = new ClickEngine();

// ========== EXPRESS APP ==========
const app = express();

// CORS - Allow everything for extension
// In backend/server.js, update the CORS configuration:
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization',
        'X-Channel-ID',
        'X-Test-Mode',
        'X-User-ID'
    ]
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    log(`${req.method} ${req.path}`, 'debug');
    next();
});

// ========== ENDPOINTS ==========

// HEALTH
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        running: gameState.running,
        version: gameState.version,
        timestamp: Date.now(),
        instanceId: INSTANCE_ID,
        load: clickEngine.currentLoad,
        clicksPerSecond: clickEngine.clicksPerSecond,
        websocket: {
            clients: wss ? wss.clients.size : 0
        }
    });
});

// CLICK
app.post('/click', (req, res) => {
    if (!gameState.running) {
        return res.status(400).json({ success: false, error: 'Not running' });
    }
    
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token' });
    }
    
    const payload = clickEngine.verifyJWTFast(token);
    if (!payload) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' ||
        x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates' });
    }
    
    const accepted = clickEngine.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    res.json({ 
        success: true,
        accepted,
        status: accepted ? 'recorded' : 'sampled'
    });
});

// Add this test endpoint to your server.js (add it after the existing /click endpoint)

// Replace your test-click endpoint with this safer version:
app.post('/test-click', (req, res) => {
    try {
        // Basic request logging
        console.log('Test click received:', req.body);
        
        // Simple rate limiting (optional)
        if (typeof requestsPerSecond !== 'undefined') {
            requestsPerSecond++;
            
            if (requestsPerSecond > (CONFIG?.MAX_CLICKS_PER_SECOND || 10000)) {
                return res.status(429).json({ error: 'Rate limit exceeded' });
            }
        }
        
        // Check if game is running (with fallback)
        if (typeof gameState !== 'undefined' && gameState.isRunning === false) {
            return res.status(400).json({ 
                error: 'Game not running - use /start endpoint first',
                gameRunning: false 
            });
        }
        
        // Create mock payload for testing
        const payload = {
            channel_id: req.body.channelId || 'test_channel',
            user_id: req.body.userId || 'test_user',
            exp: Math.floor(Date.now() / 1000) + 3600
        };
        
        // Validate coordinates
        const { x, y } = req.body;
        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            return res.status(400).json({ error: 'Invalid coordinates', received: { x, y } });
        }
        
        // Try to process click (with error handling)
        let accepted = false;
        if (typeof clickEngine !== 'undefined' && clickEngine.addClick) {
            try {
                accepted = clickEngine.addClick(payload.channel_id, payload.user_id, x, y);
            } catch (error) {
                console.error('Click processing error:', error);
                // Don't fail the request, just log the error
                accepted = false;
            }
        } else {
            console.log('Click engine not available, simulating acceptance');
            accepted = true; // Simulate acceptance for testing
        }
        
        res.json({ 
            success: true,
            accepted,
            testMode: true,
            channel: payload.channel_id,
            user: payload.user_id,
            coordinates: { x, y },
            timestamp: Date.now(),
            gameRunning: gameState?.isRunning || 'unknown'
        });
        
    } catch (error) {
        console.error('Test click endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message,
            testEndpoint: true
        });
    }
});

// Add this simple health check for the test endpoint
app.get('/test-click', (req, res) => {
    res.json({ 
        message: 'Test click endpoint is available',
        method: 'POST',
        gameRunning: gameState?.isRunning || 'unknown',
        timestamp: Date.now()
    });
});

// HEATMAP
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;
    
    const data = clickEngine.getHeatmapData(channelId);
    
    res.json({
        running: gameState.running,
        clusters: data.clusters || [],
        totalClicks: data.totalClicks || 0,
        uniqueUsers: data.uniqueUsers || 0,
        coverage: Math.min(100, (data.clusters?.length || 0) * 10),
        mode: data.mode,
        threshold,
        version: gameState.version,
        timestamp: Date.now(),
        instanceId: INSTANCE_ID
    });
});

// START
app.post('/start', (req, res) => {
    log('▶️ START command');
    
    clickEngine.clearAll();
    const version = gameState.setRunning(true);
    
    // Broadcast to all WebSocket clients
    broadcastToAll({
        running: true,
        clusters: [],
        totalClicks: 0,
        uniqueUsers: 0,
        action: 'start',
        version,
        timestamp: Date.now()
    });
    
    res.json({ 
        success: true, 
        status: 'started',
        running: true,
        version
    });
});

// STOP
app.post('/stop', (req, res) => {
    log('⏹️ STOP command');
    
    const version = gameState.setRunning(false);
    
    // Get final state
    const finalData = clickEngine.getHeatmapData();
    
    // Clear engine
    clickEngine.clearAll();
    
    // Broadcast stop
    broadcastToAll({
        running: false,
        clusters: finalData.clusters,
        totalClicks: finalData.totalClicks,
        uniqueUsers: finalData.uniqueUsers,
        action: 'stop',
        version,
        timestamp: Date.now()
    });
    
    // Send clear after delay
    setTimeout(() => {
        broadcastToAll({
            running: false,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'stop_clear',
            version,
            timestamp: Date.now()
        });
    }, 1000);
    
    res.json({ 
        success: true, 
        status: 'stopped',
        running: false,
        version
    });
});

// RESET
app.post('/reset', (req, res) => {
    log('🗑️ RESET command');
    
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    if (channelId) {
        clickEngine.clearChannel(channelId);
    } else {
        clickEngine.clearAll();
    }
    
    const version = gameState.reset();
    
    // Broadcast reset
    broadcastToAll({
        running: gameState.running,
        clusters: [],
        totalClicks: 0,
        uniqueUsers: 0,
        action: 'reset',
        version,
        timestamp: Date.now()
    });
    
    res.json({ 
        success: true, 
        status: 'reset',
        version
    });
});

// ========== WEBSOCKET ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false,
    clientTracking: true
});

const wsClients = new Map(); // channelId -> Set<ws>

// Broadcast helper
function broadcastToAll(data) {
    const message = JSON.stringify(data);
    
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
            } catch (error) {
                logError('Broadcast error:', error);
            }
        }
    });
}

function broadcastToChannel(channelId, data) {
    const clients = wsClients.get(channelId);
    if (!clients) return;
    
    const message = JSON.stringify(data);
    
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
            } catch (error) {
                logError('Channel broadcast error:', error);
            }
        }
    });
}

// Periodic broadcast
setInterval(() => {
    if (!gameState.running) return;
    
    // Broadcast to all channels
    for (const [channelId, clients] of wsClients.entries()) {
        if (clients.size === 0) continue;
        
        const data = clickEngine.getHeatmapData(channelId);
        
        broadcastToChannel(channelId, {
            running: gameState.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.uniqueUsers,
            mode: data.mode,
            version: gameState.version,
            timestamp: Date.now()
        });
    }
}, CONFIG.BROADCAST_INTERVAL);

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const url = req.url || '';
    log(`WebSocket connection: ${url}`, 'debug');
    
    // Extract channel from URL: /ws/CHANNEL_ID
    const channelMatch = url.match(/^\/ws\/(.+?)(?:\?|$)/);
    const channelId = channelMatch ? channelMatch[1] : 'global';
    
    log(`WebSocket client connected to channel: ${channelId}`);
    
    // Add to channel
    if (!wsClients.has(channelId)) {
        wsClients.set(channelId, new Set());
    }
    wsClients.get(channelId).add(ws);
    
    // Send initial state
    const data = clickEngine.getHeatmapData(channelId);
    ws.send(JSON.stringify({
        running: gameState.running,
        clusters: data.clusters,
        totalClicks: data.totalClicks,
        uniqueUsers: data.uniqueUsers,
        mode: data.mode,
        version: gameState.version,
        timestamp: Date.now()
    }));
    
    // Handle messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch {}
    });
    
    // Cleanup on close
    ws.on('close', () => {
        const clients = wsClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                wsClients.delete(channelId);
            }
        }
        log(`WebSocket disconnected from channel: ${channelId}`);
    });
    
    ws.on('error', (error) => {
        logError(`WebSocket error for ${channelId}:`, error);
    });
});

wss.on('error', (error) => {
    logError('WebSocket server error:', error);
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    log('⚡ ClickMap Server v10.0.0 - FIXED CONNECTIVITY');
    log(`📡 Port: ${PORT}`);
    log(`🔗 WebSocket: ws://localhost:${PORT}/ws/CHANNEL_ID`);
    log(`🔗 HTTP: http://localhost:${PORT}`);
    log('✅ CORS: Enabled for all origins');
    log(`🔄 Broadcast interval: ${CONFIG.BROADCAST_INTERVAL}ms`);
    log(`📊 WebSocket clients: ${wss.clients.size}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('Shutting down...');
    gameState.setRunning(false);
    clickEngine.clearAll();
    wss.close();
    httpServer.close(() => {
        process.exit(0);
    });
});

export default httpServer;
