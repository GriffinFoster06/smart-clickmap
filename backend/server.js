// backend/server.js - REAL-TIME with click sampling for 500k+ RPS
// Strategy: Sample clicks intelligently, preserve EXACT original clustering

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

// ULTRA-FAST REAL-TIME ENGINE
class UltraRealTimeEngine {
    constructor() {
        // PERFORMANCE: JWT cache to eliminate crypto overhead
        this.jwtCache = new Map();
        this.maxJWTCache = 50000; // Larger cache for high volume
        
        // REAL-TIME: Circular buffer for ultra-fast click sampling
        this.maxClicksPerChannel = 5000; // Keep last 5k clicks per channel
        this.channelClicks = new Map(); // channelId -> CircularClickBuffer
        
        // REAL-TIME: Click sampling for 500k+ RPS
        this.clickSampleRate = 0.1; // Sample 10% of clicks for visuals (drop 90%)
        this.lastClickTime = new Map(); // userId -> timestamp (prevent spam)
        this.minClickInterval = 50; // 50ms minimum between clicks per user
        
        // PERFORMANCE: Request counting
        this.totalRequests = 0;
        this.processedClicks = 0;
        this.droppedClicks = 0;
        
        console.log('🚀 Ultra real-time engine with click sampling initialized');
        console.log(`📊 Sampling rate: ${this.clickSampleRate * 100}% (dropping ${(1-this.clickSampleRate)*100}% for performance)`);
    }

    // ULTRA-FAST: JWT verification with large cache
    verifyJWTUltraFast(token) {
        const cached = this.jwtCache.get(token);
        if (cached && cached.exp > Date.now() / 1000) {
            return cached.payload;
        }

        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            
            // Aggressive cache management for high volume
            if (this.jwtCache.size >= this.maxJWTCache) {
                // Clear oldest 25% of cache
                const keysToDelete = Array.from(this.jwtCache.keys()).slice(0, Math.floor(this.maxJWTCache * 0.25));
                keysToDelete.forEach(key => this.jwtCache.delete(key));
            }
            
            this.jwtCache.set(token, { payload, exp: payload.exp });
            return payload;
        } catch {
            return null;
        }
    }

    // REAL-TIME: Intelligent click sampling for 500k+ RPS
    shouldAcceptClick(userId) {
        this.totalRequests++;
        
        // Anti-spam: Check minimum interval per user
        const now = Date.now();
        const lastClick = this.lastClickTime.get(userId);
        if (lastClick && (now - lastClick) < this.minClickInterval) {
            this.droppedClicks++;
            return false; // Drop spam clicks
        }
        
        // Sample clicks for real-time performance
        if (Math.random() > this.clickSampleRate) {
            this.droppedClicks++;
            return false; // Drop for performance
        }
        
        this.lastClickTime.set(userId, now);
        this.processedClicks++;
        return true;
    }

    // ULTRA-FAST: Add click to circular buffer (preserves original data structure)
    addClickRealTime(channelId, userId, x, y, timestamp) {
        if (!this.channelClicks.has(channelId)) {
            this.channelClicks.set(channelId, new CircularClickBuffer(this.maxClicksPerChannel));
        }
        
        const buffer = this.channelClicks.get(channelId);
        buffer.addClick(userId, x, y, timestamp);
    }

    // PRESERVE: Original method signature - convert circular buffer to Map
    getChannelClicks(channelId) {
        const buffer = this.channelClicks.get(channelId);
        if (!buffer) return new Map();
        
        return buffer.toMap(); // Convert to original Map format
    }

    getAllChannelClicks() {
        const result = new Map();
        for (const [channelId, buffer] of this.channelClicks.entries()) {
            result.set(channelId, buffer.toMap());
        }
        return result;
    }

    clearChannelClicks(channelId) {
        if (channelId) {
            this.channelClicks.delete(channelId);
        } else {
            this.channelClicks.clear();
        }
    }

    getStats() {
        return {
            totalRequests: this.totalRequests,
            processedClicks: this.processedClicks,
            droppedClicks: this.droppedClicks,
            sampleRate: this.clickSampleRate,
            jwtCacheSize: this.jwtCache.size,
            activeChannels: this.channelClicks.size
        };
    }
}

// ULTRA-FAST: Circular buffer for real-time click storage
class CircularClickBuffer {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.clicks = new Array(maxSize);
        this.userIds = new Array(maxSize);
        this.index = 0;
        this.count = 0;
    }
    
    addClick(userId, x, y, timestamp) {
        this.clicks[this.index] = { x, y, timestamp };
        this.userIds[this.index] = userId;
        
        this.index = (this.index + 1) % this.maxSize;
        this.count = Math.min(this.count + 1, this.maxSize);
    }
    
    // PRESERVE: Convert to original Map format for clustering algorithm
    toMap() {
        const result = new Map();
        
        for (let i = 0; i < this.count; i++) {
            const actualIndex = (this.index - this.count + i + this.maxSize) % this.maxSize;
            const userId = this.userIds[actualIndex];
            const click = this.clicks[actualIndex];
            
            if (userId && click) {
                result.set(userId, click);
            }
        }
        
        return result;
    }
}

// ========== PRESERVE: EXACT ORIGINAL CLUSTERING ALGORITHM ==========
// This is the EXACT original algorithm that works perfectly

function processClicksIntoVisualClusters(points, threshold) {
    if (points.length === 0) return [];

    console.log(`🧮 Clustering: ${points.length} points, ${threshold}% threshold`);

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

    // Step 3: Visual merging (EXACT ORIGINAL)
    const visuallyMergedClusters = performVisualMerging(enrichedClusters);

    // Step 4: Normalize percentages (EXACT ORIGINAL)
    const normalizedClusters = normalizePercentages(visuallyMergedClusters, points.length);

    // Step 5: Filter by threshold (EXACT ORIGINAL)
    const filteredClusters = normalizedClusters.filter(c => c.percentage >= threshold);

    // Step 6: Add visual properties (EXACT ORIGINAL)
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

    console.log(`✅ Clustering result: ${rawClusters.length} raw → ${finalClusters.length} final`);

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

    // PRESERVE: Full shape analysis algorithm
    const angles = points.map(p => Math.atan2(p.y - centroidY, p.x - centroidX));
    const distances = points.map(p => Math.sqrt(Math.pow(p.x - centroidX, 2) + Math.pow(p.y - centroidY, 2)));
    
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);
    
    const circularity = minDistance / maxDistance;
    const eccentricity = 1 - circularity;
    
    // Calculate irregularity
    const distanceVariance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
    const irregularity = Math.sqrt(distanceVariance) / avgDistance;
    
    // Determine shape complexity
    const complexity = Math.min(1, irregularity * 2 + eccentricity * 0.5);
    
    // Preferred sides based on complexity
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

// ========== INITIALIZE REAL-TIME ENGINE ==========
const realTimeEngine = new UltraRealTimeEngine();

// ========== PRESERVE: Original getCurrentHeatmapData ==========
async function getCurrentHeatmapData(channelId, threshold = 3) {
    // PRESERVE: Use exact original data flow
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = realTimeEngine.getAllChannelClicks();
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        // PRESERVE: Use EXACT original clustering
        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: Date.now()
        };
    }

    // Handle specific channel
    const channelClicks = realTimeEngine.getChannelClicks(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: Date.now()
        };
    }

    const points = Array.from(channelClicks.values());
    
    // PRESERVE: Use EXACT original clustering algorithm
    const clusters = processClicksIntoVisualClusters(points, threshold);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: Date.now()
    };
}

// ========== SIMPLE GAME STATE ==========
const gameState = {
    running: false,
    
    setRunning(running) {
        this.running = running;
        return Promise.resolve(Date.now());
    },

    isRunning() {
        return Promise.resolve(this.running);
    },

    clearAllClicks() {
        realTimeEngine.clearChannelClicks();
        return Promise.resolve();
    },
    
    clearChannelClicks(channelId) {
        realTimeEngine.clearChannelClicks(channelId);
        return Promise.resolve();
    }
};

// ========== EXPRESS APP ==========
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1kb' })); // Small limit for performance
app.disable('x-powered-by');

// ========== ULTRA-FAST ENDPOINTS ==========

// Health check with performance stats
app.get('/health', async (req, res) => {
    const stats = realTimeEngine.getStats();
    
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '7.0.0-realtime-sampling',
        instanceId: INSTANCE_ID,
        performance: stats
    });
});

// ULTRA-FAST CLICK ENDPOINT - 500k+ RPS with sampling
app.post('/click', async (req, res) => {
    const start = performance.now();
    
    try {
        if (!gameState.running) {
            return res.status(400).json({ success: false, error: 'Game not running' });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, error: 'No token' });
        }

        // ULTRA-FAST: Cached JWT verification
        const payload = realTimeEngine.verifyJWTUltraFast(token);
        if (!payload || payload.role === 'external') {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1 || !uid || !channelId) {
            return res.status(400).json({ success: false, error: 'Invalid data' });
        }

        // REAL-TIME: Intelligent click sampling for 500k+ RPS
        if (!realTimeEngine.shouldAcceptClick(uid)) {
            // Still return success for dropped clicks (user doesn't need to know)
            return res.json({
                success: true,
                status: 'sampled',
                processingTime: Math.round(performance.now() - start)
            });
        }

        // ULTRA-FAST: Add to real-time buffer
        realTimeEngine.addClickRealTime(channelId, uid, x, y, Date.now());

        const processingTime = performance.now() - start;
        
        res.json({
            success: true,
            status: 'processed',
            processingTime: Math.round(processingTime)
        });

    } catch (error) {
        const processingTime = performance.now() - start;
        res.status(500).json({
            success: false,
            error: 'Server error',
            processingTime: Math.round(processingTime)
        });
    }
});

// PRESERVE: Original heatmap endpoint with EXACT clustering
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    try {
        // PRESERVE: Use EXACT original clustering
        const data = await getCurrentHeatmapData(channelId, threshold);
        data.instanceId = INSTANCE_ID;
        res.json(data);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get heatmap data' });
    }
});

// Control endpoints
app.post('/start', async (req, res) => {
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        await gameState.setRunning(true);
        
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        res.json({ success: true, status: 'started', running: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to start' });
    }
});

app.post('/stop', async (req, res) => {
    try {
        await gameState.setRunning(false);
        res.json({ success: true, status: 'stopped', running: false });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to stop' });
    }
});

app.post('/reset', async (req, res) => {
    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        
        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }
        
        res.json({ success: true, status: 'reset' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to reset' });
    }
});

// Performance stats endpoint
app.get('/stats', (req, res) => {
    const stats = realTimeEngine.getStats();
    const uptime = process.uptime();
    
    res.json({
        ...stats,
        uptime: Math.floor(uptime),
        rps: Math.round(stats.totalRequests / uptime),
        efficiency: Math.round((stats.processedClicks / stats.totalRequests) * 100)
    });
});

// ========== START SERVER ==========
const httpServer = createServer(app);

httpServer.listen(PORT, '0.0.0.0', async () => {
    console.log('🚀 ULTRA REAL-TIME ClickMap Server v7.0.0');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🎯 Target: 500,000+ RPS with intelligent sampling`);
    console.log(`🎨 Clustering: EXACT original algorithm preserved`);
    console.log(`📊 Sample rate: ${realTimeEngine.clickSampleRate * 100}%`);
    console.log('🎊 Real-time server ready for extreme load!');
});

export default httpServer;
