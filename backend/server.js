// backend/intelligent-server.js - Smart, efficient, gorgeous
// Uses predictive scaling, intelligent batching, and adaptive optimization

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `intel_${Date.now()}`;

// ========== INTELLIGENT SYSTEM CONFIGURATION ==========
const INTEL_CONFIG = {
    // Predictive scaling - anticipates load changes
    PREDICTION_WINDOW: 30000,          // 30 seconds prediction
    LEARNING_RATE: 0.1,                // How fast to adapt
    TREND_SENSITIVITY: 0.15,           // Trend detection sensitivity
    
    // Smart performance tiers
    PERFORMANCE_TIERS: {
        OPTIMAL: {
            threshold: 800,
            batchSize: [15, 25],       // Dynamic range
            batchTimeout: [100, 200],   // Dynamic range
            memoryTarget: 0.6,
            visualQuality: 1.0,
            features: 'full'
        },
        SMART: {
            threshold: 2500,
            batchSize: [25, 50],
            batchTimeout: [80, 180],
            memoryTarget: 0.7,
            visualQuality: 0.95,
            features: 'enhanced'
        },
        EFFICIENT: {
            threshold: 6000,
            batchSize: [40, 80],
            batchTimeout: [60, 150],
            memoryTarget: 0.75,
            visualQuality: 0.90,
            features: 'optimized'
        },
        ADAPTIVE: {
            threshold: 15000,
            batchSize: [60, 120],
            batchTimeout: [40, 120],
            memoryTarget: 0.80,
            visualQuality: 0.85,
            features: 'essential'
        }
    },
    
    // Intelligent optimizations
    SMART_CLUSTERING: true,            // ML-inspired clustering
    PREDICTIVE_CLEANUP: true,          // Anticipate memory needs
    ADAPTIVE_CACHING: true,            // Smart cache management
    VISUAL_INTELLIGENCE: true,         // Smart visual optimizations
    CONNECTION_POOLING: true,          // Efficient connections
    
    // Advanced features
    HOTSPOT_PREDICTION: true,          // Predict where clicks will happen
    PATTERN_LEARNING: true,            // Learn from click patterns
    SMART_BROADCASTING: true           // Intelligent update timing
};

console.log(`🧠 Intelligent Adaptive ClickMap Server - Instance: ${INSTANCE_ID}`);

// ========== PREDICTIVE PERFORMANCE MONITOR ==========
class PredictivePerformanceMonitor {
    constructor() {
        this.currentTier = 'OPTIMAL';
        this.metrics = {
            cps: 0,
            avgResponseTime: 0,
            memoryUsage: 0,
            predictionAccuracy: 0.8
        };
        
        // Learning system
        this.history = [];
        this.patterns = new Map();
        this.predictions = [];
        this.adaptations = 0;
        
        // Smart state
        this.trendDirection = 'stable';
        this.confidence = 0.8;
        this.nextPrediction = Date.now() + INTEL_CONFIG.PREDICTION_WINDOW;
        
        this.startIntelligentMonitoring();
        console.log('🧠 Predictive monitor with pattern learning initialized');
    }
    
    startIntelligentMonitoring() {
        // High-frequency monitoring for learning
        setInterval(() => {
            this.updateMetrics();
            this.learnPatterns();
            this.makePredictions();
        }, 1000);
        
        // Adaptation decisions
        setInterval(() => {
            this.makeIntelligentAdaptation();
        }, 5000);
    }
    
    updateMetrics() {
        // Memory monitoring
        const memUsage = process.memoryUsage();
        this.metrics.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
        
        // Store metrics with timestamp
        const dataPoint = {
            timestamp: Date.now(),
            cps: this.metrics.cps,
            memory: this.metrics.memoryUsage,
            responseTime: this.metrics.avgResponseTime,
            tier: this.currentTier,
            hour: new Date().getHours(),
            dayOfWeek: new Date().getDay()
        };
        
        this.history.push(dataPoint);
        
        // Keep 10 minutes of detailed history
        const cutoff = Date.now() - 600000;
        this.history = this.history.filter(h => h.timestamp > cutoff);
        
        // Reset per-second counter
        this.metrics.cps = 0;
    }
    
    learnPatterns() {
        if (this.history.length < 20) return;
        
        // Learn daily patterns
        const hourlyPatterns = new Map();
        this.history.forEach(point => {
            const key = `${point.dayOfWeek}_${point.hour}`;
            if (!hourlyPatterns.has(key)) {
                hourlyPatterns.set(key, []);
            }
            hourlyPatterns.get(key).push(point.cps);
        });
        
        // Calculate averages for prediction
        for (const [key, values] of hourlyPatterns.entries()) {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            this.patterns.set(key, avg);
        }
        
        // Learn trend patterns
        this.analyzeTrends();
    }
    
    analyzeTrends() {
        if (this.history.length < 10) return;
        
        const recent = this.history.slice(-10);
        const older = this.history.slice(-20, -10);
        
        const recentAvg = recent.reduce((sum, p) => sum + p.cps, 0) / recent.length;
        const olderAvg = older.length > 0 ? 
            older.reduce((sum, p) => sum + p.cps, 0) / older.length : recentAvg;
        
        const change = (recentAvg - olderAvg) / Math.max(olderAvg, 1);
        
        if (change > INTEL_CONFIG.TREND_SENSITIVITY) {
            this.trendDirection = 'increasing';
            this.confidence = Math.min(1.0, Math.abs(change));
        } else if (change < -INTEL_CONFIG.TREND_SENSITIVITY) {
            this.trendDirection = 'decreasing';
            this.confidence = Math.min(1.0, Math.abs(change));
        } else {
            this.trendDirection = 'stable';
            this.confidence = 0.8;
        }
    }
    
    makePredictions() {
        if (Date.now() < this.nextPrediction) return;
        
        // Predict next 30 seconds of load
        const now = new Date();
        const patternKey = `${now.getDay()}_${now.getHours()}`;
        const historicalAvg = this.patterns.get(patternKey) || 1000;
        
        // Combine historical pattern with current trend
        let prediction = historicalAvg;
        
        if (this.trendDirection === 'increasing') {
            prediction *= (1 + this.confidence * 0.5);
        } else if (this.trendDirection === 'decreasing') {
            prediction *= (1 - this.confidence * 0.3);
        }
        
        // Add some recent context
        if (this.history.length > 0) {
            const recentAvg = this.history.slice(-5).reduce((sum, p) => sum + p.cps, 0) / 5;
            prediction = (prediction * 0.7) + (recentAvg * 0.3);
        }
        
        this.predictions.push({
            timestamp: Date.now(),
            predicted: Math.max(100, Math.round(prediction)),
            confidence: this.confidence,
            basedOn: this.trendDirection
        });
        
        // Keep only recent predictions
        this.predictions = this.predictions.slice(-20);
        this.nextPrediction = Date.now() + INTEL_CONFIG.PREDICTION_WINDOW;
        
        console.log(`🧠 Predicting ${Math.round(prediction)} CPS (${this.confidence.toFixed(2)} confidence, ${this.trendDirection})`);
    }
    
    makeIntelligentAdaptation() {
        const currentCPS = this.getCurrentCPS();
        const predictedCPS = this.getPredictedCPS();
        const memoryPressure = this.metrics.memoryUsage;
        
        // Use both current and predicted load for decisions
        const adaptiveCPS = Math.max(currentCPS, predictedCPS * 0.8); // Be proactive
        
        const oldTier = this.currentTier;
        let newTier = 'OPTIMAL';
        
        // Determine tier with predictive elements
        for (const [tier, config] of Object.entries(INTEL_CONFIG.PERFORMANCE_TIERS)) {
            if (adaptiveCPS >= config.threshold) {
                newTier = tier;
            }
        }
        
        // Memory pressure can escalate tier
        if (memoryPressure > 0.8) {
            newTier = this.escalateTier(newTier);
        }
        
        // Avoid flapping - require sustained change
        if (newTier !== oldTier && this.shouldChangeTier(newTier, adaptiveCPS)) {
            this.currentTier = newTier;
            this.adaptations++;
            
            const predicted = this.getPredictedCPS();
            console.log(`🧠 Intelligent adaptation: ${oldTier} → ${newTier} (current: ${currentCPS}, predicted: ${predicted}, memory: ${(memoryPressure * 100).toFixed(1)}%)`);
        }
    }
    
    shouldChangeTier(newTier, cps) {
        // Smarter tier change logic
        const config = INTEL_CONFIG.PERFORMANCE_TIERS[newTier];
        const currentConfig = INTEL_CONFIG.PERFORMANCE_TIERS[this.currentTier];
        
        // If going up in tier (more intensive), require sustained load
        if (config.threshold > currentConfig.threshold) {
            return cps > config.threshold * 1.2; // 20% buffer
        }
        
        // If going down, be more responsive
        return cps < currentConfig.threshold * 0.7; // 30% buffer
    }
    
    getCurrentCPS() {
        if (this.history.length < 3) return 0;
        const recent = this.history.slice(-3);
        return recent.reduce((sum, p) => sum + p.cps, 0) / recent.length;
    }
    
    getPredictedCPS() {
        if (this.predictions.length === 0) return this.getCurrentCPS();
        const latest = this.predictions[this.predictions.length - 1];
        return latest.predicted;
    }
    
    escalateTier(currentTier) {
        const tiers = ['OPTIMAL', 'SMART', 'EFFICIENT', 'ADAPTIVE'];
        const currentIndex = tiers.indexOf(currentTier);
        return tiers[Math.min(currentIndex + 1, tiers.length - 1)];
    }
    
    recordClick() { this.metrics.cps++; }
    recordResponseTime(time) { 
        this.metrics.avgResponseTime = (this.metrics.avgResponseTime * 0.9) + (time * 0.1);
    }
    
    getCurrentConfig() {
        return INTEL_CONFIG.PERFORMANCE_TIERS[this.currentTier];
    }
    
    getIntelligenceStats() {
        return {
            currentTier: this.currentTier,
            currentCPS: Math.round(this.getCurrentCPS()),
            predictedCPS: Math.round(this.getPredictedCPS()),
            trendDirection: this.trendDirection,
            confidence: Math.round(this.confidence * 100),
            adaptations: this.adaptations,
            patternsLearned: this.patterns.size,
            memoryUsage: Math.round(this.metrics.memoryUsage * 100),
            instanceId: INSTANCE_ID
        };
    }
}

// ========== INTELLIGENT CLICK ENGINE ==========
class IntelligentClickEngine {
    constructor(performanceMonitor) {
        this.monitor = performanceMonitor;
        this.instanceId = INSTANCE_ID;
        
        // Smart data structures
        this.channelData = new Map();
        this.hotspotPredictor = new Map(); // Learn where clicks happen
        this.visualOptimizer = new VisualIntelligence();
        
        // Intelligent caching
        this.jwtCache = new LRUCache(8000);
        this.clusterCache = new LRUCache(1000);
        
        // Smart batching
        this.batchProcessor = new IntelligentBatcher(this);
        
        // Performance stats
        this.stats = {
            processed: 0,
            predicted: 0,
            optimized: 0,
            cacheHits: 0
        };
        
        this.startIntelligentOptimizations();
        console.log('🧠 Intelligent click engine with predictive optimization ready');
    }
    
    startIntelligentOptimizations() {
        // Predictive cleanup
        setInterval(() => {
            this.predictiveCleanup();
        }, 10000);
        
        // Visual optimization
        setInterval(() => {
            this.optimizeVisualProcessing();
        }, 15000);
        
        // Hotspot learning
        setInterval(() => {
            this.updateHotspotPredictions();
        }, 20000);
    }
    
    predictiveCleanup() {
        const predictedMemoryNeed = this.monitor.getPredictedCPS() * 0.1; // Rough estimate
        const currentMemory = this.monitor.metrics.memoryUsage;
        
        if (currentMemory + predictedMemoryNeed > 0.75) {
            console.log('🧠 Predictive cleanup triggered');
            
            // Aggressive cleanup
            const cutoff = Date.now() - 120000; // 2 minutes
            this.cleanupChannelData(cutoff);
            this.jwtCache.clear(0.3); // Clear 30%
            
            if (global.gc) global.gc();
        }
    }
    
    optimizeVisualProcessing() {
        const config = this.monitor.getCurrentConfig();
        
        // Optimize cluster calculations based on tier
        this.visualOptimizer.setQuality(config.visualQuality);
        
        // Pre-calculate common visual elements
        this.visualOptimizer.precomputeVisualElements(this.channelData);
    }
    
    updateHotspotPredictions() {
        // Learn from click patterns to predict future hotspots
        for (const [channelId, data] of this.channelData.entries()) {
            if (data.clusters && data.clusters.length > 0) {
                const prediction = this.calculateHotspotEvolution(data.clusters);
                this.hotspotPredictor.set(channelId, prediction);
            }
        }
        
        console.log(`🧠 Updated hotspot predictions for ${this.hotspotPredictor.size} channels`);
    }
    
    calculateHotspotEvolution(clusters) {
        // Predict how hotspots will evolve
        return clusters.map(cluster => ({
            x: cluster.x,
            y: cluster.y,
            strength: cluster.percentage,
            growthRate: Math.random() * 0.1 - 0.05, // -5% to +5%
            stability: cluster.count > 10 ? 0.8 : 0.4
        }));
    }
    
    // Smart JWT verification with adaptive caching
    verifyJWTIntelligent(token) {
        const cached = this.jwtCache.get(token);
        if (cached) {
            this.stats.cacheHits++;
            return cached;
        }
        
        try {
            const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            this.jwtCache.set(token, payload);
            return payload;
        } catch {
            return null;
        }
    }
    
    addClick(channelId, userId, x, y) {
        const startTime = performance.now();
        this.monitor.recordClick();
        
        // Intelligent processing
        const accepted = this.batchProcessor.addToBatch(channelId, userId, x, y);
        
        // Learn from click patterns
        if (accepted) {
            this.learnClickPattern(channelId, x, y);
        }
        
        this.monitor.recordResponseTime(performance.now() - startTime);
        this.stats.processed++;
        
        return accepted;
    }
    
    learnClickPattern(channelId, x, y) {
        // Simple pattern learning
        if (!this.hotspotPredictor.has(channelId)) return;
        
        const predictions = this.hotspotPredictor.get(channelId);
        for (const prediction of predictions) {
            const distance = Math.sqrt(Math.pow(x - prediction.x, 2) + Math.pow(y - prediction.y, 2));
            if (distance < 0.1) {
                prediction.strength += 0.1; // Reinforce prediction
                this.stats.predicted++;
            }
        }
    }
    
    processChannelBatch(channelId, clicks) {
        if (!this.channelData.has(channelId)) {
            this.channelData.set(channelId, {
                userClicks: new Map(),
                uniqueUsers: new Set(),
                totalClicks: 0,
                lastUpdate: Date.now(),
                clusters: [],
                visualMetadata: {}
            });
        }
        
        const channelData = this.channelData.get(channelId);
        
        // ONE CLICK PER USER with intelligent processing
        for (const click of clicks) {
            channelData.userClicks.set(click.userId, {
                x: click.x,
                y: click.y,
                timestamp: click.timestamp
            });
            channelData.uniqueUsers.add(click.userId);
        }
        
        channelData.totalClicks = channelData.userClicks.size;
        channelData.lastUpdate = Date.now();
        
        // Intelligent clustering
        this.generateIntelligentClusters(channelId, channelData);
    }
    
    generateIntelligentClusters(channelId, channelData) {
        const config = this.monitor.getCurrentConfig();
        const cacheKey = `${channelId}_${channelData.totalClicks}_${config.visualQuality}`;
        
        // Try cache first
        const cached = this.clusterCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5000) {
            channelData.clusters = cached.clusters;
            return;
        }
        
        // Generate new clusters
        const points = Array.from(channelData.userClicks.values());
        const clusters = this.smartClustering(points, config);
        
        // Enhanced visual processing
        const enhancedClusters = this.visualOptimizer.enhanceClusters(clusters, config.visualQuality);
        
        channelData.clusters = enhancedClusters;
        
        // Cache results
        this.clusterCache.set(cacheKey, {
            clusters: enhancedClusters,
            timestamp: Date.now()
        });
        
        this.stats.optimized++;
    }
    
    smartClustering(points, config) {
        if (points.length === 0) return [];
        
        // Adaptive clustering based on performance tier
        const clusterRadius = this.calculateOptimalRadius(points, config);
        const minPoints = Math.max(2, Math.floor(points.length * 0.03));
        
        const clusters = [];
        const visited = new Set();
        
        for (let i = 0; i < points.length; i++) {
            if (visited.has(i)) continue;
            
            const point = points[i];
            const neighbors = this.findSmartNeighbors(point, points, clusterRadius);
            
            if (neighbors.length >= minPoints) {
                const cluster = this.buildSmartCluster(point, neighbors, points);
                clusters.push(cluster);
                neighbors.forEach(idx => visited.add(idx));
            }
        }
        
        return clusters.sort((a, b) => b.count - a.count).slice(0, 15);
    }
    
    calculateOptimalRadius(points, config) {
        // Smart radius based on point density and performance tier
        const density = points.length / 1.0; // Points per screen area
        const baseRadius = 0.08;
        const densityAdjustment = Math.min(0.04, density / 1000);
        const qualityAdjustment = config.visualQuality * 0.02;
        
        return baseRadius + densityAdjustment + qualityAdjustment;
    }
    
    findSmartNeighbors(centerPoint, allPoints, radius) {
        return allPoints
            .map((point, index) => ({ point, index }))
            .filter(({ point }) => {
                const distance = Math.sqrt(
                    Math.pow(centerPoint.x - point.x, 2) + 
                    Math.pow(centerPoint.y - point.y, 2)
                );
                return distance <= radius;
            })
            .map(({ index }) => index);
    }
    
    buildSmartCluster(centerPoint, neighborIndices, allPoints) {
        const clusterPoints = neighborIndices.map(i => allPoints[i]);
        const sumX = clusterPoints.reduce((sum, p) => sum + p.x, 0);
        const sumY = clusterPoints.reduce((sum, p) => sum + p.y, 0);
        
        return {
            x: sumX / clusterPoints.length,
            y: sumY / clusterPoints.length,
            count: clusterPoints.length,
            realPoints: clusterPoints,
            area: this.calculateArea(clusterPoints),
            spread: this.calculateSpread(clusterPoints)
        };
    }
    
    calculateArea(points) {
        if (points.length < 3) return 0.01;
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    }
    
    calculateSpread(points) {
        if (points.length < 2) return 0.02;
        const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        
        return points.reduce((sum, p) => 
            sum + Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2)), 0
        ) / points.length;
    }
    
    cleanupChannelData(cutoff) {
        for (const [channelId, data] of this.channelData.entries()) {
            for (const [userId, click] of data.userClicks.entries()) {
                if (click.timestamp < cutoff) {
                    data.userClicks.delete(userId);
                    data.uniqueUsers.delete(userId);
                }
            }
            
            if (data.userClicks.size === 0) {
                this.channelData.delete(channelId);
            }
        }
    }
    
    getHeatmapData(channelId) {
        const channelData = this.channelData.get(channelId);
        const stats = this.monitor.getIntelligenceStats();
        
        if (!channelData) {
            return {
                clusters: [],
                totalClicks: 0,
                uniqueUsers: 0,
                mode: 'INTELLIGENT',
                tier: stats.currentTier,
                intelligence: stats,
                instanceId: this.instanceId
            };
        }
        
        // Calculate percentages
        const clusters = channelData.clusters.map(cluster => ({
            ...cluster,
            percentage: Math.round((cluster.count / channelData.totalClicks) * 100)
        }));
        
        return {
            clusters: clusters,
            totalClicks: channelData.totalClicks,
            uniqueUsers: channelData.uniqueUsers.size,
            mode: 'INTELLIGENT',
            tier: stats.currentTier,
            intelligence: stats,
            instanceId: this.instanceId,
            timestamp: Date.now()
        };
    }
    
    getStats() {
        return {
            ...this.stats,
            ...this.monitor.getIntelligenceStats(),
            channels: this.channelData.size,
            jwtCacheSize: this.jwtCache.size(),
            clusterCacheSize: this.clusterCache.size(),
            hotspotPredictions: this.hotspotPredictor.size,
            batcherStats: this.batchProcessor.getStats()
        };
    }
    
    clearAll() {
        this.channelData.clear();
        this.hotspotPredictor.clear();
        this.jwtCache.clear();
        this.clusterCache.clear();
        this.batchProcessor.clearAll();
        
        if (global.gc) global.gc();
    }
}

// ========== VISUAL INTELLIGENCE ==========
class VisualIntelligence {
    constructor() {
        this.quality = 1.0;
        this.precomputedElements = new Map();
        
        console.log('🎨 Visual Intelligence system ready');
    }
    
    setQuality(quality) {
        this.quality = quality;
    }
    
    enhanceClusters(clusters, visualQuality) {
        return clusters.map((cluster, i) => ({
            ...cluster,
            
            // Smart visual properties
            complexity: this.calculateSmartComplexity(cluster, visualQuality),
            eccentricity: this.calculateSmartEccentricity(cluster, visualQuality),
            irregularity: this.calculateSmartIrregularity(cluster, visualQuality),
            circularity: this.calculateSmartCircularity(cluster, visualQuality),
            
            // Intelligent shape determination
            shapeType: this.determineIntelligentShape(cluster, visualQuality),
            preferredSides: this.calculateIntelligentSides(cluster),
            visualSize: this.calculateIntelligentSize(cluster),
            
            // Visual metadata
            isTop: i === 0,
            visualPriority: this.calculateVisualPriority(cluster, i),
            renderOptimization: this.calculateRenderOptimization(cluster, visualQuality),
            
            id: `intel_${Date.now()}_${i}`
        }));
    }
    
    calculateSmartComplexity(cluster, quality) {
        const baseComplexity = Math.min(0.6, (cluster.spread || 0.02) * 8);
        const densityFactor = Math.log10((cluster.count || 1) + 1) * 0.1;
        const areaFactor = Math.min(0.3, (cluster.area || 0.01) * 5);
        
        return Math.max(0.1, (baseComplexity + densityFactor + areaFactor) * quality);
    }
    
    calculateSmartEccentricity(cluster, quality) {
        if (!cluster.realPoints || cluster.realPoints.length < 3) return 0.1 * quality;
        
        const points = cluster.realPoints;
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        
        const xRange = Math.max(...xs) - Math.min(...xs);
        const yRange = Math.max(...ys) - Math.min(...ys);
        
        const ratio = Math.min(xRange, yRange) / Math.max(xRange, yRange, 0.001);
        return Math.min(0.5, (1 - ratio) * quality);
    }
    
    calculateSmartIrregularity(cluster, quality) {
        if (!cluster.realPoints || cluster.realPoints.length < 4) return 0.1 * quality;
        
        const points = cluster.realPoints;
        const distances = points.map(p => 
            Math.sqrt(Math.pow(p.x - cluster.x, 2) + Math.pow(p.y - cluster.y, 2))
        );
        
        const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
        const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
        
        return Math.min(0.5, Math.sqrt(variance) * 15 * quality);
    }
    
    calculateSmartCircularity(cluster, quality) {
        const irregularity = this.calculateSmartIrregularity(cluster, quality);
        const eccentricity = this.calculateSmartEccentricity(cluster, quality);
        
        return Math.max(0.4, 1 - (irregularity + eccentricity) * 0.6);
    }
    
    determineIntelligentShape(cluster, quality) {
        const complexity = this.calculateSmartComplexity(cluster, quality);
        const circularity = this.calculateSmartCircularity(cluster, quality);
        const percentage = cluster.percentage || 0;
        
        // Smart shape logic based on multiple factors
        if (quality > 0.8 && (complexity > 0.35 || circularity < 0.7 || percentage > 15)) {
            return 'polygon';
        }
        
        return 'circle';
    }
    
    calculateIntelligentSides(cluster) {
        const complexity = cluster.complexity || 0.2;
        const percentage = cluster.percentage || 5;
        const count = cluster.count || 1;
        
        const baseSides = 6;
        const complexityBonus = Math.floor(complexity * 10);
        const percentageBonus = Math.floor(percentage / 6);
        const countBonus = Math.floor(Math.log10(count + 1));
        
        return Math.max(6, Math.min(18, baseSides + complexityBonus + percentageBonus + countBonus));
    }
    
    calculateIntelligentSize(cluster) {
        const baseSize = 55;
        const percentageBonus = Math.sqrt((cluster.percentage || 5) / 100) * 90;
        const countBonus = Math.log10((cluster.count || 1) + 1) * 20;
        const spreadBonus = (cluster.spread || 0.02) * 150;
        const complexityBonus = (cluster.complexity || 0.2) * 25;
        
        return Math.max(45, Math.min(200, baseSize + percentageBonus + countBonus + spreadBonus + complexityBonus));
    }
    
    calculateVisualPriority(cluster, index) {
        const percentage = cluster.percentage || 0;
        const complexity = cluster.complexity || 0;
        const isTop = index === 0;
        
        return (percentage * 0.4) + (complexity * 30) + (isTop ? 20 : 0);
    }
    
    calculateRenderOptimization(cluster, quality) {
        return {
            useGradients: quality > 0.8,
            useBlur: quality > 0.9,
            useGlow: quality > 0.85 && cluster.percentage > 15,
            animationIntensity: quality,
            lodLevel: quality < 0.7 ? 'low' : quality < 0.9 ? 'medium' : 'high'
        };
    }
    
    precomputeVisualElements(channelData) {
        // Pre-calculate expensive visual elements
        for (const [channelId, data] of channelData.entries()) {
            if (data.clusters && data.clusters.length > 0) {
                const key = `visual_${channelId}_${data.lastUpdate}`;
                this.precomputedElements.set(key, {
                    gradients: this.precomputeGradients(data.clusters),
                    animations: this.precomputeAnimations(data.clusters),
                    timestamp: Date.now()
                });
            }
        }
        
        // Cleanup old precomputed elements
        for (const [key, element] of this.precomputedElements.entries()) {
            if (Date.now() - element.timestamp > 30000) {
                this.precomputedElements.delete(key);
            }
        }
    }
    
    precomputeGradients(clusters) {
        return clusters.map(cluster => ({
            id: cluster.id,
            gradient: `radial-gradient(circle, rgba(147,51,234,${cluster.percentage/100}) 0%, transparent 70%)`,
            shadow: `0 0 ${cluster.visualSize/4}px rgba(147,51,234,0.4)`
        }));
    }
    
    precomputeAnimations(clusters) {
        return clusters.map(cluster => ({
            id: cluster.id,
            pulseSpeed: Math.max(0.5, 2 - (cluster.percentage / 50)),
            rotationSpeed: cluster.shapeType === 'polygon' ? cluster.complexity * 0.5 : 0,
            scaleVariation: Math.min(0.2, cluster.irregularity)
        }));
    }
}

// ========== INTELLIGENT BATCHER ==========
class IntelligentBatcher {
    constructor(clickEngine) {
        this.clickEngine = clickEngine;
        this.batches = new Map(); // channelId -> batch
        this.timers = new Map();
        this.stats = { created: 0, processed: 0, optimized: 0 };
    }
    
    addToBatch(channelId, userId, x, y) {
        const config = this.clickEngine.monitor.getCurrentConfig();
        const dynamicBatchSize = this.calculateDynamicBatchSize(config, channelId);
        
        if (!this.batches.has(channelId)) {
            this.batches.set(channelId, []);
        }
        
        const batch = this.batches.get(channelId);
        batch.push({ userId, x, y, timestamp: Date.now() });
        this.stats.created++;
        
        // Process batch when full or start/update timer
        if (batch.length >= dynamicBatchSize) {
            this.processBatch(channelId);
        } else {
            this.setIntelligentTimer(channelId, config);
        }
        
        return true;
    }
    
    calculateDynamicBatchSize(config, channelId) {
        // Smart batch sizing based on channel activity and performance
        const baseSize = config.batchSize[0];
        const maxSize = config.batchSize[1];
        
        // Adjust based on current load
        const currentCPS = this.clickEngine.monitor.getCurrentCPS();
        const threshold = config.threshold;
        const loadFactor = Math.min(1, currentCPS / threshold);
        
        return Math.floor(baseSize + (maxSize - baseSize) * loadFactor);
    }
    
    setIntelligentTimer(channelId, config) {
        if (this.timers.has(channelId)) {
            return; // Timer already running
        }
        
        const dynamicTimeout = this.calculateDynamicTimeout(config, channelId);
        
        const timer = setTimeout(() => {
            this.processBatch(channelId);
        }, dynamicTimeout);
        
        this.timers.set(channelId, timer);
    }
    
    calculateDynamicTimeout(config, channelId) {
        const baseTimeout = config.batchTimeout[0];
        const maxTimeout = config.batchTimeout[1];
        
        // Faster timeout for higher loads
        const currentCPS = this.clickEngine.monitor.getCurrentCPS();
        const threshold = config.threshold;
        const urgencyFactor = Math.min(1, currentCPS / threshold);
        
        return Math.floor(maxTimeout - (maxTimeout - baseTimeout) * urgencyFactor);
    }
    
    processBatch(channelId) {
        const batch = this.batches.get(channelId);
        if (!batch || batch.length === 0) return;
        
        // Clear batch and timer
        this.batches.set(channelId, []);
        const timer = this.timers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(channelId);
        }
        
        // Process the batch
        this.clickEngine.processChannelBatch(channelId, batch);
        this.stats.processed++;
    }
    
    getStats() {
        return {
            ...this.stats,
            activeBatches: this.batches.size,
            activeTimers: this.timers.size
        };
    }
    
    clearAll() {
        this.batches.clear();
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
}

// ========== LRU CACHE IMPLEMENTATION ==========
class LRUCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    get(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        return null;
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    clear(ratio = 1.0) {
        const keysToRemove = Math.floor(this.cache.size * ratio);
        const keys = Array.from(this.cache.keys()).slice(0, keysToRemove);
        keys.forEach(key => this.cache.delete(key));
    }
    
    size() {
        return this.cache.size;
    }
}

// ========== INITIALIZE INTELLIGENT SYSTEM ==========
const intelligentMonitor = new PredictivePerformanceMonitor();
const intelligentClickEngine = new IntelligentClickEngine(intelligentMonitor);

// ========== REDIS SETUP ==========
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 2000,
        lazyConnect: true,
        reconnectStrategy: (retries) => retries > 5 ? null : Math.min(retries * 200, 2000)
    }
});

redis.on('error', (err) => console.log('Redis error:', err.message));
redis.connect().catch(() => console.log('Redis unavailable - local fallback'));

class IntelligentGameState {
    constructor(redis, instanceId) {
        this.redis = redis;
        this.instanceId = instanceId;
        this.key = 'clickmap:intelligent:gamestate';
        this.commandsChannel = 'clickmap:intelligent:commands';
        this.cachedState = { running: false, version: 0 };
    }
    
    async isRunning() {
        if (this.redis.isReady) {
            try {
                const state = await this.redis.get(this.key);
                if (state) {
                    this.cachedState = JSON.parse(state);
                }
            } catch (error) {
                console.log('State check failed:', error.message);
            }
        }
        return this.cachedState.running;
    }
    
    async start() {
        const version = Date.now();
        const state = { running: true, version, startedBy: this.instanceId, startTime: Date.now() };
        this.cachedState = state;
        
        if (this.redis.isReady) {
            try {
                await this.redis.setex(this.key, 900, JSON.stringify(state));
                await this.redis.publish(this.commandsChannel, JSON.stringify({ action: 'start', ...state }));
                console.log(`🧠 Intelligent game started by ${this.instanceId}`);
            } catch (error) {
                console.log('Redis start failed:', error.message);
            }
        }
        return version;
    }
    
    async stop() {
        const version = Date.now();
        const state = { running: false, version, stoppedBy: this.instanceId, stopTime: Date.now() };
        this.cachedState = state;
        
        if (this.redis.isReady) {
            try {
                await this.redis.setex(this.key, 60, JSON.stringify(state));
                await this.redis.publish(this.commandsChannel, JSON.stringify({ action: 'stop', ...state }));
                console.log(`🧠 Intelligent game stopped by ${this.instanceId}`);
            } catch (error) {
                console.log('Redis stop failed:', error.message);
            }
        }
        return version;
    }
    
    async reset() {
        const version = Date.now();
        if (this.redis.isReady) {
            try {
                await this.redis.publish(this.commandsChannel, JSON.stringify({
                    action: 'reset', version, resetBy: this.instanceId, resetTime: Date.now()
                }));
                console.log(`🧠 Intelligent reset by ${this.instanceId}`);
            } catch (error) {
                console.log('Redis reset failed:', error.message);
            }
        }
        return version;
    }
    
    getState() {
        return { ...this.cachedState, instanceId: this.instanceId };
    }
}

const intelligentGameState = new IntelligentGameState(redis, INSTANCE_ID);

// ========== EXPRESS APP ==========
const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10kb' }));

// Health endpoint with intelligence metrics
app.get('/health', (req, res) => {
    const stats = intelligentClickEngine.getStats();
    const state = intelligentGameState.getState();
    
    res.json({
        status: 'intelligent',
        version: 'intelligent-adaptive-v1.0',
        ...state,
        ...stats,
        timestamp: Date.now(),
        redisConnected: redis.isReady,
        features: ['predictive-scaling', 'pattern-learning', 'visual-intelligence', 'smart-optimization']
    });
});

// Intelligent click endpoint
app.post('/click', async (req, res) => {
    if (!await intelligentGameState.isRunning()) {
        return res.status(400).json({ error: 'Game not running' });
    }
    
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'No token' });
    }
    
    const payload = intelligentClickEngine.verifyJWTIntelligent(token);
    if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }
    
    const accepted = intelligentClickEngine.addClick(
        payload.channel_id,
        payload.user_id || payload.opaque_user_id,
        x, y
    );
    
    const intelligence = intelligentMonitor.getIntelligenceStats();
    
    res.json({
        success: true,
        accepted,
        tier: intelligence.currentTier,
        predicted: intelligence.predictedCPS,
        confidence: intelligence.confidence,
        instanceId: INSTANCE_ID
    });
});

// Heatmap endpoint
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const data = intelligentClickEngine.getHeatmapData(channelId);
    const state = intelligentGameState.getState();
    
    res.json({
        running: state.running,
        ...data,
        version: state.version,
        timestamp: Date.now()
    });
});

// Control endpoints
app.post('/start', async (req, res) => {
    console.log(`🧠 START command on ${INSTANCE_ID}`);
    intelligentClickEngine.clearAll();
    const version = await intelligentGameState.start();
    
    res.json({
        success: true,
        status: 'started',
        version,
        tier: intelligentMonitor.currentTier,
        instanceId: INSTANCE_ID
    });
});

app.post('/stop', async (req, res) => {
    console.log(`🧠 STOP command on ${INSTANCE_ID}`);
    const version = await intelligentGameState.stop();
    intelligentClickEngine.clearAll();
    
    res.json({
        success: true,
        status: 'stopped',
        version,
        instanceId: INSTANCE_ID
    });
});

app.post('/reset', async (req, res) => {
    console.log(`🧠 RESET command on ${INSTANCE_ID}`);
    intelligentClickEngine.clearAll();
    const version = await intelligentGameState.reset();
    
    res.json({
        success: true,
        status: 'reset',
        version,
        instanceId: INSTANCE_ID
    });
});

// Intelligence stats endpoint
app.get('/intelligence', (req, res) => {
    const stats = intelligentClickEngine.getStats();
    res.json(stats);
});

// Add these endpoints to your backend/server.js 
// Insert AFTER the existing endpoints but BEFORE the WebSocket section

// =============================================================================
// LOAD TESTING ENDPOINTS - Add these to your backend/server.js
// =============================================================================

// Test click endpoint for high-performance load testing (bypasses Twitch auth)
app.post('/test-click', async (req, res) => {
    console.log(`🧪 Load test click received`);
    
    if (!await intelligentGameState.isRunning()) {
        return res.status(400).json({ 
            error: 'Game not running - start session first',
            hint: 'Use POST /start to begin session'
        });
    }
    
    const { x = Math.random(), y = Math.random(), channelId = 'load-test-channel', userId } = req.body;
    
    // Validate coordinates
    if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ error: 'Invalid coordinates (must be 0-1 range)' });
    }
    
    // Generate unique user ID for load testing
    const testUserId = userId || `load-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Add the click using the intelligent engine
    const accepted = intelligentClickEngine.addClick(
        channelId,
        testUserId,
        x, y
    );
    
    const intelligence = intelligentMonitor.getIntelligenceStats();
    
    res.json({
        success: true,
        accepted,
        tier: intelligence.currentTier,
        predicted: intelligence.predictedCPS,
        confidence: intelligence.confidence,
        instanceId: INSTANCE_ID,
        testMode: true,
        coordinates: { x, y },
        userId: testUserId
    });
});

// Batch test clicks endpoint for ultra-high performance testing
app.post('/test-batch-clicks', async (req, res) => {
    console.log(`🧪 Batch test clicks received`);
    
    if (!await intelligentGameState.isRunning()) {
        return res.status(400).json({ 
            error: 'Game not running - start session first'
        });
    }
    
    const { clicks = [], channelId = 'load-test-channel' } = req.body;
    
    if (!Array.isArray(clicks) || clicks.length === 0) {
        return res.status(400).json({ error: 'No clicks provided' });
    }
    
    if (clicks.length > 1000) {
        return res.status(400).json({ error: 'Too many clicks in batch (max 1000)' });
    }
    
    let processed = 0;
    let accepted = 0;
    
    for (const click of clicks) {
        const { x = Math.random(), y = Math.random(), userId } = click;
        
        // Validate coordinates
        if (typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            const testUserId = userId || `batch-test-${Date.now()}-${processed}`;
            const clickAccepted = intelligentClickEngine.addClick(channelId, testUserId, x, y);
            if (clickAccepted) accepted++;
            processed++;
        }
    }
    
    const intelligence = intelligentMonitor.getIntelligenceStats();
    
    res.json({
        success: true,
        processed,
        accepted,
        tier: intelligence.currentTier,
        predicted: intelligence.predictedCPS,
        confidence: intelligence.confidence,
        instanceId: INSTANCE_ID,
        batchMode: true
    });
});

// Load test statistics endpoint
app.get('/test-stats', (req, res) => {
    const stats = intelligentClickEngine.getStats();
    const gameState = intelligentGameState.getState();
    const intelligence = intelligentMonitor.getIntelligenceStats();
    
    res.json({
        // Core stats
        ...stats,
        gameState,
        intelligence,
        
        // Load test specific
        testMode: true,
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        },
        
        // Performance metrics
        performance: {
            tier: intelligence.currentTier,
            currentCPS: intelligence.currentCPS,
            predictedCPS: intelligence.predictedCPS,
            trendDirection: intelligence.trendDirection,
            confidence: intelligence.confidence,
            adaptations: intelligence.adaptations
        }
    });
});

// Test session quick-start endpoint
app.post('/test-quickstart', async (req, res) => {
    console.log('🚀 Quick-starting test session...');
    
    try {
        // Reset data first
        intelligentClickEngine.clearAll();
        
        // Start session
        const version = await intelligentGameState.start();
        
        res.json({
            success: true,
            message: 'Test session ready for load testing',
            version,
            tier: intelligentMonitor.currentTier,
            instanceId: INSTANCE_ID,
            endpoints: {
                singleClick: '/test-click',
                batchClick: '/test-batch-clicks',
                stats: '/test-stats',
                heatmap: '/heatmap',
                stop: '/stop',
                reset: '/reset'
            }
        });
        
        console.log('✅ Test session quick-started successfully');
        
    } catch (error) {
        console.error('❌ Quick-start failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to quick-start session',
            message: error.message
        });
    }
});

// Health check with load test info
app.get('/test-health', (req, res) => {
    const stats = intelligentClickEngine.getStats();
    const state = intelligentGameState.getState();
    const intelligence = intelligentMonitor.getIntelligenceStats();
    
    res.json({
        status: 'healthy',
        testMode: true,
        version: 'load-test-enabled-v1.0',
        ...state,
        ...intelligence,
        endpoints: ['/test-click', '/test-batch-clicks', '/test-stats', '/test-quickstart'],
        timestamp: Date.now(),
        redisConnected: redis.isReady,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        uptime: `${Math.round(process.uptime())}s`
    });
});

// ========== WEBSOCKET ==========
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws', perMessageDeflate: false });
const wsClients = new Map();

// Intelligent broadcasting
function intelligentBroadcast() {
    const config = intelligentMonitor.getCurrentConfig();
    
    // Smart broadcast timing based on tier
    let interval;
    switch (intelligentMonitor.currentTier) {
        case 'OPTIMAL': interval = 1000; break;
        case 'SMART': interval = 1200; break;
        case 'EFFICIENT': interval = 1500; break;
        case 'ADAPTIVE': interval = 2000; break;
    }
    
    setTimeout(() => {
        for (const [channelId, clients] of wsClients.entries()) {
            if (clients.size === 0) continue;
            
            const data = intelligentClickEngine.getHeatmapData(channelId);
            const state = intelligentGameState.getState();
            
            const message = JSON.stringify({
                running: state.running,
                ...data,
                version: state.version,
                timestamp: Date.now()
            });
            
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(message); } catch {}
                }
            });
        }
        
        intelligentBroadcast();
    }, interval);
}

intelligentBroadcast();

// WebSocket handling
wss.on('connection', async (ws, req) => {
    const channelId = req.url?.replace('/ws/', '').split('?')[0] || 'global';
    
    if (!wsClients.has(channelId)) {
        wsClients.set(channelId, new Set());
    }
    wsClients.get(channelId).add(ws);
    
    // Send initial intelligent state
    const data = intelligentClickEngine.getHeatmapData(channelId);
    const state = intelligentGameState.getState();
    
    ws.send(JSON.stringify({
        running: state.running,
        ...data,
        version: state.version,
        timestamp: Date.now()
    }));
    
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

// ========== START INTELLIGENT SERVER ==========
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🧠 INTELLIGENT Adaptive ClickMap Server');
    console.log(`🤖 Instance: ${INSTANCE_ID}`);
    console.log(`⚡ Port: ${PORT}`);
    console.log('✨ Intelligence Features:');
    console.log('  • Predictive load scaling (30s prediction window)');
    console.log('  • Pattern learning and hotspot prediction');
    console.log('  • Visual intelligence optimization');
    console.log('  • Smart batching and caching');
    console.log('  • Adaptive performance tiers');
    console.log('  • Gorgeous visual preservation');
    console.log(`🧠 Starting at ${intelligentMonitor.currentTier} tier with ${Math.round(intelligentMonitor.confidence * 100)}% confidence`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log(`🧠 Shutting down intelligent instance ${INSTANCE_ID}...`);
    
    if (redis.isReady) {
        redis.disconnect();
    }
    
    httpServer.close(() => {
        process.exit(0);
    });
});

export default httpServer;
