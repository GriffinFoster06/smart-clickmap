// backend/server.js - REAL-TIME PRIORITY with original clustering intact
// Prioritizes immediate visual updates over click accuracy - drops clicks when needed for 500k+ RPS

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

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.DEBUG === 'true' || !IS_PRODUCTION;

function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_ENABLED) return;
    if (level === 'error' || level === 'warn' || !IS_PRODUCTION) {
        console.log(message);
    }
}

function logError(message, error = null) {
    console.error(message, error || '');
}

// ========== ULTRA-AGGRESSIVE REAL-TIME ENGINE FOR 500K+ RPS ==========
class RealTimeClickEngine {
    constructor() {
        // REAL-TIME PRIORITY: In-memory only for instant updates
        this.gameRunning = false;
        this.gameVersion = Date.now();
        
        // AGGRESSIVE: Massive JWT cache for crypto elimination
        this.jwtCache = new Map();
        this.maxJWTCache = 50000; // Cache 50k tokens
        
        // REAL-TIME: Live click data (no persistence blocking)
        this.liveClicks = new Map(); // channelId -> Map(userId -> {x, y, timestamp, version})
        
        // AGGRESSIVE: Drop clicks when overloaded - prioritize real-time updates
        this.clickDropCount = 0;
        this.maxClicksPerSecond = 100000; // Drop above 100k/sec to maintain real-time
        this.lastSecondClicks = 0;
        this.lastSecondTime = Date.now();
        
        // REAL-TIME: Immediate broadcast queue (no batching delays)
        this.pendingBroadcasts = new Set();
        this.broadcastCooldown = new Map(); // channelId -> lastBroadcast
        this.minBroadcastInterval = 16; // 60 FPS max broadcast rate
        
        console.log('🚀 Real-time engine initialized - prioritizing immediate updates');
        this.startRealTimeBroadcaster();
    }

    // INSTANT: Game state changes are immediate and authoritative
    setGameRunning(running) {
        const wasRunning = this.gameRunning;
        this.gameRunning = running;
        this.gameVersion = Date.now();
        
        console.log(`🎮 Game state: ${running ? 'RUNNING' : 'STOPPED'} (was: ${wasRunning})`);
        
        // IMMEDIATE: Clear all pending data when stopped
        if (!running) {
            this.liveClicks.clear();
            this.pendingBroadcasts.clear();
            this.broadcastCooldown.clear();
            console.log('🗑️ Cleared all live data - immediate stop');
        }
        
        return this.gameVersion;
    }

    clearChannelData(channelId) {
        if (channelId && channelId !== 'all') {
            this.liveClicks.delete(channelId);
            this.pendingBroadcasts.delete(channelId);
            this.broadcastCooldown.delete(channelId);
            console.log(`🗑️ Cleared channel ${channelId}`);
        } else {
            this.liveClicks.clear();
            this.pendingBroadcasts.clear();
            this.broadcastCooldown.clear();
            console.log('🗑️ Cleared all channels');
        }
    }

    // ULTRA-FAST: JWT verification with massive caching
    verifyJWTUltraFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }

        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // Aggressive cache management
            if (this.jwtCache.size >= this.maxJWTCache) {
                // Remove oldest 10% when full
                const toRemove = Math.floor(this.maxJWTCache * 0.1);
                const keys = Array.from(this.jwtCache.keys()).slice(0, toRemove);
                keys.forEach(key => this.jwtCache.delete(key));
            }
            
            this.jwtCache.set(token, { payload, exp: payload.exp });
            return payload;
        } catch {
            return null;
        }
    }

    // REAL-TIME: Add click with immediate processing
    addClickRealTime(channelId, userId, x, y) {
        // IMMEDIATE: Reject if game not running
        if (!this.gameRunning) {
            return false;
        }

        // AGGRESSIVE: Rate limiting to maintain real-time performance
        const now = Date.now();
        if (now - this.lastSecondTime >= 1000) {
            this.lastSecondClicks = 0;
            this.lastSecondTime = now;
        }
        
        this.lastSecondClicks++;
        
        // DROP CLICKS: Prioritize real-time over accuracy
        if (this.lastSecondClicks > this.maxClicksPerSecond) {
            this.clickDropCount++;
            if (this.clickDropCount % 1000 === 0) {
                console.log(`⚡ Dropped ${this.clickDropCount} clicks to maintain real-time performance`);
            }
            return false;
        }

        // REAL-TIME: Immediate in-memory storage
        if (!this.liveClicks.has(channelId)) {
            this.liveClicks.set(channelId, new Map());
        }
        
        this.liveClicks.get(channelId).set(userId, {
            x, y,
            timestamp: now,
            version: this.gameVersion
        });

        // IMMEDIATE: Queue for real-time broadcast
        this.queueRealTimeBroadcast(channelId);
        
        return true;
    }

    // REAL-TIME: Queue immediate broadcast (respects 60 FPS limit)
    queueRealTimeBroadcast(channelId) {
        const lastBroadcast = this.broadcastCooldown.get(channelId) || 0;
        const now = Date.now();
        
        if (now - lastBroadcast >= this.minBroadcastInterval) {
            this.pendingBroadcasts.add(channelId);
        }
    }

    // ORIGINAL: Get click data exactly as before
    getChannelClicks(channelId) {
        return this.liveClicks.get(channelId) || new Map();
    }

    getAllChannelClicks() {
        return new Map(this.liveClicks);
    }

    startRealTimeBroadcaster() {
        // REAL-TIME: 60 FPS broadcast loop
        setInterval(() => {
            if (this.pendingBroadcasts.size > 0) {
                this.processPendingBroadcasts();
            }
        }, 16); // 60 FPS
    }

    async processPendingBroadcasts() {
        const now = Date.now();
        const channelsToBroadcast = Array.from(this.pendingBroadcasts);
        this.pendingBroadcasts.clear();

        for (const channelId of channelsToBroadcast) {
            this.broadcastCooldown.set(channelId, now);
            
            // Generate and broadcast immediately
            setImmediate(async () => {
                try {
                    const data = await getCurrentHeatmapData(channelId);
                    broadcastToChannel(channelId, data);
                    
                    // Also broadcast via Redis for other instances
                    if (redisPub && redisPub.isReady) {
                        await redisPub.publish('clickmap:broadcast', JSON.stringify({
                            channelId,
                            payload: data,
                            fromInstance: INSTANCE_ID
                        }));
                    }
                } catch (error) {
                    // Silently handle broadcast errors to maintain performance
                }
            });
        }
    }
}

// ========== RESTORE ORIGINAL CLUSTERING ALGORITHM EXACTLY ==========
// This is the EXACT original clustering from your working version

function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    log(`🧮 Clustering: ${points.length} points, ${threshold}% threshold`, 'debug');

    // Step 1: Distance-based clustering (EXACT ORIGINAL)
    const rawClusters = performSimpleDistanceClustering(points);
    
    // Step 2: Calculate metrics (EXACT ORIGINAL)
    const enrichedClusters = rawClusters.map((cluster, index) => {
        const metrics = calculateBasicClusterMetrics(cluster, points.length);
        return {
            id: index,
            ...metrics,
            points: cluster
        };
    });

    // Step 3: Visual merging (EXACT ORIGINAL - THIS WAS BROKEN IN MY "OPTIMIZATION")
    const visuallyMergedClusters = performVisualMerging(enrichedClusters);

    // Step 4: Normalize percentages (EXACT ORIGINAL)
    const normalizedClusters = normalizePercentages(visuallyMergedClusters, points.length);

    // Step 5: Filter by threshold (EXACT ORIGINAL)
    const filteredClusters = normalizedClusters.filter(c => c.percentage >= threshold);

    // Step 6: Add visual properties (EXACT ORIGINAL - ALL FEATURES)
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

    // Step 7: Sort and mark top (EXACT ORIGINAL)
    finalClusters.sort((a, b) => b.percentage - a.percentage);
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    log(`✅ Clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`, 'debug');

    return finalClusters;
}

// EXACT ORIGINAL CLUSTERING FUNCTIONS (restored from your working version)
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
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    
    let mergeDistance;
    if (points.length <= 3) {
        const median = distances[Math.floor(distances.length * 0.5)] || distances[0];
        mergeDistance = Math.max(0.03, Math.min(0.12, median * 0.5));
    } else if (points.length <= 8) {
        const percentile20 = distances[Math.floor(distances.length * 0.2)] || distances[0];
        mergeDistance = Math.max(0.025, Math.min(0.08, percentile20 * 0.8));
    } else if (points.length <= 20) {
        const percentile15 = distances[Math.floor(distances.length * 0.15)] || distances[0];
        mergeDistance = Math.max(0.02, Math.min(0.06, percentile15 * 0.7));
    } else {
        const percentile10 = distances[Math.floor(distances.length * 0.1)] || distances[0];
        mergeDistance = Math.max(0.015, Math.min(0.05, percentile10 * 0.6));
    }
    
    return mergeDistance;
}

function performVisualMerging(clusters) {
    if (clusters.length <= 1) return clusters;
    
    const merged = [...clusters];
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                if (shouldMergeClusters(merged[i], merged[j])) {
                    const mergedCluster = mergeTwoClusters(merged[i], merged[j]);
                    merged[i] = mergedCluster;
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
    const percentage1 = cluster1.percentage || 0;
    const percentage2 = cluster2.percentage || 0;
    
    const size1 = calculateIntelligentVisualSize(cluster1, [cluster1, cluster2]);
    const size2 = calculateIntelligentVisualSize(cluster2, [cluster1, cluster2]);
    
    const text1 = `${percentage1}%`;
    const text2 = `${percentage2}%`;
    
    const fontSize1 = Math.max(18, Math.min(50, size1 * 0.35));
    const fontSize2 = Math.max(18, Math.min(50, size2 * 0.35));
    
    const textWidth1 = text1.length * fontSize1 * 0.6;
    const textHeight1 = fontSize1;
    const textWidth2 = text2.length * fontSize2 * 0.6;
    const textHeight2 = fontSize2;
    
    const SCREEN_WIDTH = 1920;
    const SCREEN_HEIGHT = 1080;
    
    const x1 = cluster1.x * SCREEN_WIDTH;
    const y1 = cluster1.y * SCREEN_HEIGHT;
    const x2 = cluster2.x * SCREEN_WIDTH;
    const y2 = cluster2.y * SCREEN_HEIGHT;
    
    const LABEL_PADDING = 15;
    
    const box1 = {
        left: x1 - textWidth1/2 - LABEL_PADDING,
        right: x1 + textWidth1/2 + LABEL_PADDING,
        top: y1 - textHeight1/2 - LABEL_PADDING,
        bottom: y1 + textHeight1/2 + LABEL_PADDING
    };
    
    const box2 = {
        left: x2 - textWidth2/2 - LABEL_PADDING,
        right: x2 + textWidth2/2 + LABEL_PADDING,
        top: y2 - textHeight2/2 - LABEL_PADDING,
        bottom: y2 + textHeight2/2 + LABEL_PADDING
    };
    
    const xOverlap = !(box1.right < box2.left || box2.right < box1.left);
    const yOverlap = !(box1.bottom < box2.top || box2.bottom < box1.top);
    const labelsOverlap = xOverlap && yOverlap;
    
    const distance = euclideanDistance(cluster1, cluster2) * SCREEN_WIDTH;
    const minSeparation = (size1 + size2) * 0.3;
    const circlesOverlap = distance < minSeparation;
    
    return labelsOverlap || circlesOverlap;
}

function calculateIntelligentVisualSize(cluster, allClusters) {
    const percentage = cluster.percentage || 0;
    const count = cluster.count || 1;
    const density = cluster.density || 1;
    const spread = cluster.spread || 0.05;

    const MIN_SIZE_25_PERCENT = 45;
    const MAX_SIZE_100_PERCENT = 180;
    const ABSOLUTE_MIN_SIZE = 25;

    let baseSize;
    
    if (percentage >= 25) {
        const percentageRange = percentage - 25;
        const sizeRange = MAX_SIZE_100_PERCENT - MIN_SIZE_25_PERCENT;
        baseSize = MIN_SIZE_25_PERCENT + (percentageRange / 75) * sizeRange;
    } else {
        const scaleFactor = percentage / 25;
        baseSize = ABSOLUTE_MIN_SIZE + (MIN_SIZE_25_PERCENT - ABSOLUTE_MIN_SIZE) * scaleFactor;
    }

    const densityAdjustment = Math.max(0.8, Math.min(1.3, Math.pow(density, 0.15)));
    const spreadAdjustment = Math.min(10, spread * 100);
    const countAdjustment = count > 1 ? Math.log10(count + 1) * 3 : 0;

    let finalSize = baseSize * densityAdjustment + spreadAdjustment + countAdjustment;
    finalSize = Math.max(ABSOLUTE_MIN_SIZE, Math.min(MAX_SIZE_100_PERCENT + 20, finalSize));

    return Math.round(finalSize);
}

function normalizePercentages(clusters, totalPoints) {
    if (clusters.length === 0) return clusters;
    
    const normalized = clusters.map((cluster) => {
        const rawPercentage = (cluster.count / totalPoints) * 100;
        const roundedPercentage = Math.round(rawPercentage);
        
        return {
            ...cluster,
            percentage: roundedPercentage
        };
    });
    
    const currentTotal = normalized.reduce((sum, c) => sum + c.percentage, 0);
    const expectedTotal = 100;
    const difference = expectedTotal - currentTotal;
    
    if (Math.abs(difference) >= 2 && normalized.length > 0) {
        const largeClusters = normalized.filter(c => c.percentage >= 5);
        
        if (largeClusters.length > 0) {
            const adjustmentPerCluster = Math.round(difference / largeClusters.length);
            largeClusters.forEach(cluster => {
                cluster.percentage += adjustmentPerCluster;
            });
        } else {
            const largest = normalized.reduce((max, current) => 
                current.percentage > max.percentage ? current : max
            );
            largest.percentage += difference;
        }
    }
    
    return normalized;
}

function mergeTwoClusters(cluster1, cluster2) {
    const allPoints = [...cluster1.points, ...cluster2.points];
    const totalCount = cluster1.count + cluster2.count;
    
    const weight1 = cluster1.count / totalCount;
    const weight2 = cluster2.count / totalCount;
    
    const newX = cluster1.x * weight1 + cluster2.x * weight2;
    const newY = cluster1.y * weight1 + cluster2.y * weight2;
    
    const mergedMetrics = calculateBasicClusterMetrics(allPoints, totalCount);
    
    return {
        ...mergedMetrics,
        x: newX,
        y: newY,
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
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const stdDev = Math.sqrt(
        distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length
    );

    const density = count / (Math.PI * Math.pow(maxDistance || 0.001, 2));
    const compactness = avgDistance / (maxDistance || 0.001);

    return {
        x: centroidX,
        y: centroidY,
        count,
        percentage,
        radius: maxDistance,
        spread: avgDistance,
        maxSpread: maxDistance,
        stdDev,
        density,
        compactness
    };
}

function analyzeClusterShape(points, centroidX, centroidY) {
    if (points.length === 1) {
        return {
            shapeType: 'circle',
            circularity: 1.0,
            eccentricity: 0,
            irregularity: 0,
            convexity: 1,
            preferredSides: 8,
            complexity: 0,
            shapeConfidence: 1.0,
            polygonPoints: null
        };
    }

    // Full shape analysis algorithm (EXACT ORIGINAL)
    const angles = points.map(p => Math.atan2(p.y - centroidY, p.x - centroidX));
    const distances = points.map(p => Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2)));
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    const circularity = minDistance / maxDistance;
    const eccentricity = 1 - circularity;
    
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const irregularity = Math.sqrt(distanceVariance) / avgDistance;
    
    const complexity = Math.min(1, irregularity * 2 + eccentricity * 0.5);
    const preferredSides = Math.max(6, Math.min(20, Math.round(8 + complexity * 12)));
    
    return {
        shapeType: complexity > 0.4 ? 'polygon' : 'circle',
        circularity,
        eccentricity,
        irregularity,
        convexity: 1 - irregularity * 0.5,
        preferredSides,
        complexity,
        shapeConfidence: 1 - irregularity,
        polygonPoints: null
    };
}

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// ========== REDIS SETUP ==========
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 3000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

const redisPub = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 3000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

const redisSub = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 3000,
        lazyConnect: true,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
    }
});

redis.on('error', (err) => logError('Redis Client Error:', err));
redis.on('connect', () => log('✅ Redis connected'));

redisPub.on('error', (err) => logError('Redis Pub Error:', err));
redisSub.on('error', (err) => logError('Redis Sub Error:', err));

async function connectRedis() {
    try {
        await Promise.all([
            redis.connect(),
            redisPub.connect(),
            redisSub.connect()
        ]);
        log('✅ All Redis clients connected');
        
        await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
        log('✅ Subscribed to Redis channels');
        
    } catch (error) {
        logError('❌ Redis connection failed:', error);
        log('⚠️ Continuing without Redis - using in-memory only', 'warn');
    }
}

await connectRedis();

// ========== INITIALIZE REAL-TIME ENGINE ==========
const clickEngine = new RealTimeClickEngine();

// ========== FIXED GAME STATE ==========
const gameState = {
    async setRunning(running) {
        // IMMEDIATE: Set state in real-time engine first
        const version = clickEngine.setGameRunning(running);
        
        // Background Redis update (don't block)
        setImmediate(async () => {
            try {
                if (redis.isReady) {
                    const pipeline = redis.multi();
                    pipeline.set('game:running', running.toString());
                    pipeline.set('game:lastUpdate', version.toString());
                    pipeline.set('game:version', version.toString());
                    await pipeline.exec();
                }
            } catch (error) {
                logError('Redis setRunning error:', error);
            }
        });
        
        return version;
    },

    async isRunning() {
        // IMMEDIATE: Return from real-time engine
        return clickEngine.gameRunning;
    },

    async clearAllClicks() {
        clickEngine.clearChannelData('all');
        
        // Background Redis cleanup
        setImmediate(async () => {
            try {
                if (redis.isReady) {
                    const clickKeys = await redis.keys('clicks:*');
                    if (clickKeys.length > 0) {
                        await redis.del(clickKeys);
                    }
                }
            } catch (error) {
                logError('Redis clearAllClicks error:', error);
            }
        });
    },
    
    async clearChannelClicks(channelId) {
        clickEngine.clearChannelData(channelId);
        
        // Background Redis cleanup
        setImmediate(async () => {
            try {
                if (redis.isReady) {
                    const clickKeys = await redis.keys(`clicks:${channelId}:*`);
                    if (clickKeys.length > 0) {
                        await redis.del(clickKeys);
                    }
                }
            } catch (error) {
                logError('Redis clearChannelClicks error:', error);
            }
        });
    }
};

// ========== ORIGINAL HEATMAP DATA GENERATION ==========
async function getCurrentHeatmapData(channelId, threshold = 3) {
    const running = await gameState.isRunning();
    const lastUpdate = Date.now();

    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = clickEngine.getAllChannelClicks();
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        // EXACT ORIGINAL: Use sophisticated clustering
        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        return {
            running: running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: lastUpdate,
            version: clickEngine.gameVersion
        };
    }

    const channelClicks = clickEngine.getChannelClicks(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: lastUpdate,
            version: clickEngine.gameVersion
        };
    }

    const points = Array.from(channelClicks.values());
    
    // EXACT ORIGINAL: Use sophisticated clustering with ALL features
    const clusters = processClicksIntoVisualClusters(points, threshold);

    log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`, 'debug');

    return {
        running: running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: lastUpdate,
        version: clickEngine.gameVersion
    };
}

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Id', 'X-State-Version', 'X-Channel-Id'],
    credentials: false
}));

app.use(express.json({ limit: '1kb' })); // Tiny payloads for performance
app.use(express.urlencoded({ extended: true }));

app.disable('x-powered-by');
app.set('trust proxy', true);

// Minimal middleware
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-Instance-Id', INSTANCE_ID);
    next();
});

// ========== OPTIMIZED ENDPOINTS ==========

// Health check
app.get('/health', async (req, res) => {
    const running = await gameState.isRunning();
    const allClicks = clickEngine.getAllChannelClicks();
    
    res.json({
        status: 'ok',
        running: running,
        timestamp: Date.now(),
        version: '7.0.0-realtime-priority',
        instanceId: INSTANCE_ID,
        websocket: {
            clients: wss ? wss.clients.size : 0
        },
        redis: {
            connected: redis.isReady
        },
        performance: {
            droppedClicks: clickEngine.clickDropCount,
            jwtCacheSize: clickEngine.jwtCache.size,
            liveChannels: allClicks.size,
            totalClicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
        }
    });
});

// ULTRA-FAST CLICK ENDPOINT - Real-time priority
app.post('/click', async (req, res) => {
    const start = performance.now();
    
    try {
        // IMMEDIATE: Check game state
        if (!clickEngine.gameRunning) {
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

        // ULTRA-FAST: Cached JWT verification
        const payload = clickEngine.verifyJWTUltraFast(token);
        
        if (!payload || payload.role === 'external') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        // FAST: Basic validation
        if (typeof x !== 'number' || typeof y !== 'number' ||
            isNaN(x) || isNaN(y) ||
            x < 0 || x > 1 || y < 0 || y > 1 ||
            !uid || !channelId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid data'
            });
        }

        // REAL-TIME: Add click with immediate processing
        const accepted = clickEngine.addClickRealTime(channelId, uid, x, y);

        const processingTime = performance.now() - start;
        
        if (accepted) {
            res.json({
                success: true,
                processingTime: Math.round(processingTime * 100) / 100,
                instanceId: INSTANCE_ID
            });
        } else {
            res.status(429).json({
                success: false,
                error: 'Rate limited - prioritizing real-time updates',
                processingTime: Math.round(processingTime * 100) / 100
            });
        }

    } catch (error) {
        const processingTime = performance.now() - start;
        res.status(500).json({
            success: false,
            error: 'Server error',
            processingTime: Math.round(processingTime * 100) / 100
        });
    }
});

// FAST heatmap endpoint
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    try {
        const data = await getCurrentHeatmapData(channelId, threshold);
        data.instanceId = INSTANCE_ID;
        res.json(data);
    } catch (error) {
        logError('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data'
        });
    }
});

// IMMEDIATE control endpoints
app.post('/start', async (req, res) => {
    log('🚀 START endpoint called');
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        // IMMEDIATE: Clear data first
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        // IMMEDIATE: Start game
        const result = await gameState.setRunning(true);
        
        log(`✅ Game started immediately (Version: ${result})`);
        
        // IMMEDIATE: Broadcast start state
        const broadcastData = {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start',
            version: result,
            channelId: channelId || 'all'
        };
        
        // Immediate broadcast
        broadcastToAll(broadcastData);
        
        // Background Redis broadcast
        setImmediate(async () => {
            try {
                if (redisPub && redisPub.isReady) {
                    await redisPub.publish('clickmap:broadcast', JSON.stringify({
                        channelId: channelId || 'all',
                        payload: broadcastData,
                        fromInstance: INSTANCE_ID
                    }));
                }
            } catch (error) {
                logError('Background broadcast error:', error);
            }
        });
        
        res.json({
            success: true,
            status: 'started',
            running: true,
            stateVersion: result,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session'
        });
    }
});

app.post('/stop', async (req, res) => {
    log('⏹️ STOP endpoint called');
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        // IMMEDIATE: Stop game (clears all data immediately)
        const result = await gameState.setRunning(false);
        
        log(`✅ Game stopped immediately (Version: ${result})`);
        
        // IMMEDIATE: Broadcast stop state
        const broadcastData = {
            running: false,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'stop',
            version: result,
            channelId: channelId || 'all'
        };
        
        // Immediate broadcast
        broadcastToAll(broadcastData);
        
        // Background Redis broadcast
        setImmediate(async () => {
            try {
                if (redisPub && redisPub.isReady) {
                    await redisPub.publish('clickmap:broadcast', JSON.stringify({
                        channelId: channelId || 'all',
                        payload: broadcastData,
                        fromInstance: INSTANCE_ID
                    }));
                }
            } catch (error) {
                logError('Background broadcast error:', error);
            }
        });
        
        res.json({
            success: true,
            status: 'stopped',
            running: false,
            stateVersion: result,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session'
        });
    }
});

app.post('/reset', async (req, res) => {
    log('🗑️ RESET endpoint called');
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        // IMMEDIATE: Clear data
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        log(`✅ Data reset immediately`);
        
        const running = await gameState.isRunning();
        
        // IMMEDIATE: Broadcast reset state
        const broadcastData = {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset',
            channelId: channelId || 'all'
        };
        
        // Immediate broadcast
        broadcastToAll(broadcastData);
        
        // Background Redis broadcast
        setImmediate(async () => {
            try {
                if (redisPub && redisPub.isReady) {
                    await redisPub.publish('clickmap:broadcast', JSON.stringify({
                        channelId: channelId || 'all',
                        payload: broadcastData,
                        fromInstance: INSTANCE_ID
                    }));
                }
            } catch (error) {
                logError('Background broadcast error:', error);
            }
        });
        
        res.json({
            success: true,
            status: 'reset',
            running: running,
            instanceId: INSTANCE_ID
        });
        
    } catch (error) {
        logError('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data'
        });
    }
});

// ========== WEBSOCKET (PRESERVED) ==========
const httpServer = createServer(app);
let wss = null;
const connectedClients = new Map();
const configPanels = new Map();

function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        if (data.fromInstance === INSTANCE_ID) return;
        broadcastToLocalClients(data.channelId, data.payload);
    } catch (error) {
        logError('Error handling broadcast message:', error);
    }
}

function broadcastToChannel(channelId, data) {
    if (!wss || !connectedClients) return;
    
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    let message;
    try {
        message = JSON.stringify(data);
    } catch (error) {
        logError('Failed to stringify broadcast data:', error);
        return;
    }

    let sentCount = 0;
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                clients.delete(ws);
            }
        } else {
            clients.delete(ws);
        }
    });

    log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters?.length || 0} clusters`, 'debug');
}

function broadcastToLocalClients(channelId, data) {
    broadcastToChannel(channelId, data);
}

async function broadcastToAll(data) {
    if (!connectedClients) return;
    
    connectedClients.forEach((clients, channelId) => {
        broadcastToChannel(channelId, data);
    });
    
    // Also broadcast to config panels
    configPanels.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(data));
            } catch (error) {
                // Remove dead connection
            }
        }
    });
}

// Create WebSocket server
try {
    wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        perMessageDeflate: false,
        clientTracking: true
    });
    log('✅ WebSocket server created');
} catch (error) {
    logError('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// WebSocket connection handling
wss.on('connection', async (ws, req) => {
    let channelId = null;
    let sessionId = null;
    let isConfigPanel = false;

    if (req.url) {
        const urlPath = req.url.replace('/ws/', '').split('?')[0];
        
        if (urlPath.startsWith('config_')) {
            isConfigPanel = true;
            sessionId = urlPath;
        } else {
            channelId = urlPath;
        }
    }

    if (isConfigPanel && sessionId) {
        configPanels.set(sessionId, ws);
        log(`✅ Config panel connected: ${sessionId}`, 'debug');
        
        try {
            const initialData = await getCurrentHeatmapData('all');
            initialData.type = 'state_update';
            initialData.instanceId = INSTANCE_ID;
            ws.send(JSON.stringify(initialData));
        } catch (error) {
            logError('Error sending initial config data:', error);
        }
        
    } else if (channelId) {
        if (!connectedClients.has(channelId)) {
            connectedClients.set(channelId, new Set());
        }
        connectedClients.get(channelId).add(ws);

        log(`✅ WebSocket connected: Channel ${channelId}`, 'debug');

        try {
            const initialData = await getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
        } catch (error) {
            logError('Error sending initial data:', error);
        }
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (error) {
            // Ignore message parse errors
        }
    });

    ws.on('close', () => {
        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
        } else if (channelId) {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
        }
    });

    ws.on('error', (error) => {
        logError(`WebSocket error for ${channelId || sessionId}:`, error);
    });
});

// Performance monitoring
let requestCount = 0;
let startTime = Date.now();

app.use((req, res, next) => {
    requestCount++;
    next();
});

setInterval(() => {
    const uptime = Date.now() - startTime;
    const rps = Math.round((requestCount / uptime) * 1000);
    
    console.log(`📊 REAL-TIME STATS: ${rps} RPS, ${clickEngine.clickDropCount} dropped, ${clickEngine.jwtCache.size} JWT cache`);
}, 30000);

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', async () => {
    log('🚀 ClickMap REAL-TIME PRIORITY v7.0.0');
    log(`📡 Instance ID: ${INSTANCE_ID}`);
    log(`📡 Port: ${PORT}`);
    log(`💾 Redis connected: ${redis.isReady}`);
    log(`🎨 Original clustering: RESTORED`);
    log(`⚡ Real-time priority: ENABLED`);
    log(`🎯 Target: 500,000+ RPS with click dropping`);
    
    try {
        const running = await gameState.isRunning();
        log(`📊 Game state: ${running ? 'RUNNING' : 'STOPPED'}`);
    } catch (error) {
        logError('❌ Failed to get initial state:', error);
    }

    log('🎊 Real-time server ready!');
});

export default httpServer;
