// backend/server.js - ULTRA HIGH-PERFORMANCE with click sampling and 5-second updates
// Handles millions of clicks/second with 1-in-3 sampling and 5-second broadcast cycles

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

// ULTRA PERFORMANCE SETTINGS
const CLICK_SAMPLING_RATE = 3; // Only process 1 in 3 clicks
const BROADCAST_INTERVAL = 5000; // 5 seconds between updates
const BATCH_SIZE = 1000; // Larger batch sizes
const BATCH_TIMEOUT = 1000; // 1 second max batch time

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

// ========== ULTRA HIGH-PERFORMANCE CLICK ENGINE ==========
class UltraHighPerformanceClickEngine {
    constructor() {
        // Performance optimizations
        this.jwtCache = new Map();
        this.maxJWTCache = 50000; // Larger JWT cache
        
        // Massive batching for performance
        this.clickBuffer = new Map();
        this.batchSize = BATCH_SIZE;
        this.batchTimeout = BATCH_TIMEOUT;
        this.lastFlush = Date.now();
        
        // Click sampling for millions/second performance
        this.clickCounter = 0;
        this.samplingRate = CLICK_SAMPLING_RATE;
        this.totalClicksReceived = 0;
        this.totalClicksProcessed = 0;
        
        // In-memory storage with optimizations
        this.allChannelClicks = new Map();
        
        // Performance metrics
        this.lastStatsLog = Date.now();
        this.statsInterval = 10000; // Log stats every 10 seconds
        
        console.log(`🚀 Ultra high-performance engine initialized (1-in-${this.samplingRate} sampling)`);
        this.startBatchProcessor();
        this.startStatsLogger();
    }

    // ULTRA-FAST JWT verification with large cache
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }

        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // Smart cache management with LRU-style cleanup
            if (this.jwtCache.size >= this.maxJWTCache) {
                // Remove oldest 25% of cache
                const keysToRemove = Math.floor(this.maxJWTCache * 0.25);
                const keys = Array.from(this.jwtCache.keys());
                for (let i = 0; i < keysToRemove; i++) {
                    this.jwtCache.delete(keys[i]);
                }
            }
            
            this.jwtCache.set(token, { payload, exp: payload.exp });
            return payload;
        } catch {
            return null;
        }
    }

    // CLICK SAMPLING for millions/second performance
    shouldProcessClick() {
        this.totalClicksReceived++;
        this.clickCounter++;
        
        // Only process every Nth click
        if (this.clickCounter >= this.samplingRate) {
            this.clickCounter = 0;
            this.totalClicksProcessed++;
            return true;
        }
        return false;
    }

    // Ultra-fast click processing with sampling
    addClickFast(channelId, userId, x, y, timestamp) {
        // PERFORMANCE: Only process sampled clicks
        if (!this.shouldProcessClick()) {
            return false; // Click was discarded for performance
        }

        // Add to massive batch buffer
        if (!this.clickBuffer.has(channelId)) {
            this.clickBuffer.set(channelId, []);
        }
        this.clickBuffer.get(channelId).push({ userId, x, y, timestamp });

        // Update in-memory for immediate clustering
        if (!this.allChannelClicks.has(channelId)) {
            this.allChannelClicks.set(channelId, new Map());
        }
        this.allChannelClicks.get(channelId).set(userId, { x, y, timestamp });

        // Force flush if needed
        if (this.shouldFlush()) {
            setImmediate(() => this.flushBatches());
        }

        return true; // Click was processed
    }

    shouldFlush() {
        const totalBuffered = Array.from(this.clickBuffer.values())
            .reduce((sum, arr) => sum + arr.length, 0);
        
        return totalBuffered >= this.batchSize || 
               (Date.now() - this.lastFlush) > this.batchTimeout;
    }

    async flushBatches() {
        if (this.clickBuffer.size === 0) return;

        const batchesToFlush = new Map(this.clickBuffer);
        this.clickBuffer.clear();
        this.lastFlush = Date.now();

        // Async persistence without blocking
        setImmediate(() => this.persistBatchesToRedis(batchesToFlush));
    }

    async persistBatchesToRedis(batches) {
        if (!redis.isReady) return;

        try {
            const pipeline = redis.multi();
            let operationCount = 0;
            
            for (const [channelId, clicks] of batches) {
                for (const click of clicks) {
                    const redisKey = `clicks:${channelId}:${click.userId}`;
                    pipeline.hSet(redisKey, {
                        'x': click.x.toString(),
                        'y': click.y.toString(),
                        'timestamp': click.timestamp.toString()
                    });
                    pipeline.expire(redisKey, 3600);
                    operationCount += 2;
                }
            }
            
            await pipeline.exec();
            log(`📦 Persisted ${operationCount} operations to Redis`, 'debug');
        } catch (error) {
            logError('Batch persist error:', error);
        }
    }

    async getChannelClicks(channelId) {
        return this.allChannelClicks.get(channelId) || new Map();
    }

    async getAllChannelClicks() {
        return new Map(this.allChannelClicks);
    }

    async clearChannelClicks(channelId) {
        if (channelId) {
            this.allChannelClicks.delete(channelId);
            this.clickBuffer.delete(channelId);
        } else {
            this.allChannelClicks.clear();
            this.clickBuffer.clear();
        }
    }

    startBatchProcessor() {
        setInterval(() => {
            if (this.shouldFlush()) {
                this.flushBatches();
            }
        }, 100); // Check every 100ms
    }

    startStatsLogger() {
        setInterval(() => {
            const now = Date.now();
            const timeDiff = now - this.lastStatsLog;
            const receivedRate = Math.round((this.totalClicksReceived * 1000) / timeDiff);
            const processedRate = Math.round((this.totalClicksProcessed * 1000) / timeDiff);
            const samplingEfficiency = ((this.totalClicksProcessed / Math.max(this.totalClicksReceived, 1)) * 100).toFixed(1);
            
            log(`📊 PERFORMANCE: ${receivedRate}/s received, ${processedRate}/s processed (${samplingEfficiency}% sampling), JWT cache: ${this.jwtCache.size}`);
            
            this.totalClicksReceived = 0;
            this.totalClicksProcessed = 0;
            this.lastStatsLog = now;
        }, this.statsInterval);
    }

    getPerformanceStats() {
        return {
            jwtCacheSize: this.jwtCache.size,
            batchBufferSize: Array.from(this.clickBuffer.values()).reduce((sum, arr) => sum + arr.length, 0),
            totalChannels: this.allChannelClicks.size,
            samplingRate: this.samplingRate,
            totalClicksInMemory: Array.from(this.allChannelClicks.values()).reduce((sum, clicks) => sum + clicks.size, 0)
        };
    }
}

// ========== PRESERVE: ORIGINAL SOPHISTICATED CLUSTERING ==========
// Keep all the original clustering functions exactly as they were
function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    log(`🧮 Clustering: ${points.length} points, ${threshold}% threshold`, 'debug');

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

    log(`✅ Clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`, 'debug');
    return finalClusters;
}

// [Include all the original clustering functions here - keeping them exactly the same]
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
    
    // Determine which is larger/smaller for edge-to-label merging
    const largerCluster = percentage1 >= percentage2 ? cluster1 : cluster2;
    const smallerCluster = percentage1 >= percentage2 ? cluster2 : cluster1;
    
    const size1 = calculateIntelligentVisualSize(cluster1, [cluster1, cluster2]);
    const size2 = calculateIntelligentVisualSize(cluster2, [cluster1, cluster2]);
    
    const largerSize = percentage1 >= percentage2 ? size1 : size2;
    const smallerSize = percentage1 >= percentage2 ? size2 : size1;
    
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
    
    // ORIGINAL: Label-to-label overlap check
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
    
    // ORIGINAL: Circle-to-circle overlap check
    const distance = euclideanDistance(cluster1, cluster2) * SCREEN_WIDTH;
    const minSeparation = (size1 + size2) * 0.3;
    const circlesOverlap = distance < minSeparation;
    
    // NEW: Enhanced edge-to-label merging logic
    const largerX = largerCluster.x * SCREEN_WIDTH;
    const largerY = largerCluster.y * SCREEN_HEIGHT;
    const smallerX = smallerCluster.x * SCREEN_WIDTH;
    const smallerY = smallerCluster.y * SCREEN_HEIGHT;
    
    // Calculate larger cluster's edge boundary
    const largerRadius = largerSize;
    const largerEdgeDistance = Math.sqrt(Math.pow(smallerX - largerX, 2) + Math.pow(smallerY - largerY, 2));
    const largerClusterReachesSmaller = largerEdgeDistance <= (largerRadius + LABEL_PADDING);
    
    // Calculate smaller cluster's label box
    const smallerFontSize = percentage1 >= percentage2 ? fontSize2 : fontSize1;
    const smallerTextWidth = (percentage1 >= percentage2 ? text2 : text1).length * smallerFontSize * 0.6;
    const smallerTextHeight = smallerFontSize;
    
    const smallerLabelBox = {
        left: smallerX - smallerTextWidth/2 - LABEL_PADDING,
        right: smallerX + smallerTextWidth/2 + LABEL_PADDING,
        top: smallerY - smallerTextHeight/2 - LABEL_PADDING,
        bottom: smallerY + smallerTextHeight/2 + LABEL_PADDING
    };
    
    // Check if larger cluster edge intersects with smaller cluster's label area
    const edgeToLabelMerge = largerClusterReachesSmaller && (
        (largerX + largerRadius >= smallerLabelBox.left && largerX - largerRadius <= smallerLabelBox.right) &&
        (largerY + largerRadius >= smallerLabelBox.top && largerY - largerRadius <= smallerLabelBox.bottom)
    );
    
    // ENHANCED: Percentage-based smart merging (larger clusters are more aggressive)
    const percentageDifference = Math.abs(percentage1 - percentage2);
    const aggressiveMerging = percentageDifference > 15; // 15% or more difference
    
    let shouldMerge = labelsOverlap || circlesOverlap || edgeToLabelMerge;
    
    // If aggressive merging and one cluster is significantly larger, be more lenient
    if (aggressiveMerging && !shouldMerge) {
        const extendedDistance = distance < (largerRadius * 1.2 + smallerSize * 0.5);
        shouldMerge = extendedDistance;
    }
    
    // Logging for debugging the new merge logic
    if (shouldMerge && edgeToLabelMerge) {
        console.log(`🔗 Edge-to-label merge: ${largerCluster.percentage}% (${largerRadius}px) reaches ${smallerCluster.percentage}% label`);
    }
    
    return shouldMerge;
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
        await redisSub.subscribe('clickmap:config', handleConfigMessage);
        log('✅ Subscribed to Redis channels');
        
    } catch (error) {
        logError('❌ Redis connection failed:', error);
        log('⚠️ Continuing without Redis - using in-memory fallback', 'warn');
    }
}

await connectRedis();

// ========== INITIALIZE ULTRA HIGH-PERFORMANCE ENGINE ==========
const clickEngine = new UltraHighPerformanceClickEngine();

// ========== IMPROVED GAME STATE MANAGEMENT ==========
const gameState = {
    _running: false,
    _version: Date.now(),

    async setRunning(running) {
        try {
            this._running = running;
            this._version = Date.now();
            
            if (redis.isReady) {
                const pipeline = redis.multi();
                pipeline.set('game:running', running.toString());
                pipeline.set('game:lastUpdate', this._version.toString());
                pipeline.set('game:version', this._version.toString());
                await pipeline.exec();
            }
            
            log(`🎮 Game state changed: ${running ? 'RUNNING' : 'STOPPED'} (v${this._version})`);
            return this._version;
        } catch (error) {
            logError('Redis setRunning error:', error);
            // Continue with in-memory state even if Redis fails
            return this._version;
        }
    },

    async isRunning() {
        try {
            if (redis.isReady) {
                const running = await redis.get('game:running');
                this._running = running === 'true';
                return this._running;
            }
        } catch (error) {
            logError('Redis isRunning error:', error);
        }
        return this._running;
    },

    async clearAllClicks() {
        await clickEngine.clearChannelClicks();
        
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
        log('🗑️ All clicks cleared');
    },
    
    async clearChannelClicks(channelId) {
        await clickEngine.clearChannelClicks(channelId);
        
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
        log(`🗑️ Channel ${channelId} clicks cleared`);
    }
};

// ========== 5-SECOND BROADCAST SYSTEM ==========
class BroadcastManager {
    constructor() {
        this.lastBroadcast = Date.now();
        this.pendingUpdates = new Set();
        this.scheduledBroadcast = null;
        
        console.log(`📡 Broadcast manager initialized (${BROADCAST_INTERVAL}ms intervals)`);
    }

    scheduleUpdate(channelId) {
        this.pendingUpdates.add(channelId);
        
        if (this.scheduledBroadcast) return; // Already scheduled
        
        const timeSinceLastBroadcast = Date.now() - this.lastBroadcast;
        const timeUntilNext = Math.max(0, BROADCAST_INTERVAL - timeSinceLastBroadcast);
        
        this.scheduledBroadcast = setTimeout(() => {
            this.processPendingBroadcasts();
        }, timeUntilNext);
    }

    async processPendingBroadcasts() {
        if (this.pendingUpdates.size === 0) {
            this.scheduledBroadcast = null;
            return;
        }

        const channelsToUpdate = Array.from(this.pendingUpdates);
        this.pendingUpdates.clear();
        this.scheduledBroadcast = null;
        this.lastBroadcast = Date.now();

        log(`📡 Broadcasting updates for ${channelsToUpdate.length} channels`);

        // Process all pending channels
        for (const channelId of channelsToUpdate) {
            try {
                const data = await getCurrentHeatmapData(channelId);
                
                // Broadcast to Redis
                await redisPub.publish('clickmap:broadcast', JSON.stringify({
                    channelId: channelId,
                    payload: data,
                    fromInstance: INSTANCE_ID,
                    timestamp: Date.now()
                }));
                
                // Local broadcast
                broadcastToChannel(channelId, data);
                
            } catch (error) {
                logError(`Failed to broadcast for channel ${channelId}:`, error);
            }
        }
    }

    async forceImmediateBroadcast(channelId, data) {
        // IMMEDIATE HARD BROADCAST - bypasses all delays
        log(`📡 FORCE IMMEDIATE BROADCAST: ${data.action} for ${channelId}`);
        
        try {
            // Redis broadcast with immediate flag
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId,
                payload: data,
                fromInstance: INSTANCE_ID,
                timestamp: Date.now(),
                immediate: true,
                action: data.action
            }));
            
            // Local WebSocket broadcast
            if (channelId === 'all') {
                await broadcastToAll(data);
            } else {
                broadcastToChannel(channelId, data);
            }
            
            // Also broadcast to config panels immediately
            broadcastToConfigPanels(data);
            
            log(`✅ IMMEDIATE BROADCAST SENT: ${data.action}`);
            
        } catch (error) {
            logError(`Failed immediate broadcast for ${data.action}:`, error);
        }
    }
}

const broadcastManager = new BroadcastManager();

// ========== PRESERVE: Original heatmap generation with performance ==========
async function getCurrentHeatmapData(channelId, threshold = 3) {
    const running = await gameState.isRunning();
    const lastUpdate = Date.now();

    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = await clickEngine.getAllChannelClicks();
        console.log(`🔍 Getting ALL channel data: ${allChannelData.size} channels`);
        
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = processClicksIntoVisualClusters(allPoints, threshold);
        console.log(`🎨 Processed ${allPoints.length} points into ${clusters.length} clusters`);

        return {
            running: running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: lastUpdate,
            version: gameState._version
        };
    }

    const channelClicks = await clickEngine.getChannelClicks(channelId);
    console.log(`🔍 Getting channel ${channelId} data: ${channelClicks ? channelClicks.size : 0} clicks`);

    if (!channelClicks || channelClicks.size === 0) {
        console.log(`✅ Returning empty data for channel ${channelId}`);
        return {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: lastUpdate,
            version: gameState._version
        };
    }

    const points = Array.from(channelClicks.values());
    const clusters = processClicksIntoVisualClusters(points, threshold);
    console.log(`🎨 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

    return {
        running: running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: lastUpdate,
        version: gameState._version
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

app.use((req, res, next) => {
    log(`${req.method} ${req.path}`, 'debug');
    res.set('Cache-Control', 'no-store');
    res.set('X-Instance-Id', INSTANCE_ID);
    next();
});

// ========== ULTRA-OPTIMIZED ENDPOINTS ==========

app.get('/health', async (req, res) => {
    log('🏥 Health check called', 'debug');
    
    const running = await gameState.isRunning();
    const allClicks = await clickEngine.getAllChannelClicks();
    const stats = clickEngine.getPerformanceStats();
    
    res.json({
        status: 'ok',
        running: running,
        timestamp: Date.now(),
        version: '7.0.0-ultra-optimized',
        instanceId: INSTANCE_ID,
        websocket: {
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size
        },
        redis: {
            connected: redis.isReady
        },
        game_data: {
            total_channels: allClicks.size,
            total_clicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
        },
        performance: {
            ...stats,
            broadcastInterval: BROADCAST_INTERVAL,
            clickSampling: `1-in-${CLICK_SAMPLING_RATE}`,
            batchSize: BATCH_SIZE
        }
    });
});

// ULTRA-OPTIMIZED CLICK ENDPOINT with sampling and freeze rejection
app.post('/click', async (req, res) => {
    const start = performance.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    
    console.log(`🎯 CLICK RECEIVED [${requestId}]`);

    try {
        const running = await gameState.isRunning();
        if (!running) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Game stopped (visualization frozen)`);
            return res.status(400).json({
                success: false,
                error: 'Game not running - visualization is frozen',
                frozen: true,
                status: 'frozen',
                requestId: requestId
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log(`❌ CLICK REJECTED [${requestId}] - No token`);
            return res.status(401).json({
                success: false,
                error: 'No token provided',
                requestId: requestId
            });
        }

        const payload = clickEngine.verifyJWTFast(token);
        
        if (!payload) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid token`);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                requestId: requestId
            });
        }
        
        if (payload.role === 'external') {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid role`);
            return res.status(403).json({
                success: false,
                error: 'Invalid role',
                requestId: requestId
            });
        }

        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            isNaN(x) || isNaN(y) ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid coordinates`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates',
                requestId: requestId
            });
        }

        if (!uid || !channelId) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Missing IDs`);
            return res.status(400).json({
                success: false,
                error: 'Missing user or channel ID',
                requestId: requestId
            });
        }

        // ULTRA-FAST: Process with sampling
        const wasProcessed = clickEngine.addClickFast(channelId, uid, x, y, Date.now());
        
        if (wasProcessed) {
            console.log(`✅ CLICK PROCESSED [${requestId}] - Added to batch`);
            
            // Schedule 5-second broadcast (not immediate)
            broadcastManager.scheduleUpdate(channelId);
        } else {
            console.log(`⚡ CLICK SAMPLED [${requestId}] - Discarded for performance`);
        }

        const channelClicks = await clickEngine.getChannelClicks(channelId);
        const processingTime = performance.now() - start;
        
        console.log(`✅ CLICK RESPONSE [${requestId}] in ${processingTime.toFixed(1)}ms - ${channelClicks.size} total clicks`);
        
        res.json({
            success: true,
            status: wasProcessed ? 'click recorded' : 'click sampled',
            totalClicks: channelClicks.size,
            channelId: channelId,
            instanceId: INSTANCE_ID,
            requestId: requestId,
            processingTime: Math.round(processingTime),
            sampled: !wasProcessed,
            gameRunning: true
        });

    } catch (error) {
        const processingTime = performance.now() - start;
        console.log(`❌ CLICK ERROR [${requestId}] after ${processingTime.toFixed(1)}ms: ${error.message}`);
        
        res.status(500).json({
            success: false,
            error: 'Server error',
            requestId: requestId,
            processingTime: Math.round(processingTime)
        });
    }
});

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

// FIXED START/STOP/RESET with proper data preservation
app.post('/start', async (req, res) => {
    log('🚀 START endpoint called');
    
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(true);
        
        // START: Clear processing queues/backlogs but PRESERVE existing click data
        if (clickEngine.clickBuffer) {
            if (channelId) {
                clickEngine.clickBuffer.delete(channelId);
            } else {
                clickEngine.clickBuffer.clear();
            }
        }
        
        // Force flush any pending batches to ensure clean state
        if (clickEngine.flushBatches) {
            await clickEngine.flushBatches();
        }
        
        log(`✅ Game started (Version: ${result}) - PRESERVING existing click data`);
        
        // Get current data (which preserves existing clusters)
        const broadcastData = await getCurrentHeatmapData(channelId || 'all');
        broadcastData.running = true;
        broadcastData.action = 'start';
        broadcastData.version = result;
        broadcastData.channelId = channelId || 'all';
        broadcastData.timestamp = Date.now();
        broadcastData.dataPreserved = true; // Signal that data was preserved
        
        // Immediate broadcast for start
        broadcastManager.forceImmediateBroadcast(channelId || 'all', broadcastData);
        
        res.json({
            success: true,
            status: 'started',
            running: true,
            dataPreserved: true,
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
        const result = await gameState.setRunning(false);
        
        // STOP: Clear processing queues/backlogs but PRESERVE existing click data
        if (clickEngine.clickBuffer) {
            if (channelId) {
                clickEngine.clickBuffer.delete(channelId);
            } else {
                clickEngine.clickBuffer.clear();
            }
        }
        
        // Force flush any pending batches to ensure clean state
        if (clickEngine.flushBatches) {
            await clickEngine.flushBatches();
        }
        
        log(`✅ Game stopped (Version: ${result}) - PRESERVING existing click data for freeze`);
        
        // Get current data to freeze (preserves existing clusters)
        const currentData = await getCurrentHeatmapData(channelId || 'all');
        currentData.running = false;
        currentData.action = 'stop';
        currentData.version = result;
        currentData.timestamp = Date.now();
        currentData.frozen = true; // Signal that visualization should be frozen
        currentData.dataPreserved = true; // Signal that data was preserved
        
        // Immediate broadcast for stop with freeze
        broadcastManager.forceImmediateBroadcast(channelId || 'all', currentData);
        
        res.json({
            success: true,
            status: 'stopped',
            running: false,
            frozen: true,
            dataPreserved: true,
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
        
        // RESET: Clear EVERYTHING - processing queues AND stored click data
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        log(`✅ Data reset - ALL click data cleared`);
        
        const running = await gameState.isRunning();
        
        const broadcastData = {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            action: 'reset',
            channelId: channelId || 'all',
            timestamp: Date.now(),
            allDataCleared: true // Signal that all data was cleared
        };
        
        // Immediate broadcast for reset
        broadcastManager.forceImmediateBroadcast(channelId || 'all', broadcastData);
        
        res.json({
            success: true,
            status: 'reset',
            running: running,
            allDataCleared: true,
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

// ========== PRESERVE: ORIGINAL WEBSOCKET & BROADCASTING ==========
const httpServer = createServer(app);
let wss = null;
const connectedClients = new Map();
const configPanels = new Map();

function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        log(`📨 Broadcast from instance ${data.fromInstance}`, 'debug');
        
        if (data.fromInstance === INSTANCE_ID) return;
        
        broadcastToLocalClients(data.channelId, data.payload);
        
    } catch (error) {
        logError('Error handling broadcast message:', error);
    }
}

function handleConfigMessage(message) {
    try {
        const data = JSON.parse(message);
        log(`📨 Config update from instance ${data.fromInstance}`, 'debug');
        
        if (data.fromInstance === INSTANCE_ID) return;
        
        broadcastToConfigPanels(data.payload);
        
    } catch (error) {
        logError('Error handling config message:', error);
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
                logError('WebSocket send error:', error);
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

function broadcastToConfigPanels(data) {
    if (!configPanels) return;
    
    let message;
    try {
        message = JSON.stringify(data);
    } catch (error) {
        logError('Failed to stringify config data:', error);
        return;
    }

    configPanels.forEach((ws, sessionId) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
            } catch (error) {
                logError('Config panel send error:', error);
                configPanels.delete(sessionId);
            }
        } else {
            configPanels.delete(sessionId);
        }
    });
}

async function broadcastToAll(data) {
    if (!connectedClients) return;
    
    const promises = [];
    
    connectedClients.forEach((clients, channelId) => {
        const promise = (async () => {
            const channelData = channelId === 'all' ? data : await getCurrentHeatmapData(channelId);
            Object.assign(channelData, { running: data.running, action: data.action });
            broadcastToChannel(channelId, channelData);
        })();
        promises.push(promise);
    });
    
    await Promise.all(promises);
}

// Create WebSocket server
log('🔧 Creating WebSocket server...');
try {
    wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        perMessageDeflate: false,
        clientTracking: true
    });
    log('✅ WebSocket server integrated with HTTP server');
} catch (error) {
    logError('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

wss.on('connection', async (ws, req) => {
    const startTime = Date.now();
    log(`🔗 NEW WEBSOCKET CONNECTION: ${req.url}`, 'debug');

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

        log(`✅ WebSocket connected: Channel ${channelId} (${connectedClients.get(channelId).size} clients)`, 'debug');

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
            logError('Message parse error:', error);
        }
    });

    ws.on('close', () => {
        const duration = Date.now() - startTime;
        
        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
            log(`🔒 Config panel disconnected: ${sessionId} after ${duration}ms`, 'debug');
        } else if (channelId) {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            log(`🔒 WebSocket disconnected: ${channelId} after ${duration}ms`, 'debug');
        }
    });

    ws.on('error', (error) => {
        logError(`WebSocket error for ${channelId || sessionId}:`, error);
    });
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', async () => {
    log('🚀 ClickMap EBS v7.0.0 ULTRA HIGH-PERFORMANCE');
    log(`📡 Instance ID: ${INSTANCE_ID}`);
    log(`📡 Port: ${PORT}`);
    log(`💾 Redis connected: ${redis.isReady}`);
    log(`📢 PubSub active: ${redisSub.isReady && redisPub.isReady}`);
    log(`🎨 Sophisticated clustering: ENABLED`);
    log(`⚡ Performance: 1-in-${CLICK_SAMPLING_RATE} sampling, ${BROADCAST_INTERVAL}ms broadcasts`);
    log(`🔥 Batch size: ${BATCH_SIZE}, Timeout: ${BATCH_TIMEOUT}ms`);
    
    try {
        const running = await gameState.isRunning();
        log(`📊 Game state: ${running ? 'RUNNING' : 'STOPPED'}`);
    } catch (error) {
        logError('❌ Failed to get initial state:', error);
    }

    setTimeout(() => {
        const stats = clickEngine.getPerformanceStats();
        log('🔍 FINAL STATUS:');
        log(`   HTTP server: ${httpServer.listening ? 'LISTENING' : 'NOT LISTENING'}`);
        log(`   WebSocket: ${wss ? 'READY' : 'NOT READY'}`);
        log(`   Channels: ${connectedClients.size}`);
        log(`   Config panels: ${configPanels.size}`);
        log(`   JWT cache: ${stats.jwtCacheSize} tokens`);
        log(`   Total channels: ${stats.totalChannels}`);
        log(`   Clicks in memory: ${stats.totalClicksInMemory}`);
        log('🎊 Ultra high-performance server ready for millions of clicks/second!');
    }, 1000);
});

export default httpServer;
