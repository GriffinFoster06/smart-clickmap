// backend/server.js - Complete implementation with one click per user + immediate state control
// Handles 15k CPS with autoscaling persistence and instant state changes

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

console.log(`Instance ${INSTANCE_ID} starting...`);

// ========== EXTREME LOAD CONFIGURATION ==========
const CONFIG = {
    // Load thresholds and sampling rates
    LOAD_LEVELS: {
        NORMAL: { threshold: 1000, sample: 1, grid: false, broadcast: 5000 },
        HIGH: { threshold: 5000, sample: 10, grid: true, broadcast: 3000 },
        EXTREME: { threshold: 15000, sample: 50, grid: true, broadcast: 2000 },
        MELTDOWN: { threshold: 25000, sample: 100, grid: true, broadcast: 1000 }
    },
    
    // Performance limits
    MAX_CLICKS_PER_SECOND: 50000,  // Instance limit
    GRID_SIZE: 20,                 // Efficient grid size
    CLEANUP_INTERVAL: 2000,        // Clean every 2 seconds
    
    // Redis keys
    GAME_STATE_KEY: 'clickmap:gamestate',
    COMMANDS_CHANNEL: 'clickmap:commands',
    
    // State management
    STATE_CACHE_MS: 100,           // Cache game state checks
    REDIS_RETRY_DELAY: 1000
};

// ========== REDIS SETUP ==========
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 2000,
        lazyConnect: true,
        reconnectStrategy: (retries) => {
            if (retries > 5) return null;
            return CONFIG.REDIS_RETRY_DELAY;
        }
    }
});

redis.on('error', (err) => console.log('Redis error:', err.message));
redis.on('connect', () => console.log('Redis connected'));
redis.on('ready', () => console.log('Redis ready'));

// Connect Redis
redis.connect().catch(err => {
    console.log('Redis unavailable - local fallback mode');
});

// ========== REDIS GAME STATE MANAGER ==========
class RedisGameState {
    constructor(redis, instanceId) {
        this.redis = redis;
        this.instanceId = instanceId;
        this.key = CONFIG.GAME_STATE_KEY;
        this.lastCheck = 0;
        this.cachedState = { running: false, version: 0 };
    }
    
    async isRunning() {
        const now = Date.now();
        
        // Use cached value if recent
        if (now - this.lastCheck < CONFIG.STATE_CACHE_MS) {
            return this.cachedState.running;
        }
        
        if (!this.redis.isReady) {
            return this.cachedState.running;
        }
        
        try {
            const state = await this.redis.get(this.key);
            if (state) {
                this.cachedState = JSON.parse(state);
            }
            this.lastCheck = now;
            return this.cachedState.running;
        } catch (error) {
            console.log('State check failed:', error.message);
            return this.cachedState.running;
        }
    }
    
    async start() {
        const version = Date.now();
        const state = {
            running: true,
            version,
            startedBy: this.instanceId,
            startTime: Date.now()
        };
        
        this.cachedState = state;
        
        if (this.redis.isReady) {
            try {
                // Store state with 15min expiry
                await this.redis.setex(this.key, 900, JSON.stringify(state));
                
                // Broadcast to all instances
                await this.redis.publish(CONFIG.COMMANDS_CHANNEL, JSON.stringify({
                    action: 'start',
                    ...state
                }));
                
                console.log(`Game started by ${this.instanceId}, broadcast to cluster`);
            } catch (error) {
                console.log('Redis start failed:', error.message);
            }
        }
        
        return version;
    }
    
    async stop() {
        const version = Date.now();
        const state = {
            running: false,
            version,
            stoppedBy: this.instanceId,
            stopTime: Date.now()
        };
        
        this.cachedState = state;
        
        if (this.redis.isReady) {
            try {
                // Keep stop state briefly
                await this.redis.setex(this.key, 60, JSON.stringify(state));
                
                // Broadcast stop command
                await this.redis.publish(CONFIG.COMMANDS_CHANNEL, JSON.stringify({
                    action: 'stop',
                    ...state
                }));
                
                console.log(`Game stopped by ${this.instanceId}, broadcast to cluster`);
            } catch (error) {
                console.log('Redis stop failed:', error.message);
            }
        }
        
        return version;
    }
    
    async reset() {
        const version = Date.now();
        const state = {
            running: this.cachedState.running,
            version,
            resetBy: this.instanceId,
            resetTime: Date.now()
        };
        
        this.cachedState.version = version;
        
        if (this.redis.isReady) {
            try {
                // Broadcast reset
                await this.redis.publish(CONFIG.COMMANDS_CHANNEL, JSON.stringify({
                    action: 'reset',
                    ...state
                }));
                
                console.log(`Data reset by ${this.instanceId}`);
            } catch (error) {
                console.log('Redis reset failed:', error.message);
            }
        }
        
        return version;
    }
    
    getState() {
        return {
            ...this.cachedState,
            instanceId: this.instanceId
        };
    }
}

// ========== EXTREME LOAD CLICK ENGINE WITH ONE CLICK PER USER ==========
class ExtremeLoadClickEngine {
    constructor(gameState) {
        this.gameState = gameState;
        this.instanceId = gameState.instanceId;
        
        // IMMEDIATE CONTROL FLAGS
        this.immediateStop = false;  // Instant request rejection
        
        // Load monitoring
        this.currentLoad = 'NORMAL';
        this.clicksThisSecond = 0;
        this.lastSecond = Math.floor(Date.now() / 1000);
        
        // Memory-efficient grid for extreme loads
        this.gridSize = CONFIG.GRID_SIZE;
        this.heatGrid = new Float32Array(this.gridSize * this.gridSize);
        this.gridTotalClicks = 0;
        this.gridLastClear = Date.now();
        
        // ONE CLICK PER USER storage: channelId -> Map(userId -> click)
        this.currentClicks = new Map();
        
        // JWT cache
        this.jwtCache = new Map();
        this.maxJWTCache = 1000;
        
        // Performance tracking
        this.droppedSampling = 0;
        this.droppedOverload = 0;
        this.droppedImmediate = 0;
        this.processed = 0;
        
        this.startLoadMonitoring();
        this.startCleanupTask();
        
        console.log(`Extreme load engine ready (${this.instanceId})`);
    }
    
    startLoadMonitoring() {
        setInterval(() => {
            const currentSecond = Math.floor(Date.now() / 1000);
            
            if (currentSecond !== this.lastSecond) {
                const cps = this.clicksThisSecond;
                const oldLoad = this.currentLoad;
                
                // Determine load level
                if (cps > CONFIG.LOAD_LEVELS.MELTDOWN.threshold) this.currentLoad = 'MELTDOWN';
                else if (cps > CONFIG.LOAD_LEVELS.EXTREME.threshold) this.currentLoad = 'EXTREME';
                else if (cps > CONFIG.LOAD_LEVELS.HIGH.threshold) this.currentLoad = 'HIGH';
                else this.currentLoad = 'NORMAL';
                
                // Log load changes and high loads
                if (this.currentLoad !== oldLoad || cps > 500) {
                    const sampleRate = CONFIG.LOAD_LEVELS[this.currentLoad].sample;
                    console.log(`Load: ${this.currentLoad} - ${cps} CPS (sample 1:${sampleRate})`);
                }
                
                // Reset counters
                this.clicksThisSecond = 0;
                this.lastSecond = currentSecond;
            }
        }, 100);
    }
    
    startCleanupTask() {
        setInterval(() => {
            if (this.immediateStop) return; // Don't cleanup when stopped
            
            const now = Date.now();
            
            // Clear grid periodically in normal/high loads
            if (this.currentLoad === 'NORMAL' || this.currentLoad === 'HIGH') {
                if (now - this.gridLastClear > 10000) { // 10 seconds
                    this.heatGrid.fill(0);
                    this.gridTotalClicks = 0;
                    this.gridLastClear = now;
                }
            }
            
            // Clean old clicks for normal loads (keep only recent clicks)
            if (this.currentLoad === 'NORMAL') {
                const cutoff = now - 30000; // 30 seconds max age
                
                for (const [channelId, clicks] of this.currentClicks.entries()) {
                    for (const [userId, click] of clicks.entries()) {
                        if (click.timestamp < cutoff) {
                            clicks.delete(userId);
                        }
                    }
                    
                    if (clicks.size === 0) {
                        this.currentClicks.delete(channelId);
                    }
                }
            }
            
            // Clean JWT cache
            if (this.jwtCache.size > this.maxJWTCache) {
                const keys = Array.from(this.jwtCache.keys());
                keys.slice(0, Math.floor(this.maxJWTCache * 0.2)).forEach(key => {
                    this.jwtCache.delete(key);
                });
            }
            
        }, CONFIG.CLEANUP_INTERVAL);
    }
    
    // Fast JWT verification with caching
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }
        
        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            this.jwtCache.set(token, { payload, exp: payload.exp });
            return payload;
        } catch {
            return null;
        }
    }
    
    async addClick(channelId, userId, x, y) {
        // IMMEDIATE REJECTION FIRST (faster than any async operation)
        if (this.immediateStop) {
            this.droppedImmediate++;
            return false;
        }
        
        this.clicksThisSecond++;
        
        // Quick game state check
        if (!await this.gameState.isRunning()) {
            this.droppedOverload++;
            return false;
        }
        
        const loadConfig = CONFIG.LOAD_LEVELS[this.currentLoad];
        
        // Aggressive sampling based on load
        if (loadConfig.sample > 1 && Math.random() * loadConfig.sample > 1) {
            this.droppedSampling++;
            return false;
        }
        
        this.processed++;
        
        // Use grid for high/extreme loads
        if (loadConfig.grid) {
            const gridX = Math.min(this.gridSize - 1, Math.floor(x * this.gridSize));
            const gridY = Math.min(this.gridSize - 1, Math.floor(y * this.gridSize));
            const index = gridY * this.gridSize + gridX;
            
            this.heatGrid[index] += 1;
            this.gridTotalClicks++;
            return true;
        }
        
        // ONE CLICK PER USER processing for normal/detailed loads
        if (!this.currentClicks.has(channelId)) {
            this.currentClicks.set(channelId, new Map());
        }
        
        const channelClicks = this.currentClicks.get(channelId);
        
        // Store/UPDATE only ONE click per user (overwrites previous)
        channelClicks.set(userId, {
            x, y, 
            timestamp: Date.now(),
            userId
        });
        
        // Limit total unique users per channel
        if (channelClicks.size > 1000) {
            const oldestUsers = Array.from(channelClicks.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 200)
                .map(([userId]) => userId);
            oldestUsers.forEach(userId => channelClicks.delete(userId));
        }
        
        return true;
    }
    
    getHeatmapData(channelId) {
        if (!this.gameState.cachedState.running || this.immediateStop) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: 'STOPPED',
                instanceId: this.instanceId
            };
        }
        
        const loadConfig = CONFIG.LOAD_LEVELS[this.currentLoad];
        
        if (loadConfig.grid) {
            return this.generateGridClusters();
        } else {
            return this.generateDetailedClusters(channelId);
        }
    }
    
    generateGridClusters() {
        const clusters = [];
        const cellSize = 1 / this.gridSize;
        
        if (this.gridTotalClicks === 0) {
            return { 
                clusters: [], 
                totalClicks: 0, 
                uniqueUsers: 0, 
                mode: this.currentLoad,
                instanceId: this.instanceId
            };
        }
        
        // Generate clusters from hot grid cells
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const index = y * this.gridSize + x;
                const count = this.heatGrid[index];
                
                if (count > 0) {
                    const percentage = Math.round((count / this.gridTotalClicks) * 100);
                    if (percentage >= 3) {
                        clusters.push({
                            x: (x + 0.5) * cellSize,
                            y: (y + 0.5) * cellSize,
                            percentage,
                            count,
                            visualSize: Math.max(45, Math.min(150, 30 + percentage * 4)),
                            id: `grid_${x}_${y}`,
                            shapeType: 'circle'
                        });
                    }
                }
            }
        }
        
        // Sort and limit
        clusters.sort((a, b) => b.percentage - a.percentage);
        const topClusters = clusters.slice(0, 8);
        
        // Mark top cluster
        if (topClusters.length > 0) {
            topClusters[0].isTop = true;
        }
        
        return {
            clusters: topClusters,
            totalClicks: this.gridTotalClicks,
            uniqueUsers: Math.floor(this.gridTotalClicks * 0.6), // Estimate
            mode: this.currentLoad,
            instanceId: this.instanceId
        };
    }
    
    generateDetailedClusters(channelId) {
        const channelClicks = this.currentClicks.get(channelId);
        if (!channelClicks || channelClicks.size === 0) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: this.currentLoad,
                instanceId: this.instanceId
            };
        }
        
        const points = Array.from(channelClicks.values());
        const clusters = this.fastClustering(points);
        const uniqueUsers = points.length; // Each point is one user
        
        return {
            clusters,
            totalClicks: points.length,
            uniqueUsers,
            mode: this.currentLoad,
            instanceId: this.instanceId
        };
    }
    
    fastClustering(points) {
        const gridSize = 15;
        const grid = {};
        
        // Grid aggregation
        points.forEach(p => {
            const key = `${Math.floor(p.x * gridSize)}_${Math.floor(p.y * gridSize)}`;
            if (!grid[key]) {
                grid[key] = { sumX: 0, sumY: 0, count: 0, users: new Set() };
            }
            grid[key].sumX += p.x;
            grid[key].sumY += p.y;
            grid[key].count++;
            grid[key].users.add(p.userId);
        });
        
        // Convert to clusters
        const total = points.length;
        const clusters = Object.values(grid)
            .map(cell => ({
                x: cell.sumX / cell.count,
                y: cell.sumY / cell.count,
                count: cell.count,
                percentage: Math.round((cell.count / total) * 100),
                uniqueUsers: cell.users.size
            }))
            .filter(c => c.percentage >= 3)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 12)
            .map((c, i) => ({
                ...c,
                visualSize: Math.min(200, 50 + Math.sqrt(c.percentage) * 35),
                id: `cluster_${i}`,
                isTop: i === 0,
                shapeType: c.percentage > 20 ? 'polygon' : 'circle',
                preferredSides: Math.min(12, 6 + Math.floor(c.percentage / 8))
            }));
        
        return clusters;
    }
    
    // IMMEDIATE CONTROL METHODS
    immediatelyStop() {
        console.log(`IMMEDIATE STOP - ${this.instanceId}`);
        // Set flag FIRST for instant rejection
        this.immediateStop = true;
        this.clearAll();
    }
    
    immediatelyStart() {
        console.log(`IMMEDIATE START - ${this.instanceId}`);
        // Clear everything FIRST, then enable
        this.clearAll();
        this.immediateStop = false;
    }
    
    clearAll() {
        this.currentClicks.clear();
        this.heatGrid.fill(0);
        this.gridTotalClicks = 0;
        this.gridLastClear = Date.now();
        this.jwtCache.clear();
        this.processed = 0;
        this.droppedSampling = 0;
        this.droppedOverload = 0;
        this.droppedImmediate = 0;
        
        if (global.gc) {
            global.gc();
        }
    }
    
    getStatus() {
        const loadConfig = CONFIG.LOAD_LEVELS[this.currentLoad];
        
        return {
            instanceId: this.instanceId,
            immediateStop: this.immediateStop,
            load: this.currentLoad,
            clicksPerSecond: this.clicksThisSecond,
            samplingRate: loadConfig.sample,
            gridMode: loadConfig.grid,
            processed: this.processed,
            droppedSampling: this.droppedSampling,
            droppedOverload: this.droppedOverload,
            droppedImmediate: this.droppedImmediate,
            gridTotalClicks: this.gridTotalClicks,
            detailedChannels: this.currentClicks.size,
            totalUniqueUsers: Array.from(this.currentClicks.values())
                .reduce((sum, channel) => sum + channel.size, 0),
            jwtCacheSize: this.jwtCache.size
        };
    }
}

// ========== INITIALIZE COMPONENTS ==========
const gameState = new RedisGameState(redis, INSTANCE_ID);
const clickEngine = new ExtremeLoadClickEngine(gameState);

// ========== REDIS COMMAND SUBSCRIPTION ==========
if (redis.isReady || redis.status === 'connecting') {
    redis.subscribe(CONFIG.COMMANDS_CHANNEL, (message, channel) => {
        try {
            const cmd = JSON.parse(message);
            
            // Ignore commands from this instance
            if (cmd.startedBy === INSTANCE_ID || cmd.stoppedBy === INSTANCE_ID || cmd.resetBy === INSTANCE_ID) {
                return;
            }
            
            if (cmd.action === 'start') {
                clickEngine.immediatelyStart();
                console.log(`Remote start by ${cmd.startedBy}`);
            } else if (cmd.action === 'stop') {
                clickEngine.immediatelyStop();
                console.log(`Remote stop by ${cmd.stoppedBy}`);
            } else if (cmd.action === 'reset') {
                clickEngine.clearAll();
                console.log(`Remote reset by ${cmd.resetBy}`);
            }
        } catch (error) {
            console.log('Command sync error:', error.message);
        }
    }).catch(err => {
        console.log('Redis subscription failed:', err.message);
    });
}

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

// HEALTH with instance info
app.get('/health', (req, res) => {
    const status = clickEngine.getStatus();
    const state = gameState.getState();
    
    res.json({
        status: 'ok',
        version: '11.0.0-oneclick',
        ...state,
        ...status,
        timestamp: Date.now(),
        redisConnected: redis.isReady,
        features: ['one-click-per-user', 'immediate-state-control', 'extreme-load-15k']
    });
});

// CLICK - Production endpoint with one click per user
app.post('/click', async (req, res) => {
    requestsPerSecond++;
    
    // Hard rate limit per instance
    if (requestsPerSecond > CONFIG.MAX_CLICKS_PER_SECOND) {
        return res.status(429).json({ error: 'Instance overload' });
    }
    
    // Quick game state check
    if (!await gameState.isRunning()) {
        return res.status(400).json({ error: 'Game not running' });
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
    
    // Process click with extreme load handling
    const accepted = await clickEngine.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    res.json({ 
        success: true,
        accepted,
        instanceId: INSTANCE_ID,
        mode: clickEngine.currentLoad
    });
});

// TEST CLICK - For load testing
app.post('/test-click', async (req, res) => {
    try {
        requestsPerSecond++;
        
        if (requestsPerSecond > CONFIG.MAX_CLICKS_PER_SECOND) {
            return res.status(429).json({ error: 'Rate limit' });
        }
        
        if (!await gameState.isRunning()) {
            return res.status(400).json({ 
                error: 'Game not running - use /start first',
                instanceId: INSTANCE_ID
            });
        }
        
        const { x, y, channelId = 'test_channel', userId = 'test_user' } = req.body;
        
        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            return res.status(400).json({ error: 'Invalid coordinates' });
        }
        
        const accepted = await clickEngine.addClick(channelId, userId, x, y);
        
        res.json({ 
            success: true,
            accepted,
            testMode: true,
            instanceId: INSTANCE_ID,
            mode: clickEngine.currentLoad
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message,
            instanceId: INSTANCE_ID
        });
    }
});

// HEATMAP with instance coordination
app.get('/heatmap', async (req, res) => {
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
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
    });
});

// START - IMMEDIATE clear then enable
app.post('/start', async (req, res) => {
    console.log(`START command received on ${INSTANCE_ID}`);
    
    // IMMEDIATE clear and enable FIRST
    clickEngine.immediatelyStart();
    
    // Then handle Redis coordination
    const version = await gameState.start();
    
    // Always broadcast empty state on start
    broadcastUpdate('all', {
        running: true,
        clusters: [], // ALWAYS empty on start
        totalClicks: 0,
        uniqueUsers: 0,
        action: 'start',
        version,
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
    });
    
    res.json({ 
        success: true, 
        status: 'started',
        running: true,
        version,
        instanceId: INSTANCE_ID
    });
});

// STOP - IMMEDIATE cutoff, no catch-up
app.post('/stop', async (req, res) => {
    console.log(`STOP command received on ${INSTANCE_ID}`);
    
    // IMMEDIATE cutoff - no final data collection
    clickEngine.immediatelyStop();
    
    const version = await gameState.stop();
    
    // Always broadcast empty state on stop (no catch-up)
    broadcastUpdate('all', {
        running: false,
        clusters: [], // ALWAYS empty on stop
        totalClicks: 0,
        uniqueUsers: 0,
        action: 'stop',
        version,
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
    });
    
    res.json({ 
        success: true, 
        status: 'stopped',
        running: false,
        version,
        instanceId: INSTANCE_ID
    });
});

// RESET - IMMEDIATE clear
app.post('/reset', async (req, res) => {
    console.log(`RESET command received on ${INSTANCE_ID}`);
    
    // IMMEDIATE clear
    clickEngine.clearAll();
    
    const version = await gameState.reset();
    const state = gameState.getState();
    
    // Always broadcast empty state
    broadcastUpdate('all', {
        running: state.running,
        clusters: [], // ALWAYS empty on reset
        totalClicks: 0,
        uniqueUsers: 0,
        action: 'reset',
        version,
        instanceId: INSTANCE_ID,
        timestamp: Date.now()
    });
    
    res.json({ 
        success: true, 
        status: 'reset',
        version,
        instanceId: INSTANCE_ID
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

// Adaptive broadcast interval based on load
function getBroadcastInterval() {
    const loadConfig = CONFIG.LOAD_LEVELS[clickEngine.currentLoad];
    return loadConfig.broadcast;
}

// Periodic broadcast with adaptive interval
let broadcastInterval;
function startBroadcast() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    
    broadcastInterval = setInterval(async () => {
        if (!await gameState.isRunning() || clickEngine.immediateStop) return;
        
        for (const [channelId, clients] of wsClients.entries()) {
            if (clients.size === 0) continue;
            
            const data = clickEngine.getHeatmapData(channelId);
            const state = gameState.getState();
            
            const message = JSON.stringify({
                running: state.running && !clickEngine.immediateStop,
                clusters: data.clusters,
                totalClicks: data.totalClicks,
                uniqueUsers: data.uniqueUsers,
                mode: data.mode,
                version: state.version,
                instanceId: INSTANCE_ID,
                timestamp: Date.now()
            });
            
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(message); } catch {}
                }
            });
        }
        
        // Adjust interval based on load
        const newInterval = getBroadcastInterval();
        if (newInterval !== broadcastInterval._repeat) {
            startBroadcast(); // Restart with new interval
        }
    }, getBroadcastInterval());
}

startBroadcast();

// WebSocket connections
wss.on('connection', async (ws, req) => {
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
        running: state.running && !clickEngine.immediateStop,
        clusters: data.clusters,
        totalClicks: data.totalClicks,
        uniqueUsers: data.uniqueUsers,
        mode: data.mode,
        version: state.version,
        instanceId: INSTANCE_ID,
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
    console.log('EXTREME LOAD ClickMap Server v11.0.0');
    console.log(`Instance: ${INSTANCE_ID}`);
    console.log(`Port: ${PORT}`);
    console.log('Features:');
    console.log('  • One click per user (moveable)');
    console.log('  • Immediate state control (no catch-up)');
    console.log('  • 15k+ CPS extreme load handling');
    console.log('  • Redis-based state coordination');
    console.log('  • Auto-scaling persistence');
    console.log('  • Adaptive sampling (1:1 to 1:100)');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(`Shutting down instance ${INSTANCE_ID}...`);
    clickEngine.immediatelyStop();
    
    if (redis.isReady) {
        redis.disconnect();
    }
    
    httpServer.close(() => {
        process.exit(0);
    });
});

export default httpServer;
