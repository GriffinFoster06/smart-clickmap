// backend/server.js - ULTRA HIGH-PERFORMANCE: 50,000 clicks/second capable
// Extreme optimizations for massive scale with optimal WebSocket manager

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

// EXTREME PERFORMANCE SETTINGS FOR 50K CLICKS/SECOND
const CLICK_SAMPLING_RATE = 20; // Only process 1 in 20 clicks (2,500 processed/sec)
const BROADCAST_INTERVAL = 8000; // 8 seconds between updates (reduce server load)
const BATCH_SIZE = 10000; // Massive batch sizes for efficiency
const BATCH_TIMEOUT = 200; // Very fast batch processing (200ms max)
const MAX_MEMORY_CHANNELS = 100; // Limit memory usage
const CLEANUP_INTERVAL = 30000; // Clean up every 30 seconds
const HEATMAP_CACHE_TTL = 3000; // Cache heatmap responses for 3 seconds

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.DEBUG === 'true' || !IS_PRODUCTION;

// EXTREME REQUEST QUEUEING FOR HIGH LOAD
const MAX_CONCURRENT_REQUESTS = 100;
const REQUEST_QUEUE_SIZE = 1000;
let activeRequests = 0;
const requestQueue = [];

// HEATMAP RESPONSE CACHING
const heatmapCache = new Map(); // channelId -> {data, timestamp}

// STICKY RESET SYSTEM - Keep broadcasting reset signals
const stickyResetSignals = new Map();
const RESET_SIGNAL_DURATION = 30000;

function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_ENABLED) return;
    if (level === 'error' || level === 'warn' || !IS_PRODUCTION) {
        console.log(message);
    }
}

function logError(message, error = null) {
    console.error(message, error || '');
}

// Enhanced reset signal manager
function addStickyResetSignal(channelId, resetData) {
    const key = channelId || 'all';
    const expiry = Date.now() + RESET_SIGNAL_DURATION;
    
    stickyResetSignals.set(key, {
        signal: resetData,
        expiry: expiry
    });
    
    log(`🔄 Added sticky reset signal for ${key}`);
    
    setTimeout(() => {
        if (stickyResetSignals.has(key)) {
            stickyResetSignals.delete(key);
        }
    }, RESET_SIGNAL_DURATION);
}

function getStickyResetSignal(channelId) {
    const key = channelId || 'all';
    const signal = stickyResetSignals.get(key);
    
    if (signal && Date.now() < signal.expiry) {
        return signal.signal;
    }
    
    if (signal) {
        stickyResetSignals.delete(key);
    }
    
    return null;
}

// REQUEST QUEUE SYSTEM FOR HIGH LOAD
function processRequestQueue() {
    while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
        const { req, res, handler } = requestQueue.shift();
        activeRequests++;
        
        handler(req, res).finally(() => {
            activeRequests--;
            // Process next in queue
            setImmediate(processRequestQueue);
        });
    }
}

function queueRequest(req, res, handler) {
    if (requestQueue.length >= REQUEST_QUEUE_SIZE) {
        // Queue full - reject with 503
        res.status(503).json({
            success: false,
            error: 'Server overloaded',
            queueFull: true
        });
        return;
    }
    
    requestQueue.push({ req, res, handler });
    processRequestQueue();
}

// ========== EXTREME HIGH-PERFORMANCE CLICK ENGINE ==========
class ExtremePerformanceClickEngine {
    constructor() {
        // MASSIVE optimization settings
        this.jwtCache = new Map();
        this.maxJWTCache = 100000; // Massive JWT cache
        
        // EXTREME batching for 50k/sec
        this.clickBuffer = new Map();
        this.batchSize = BATCH_SIZE;
        this.batchTimeout = BATCH_TIMEOUT;
        this.lastFlush = Date.now();
        
        // EXTREME click sampling
        this.clickCounter = 0;
        this.samplingRate = CLICK_SAMPLING_RATE;
        this.totalClicksReceived = 0;
        this.totalClicksProcessed = 0;
        
        // Optimized in-memory storage with limits
        this.allChannelClicks = new Map();
        this.maxClicksPerChannel = 1000; // Limit per channel
        
        // Performance tracking
        this.lastStatsLog = Date.now();
        this.statsInterval = 10000;
        
        console.log(`🚀 EXTREME performance engine: 1-in-${this.samplingRate} sampling, ${this.batchSize} batch size`);
        this.startBatchProcessor();
        this.startStatsLogger();
        this.startMemoryCleanup();
    }

    // LIGHTNING-FAST JWT verification with massive cache
    verifyJWTFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }

        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // Aggressive cache management
            if (this.jwtCache.size >= this.maxJWTCache) {
                // Remove oldest 50% of cache aggressively
                const keysToRemove = Math.floor(this.maxJWTCache * 0.5);
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

    // EXTREME sampling for 50k/sec performance
    shouldProcessClick() {
        this.totalClicksReceived++;
        this.clickCounter++;
        
        // Only process every 20th click
        if (this.clickCounter >= this.samplingRate) {
            this.clickCounter = 0;
            this.totalClicksProcessed++;
            return true;
        }
        return false;
    }

    // EXTREME-SPEED click processing with aggressive sampling
    addClickFast(channelId, userId, x, y, timestamp) {
        // EXTREME: Only process heavily sampled clicks
        if (!this.shouldProcessClick()) {
            return false;
        }

        // Limit memory usage per channel
        if (!this.allChannelClicks.has(channelId)) {
            this.allChannelClicks.set(channelId, new Map());
        }
        
        const channelClicks = this.allChannelClicks.get(channelId);
        
        // Aggressive memory management
        if (channelClicks.size >= this.maxClicksPerChannel) {
            // Remove oldest 20% of clicks
            const keysToRemove = Math.floor(this.maxClicksPerChannel * 0.2);
            const keys = Array.from(channelClicks.keys());
            for (let i = 0; i < keysToRemove; i++) {
                channelClicks.delete(keys[i]);
            }
        }
        
        channelClicks.set(userId, { x, y, timestamp });

        // Add to massive batch buffer
        if (!this.clickBuffer.has(channelId)) {
            this.clickBuffer.set(channelId, []);
        }
        this.clickBuffer.get(channelId).push({ userId, x, y, timestamp });

        // Aggressive flushing
        if (this.shouldFlush()) {
            setImmediate(() => this.flushBatches());
        }

        return true;
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
            // MASSIVE pipeline operations
            const pipeline = redis.multi();
            let operationCount = 0;
            
            for (const [channelId, clicks] of batches) {
                // Process in chunks to avoid massive pipelines
                const chunkSize = 1000;
                for (let i = 0; i < clicks.length; i += chunkSize) {
                    const chunk = clicks.slice(i, i + chunkSize);
                    
                    for (const click of chunk) {
                        const redisKey = `clicks:${channelId}:${click.userId}`;
                        pipeline.hSet(redisKey, {
                            'x': click.x.toString(),
                            'y': click.y.toString(),
                            'timestamp': click.timestamp.toString()
                        });
                        pipeline.expire(redisKey, 1800); // Shorter expiry
                        operationCount += 2;
                    }
                    
                    // Execute in chunks to prevent massive operations
                    if (operationCount >= 2000) {
                        await pipeline.exec();
                        pipeline.clear();
                        operationCount = 0;
                    }
                }
            }
            
            if (operationCount > 0) {
                await pipeline.exec();
            }
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
        }, 50); // Check every 50ms for extreme responsiveness
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.performMemoryCleanup();
        }, CLEANUP_INTERVAL);
    }

    performMemoryCleanup() {
        const now = Date.now();
        const maxAge = 3600000; // 1 hour max age
        let cleanedChannels = 0;
        let cleanedClicks = 0;
        
        // Clean old channels
        if (this.allChannelClicks.size > MAX_MEMORY_CHANNELS) {
            const channelsToRemove = this.allChannelClicks.size - MAX_MEMORY_CHANNELS;
            const channelKeys = Array.from(this.allChannelClicks.keys());
            
            for (let i = 0; i < channelsToRemove; i++) {
                this.allChannelClicks.delete(channelKeys[i]);
                cleanedChannels++;
            }
        }
        
        // Clean old clicks within each channel
        for (const [channelId, clicks] of this.allChannelClicks.entries()) {
            const clicksToRemove = [];
            
            for (const [userId, click] of clicks.entries()) {
                if (now - click.timestamp > maxAge) {
                    clicksToRemove.push(userId);
                }
            }
            
            clicksToRemove.forEach(userId => {
                clicks.delete(userId);
                cleanedClicks++;
            });
            
            // If channel is empty, remove it
            if (clicks.size === 0) {
                this.allChannelClicks.delete(channelId);
                cleanedChannels++;
            }
        }
        
        // Clean JWT cache aggressively
        if (this.jwtCache.size > this.maxJWTCache * 0.8) {
            const keysToRemove = Math.floor(this.jwtCache.size * 0.3);
            const keys = Array.from(this.jwtCache.keys());
            for (let i = 0; i < keysToRemove; i++) {
                this.jwtCache.delete(keys[i]);
            }
        }
        
        if (cleanedChannels > 0 || cleanedClicks > 0) {
            log(`🧹 Memory cleanup: ${cleanedChannels} channels, ${cleanedClicks} clicks removed`);
        }
    }

    startStatsLogger() {
        setInterval(() => {
            const now = Date.now();
            const timeDiff = now - this.lastStatsLog;
            const receivedRate = Math.round((this.totalClicksReceived * 1000) / timeDiff);
            const processedRate = Math.round((this.totalClicksProcessed * 1000) / timeDiff);
            const samplingEfficiency = ((this.totalClicksProcessed / Math.max(this.totalClicksReceived, 1)) * 100).toFixed(1);
            
            log(`📊 EXTREME PERFORMANCE: ${receivedRate}/s received, ${processedRate}/s processed (${samplingEfficiency}% sampling)`);
            log(`   Memory: ${this.allChannelClicks.size} channels, JWT cache: ${this.jwtCache.size}, Queue: ${requestQueue.length}, Active: ${activeRequests}`);
            
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
            totalClicksInMemory: Array.from(this.allChannelClicks.values()).reduce((sum, clicks) => sum + clicks.size, 0),
            requestQueue: requestQueue.length,
            activeRequests: activeRequests,
            maxMemoryChannels: MAX_MEMORY_CHANNELS,
            batchSize: this.batchSize,
            batchTimeout: this.batchTimeout
        };
    }
}

// ========== PRESERVE: ORIGINAL CLUSTERING ==========
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

// ========== INITIALIZE EXTREME ENGINE ==========
const clickEngine = new ExtremePerformanceClickEngine();

// ========== GAME STATE MANAGEMENT ==========
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
                    // Process in chunks for massive deletions
                    const chunkSize = 1000;
                    for (let i = 0; i < clickKeys.length; i += chunkSize) {
                        const chunk = clickKeys.slice(i, i + chunkSize);
                        await redis.del(chunk);
                    }
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

// ========== OPTIMAL HIGH-PERFORMANCE WEBSOCKET MANAGER ==========
class OptimalWebSocketManager {
    constructor(redisClient, redisPub, redisSub, instanceId) {
        this.redis = redisClient;
        this.redisPub = redisPub;
        this.redisSub = redisSub;
        this.instanceId = instanceId;
        
        // LOCAL connection storage for maximum performance
        this.localConnections = new Map(); // channelId -> Set<{ws, connectionId, connectedAt}>
        this.localConfigPanels = new Map(); // sessionId -> {ws, connectionId, connectedAt}
        
        // PERFORMANCE optimizations
        this.broadcastQueue = new Map(); // channelId -> {data, timestamp}
        this.batchBroadcastInterval = 100; // Batch broadcasts every 100ms
        this.maxBroadcastsPerSecond = 50; // Rate limit broadcasts
        this.lastBroadcastTime = new Map(); // channelId -> timestamp
        
        // CONNECTION management
        this.connectionCounter = 0;
        this.heartbeatInterval = 30000; // 30 seconds
        this.connectionCleanupInterval = 60000; // 1 minute
        this.maxConnectionsPerChannel = 1000; // Prevent memory issues
        
        // CROSS-INSTANCE coordination (minimal Redis usage)
        this.instanceRegistry = new Map(); // instanceId -> lastSeen
        this.instanceHeartbeatInterval = 5000; // 5 seconds
        this.crossInstanceBroadcastDebounce = 200; // Debounce cross-instance broadcasts
        
        // METRICS
        this.metrics = {
            totalConnections: 0,
            broadcastsSent: 0,
            crossInstanceBroadcasts: 0,
            connectionsDropped: 0,
            lastCleanup: Date.now()
        };
        
        console.log(`🚀 OPTIMAL WebSocket Manager initialized on instance ${this.instanceId}`);
        this.initialize();
    }

    async initialize() {
        // Setup cross-instance communication with minimal overhead
        await this.setupCrossInstanceCommunication();
        
        // Start background processes
        this.startInstanceHeartbeat();
        this.startConnectionCleanup();
        this.startBatchBroadcasting();
        this.startMetricsReporting();
        
        console.log(`✅ WebSocket manager fully initialized`);
    }

    async setupCrossInstanceCommunication() {
        try {
            // Subscribe to critical cross-instance events only
            await this.redisSub.subscribe('ws:cluster:broadcast', (message) => {
                this.handleCrossInstanceBroadcast(message);
            });
            
            await this.redisSub.subscribe('ws:cluster:reset', (message) => {
                this.handleCrossInstanceReset(message);
            });
            
            console.log(`✅ Cross-instance communication setup complete`);
        } catch (error) {
            logError('Failed to setup cross-instance communication:', error);
        }
    }

    // ========== CONNECTION MANAGEMENT ==========
    
    async registerConnection(channelId, ws, req) {
        const connectionId = `${this.instanceId}_${++this.connectionCounter}_${Date.now()}`;
        const connectionInfo = {
            ws: ws,
            connectionId: connectionId,
            connectedAt: Date.now(),
            lastPing: Date.now(),
            userAgent: req.headers['user-agent']?.substring(0, 100) || 'unknown'
        };

        // Store locally for maximum performance
        if (!this.localConnections.has(channelId)) {
            this.localConnections.set(channelId, new Set());
        }
        
        const channelConnections = this.localConnections.get(channelId);
        
        // Prevent memory issues - limit connections per channel
        if (channelConnections.size >= this.maxConnectionsPerChannel) {
            // Remove oldest connection
            const oldestConnection = Array.from(channelConnections)[0];
            this.unregisterConnectionLocal(channelId, oldestConnection.ws, oldestConnection.connectionId);
            console.log(`⚠️ Connection limit reached for ${channelId}, dropped oldest`);
        }
        
        channelConnections.add(connectionInfo);
        this.metrics.totalConnections++;

        // MINIMAL Redis usage - only store count and instance presence
        try {
            await this.updateChannelMetrics(channelId);
        } catch (error) {
            // Don't fail connection on Redis error
            logError('Redis connection registration failed:', error);
        }

        console.log(`📡 Registered WebSocket: ${channelId} (${connectionId}) - Total: ${channelConnections.size}`);
        return connectionInfo;
    }

    unregisterConnectionLocal(channelId, ws, connectionId) {
        const channelConnections = this.localConnections.get(channelId);
        if (!channelConnections) return;

        // Find and remove connection
        for (const conn of channelConnections) {
            if (conn.connectionId === connectionId || conn.ws === ws) {
                channelConnections.delete(conn);
                this.metrics.totalConnections--;
                
                // Close WebSocket if still open
                if (conn.ws.readyState === WebSocket.OPEN) {
                    try {
                        conn.ws.close();
                    } catch (error) {
                        // Ignore close errors
                    }
                }
                break;
            }
        }

        // Clean up empty channel
        if (channelConnections.size === 0) {
            this.localConnections.delete(channelId);
        }

        console.log(`🔒 Unregistered WebSocket: ${channelId} (${connectionId})`);
    }

    async unregisterConnection(channelId, ws, connectionId) {
        this.unregisterConnectionLocal(channelId, ws, connectionId);
        
        // Update Redis metrics
        try {
            await this.updateChannelMetrics(channelId);
        } catch (error) {
            logError('Redis unregistration failed:', error);
        }
    }

    // ========== OPTIMIZED BROADCASTING ==========
    
    async broadcastToChannel(channelId, data, options = {}) {
        const now = Date.now();
        const isImmediate = options.immediate || false;
        const isCrossInstance = options.crossInstance !== false;

        // Rate limiting for performance
        const lastBroadcast = this.lastBroadcastTime.get(channelId) || 0;
        if (!isImmediate && (now - lastBroadcast) < (1000 / this.maxBroadcastsPerSecond)) {
            // Queue for batching
            this.broadcastQueue.set(channelId, { data, timestamp: now });
            return;
        }

        this.lastBroadcastTime.set(channelId, now);
        
        // LOCAL broadcast first (maximum performance)
        const localCount = this.broadcastToChannelLocal(channelId, data);
        
        // CROSS-INSTANCE broadcast only if needed
        if (isCrossInstance && localCount === 0) {
            // Only broadcast to other instances if no local connections
            await this.broadcastCrossInstance(channelId, data, options);
        }
        
        this.metrics.broadcastsSent++;
        return localCount;
    }

    broadcastToChannelLocal(channelId, data) {
        const connections = this.localConnections.get(channelId);
        if (!connections || connections.size === 0) return 0;

        let message;
        try {
            message = JSON.stringify(data);
        } catch (error) {
            logError('Failed to stringify broadcast data:', error);
            return 0;
        }

        let sentCount = 0;
        const deadConnections = [];
        const now = Date.now();

        connections.forEach(connInfo => {
            const ws = connInfo.ws;
            
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    connInfo.lastPing = now; // Update activity
                    sentCount++;
                } catch (error) {
                    deadConnections.push(connInfo);
                }
            } else {
                deadConnections.push(connInfo);
            }
        });

        // Clean up dead connections efficiently
        deadConnections.forEach(connInfo => {
            connections.delete(connInfo);
            this.metrics.connectionsDropped++;
        });

        if (sentCount > 0) {
            console.log(`📡 Local broadcast to ${channelId}: ${sentCount} clients`);
        }

        return sentCount;
    }

    async broadcastCrossInstance(channelId, data, options = {}) {
        if (!this.redis.isReady) return;

        try {
            const payload = {
                type: 'channel_broadcast',
                channelId: channelId,
                data: data,
                fromInstance: this.instanceId,
                timestamp: Date.now(),
                options: options
            };

            await this.redisPub.publish('ws:cluster:broadcast', JSON.stringify(payload));
            this.metrics.crossInstanceBroadcasts++;
            
        } catch (error) {
            logError('Cross-instance broadcast failed:', error);
        }
    }

    // ========== BATCH BROADCASTING FOR PERFORMANCE ==========
    
    startBatchBroadcasting() {
        setInterval(() => {
            this.processBroadcastQueue();
        }, this.batchBroadcastInterval);
    }

    processBroadcastQueue() {
        if (this.broadcastQueue.size === 0) return;

        const now = Date.now();
        const batch = new Map(this.broadcastQueue);
        this.broadcastQueue.clear();

        for (const [channelId, broadcastInfo] of batch) {
            // Only process if not too old
            if (now - broadcastInfo.timestamp < 1000) {
                this.broadcastToChannelLocal(channelId, broadcastInfo.data);
            }
        }
    }

    // ========== CROSS-INSTANCE EVENT HANDLING ==========
    
    handleCrossInstanceBroadcast(message) {
        try {
            const payload = JSON.parse(message);
            
            // Ignore our own broadcasts
            if (payload.fromInstance === this.instanceId) return;
            
            switch (payload.type) {
                case 'channel_broadcast':
                    this.broadcastToChannelLocal(payload.channelId, payload.data);
                    break;
                case 'config_broadcast':
                    this.broadcastToConfigPanelsLocal(payload.data);
                    break;
            }
        } catch (error) {
            logError('Cross-instance broadcast handling error:', error);
        }
    }

    handleCrossInstanceReset(message) {
        try {
            const payload = JSON.parse(message);
            
            if (payload.fromInstance === this.instanceId) return;
            
            console.log(`🔄 Cross-instance reset signal received from ${payload.fromInstance}`);
            
            // Apply reset locally
            if (payload.channelId) {
                this.localConnections.delete(payload.channelId);
            } else {
                this.localConnections.clear();
            }
            
        } catch (error) {
            logError('Cross-instance reset handling error:', error);
        }
    }

    // ========== CONFIG PANEL MANAGEMENT ==========
    
    registerConfigPanel(sessionId, ws, req) {
        const connectionId = `config_${this.instanceId}_${++this.connectionCounter}_${Date.now()}`;
        const connectionInfo = {
            ws: ws,
            connectionId: connectionId,
            connectedAt: Date.now(),
            lastPing: Date.now()
        };

        this.localConfigPanels.set(sessionId, connectionInfo);
        console.log(`⚙️ Config panel registered: ${sessionId}`);
        
        return connectionInfo;
    }

    unregisterConfigPanel(sessionId) {
        const removed = this.localConfigPanels.delete(sessionId);
        if (removed) {
            console.log(`⚙️ Config panel unregistered: ${sessionId}`);
        }
    }

    broadcastToConfigPanelsLocal(data) {
        if (this.localConfigPanels.size === 0) return 0;

        let message;
        try {
            message = JSON.stringify(data);
        } catch (error) {
            return 0;
        }

        let sentCount = 0;
        const deadPanels = [];

        this.localConfigPanels.forEach((connInfo, sessionId) => {
            const ws = connInfo.ws;
            
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    sentCount++;
                } catch (error) {
                    deadPanels.push(sessionId);
                }
            } else {
                deadPanels.push(sessionId);
            }
        });

        // Clean up dead panels
        deadPanels.forEach(sessionId => {
            this.localConfigPanels.delete(sessionId);
        });

        return sentCount;
    }

    async broadcastToConfigPanels(data) {
        const localCount = this.broadcastToConfigPanelsLocal(data);
        
        // Cross-instance config broadcast
        if (this.redis.isReady) {
            try {
                await this.redisPub.publish('ws:cluster:broadcast', JSON.stringify({
                    type: 'config_broadcast',
                    data: data,
                    fromInstance: this.instanceId,
                    timestamp: Date.now()
                }));
            } catch (error) {
                logError('Config cross-instance broadcast failed:', error);
            }
        }
        
        return localCount;
    }

    // ========== MAINTENANCE & HEALTH ==========
    
    startInstanceHeartbeat() {
        setInterval(async () => {
            try {
                if (this.redis.isReady) {
                    await this.redis.setEx(
                        `ws:instance:${this.instanceId}`,
                        15, // 15 second TTL
                        JSON.stringify({
                            lastSeen: Date.now(),
                            connections: this.metrics.totalConnections,
                            channels: this.localConnections.size,
                            configPanels: this.localConfigPanels.size
                        })
                    );
                }
            } catch (error) {
                logError('Instance heartbeat failed:', error);
            }
        }, this.instanceHeartbeatInterval);
    }

    startConnectionCleanup() {
        setInterval(() => {
            this.cleanupStaleConnections();
            this.metrics.lastCleanup = Date.now();
        }, this.connectionCleanupInterval);
    }

    cleanupStaleConnections() {
        const now = Date.now();
        const staleThreshold = 300000; // 5 minutes
        let cleanedCount = 0;

        // Clean up stale regular connections
        this.localConnections.forEach((connections, channelId) => {
            const staleConnections = [];
            
            connections.forEach(connInfo => {
                if (now - connInfo.lastPing > staleThreshold || 
                    connInfo.ws.readyState !== WebSocket.OPEN) {
                    staleConnections.push(connInfo);
                }
            });
            
            staleConnections.forEach(connInfo => {
                connections.delete(connInfo);
                cleanedCount++;
                
                if (connInfo.ws.readyState === WebSocket.OPEN) {
                    try {
                        connInfo.ws.close();
                    } catch (error) {
                        // Ignore
                    }
                }
            });
            
            if (connections.size === 0) {
                this.localConnections.delete(channelId);
            }
        });

        // Clean up stale config panels
        this.localConfigPanels.forEach((connInfo, sessionId) => {
            if (now - connInfo.lastPing > staleThreshold || 
                connInfo.ws.readyState !== WebSocket.OPEN) {
                this.localConfigPanels.delete(sessionId);
                cleanedCount++;
                
                if (connInfo.ws.readyState === WebSocket.OPEN) {
                    try {
                        connInfo.ws.close();
                    } catch (error) {
                        // Ignore
                    }
                }
            }
        });

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} stale connections`);
        }
    }

    async updateChannelMetrics(channelId) {
        if (!this.redis.isReady) return;
        
        try {
            const connections = this.localConnections.get(channelId);
            const count = connections ? connections.size : 0;
            
            if (count > 0) {
                await this.redis.hSet('ws:channel:metrics', channelId, JSON.stringify({
                    instanceId: this.instanceId,
                    connections: count,
                    lastUpdate: Date.now()
                }));
            } else {
                await this.redis.hDel('ws:channel:metrics', channelId);
            }
        } catch (error) {
            // Don't log Redis errors in production
        }
    }

    startMetricsReporting() {
        setInterval(() => {
            const totalLocalConnections = Array.from(this.localConnections.values())
                .reduce((sum, connections) => sum + connections.size, 0);
            
            console.log(`📊 WebSocket Metrics [${this.instanceId}]:`);
            console.log(`   Local connections: ${totalLocalConnections} across ${this.localConnections.size} channels`);
            console.log(`   Config panels: ${this.localConfigPanels.size}`);
            console.log(`   Broadcasts sent: ${this.metrics.broadcastsSent}`);
            console.log(`   Cross-instance broadcasts: ${this.metrics.crossInstanceBroadcasts}`);
            console.log(`   Connections dropped: ${this.metrics.connectionsDropped}`);
            
            // Reset counters
            this.metrics.broadcastsSent = 0;
            this.metrics.crossInstanceBroadcasts = 0;
            this.metrics.connectionsDropped = 0;
            
        }, 30000); // Every 30 seconds
    }

    // ========== CLUSTER-WIDE OPERATIONS ==========
    
    async broadcastToAll(data, options = {}) {
        const promises = [];
        let totalLocal = 0;
        
        // Broadcast to all local channels
        this.localConnections.forEach((connections, channelId) => {
            if (connections.size > 0) {
                const channelData = channelId === 'all' ? data : 
                    { ...data, channelId: channelId };
                totalLocal += this.broadcastToChannelLocal(channelId, channelData);
            }
        });
        
        // Cross-instance broadcast
        if (options.crossInstance !== false && this.redis.isReady) {
            try {
                await this.redisPub.publish('ws:cluster:broadcast', JSON.stringify({
                    type: 'broadcast_all',
                    data: data,
                    fromInstance: this.instanceId,
                    timestamp: Date.now()
                }));
            } catch (error) {
                logError('Broadcast to all cross-instance failed:', error);
            }
        }
        
        return totalLocal;
    }

    async resetAll(channelId = null) {
        // Local reset
        if (channelId) {
            this.localConnections.delete(channelId);
        } else {
            this.localConnections.clear();
            this.localConfigPanels.clear();
        }
        
        // Cross-instance reset signal
        if (this.redis.isReady) {
            try {
                await this.redisPub.publish('ws:cluster:reset', JSON.stringify({
                    channelId: channelId,
                    fromInstance: this.instanceId,
                    timestamp: Date.now()
                }));
            } catch (error) {
                logError('Reset cross-instance signal failed:', error);
            }
        }
        
        console.log(`🔄 Reset triggered for ${channelId || 'ALL'} on ${this.instanceId}`);
    }

    // ========== PUBLIC API ==========
    
    getStatus() {
        const totalConnections = Array.from(this.localConnections.values())
            .reduce((sum, connections) => sum + connections.size, 0);
            
        return {
            instanceId: this.instanceId,
            totalConnections: totalConnections,
            channels: this.localConnections.size,
            configPanels: this.localConfigPanels.size,
            broadcastQueueSize: this.broadcastQueue.size,
            metrics: { ...this.metrics },
            performance: {
                maxBroadcastsPerSecond: this.maxBroadcastsPerSecond,
                batchBroadcastInterval: this.batchBroadcastInterval,
                maxConnectionsPerChannel: this.maxConnectionsPerChannel
            }
        };
    }

    async getClusterStatus() {
        if (!this.redis.isReady) {
            return { instances: [this.getStatus()] };
        }
        
        try {
            const instanceKeys = await this.redis.keys('ws:instance:*');
            const instances = [];
            
            for (const key of instanceKeys) {
                const data = await this.redis.get(key);
                if (data) {
                    const instanceData = JSON.parse(data);
                    const instanceId = key.replace('ws:instance:', '');
                    instances.push({
                        instanceId: instanceId,
                        ...instanceData,
                        isLocal: instanceId === this.instanceId
                    });
                }
            }
            
            return { instances };
        } catch (error) {
            return { instances: [this.getStatus()], error: error.message };
        }
    }
}

// ========== BROADCAST SYSTEM ==========
class BroadcastManager {
    constructor() {
        this.lastBroadcast = Date.now();
        this.pendingUpdates = new Set();
        this.scheduledBroadcast = null;
        
        console.log(`📡 Broadcast manager initialized (${BROADCAST_INTERVAL}ms intervals)`);
    }

    scheduleUpdate(channelId) {
        this.pendingUpdates.add(channelId);
        
        if (this.scheduledBroadcast) return;
        
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

        for (const channelId of channelsToUpdate) {
            try {
                const data = await getCurrentHeatmapData(channelId);
                
                await redisPub.publish('clickmap:broadcast', JSON.stringify({
                    channelId: channelId,
                    payload: data,
                    fromInstance: INSTANCE_ID,
                    timestamp: Date.now()
                }));
                
                broadcastToChannel(channelId, data);
                
            } catch (error) {
                logError(`Failed to broadcast for channel ${channelId}:`, error);
            }
        }
    }

    async forceImmediateBroadcast(channelId, data) {
        log(`📡 FORCE IMMEDIATE BROADCAST: ${data.action} for ${channelId}`);
        
        try {
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId,
                payload: data,
                fromInstance: INSTANCE_ID,
                timestamp: Date.now(),
                immediate: true,
                action: data.action
            }));
            
            if (channelId === 'all') {
                await broadcastToAll(data);
            } else {
                broadcastToChannel(channelId, data);
            }
            
            broadcastToConfigPanels(data);
            
        } catch (error) {
            logError(`Failed immediate broadcast for ${data.action}:`, error);
        }
    }
}

// ========== CACHED HEATMAP DATA ==========
async function getCurrentHeatmapData(channelId, threshold = 3) {
    // Check cache first
    const cacheKey = `${channelId || 'all'}_${threshold}`;
    const cached = heatmapCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < HEATMAP_CACHE_TTL) {
        return cached.data;
    }

    // Check for sticky reset signal first
    const stickyReset = getStickyResetSignal(channelId);
    if (stickyReset) {
        return {
            ...stickyReset,
            lastUpdate: Date.now(),
            version: gameState._version,
            stickyReset: true
        };
    }

    const running = await gameState.isRunning();
    const lastUpdate = Date.now();

    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = await clickEngine.getAllChannelClicks();
        
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        const data = {
            running: running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: lastUpdate,
            version: gameState._version
        };

        // Cache the result
        heatmapCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    const channelClicks = await clickEngine.getChannelClicks(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        const data = {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: lastUpdate,
            version: gameState._version
        };

        heatmapCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    const points = Array.from(channelClicks.values());
    const clusters = processClicksIntoVisualClusters(points, threshold);

    const data = {
        running: running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: lastUpdate,
        version: gameState._version
    };

    heatmapCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
}

// Clean cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, cached] of heatmapCache.entries()) {
        if (now - cached.timestamp > HEATMAP_CACHE_TTL * 2) {
            heatmapCache.delete(key);
        }
    }
}, HEATMAP_CACHE_TTL);

// ========== INITIALIZE WEBSOCKET MANAGER ==========
const wsManager = new OptimalWebSocketManager(redis, redisPub, redisSub, INSTANCE_ID);
const broadcastManager = new BroadcastManager();

// Replace your existing broadcast functions with these optimal versions
async function broadcastToChannel(channelId, data) {
    return await wsManager.broadcastToChannel(channelId, data);
}

function broadcastToLocalClients(channelId, data) {
    return wsManager.broadcastToChannelLocal(channelId, data);
}

async function broadcastToConfigPanels(data) {
    return await wsManager.broadcastToConfigPanels(data);
}

async function broadcastToAll(data) {
    return await wsManager.broadcastToAll(data);
}

function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        if (data.fromInstance === INSTANCE_ID) return;
        broadcastToLocalClients(data.channelId, data.payload);
    } catch (error) {
        logError('Error handling broadcast message:', error);
    }
}

function handleConfigMessage(message) {
    try {
        const data = JSON.parse(message);
        if (data.fromInstance === INSTANCE_ID) return;
        broadcastToConfigPanels(data.payload);
    } catch (error) {
        logError('Error handling config message:', error);
    }
}

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Id', 'X-State-Version', 'X-Channel-Id'],
    credentials: false
}));

app.use(express.json({ limit: '1mb' })); // Reduced limit
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
    res.set('Cache-Control', 'no-store');
    res.set('X-Instance-Id', INSTANCE_ID);
    next();
});

// ========== EXTREME OPTIMIZED ENDPOINTS ==========

app.get('/health', async (req, res) => {
    const running = await gameState.isRunning();
    const allClicks = await clickEngine.getAllChannelClicks();
    const stats = clickEngine.getPerformanceStats();
    const wsStatus = wsManager.getStatus();
    
    res.json({
        status: 'ok',
        running: running,
        timestamp: Date.now(),
        version: '8.0.0-extreme-50k',
        instanceId: INSTANCE_ID,
        websocket: {
            totalConnections: wsStatus.totalConnections,
            channels: wsStatus.channels,
            configPanels: wsStatus.configPanels
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
            batchSize: BATCH_SIZE,
            heatmapCacheSize: heatmapCache.size,
            cacheHitRatio: '3s TTL'
        },
        load: {
            requestQueue: requestQueue.length,
            activeRequests: activeRequests,
            maxConcurrent: MAX_CONCURRENT_REQUESTS,
            queueSize: REQUEST_QUEUE_SIZE
        }
    });
});

// EXTREME-OPTIMIZED CLICK ENDPOINT with request queuing
app.post('/click', (req, res) => {
    // Use request queue for high load
    queueRequest(req, res, async (req, res) => {
        const start = performance.now();
        const requestId = Math.random().toString(36).substr(2, 9);

        try {
            const running = await gameState.isRunning();
            if (!running) {
                return res.status(400).json({
                    success: false,
                    error: 'Game not running',
                    frozen: true,
                    requestId: requestId
                });
            }

            const token = (req.headers.authorization || '').replace('Bearer ', '');
            if (!token) {
                return res.status(401).json({
                    success: false,
                    error: 'No token provided',
                    requestId: requestId
                });
            }

            const payload = clickEngine.verifyJWTFast(token);
            
            if (!payload) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid token',
                    requestId: requestId
                });
            }

            const { x, y } = req.body;
            const uid = payload.user_id || payload.opaque_user_id;
            const channelId = payload.channel_id;

            if (typeof x !== 'number' || typeof y !== 'number' ||
                isNaN(x) || isNaN(y) ||
                x < 0 || x > 1 || y < 0 || y > 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid coordinates',
                    requestId: requestId
                });
            }

            if (!uid || !channelId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing user or channel ID',
                    requestId: requestId
                });
            }

            // EXTREME: Process with heavy sampling
            const wasProcessed = clickEngine.addClickFast(channelId, uid, x, y, Date.now());
            
            if (wasProcessed) {
                // Schedule broadcast
                broadcastManager.scheduleUpdate(channelId);
            }

            const channelClicks = await clickEngine.getChannelClicks(channelId);
            const processingTime = performance.now() - start;
            
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
            
            res.status(500).json({
                success: false,
                error: 'Server error',
                requestId: requestId,
                processingTime: Math.round(processingTime)
            });
        }
    });
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

app.post('/start', async (req, res) => {
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(true);
        
        // Clear cache on start
        heatmapCache.clear();
        
        const broadcastData = await getCurrentHeatmapData(channelId || 'all');
        broadcastData.running = true;
        broadcastData.action = 'start';
        broadcastData.version = result;
        broadcastData.channelId = channelId || 'all';
        broadcastData.timestamp = Date.now();
        broadcastData.frozen = false;
        broadcastData.unfrozen = true;
        
        broadcastManager.forceImmediateBroadcast(channelId || 'all', broadcastData);
        
        res.json({
            success: true,
            status: 'started',
            running: true,
            unfrozen: true,
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
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(false);
        
        // Clear cache on stop
        heatmapCache.clear();
        
        const currentData = await getCurrentHeatmapData(channelId || 'all');
        currentData.running = false;
        currentData.action = 'stop';
        currentData.version = result;
        currentData.timestamp = Date.now();
        currentData.frozen = true;
        
        broadcastManager.forceImmediateBroadcast(channelId || 'all', currentData);
        
        res.json({
            success: true,
            status: 'stopped',
            running: false,
            frozen: true,
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
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        // EXTREME RESET: Clear everything
        clickEngine.allChannelClicks.clear();
        clickEngine.clickBuffer.clear();
        clickEngine.jwtCache.clear();
        heatmapCache.clear();
        
        // Reset WebSocket connections across all instances
        await wsManager.resetAll(channelId);
        
        if (redis.isReady) {
            try {
                const clickKeys = await redis.keys('clicks:*');
                if (clickKeys.length > 0) {
                    const chunkSize = 1000;
                    for (let i = 0; i < clickKeys.length; i += chunkSize) {
                        const chunk = clickKeys.slice(i, i + chunkSize);
                        await redis.del(chunk);
                    }
                }
            } catch (redisError) {
                logError('Redis reset error:', redisError);
            }
        }
        
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
            allDataCleared: true,
            frozen: false,
            unfrozen: true,
            hardReset: true,
            resetSignalId: Math.random().toString(36).substr(2, 9)
        };
        
        addStickyResetSignal(channelId, broadcastData);
        await broadcastManager.forceImmediateBroadcast(channelId || 'all', broadcastData);
        
        res.json({
            success: true,
            status: 'reset',
            running: running,
            allDataCleared: true,
            unfrozen: true,
            hardReset: true,
            instanceId: INSTANCE_ID,
            resetSignalId: broadcastData.resetSignalId,
            wsReset: true
        });
        
    } catch (error) {
        logError('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data'
        });
    }
});

app.get('/ws-status', async (req, res) => {
    try {
        const status = wsManager.getStatus();
        res.json({
            success: true,
            ...status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/cluster-status', async (req, res) => {
    try {
        const clusterStatus = await wsManager.getClusterStatus();
        res.json({
            success: true,
            ...clusterStatus
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========== WEBSOCKET SERVER ==========
const httpServer = createServer(app);
let wss = null;

// Create WebSocket server with optimal settings
try {
    wss = new WebSocketServer({
        server: httpServer,
        // Remove path restriction to handle dynamic paths like /ws/{channelId}
        perMessageDeflate: false,
        clientTracking: false, // We handle this ourselves
        maxPayload: 16 * 1024 // 16KB max message size
    });
    console.log('✅ WebSocket server created with optimal settings');
} catch (error) {
    logError('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// OPTIMAL WebSocket connection handler
wss.on('connection', async (ws, req) => {
    const startTime = Date.now();
    
    let channelId = null;
    let sessionId = null;
    let isConfigPanel = false;
    let connectionInfo = null;

    // Parse connection type from URL
    if (req.url) {
        const urlPath = req.url.replace('/ws/', '').split('?')[0];
        
        if (urlPath.startsWith('config_')) {
            isConfigPanel = true;
            sessionId = urlPath;
        } else {
            channelId = urlPath;
        }
    }

    try {
        if (isConfigPanel && sessionId) {
            // Register config panel
            connectionInfo = wsManager.registerConfigPanel(sessionId, ws, req);
            
            // Send initial data
            const initialData = await getCurrentHeatmapData('all');
            initialData.type = 'state_update';
            initialData.instanceId = INSTANCE_ID;
            ws.send(JSON.stringify(initialData));
            
        } else if (channelId) {
            // Register regular connection
            connectionInfo = await wsManager.registerConnection(channelId, ws, req);
            
            // Send initial data
            const initialData = await getCurrentHeatmapData(channelId);
            ws.send(JSON.stringify(initialData));
        }
    } catch (error) {
        logError('Error during WebSocket registration:', error);
        ws.close();
        return;
    }

    // Message handling
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'ping':
                    ws.send(JSON.stringify({ 
                        type: 'pong', 
                        instanceId: INSTANCE_ID,
                        timestamp: Date.now()
                    }));
                    if (connectionInfo) {
                        connectionInfo.lastPing = Date.now();
                    }
                    break;
                    
                case 'heartbeat':
                    if (connectionInfo) {
                        connectionInfo.lastPing = Date.now();
                    }
                    break;
            }
        } catch (error) {
            // Ignore malformed messages
        }
    });

    // Connection close handling
    ws.on('close', () => {
        const duration = Date.now() - startTime;
        
        if (isConfigPanel && sessionId) {
            wsManager.unregisterConfigPanel(sessionId);
        } else if (channelId && connectionInfo) {
            wsManager.unregisterConnection(channelId, ws, connectionInfo.connectionId);
        }
    });

    // Error handling
    ws.on('error', (error) => {
        logError(`WebSocket error for ${channelId || sessionId}:`, error);
        
        if (isConfigPanel && sessionId) {
            wsManager.unregisterConfigPanel(sessionId);
        } else if (channelId && connectionInfo) {
            wsManager.unregisterConnection(channelId, ws, connectionInfo.connectionId);
        }
    });
});

// ========== START SERVER ==========
httpServer.listen(PORT, '0.0.0.0', async () => {
    log('🚀 ClickMap EBS v8.0.0 OPTIMAL HIGH-PERFORMANCE: 50,000 CLICKS/SECOND');
    log(`📡 Instance ID: ${INSTANCE_ID}`);
    log(`📡 Port: ${PORT}`);
    log(`💾 Redis connected: ${redis.isReady}`);
    log(`⚡ OPTIMAL Performance: 1-in-${CLICK_SAMPLING_RATE} sampling (2,500 processed/sec)`);
    log(`🔥 Batch size: ${BATCH_SIZE}, Timeout: ${BATCH_TIMEOUT}ms`);
    log(`📦 Request queue: ${REQUEST_QUEUE_SIZE} max, ${MAX_CONCURRENT_REQUESTS} concurrent`);
    log(`💾 Heatmap cache: ${HEATMAP_CACHE_TTL}ms TTL`);
    log(`🧹 Memory limits: ${MAX_MEMORY_CHANNELS} channels, ${clickEngine.maxClicksPerChannel} clicks/channel`);
    log(`🌐 OPTIMAL WebSocket Manager: Cross-instance coordination, batch broadcasting`);
    
    setTimeout(() => {
        const stats = clickEngine.getPerformanceStats();
        const wsStatus = wsManager.getStatus();
        log('🔍 OPTIMAL STATUS:');
        log(`   WebSocket connections: ${wsStatus.totalConnections} across ${wsStatus.channels} channels`);
        log(`   Config panels: ${wsStatus.configPanels}`);
        log(`   JWT cache: ${stats.jwtCacheSize}, Memory channels: ${stats.totalChannels}`);
        log(`   Request queue: ${requestQueue.length}, Active requests: ${activeRequests}`);
        log(`   Heatmap cache: ${heatmapCache.size} entries`);
        log('💥 Ready for 50,000 clicks/second with optimal WebSocket management!');
    }, 1000);
});

export default httpServer;
