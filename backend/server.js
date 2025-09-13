// backend/server.js - BALANCED: Sophisticated clustering at low load, grid at high load
// Preserves visual quality while preventing crashes at any scale

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

// ========== BALANCED PERFORMANCE SETTINGS ==========
const PERFORMANCE_CONFIG = {
    // Load thresholds
    LOW_LOAD_THRESHOLD: 100,      // < 100/s: Full sophistication
    MEDIUM_LOAD_THRESHOLD: 1000,   // 100-1000/s: Simplified clustering
    HIGH_LOAD_THRESHOLD: 10000,    // 1000-10000/s: Grid mode
    EXTREME_LOAD_THRESHOLD: 100000, // > 10000/s: Emergency mode
    
    // Sampling rates by load
    SAMPLING: {
        LOW: 1,       // Accept all clicks
        MEDIUM: 3,    // 1 in 3
        HIGH: 10,     // 1 in 10
        EXTREME: 100, // 1 in 100
        EMERGENCY: 1000 // 1 in 1000
    },
    
    // Clustering complexity by load
    MAX_CLUSTERS: {
        LOW: 20,      // Full sophistication
        MEDIUM: 15,   // Moderate
        HIGH: 10,     // Simplified
        GRID: 20      // Grid cells
    },
    
    // Memory protection
    MAX_POINTS_IN_MEMORY: 50000,
    MAX_MEMORY_MB: 400,
    
    // I/O protection
    REDIS_BATCH_INTERVAL: 10000, // 10 seconds
    REDIS_BATCH_SIZE: 500,
    
    // Grid settings for high load
    GRID_SIZE: 30, // 30x30 = 900 cells max
    
    // Broadcast settings
    BROADCAST_INTERVAL: 5000 // Keep 5 second updates
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ========== LOAD MONITOR WITH CIRCUIT BREAKER ==========
class LoadMonitor {
    constructor() {
        this.clicksInSecond = 0;
        this.totalClicks = 0;
        this.droppedClicks = 0;
        this.currentLoad = 'LOW';
        this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.LOW;
        
        // Reset counter every second
        setInterval(() => {
            const cps = this.clicksInSecond;
            
            // Determine load level
            if (cps < PERFORMANCE_CONFIG.LOW_LOAD_THRESHOLD) {
                this.currentLoad = 'LOW';
                this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.LOW;
            } else if (cps < PERFORMANCE_CONFIG.MEDIUM_LOAD_THRESHOLD) {
                this.currentLoad = 'MEDIUM';
                this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.MEDIUM;
            } else if (cps < PERFORMANCE_CONFIG.HIGH_LOAD_THRESHOLD) {
                this.currentLoad = 'HIGH';
                this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.HIGH;
            } else if (cps < PERFORMANCE_CONFIG.EXTREME_LOAD_THRESHOLD) {
                this.currentLoad = 'EXTREME';
                this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.EXTREME;
            } else {
                this.currentLoad = 'EMERGENCY';
                this.samplingRate = PERFORMANCE_CONFIG.SAMPLING.EMERGENCY;
            }
            
            // Log status changes
            if (cps > 0) {
                const dropRate = this.droppedClicks > 0 ? 
                    ((this.droppedClicks / (this.droppedClicks + cps)) * 100).toFixed(1) : 0;
                console.log(`📊 Load: ${this.currentLoad} (${cps}/s, ${dropRate}% dropped, 1:${this.samplingRate} sampling)`);
            }
            
            this.clicksInSecond = 0;
            this.droppedClicks = 0;
        }, 1000);
    }
    
    recordClick() {
        this.clicksInSecond++;
        this.totalClicks++;
    }
    
    shouldAcceptClick() {
        this.recordClick();
        
        // Emergency circuit breaker
        if (this.clicksInSecond > PERFORMANCE_CONFIG.EXTREME_LOAD_THRESHOLD * 2) {
            this.droppedClicks++;
            return false;
        }
        
        // Sampling based on current load
        if (this.samplingRate > 1) {
            const shouldSample = Math.random() < (1 / this.samplingRate);
            if (!shouldSample) {
                this.droppedClicks++;
                return false;
            }
        }
        
        return true;
    }
    
    getLoadLevel() {
        return this.currentLoad;
    }
    
    getClicksPerSecond() {
        return this.clicksInSecond;
    }
}

// ========== ADAPTIVE CLICK ENGINE ==========
class AdaptiveClickEngine {
    constructor() {
        this.loadMonitor = new LoadMonitor();
        
        // Memory-bounded storage
        this.clickPoints = new Map(); // channelId -> points array
        this.maxPointsPerChannel = 10000;
        
        // Grid aggregator for high load
        this.gridAggregators = new Map(); // channelId -> GridAggregator
        
        // JWT cache
        this.jwtCache = new Map();
        this.maxJWTCache = 5000;
        
        // Redis write buffer
        this.redisBuffer = [];
        this.lastRedisFlush = Date.now();
        
        // State
        this.isRunning = true;
        
        // Start background tasks
        this.startBackgroundTasks();
        
        console.log('🚀 Adaptive click engine initialized');
    }
    
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }
        
        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // LRU cache eviction
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
    
    addClick(channelId, userId, x, y, timestamp) {
        // Check if we should accept this click
        if (!this.loadMonitor.shouldAcceptClick()) {
            return false;
        }
        
        const loadLevel = this.loadMonitor.getLoadLevel();
        
        // HIGH/EXTREME load: Use grid aggregation
        if (loadLevel === 'HIGH' || loadLevel === 'EXTREME' || loadLevel === 'EMERGENCY') {
            if (!this.gridAggregators.has(channelId)) {
                this.gridAggregators.set(channelId, new GridAggregator());
            }
            this.gridAggregators.get(channelId).addClick(x, y);
            return true;
        }
        
        // LOW/MEDIUM load: Store individual points for sophisticated clustering
        if (!this.clickPoints.has(channelId)) {
            this.clickPoints.set(channelId, []);
        }
        
        const points = this.clickPoints.get(channelId);
        
        // Memory protection
        if (points.length >= this.maxPointsPerChannel) {
            points.shift(); // Remove oldest
        }
        
        points.push({ x, y, userId, timestamp });
        
        // Buffer for Redis (but don't block)
        if (this.redisBuffer.length < PERFORMANCE_CONFIG.REDIS_BATCH_SIZE) {
            this.redisBuffer.push({ channelId, userId, x, y, timestamp });
        }
        
        return true;
    }
    
    async getHeatmapData(channelId, threshold = 3) {
        const loadLevel = this.loadMonitor.getLoadLevel();
        
        // Grid mode for high load
        if ((loadLevel === 'HIGH' || loadLevel === 'EXTREME' || loadLevel === 'EMERGENCY') && 
            this.gridAggregators.has(channelId)) {
            const grid = this.gridAggregators.get(channelId);
            return this.gridToClusters(grid.getHeatmap(), threshold);
        }
        
        // Get points for channel
        const points = this.clickPoints.get(channelId) || [];
        if (points.length === 0) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: loadLevel
            };
        }
        
        // Choose clustering algorithm based on load
        let clusters;
        if (loadLevel === 'LOW' && points.length < 1000) {
            // Full sophisticated clustering at low load
            clusters = this.sophisticatedClustering(points, threshold);
        } else {
            // Simplified clustering at medium load
            clusters = this.simplifiedClustering(points, threshold);
        }
        
        // Get unique users
        const uniqueUsers = new Set(points.map(p => p.userId)).size;
        
        return {
            clusters,
            totalClicks: points.length,
            uniqueUsers,
            mode: loadLevel,
            threshold
        };
    }
    
    // SOPHISTICATED CLUSTERING (preserved from original) - used at low load
    sophisticatedClustering(points, threshold) {
        if (points.length === 0) return [];
        
        // Use original sophisticated algorithm
        const clusters = processClicksIntoVisualClusters(
            points.map(p => ({ x: p.x, y: p.y })), 
            threshold
        );
        
        // Limit clusters based on load
        const maxClusters = this.loadMonitor.getLoadLevel() === 'LOW' ? 
            PERFORMANCE_CONFIG.MAX_CLUSTERS.LOW : 
            PERFORMANCE_CONFIG.MAX_CLUSTERS.MEDIUM;
            
        return clusters.slice(0, maxClusters);
    }
    
    // SIMPLIFIED CLUSTERING - used at medium load
    simplifiedClustering(points, threshold) {
        const gridSize = 25;
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
        const clusters = Object.values(grid)
            .map(cell => ({
                x: cell.sumX / cell.count,
                y: cell.sumY / cell.count,
                count: cell.count,
                percentage: Math.round((cell.count / points.length) * 100)
            }))
            .filter(c => c.percentage >= threshold)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, PERFORMANCE_CONFIG.MAX_CLUSTERS.MEDIUM);
        
        // Calculate visual sizes
        return clusters.map((c, i) => ({
            ...c,
            visualSize: this.calculateVisualSize(c.percentage),
            id: `cluster_${i}`,
            isTop: i === 0,
            // Simplified shape analysis
            shapeType: c.percentage > 20 ? 'polygon' : 'circle',
            complexity: Math.min(0.5, c.percentage / 100),
            preferredSides: c.percentage > 20 ? 8 : 6
        }));
    }
    
    // GRID TO CLUSTERS - used at high load
    gridToClusters(gridData, threshold) {
        const total = gridData.reduce((sum, cell) => sum + cell.count, 0);
        
        return gridData
            .map(cell => ({
                x: cell.x,
                y: cell.y,
                count: cell.count,
                percentage: Math.round((cell.count / total) * 100)
            }))
            .filter(c => c.percentage >= threshold)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, PERFORMANCE_CONFIG.MAX_CLUSTERS.HIGH)
            .map((c, i) => ({
                ...c,
                visualSize: this.calculateVisualSize(c.percentage),
                id: `grid_${i}`,
                isTop: i === 0,
                // Basic properties for grid mode
                shapeType: 'circle',
                complexity: 0,
                preferredSides: 6
            }));
    }
    
    calculateVisualSize(percentage) {
        const MIN_SIZE = 45;
        const MAX_SIZE = 180;
        
        if (percentage >= 25) {
            const scale = (percentage - 25) / 75;
            return Math.round(MIN_SIZE + scale * (MAX_SIZE - MIN_SIZE));
        } else {
            const scale = percentage / 25;
            return Math.round(25 + scale * (MIN_SIZE - 25));
        }
    }
    
    // Background tasks
    startBackgroundTasks() {
        // Flush to Redis periodically
        setInterval(() => {
            if (this.redisBuffer.length > 0) {
                this.flushToRedis();
            }
        }, PERFORMANCE_CONFIG.REDIS_BATCH_INTERVAL);
        
        // Memory monitoring
        setInterval(() => {
            const usage = process.memoryUsage();
            const heapMB = usage.heapUsed / 1024 / 1024;
            
            if (heapMB > PERFORMANCE_CONFIG.MAX_MEMORY_MB) {
                console.log(`⚠️ Memory pressure: ${heapMB.toFixed(1)}MB - clearing old data`);
                this.clearOldData();
            }
        }, 30000);
        
        // Clear grids periodically
        setInterval(() => {
            if (this.loadMonitor.getLoadLevel() !== 'HIGH' && 
                this.loadMonitor.getLoadLevel() !== 'EXTREME') {
                this.gridAggregators.clear();
            }
        }, 60000);
    }
    
    async flushToRedis() {
        if (!redis.isReady) return;
        
        const toFlush = this.redisBuffer.splice(0, PERFORMANCE_CONFIG.REDIS_BATCH_SIZE);
        
        try {
            const pipeline = redis.pipeline();
            const key = `clicks:batch:${Date.now()}`;
            pipeline.set(key, JSON.stringify(toFlush), 'EX', 300); // 5 min TTL
            await pipeline.exec();
        } catch (error) {
            // Silent fail to prevent crashes
            console.log('Redis write skipped:', error.message);
        }
    }
    
    clearOldData() {
        // Clear half of the data when memory pressure
        for (const [channelId, points] of this.clickPoints.entries()) {
            const halfLength = Math.floor(points.length / 2);
            this.clickPoints.set(channelId, points.slice(halfLength));
        }
        
        // Clear JWT cache
        if (this.jwtCache.size > 2500) {
            const keys = Array.from(this.jwtCache.keys());
            keys.slice(0, 2500).forEach(key => this.jwtCache.delete(key));
        }
    }
    
    clearChannel(channelId) {
        this.clickPoints.delete(channelId);
        this.gridAggregators.delete(channelId);
    }
    
    clearAll() {
        this.clickPoints.clear();
        this.gridAggregators.clear();
        this.redisBuffer = [];
    }
    
    getStatus() {
        return {
            load: this.loadMonitor.getLoadLevel(),
            clicksPerSecond: this.loadMonitor.getClicksPerSecond(),
            totalClicks: this.loadMonitor.totalClicks,
            mode: this.loadMonitor.getLoadLevel() === 'HIGH' ? 'GRID' : 'CLUSTERING',
            channels: this.clickPoints.size,
            gridChannels: this.gridAggregators.size,
            redisBuffer: this.redisBuffer.length,
            jwtCache: this.jwtCache.size,
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
        };
    }
}

// ========== GRID AGGREGATOR FOR HIGH LOAD ==========
class GridAggregator {
    constructor(gridSize = PERFORMANCE_CONFIG.GRID_SIZE) {
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

// ========== PRESERVE ORIGINAL SOPHISTICATED CLUSTERING ==========
// Keep all the original clustering functions for low-load scenarios
function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    const rawClusters = performSimpleDistanceClustering(points);
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateBasicClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster
        };
    });

    const visuallyMergedClusters = performVisualMerging(enrichedClusters);
    const normalizedClusters = normalizePercentages(visuallyMergedClusters, points.length);
    const filteredClusters = normalizedClusters.filter(c => c.percentage >= threshold);

    const finalClusters = filteredClusters.map((cluster, index) => {
        const shapeAnalysis = analyzeClusterShape(cluster.points, cluster.x, cluster.y);
        const visualSize = calculateIntelligentVisualSize(cluster, filteredClusters);
        
        return {
            ...cluster,
            ...shapeAnalysis,
            visualSize,
            isTop: false
        };
    });

    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    return finalClusters;
}

// Include all original clustering helper functions
function performSimpleDistanceClustering(points) {
    if (points.length === 0) return [];
    
    const clusters = [];
    const assigned = new Set();
    const mergeDistance = calculateMergeDistance(points);
    
    for (let i = 0; i < points.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = [points[i]];
        assigned.add(i);
        
        for (let j = i + 1; j < points.length; j++) {
            if (assigned.has(j)) continue;
            
            const distance = euclideanDistance(points[i], points[j]);
            if (distance <= mergeDistance) {
                cluster.push(points[j]);
                assigned.add(j);
            }
        }
        
        clusters.push(cluster);
    }
    
    return clusters;
}

function calculateMergeDistance(points) {
    if (points.length < 2) return 0.08;
    
    const distances = [];
    const sampleSize = Math.min(points.length, 100); // Limit for performance
    
    for (let i = 0; i < sampleSize; i++) {
        for (let j = i + 1; j < sampleSize; j++) {
            distances.push(euclideanDistance(points[i], points[j]));
        }
    }
    
    distances.sort((a, b) => a - b);
    
    if (points.length <= 3) {
        return Math.max(0.03, Math.min(0.12, distances[Math.floor(distances.length * 0.5)] * 0.5));
    } else if (points.length <= 20) {
        return Math.max(0.02, Math.min(0.08, distances[Math.floor(distances.length * 0.15)] * 0.7));
    } else {
        return Math.max(0.015, Math.min(0.05, distances[Math.floor(distances.length * 0.1)] * 0.6));
    }
}

function performVisualMerging(clusters) {
    if (clusters.length <= 1) return clusters;
    
    const merged = [...clusters];
    let changed = true;
    let iterations = 0;
    
    while (changed && iterations < 5) { // Limit iterations for performance
        changed = false;
        iterations++;
        
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                if (shouldMergeClusters(merged[i], merged[j])) {
                    merged[i] = mergeTwoClusters(merged[i], merged[j]);
                    merged.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
    
    return merged;
}

function shouldMergeClusters(cluster1, cluster2) {
    const distance = euclideanDistance(cluster1, cluster2);
    const size1 = cluster1.radius || 0.05;
    const size2 = cluster2.radius || 0.05;
    return distance < (size1 + size2) * 0.5;
}

function mergeTwoClusters(cluster1, cluster2) {
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;
    
    const weight1 = cluster1.count / totalCount;
    const weight2 = cluster2.count / totalCount;
    
    return {
        ...calculateBasicClusterMetrics(allPoints, totalCount),
        x: cluster1.x * weight1 + cluster2.x * weight2,
        y: cluster1.y * weight1 + cluster2.y * weight2,
        points: allPoints,
        id: cluster1.id
    };
}

function calculateBasicClusterMetrics(clusterPoints, totalPoints) {
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);

    const centroidX = clusterPoints.reduce((sum, p) => sum + p.x, 0) / count;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.y, 0) / count;

    const distances = clusterPoints.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const maxDistance = Math.max(...distances);
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        radius: maxDistance,
        spread: avgDistance,
        density: count / (Math.PI * Math.pow(maxDistance || 0.001, 2))
    };
}

function analyzeClusterShape(points, centroidX, centroidY) {
    if (points.length === 1) {
        return {
            shapeType: 'circle',
            circularity: 1.0,
            eccentricity: 0,
            irregularity: 0,
            preferredSides: 8,
            complexity: 0
        };
    }

    const distances = points.map(p => 
        Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2))
    );
    
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    
    const circularity = minDistance / maxDistance;
    const irregularity = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    ) / avgDistance;
    
    const complexity = Math.min(1, irregularity * 2 + (1 - circularity) * 0.5);
    const preferredSides = Math.max(6, Math.min(12, Math.round(6 + complexity * 6)));
    
    return {
        shapeType: complexity > 0.4 ? 'polygon' : 'circle',
        circularity,
        eccentricity: 1 - circularity,
        irregularity,
        preferredSides,
        complexity
    };
}

function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;

    const MIN_SIZE = 45;
    const MAX_SIZE = 180;
    
    let baseSize;
    if (percentage >= 25) {
        const scale = (percentage - 25) / 75;
        baseSize = MIN_SIZE + scale * (MAX_SIZE - MIN_SIZE);
    } else {
        const scale = percentage / 25;
        baseSize = 25 + scale * (MIN_SIZE - 25);
    }

    const densityAdjustment = Math.max(0.8, Math.min(1.3, Math.pow(density, 0.15)));
    const spreadAdjustment = Math.min(10, spread * 100);

    return Math.round(baseSize * densityAdjustment + spreadAdjustment);
}

function normalizePercentages(clusters, totalPoints) {
    if (clusters.length === 0) return clusters;
    
    const normalized = clusters.map(cluster => ({
        ...cluster,
        percentage: Math.round((cluster.count / totalPoints) * 100)
    }));
    
    const currentTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    const difference = 100 - currentTotal;
    
    if (Math.abs(difference) >= 2 && normalized.length > 0) {
        normalized[0].percentage += difference;
    }
    
    return normalized;
}

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// ========== REDIS SETUP ==========
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 2000,
        lazyConnect: true,
        reconnectStrategy: (retries) => {
            if (retries > 3) return null;
            return Math.min(retries * 100, 1000);
        }
    }
});

redis.on('error', (err) => console.log('Redis error:', err.message));

async function connectRedis() {
    try {
        await redis.connect();
        console.log('✅ Redis connected');
    } catch (error) {
        console.log('⚠️ Redis unavailable - continuing without persistence');
    }
}

connectRedis();

// ========== INITIALIZE ==========
const clickEngine = new AdaptiveClickEngine();
const gameState = {
    running: true,
    
    async setRunning(value) {
        this.running = value;
        if (redis.isReady) {
            await redis.set('game:running', value.toString()).catch(() => {});
        }
    },
    
    async isRunning() {
        return this.running;
    }
};

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
}));

app.use(express.json({ limit: '10kb' }));

// Rate limiting middleware for click endpoint
let requestCount = 0;
setInterval(() => { requestCount = 0; }, 1000);

const rateLimit = (req, res, next) => {
    requestCount++;
    if (requestCount > 10000) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    next();
};

// HEALTH endpoint
app.get('/health', (req, res) => {
    const status = clickEngine.getStatus();
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '8.0.0-balanced',
        instanceId: INSTANCE_ID,
        performance: status
    });
});

// CLICK endpoint with protection
app.post('/click', rateLimit, async (req, res) => {
    // Quick validation
    if (!gameState.running) {
        return res.status(400).json({ error: 'Not running' });
    }
    
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }
    
    const payload = clickEngine.verifyJWTFast(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' ||
        x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }
    
    const accepted = clickEngine.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y,
        Date.now()
    );
    
    res.json({ 
        success: true,
        accepted,
        status: accepted ? 'recorded' : 'sampled'
    });
});

// HEATMAP endpoint
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;
    
    try {
        const data = await clickEngine.getHeatmapData(channelId, threshold);
        
        res.json({
            running: gameState.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.uniqueUsers,
            coverage: Math.min(100, data.clusters.length * 10),
            threshold,
            mode: data.mode,
            lastUpdate: Date.now(),
            instanceId: INSTANCE_ID
        });
    } catch (error) {
        console.error('Heatmap error:', error);
        res.status(500).json({ error: 'Failed to get heatmap' });
    }
});

// Control endpoints
app.post('/start', async (req, res) => {
    await gameState.setRunning(true);
    clickEngine.clearAll();
    res.json({ success: true, status: 'started', running: true });
});

app.post('/stop', async (req, res) => {
    await gameState.setRunning(false);
    res.json({ success: true, status: 'stopped', running: false });
});

app.post('/reset', (req, res) => {
    const channelId = req.headers['x-channel-id'] || req.body.channelId;
    
    if (channelId) {
        clickEngine.clearChannel(channelId);
    } else {
        clickEngine.clearAll();
    }
    
    res.json({ success: true, status: 'reset' });
});

// ========== WEBSOCKET ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 128 * 1024
});

const connectedClients = new Map();

// Broadcast with throttling
class BroadcastManager {
    constructor() {
        this.lastBroadcast = new Map();
    }
    
    async broadcast() {
        const now = Date.now();
        
        for (const [channelId, clients] of connectedClients.entries()) {
            const last = this.lastBroadcast.get(channelId) || 0;
            
            if (now - last < PERFORMANCE_CONFIG.BROADCAST_INTERVAL) continue;
            
            this.lastBroadcast.set(channelId, now);
            
            const data = await clickEngine.getHeatmapData(channelId);
            const message = JSON.stringify({
                running: gameState.running,
                clusters: data.clusters,
                totalClicks: data.totalClicks,
                uniqueUsers: data.uniqueUsers,
                mode: data.mode,
                timestamp: now
            });
            
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(message);
                    } catch {
                        clients.delete(ws);
                    }
                }
            });
        }
    }
}

const broadcaster = new BroadcastManager();

// Periodic broadcast
setInterval(() => {
    broadcaster.broadcast();
}, PERFORMANCE_CONFIG.BROADCAST_INTERVAL);

wss.on('connection', (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);
    
    ws.on('close', () => {
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
    });
    
    ws.on('error', () => {});
    
    // Send initial data
    clickEngine.getHeatmapData(channelId).then(data => {
        ws.send(JSON.stringify({
            running: gameState.running,
            clusters: data.clusters,
            totalClicks: data.totalClicks,
            uniqueUsers: data.uniqueUsers,
            mode: data.mode,
            timestamp: Date.now()
        }));
    });
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap Server v8.0.0 BALANCED');
    console.log(`📡 Port: ${PORT}`);
    console.log('⚖️ Performance Mode:');
    console.log('  < 100/s: Full sophisticated clustering');
    console.log('  100-1000/s: Simplified clustering');
    console.log('  1000-10000/s: Grid aggregation');
    console.log('  > 10000/s: Emergency mode');
    console.log(`🔄 Broadcast: Every ${PERFORMANCE_CONFIG.BROADCAST_INTERVAL}ms`);
    console.log(`💾 Max Memory: ${PERFORMANCE_CONFIG.MAX_MEMORY_MB}MB`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    httpServer.close(() => {
        redis.quit();
        process.exit(0);
    });
});

export default httpServer;
