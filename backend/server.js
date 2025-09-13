// backend/server.js - REAL-TIME PRIORITY: Always current, never playing catch-up
// Proper stop/start/reset with immediate cleanup

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

// ========== REAL-TIME CONFIGURATION ==========
const CONFIG = {
    // Time windows
    MAX_CLICK_AGE_MS: 5000,        // Ignore clicks older than 5 seconds
    CURRENT_WINDOW_MS: 10000,      // Only keep last 10 seconds of data
    BROADCAST_INTERVAL: 5000,      // Broadcast every 5 seconds
    
    // Load management
    MAX_CLICKS_PER_SECOND: 10000,  // Hard limit
    SAMPLING_RATES: {
        LOW: 1,       // < 100/s: Accept all
        MEDIUM: 5,    // 100-1000/s: 1 in 5
        HIGH: 20,     // 1000-5000/s: 1 in 20
        EXTREME: 100  // > 5000/s: 1 in 100
    },
    
    // Memory management
    MAX_POINTS_PER_CHANNEL: 5000,  // Hard limit per channel
    CLEANUP_INTERVAL: 2000,         // Clean old data every 2 seconds
    
    // Grid settings for high load
    GRID_SIZE: 30,
    GRID_THRESHOLD: 1000, // Use grid above 1000 clicks/s
    
    // State management
    HARD_STOP_ENABLED: true,        // Immediate stop, no processing
    CLEAR_ON_START: true,           // Clear all data on start
    CLEAR_ON_RESET: true            // Clear all data on reset
};

// ========== GAME STATE MANAGER ==========
class GameStateManager {
    constructor() {
        this.isRunning = false;
        this.version = Date.now();
        this.lastStateChange = Date.now();
    }
    
    start() {
        console.log('🚀 GAME START - Clearing all old data');
        this.isRunning = true;
        this.version = Date.now();
        this.lastStateChange = Date.now();
        return this.version;
    }
    
    stop() {
        console.log('🛑 GAME STOP - Halting all processing');
        this.isRunning = false;
        this.version = Date.now();
        this.lastStateChange = Date.now();
        return this.version;
    }
    
    reset() {
        console.log('🗑️ GAME RESET - Clearing everything');
        this.version = Date.now();
        this.lastStateChange = Date.now();
        return this.version;
    }
    
    getState() {
        return {
            running: this.isRunning,
            version: this.version,
            lastChange: this.lastStateChange
        };
    }
}

// ========== REAL-TIME CLICK ENGINE ==========
class RealTimeClickEngine {
    constructor(gameState) {
        this.gameState = gameState;
        
        // Current data only (no history)
        this.currentClicks = new Map(); // channelId -> Map(userId -> click)
        this.gridAggregators = new Map(); // channelId -> GridAggregator
        
        // Performance tracking
        this.clicksPerSecond = 0;
        this.totalReceived = 0;
        this.totalDropped = 0;
        this.currentLoad = 'LOW';
        this.samplingRate = 1;
        
        // JWT cache (small, fast)
        this.jwtCache = new Map();
        this.maxJWTCache = 1000;
        
        // Start cleanup task
        this.startCleanupTask();
        this.startMetricsTask();
        
        console.log('⚡ Real-time engine initialized');
    }
    
    // Fast JWT verification
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }
        
        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // Simple LRU
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
    
    // Main click handler - REAL-TIME PRIORITY
    addClick(channelId, userId, x, y) {
        // IMMEDIATE REJECTION if game not running
        if (!this.gameState.isRunning) {
            this.totalDropped++;
            return false;
        }
        
        const now = Date.now();
        this.totalReceived++;
        
        // DROP OLD CLICKS IMMEDIATELY (no catch-up)
        const clickAge = now - this.gameState.lastStateChange;
        if (clickAge > CONFIG.MAX_CLICK_AGE_MS) {
            this.totalDropped++;
            return false; // Click is too old, drop it
        }
        
        // Sampling based on current load
        if (this.samplingRate > 1 && Math.random() > (1 / this.samplingRate)) {
            this.totalDropped++;
            return false;
        }
        
        // HIGH LOAD: Use grid (very fast)
        if (this.currentLoad === 'HIGH' || this.currentLoad === 'EXTREME') {
            if (!this.gridAggregators.has(channelId)) {
                this.gridAggregators.set(channelId, new GridAggregator());
            }
            this.gridAggregators.get(channelId).addClick(x, y);
            return true;
        }
        
        // NORMAL LOAD: Store individual clicks
        if (!this.currentClicks.has(channelId)) {
            this.currentClicks.set(channelId, new Map());
        }
        
        const channelClicks = this.currentClicks.get(channelId);
        
        // Enforce max points limit (drop oldest)
        if (channelClicks.size >= CONFIG.MAX_POINTS_PER_CHANNEL) {
            // Remove 20% oldest entries
            const toRemove = Math.floor(channelClicks.size * 0.2);
            const keys = Array.from(channelClicks.keys()).slice(0, toRemove);
            keys.forEach(key => channelClicks.delete(key));
        }
        
        // Store click with timestamp
        channelClicks.set(`${userId}_${Date.now()}_${Math.random()}`, {
            x, y, 
            timestamp: now,
            userId
        });
        
        return true;
    }
    
    // Get current heatmap data
    getHeatmapData(channelId) {
        // Return empty if game not running
        if (!this.gameState.isRunning) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: 'STOPPED'
            };
        }
        
        // Grid mode for high load
        if (this.gridAggregators.has(channelId)) {
            const grid = this.gridAggregators.get(channelId);
            const clusters = this.gridToClusters(grid.getHeatmap());
            return {
                clusters,
                totalClicks: grid.total,
                uniqueUsers: Math.floor(grid.total * 0.7), // Estimate
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
        
        // Convert to points
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
    
    // Fast clustering for real-time
    fastClustering(points) {
        const gridSize = 20;
        const grid = {};
        
        // Grid aggregation
        points.forEach(p => {
            const key = `${Math.floor(p.x * gridSize)}_${Math.floor(p.y * gridSize)}`;
            if (!grid[key]) {
                grid[key] = { sumX: 0, sumY: 0, count: 0 };
            }
            grid[key].sumX += p.x;
            grid[key].sumY += p.y;
            grid[key].count++;
        });
        
        // Convert to clusters
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
            .slice(0, 15); // Max 15 clusters
        
        // Add visual properties
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
    
    // Grid to clusters conversion
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
    
    // IMMEDIATE CLEAR - no delay, no processing
    clearAll() {
        console.log('🧹 CLEARING ALL DATA IMMEDIATELY');
        this.currentClicks.clear();
        this.gridAggregators.clear();
        this.jwtCache.clear();
        this.totalReceived = 0;
        this.totalDropped = 0;
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    }
    
    clearChannel(channelId) {
        console.log(`🧹 Clearing channel ${channelId}`);
        this.currentClicks.delete(channelId);
        this.gridAggregators.delete(channelId);
    }
    
    // Cleanup old data regularly
    startCleanupTask() {
        setInterval(() => {
            if (!this.gameState.isRunning) return;
            
            const now = Date.now();
            const cutoff = now - CONFIG.CURRENT_WINDOW_MS;
            
            // Clean old clicks from all channels
            for (const [channelId, clicks] of this.currentClicks.entries()) {
                for (const [key, click] of clicks.entries()) {
                    if (click.timestamp < cutoff) {
                        clicks.delete(key);
                    }
                }
                
                // Remove empty channels
                if (clicks.size === 0) {
                    this.currentClicks.delete(channelId);
                }
            }
            
            // Clear grids if not in high load
            if (this.currentLoad !== 'HIGH' && this.currentLoad !== 'EXTREME') {
                this.gridAggregators.clear();
            }
            
        }, CONFIG.CLEANUP_INTERVAL);
    }
    
    // Track metrics
    startMetricsTask() {
        setInterval(() => {
            const cps = this.totalReceived;
            
            // Determine load level
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
            
            // Log if active
            if (cps > 0) {
                const dropRate = this.totalDropped > 0 ? 
                    ((this.totalDropped / (this.totalDropped + cps)) * 100).toFixed(1) : 0;
                console.log(`📊 ${this.currentLoad}: ${cps}/s (${dropRate}% dropped, 1:${this.samplingRate})`);
            }
            
            this.clicksPerSecond = cps;
            this.totalReceived = 0;
            this.totalDropped = 0;
        }, 1000);
    }
    
    getStatus() {
        return {
            load: this.currentLoad,
            clicksPerSecond: this.clicksPerSecond,
            samplingRate: this.samplingRate,
            channels: this.currentClicks.size,
            gridChannels: this.gridAggregators.size,
            totalPoints: Array.from(this.currentClicks.values())
                .reduce((sum, channel) => sum + channel.size, 0)
        };
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
        reconnectStrategy: () => null // Don't retry
    }
});

redis.on('error', () => {}); // Ignore Redis errors
redis.connect().catch(() => console.log('📴 Redis unavailable - memory only mode'));

// ========== INITIALIZE ==========
const gameState = new GameStateManager();
const clickEngine = new RealTimeClickEngine(gameState);

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));

// Request tracking
let requestsPerSecond = 0;
setInterval(() => { requestsPerSecond = 0; }, 1000);

// ========== ENDPOINTS ==========

// HEALTH
app.get('/health', (req, res) => {
    const status = clickEngine.getStatus();
    const state = gameState.getState();
    
    res.json({
        status: 'ok',
        ...state,
        ...status,
        timestamp: Date.now(),
        instanceId: INSTANCE_ID
    });
});

// CLICK - Real-time processing
app.post('/click', (req, res) => {
    requestsPerSecond++;
    
    // Rate limit
    if (requestsPerSecond > CONFIG.MAX_CLICKS_PER_SECOND) {
        return res.status(429).json({ error: 'Rate limit' });
    }
    
    // Quick rejection if not running
    if (!gameState.isRunning) {
        return res.status(400).json({ error: 'Not running' });
    }
    
    // Token verification
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }
    
    const payload = clickEngine.verifyJWTFast(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Validate coordinates
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' ||
        x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }
    
    // Process click
    const accepted = clickEngine.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    res.json({ 
        success: true,
        accepted
    });
});

// HEATMAP
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;
    
    const data = clickEngine.getHeatmapData(channelId);
    const state = gameState.getState();
    
    res.json({
        running: state.running,
        clusters: data.clusters,
        totalClicks: data.totalClicks,
        uniqueUsers: data.uniqueUsers,
        mode: data.mode,
        threshold,
        version: state.version,
        timestamp: Date.now()
    });
});

// START - Clear everything and start fresh
app.post('/start', async (req, res) => {
    console.log('▶️ START COMMAND RECEIVED');
    
    // Clear EVERYTHING first
    if (CONFIG.CLEAR_ON_START) {
        clickEngine.clearAll();
        
        // Clear Redis if available
        if (redis.isReady) {
            try {
                await redis.flushDb();
            } catch {}
        }
    }
    
    // Start game
    const version = gameState.start();
    
    // Broadcast immediate update
    broadcastUpdate('all', {
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

// STOP - Immediate halt
app.post('/stop', async (req, res) => {
    console.log('⏹️ STOP COMMAND RECEIVED');
    
    // Stop game immediately
    const version = gameState.stop();
    
    // Get final state before clearing
    const finalData = clickEngine.getHeatmapData();
    
    // Clear all processing
    if (CONFIG.HARD_STOP_ENABLED) {
        clickEngine.clearAll();
    }
    
    // Broadcast final state then clear
    broadcastUpdate('all', {
        running: false,
        clusters: finalData.clusters,
        totalClicks: finalData.totalClicks,
        uniqueUsers: finalData.uniqueUsers,
        action: 'stop',
        version,
        timestamp: Date.now()
    });
    
    // Send empty state after short delay
    setTimeout(() => {
        broadcastUpdate('all', {
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

// RESET - Clear everything
app.post('/reset', async (req, res) => {
    console.log('🗑️ RESET COMMAND RECEIVED');
    
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    // Clear data
    if (CONFIG.CLEAR_ON_RESET) {
        if (channelId) {
            clickEngine.clearChannel(channelId);
        } else {
            clickEngine.clearAll();
            
            // Clear Redis if available
            if (redis.isReady) {
                try {
                    await redis.flushDb();
                } catch {}
            }
        }
    }
    
    const version = gameState.reset();
    const state = gameState.getState();
    
    // Broadcast empty state
    broadcastUpdate(channelId || 'all', {
        running: state.running,
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
    perMessageDeflate: false
});

const wsClients = new Map(); // channelId -> Set<ws>

// Broadcast helper
function broadcastUpdate(channelId, data) {
    const message = JSON.stringify(data);
    
    if (channelId === 'all') {
        // Broadcast to all channels
        for (const clients of wsClients.values()) {
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(message); } catch {}
                }
            });
        }
    } else {
        // Broadcast to specific channel
        const clients = wsClients.get(channelId);
        if (clients) {
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(message); } catch {}
                }
            });
        }
    }
}

// Periodic broadcast (only if running)
setInterval(() => {
    if (!gameState.isRunning) return;
    
    for (const [channelId, clients] of wsClients.entries()) {
        if (clients.size === 0) continue;
        
        const data = clickEngine.getHeatmapData(channelId);
        const state = gameState.getState();
        
        const message = JSON.stringify({
            running: state.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.uniqueUsers,
            mode: data.mode,
            version: state.version,
            timestamp: Date.now()
        });
        
        clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(message); } catch {}
            }
        });
    }
}, CONFIG.BROADCAST_INTERVAL);

// WebSocket connections
wss.on('connection', (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
    // Add to channel
    if (!wsClients.has(channelId)) {
        wsClients.set(channelId, new Set());
    }
    wsClients.get(channelId).add(ws);
    
    // Send current state
    const data = clickEngine.getHeatmapData(channelId);
    const state = gameState.getState();
    
    ws.send(JSON.stringify({
        running: state.running,
        clusters: data.clusters,
        totalClicks: data.totalClicks,
        uniqueUsers: data.uniqueUsers,
        mode: data.mode,
        version: state.version,
        timestamp: Date.now()
    }));
    
    // Cleanup on close
    ws.on('close', () => {
        const clients = wsClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                wsClients.delete(channelId);
            }
        }
    });
    
    ws.on('error', () => {});
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('⚡ REAL-TIME ClickMap Server v9.0.0');
    console.log(`📡 Port: ${PORT}`);
    console.log('🎯 Features:');
    console.log('  • Never plays catch-up (drops old clicks)');
    console.log('  • Immediate stop/start/reset');
    console.log('  • Current data only (10s window)');
    console.log('  • Auto-cleanup every 2s');
    console.log('  • Hard stops enabled');
    console.log(`🔄 Broadcast: ${CONFIG.BROADCAST_INTERVAL}ms`);
    console.log(`⏱️ Max click age: ${CONFIG.MAX_CLICK_AGE_MS}ms`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    gameState.stop();
    clickEngine.clearAll();
    httpServer.close(() => {
        process.exit(0);
    });
});

export default httpServer;
