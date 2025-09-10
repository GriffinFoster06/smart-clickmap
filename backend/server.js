// backend/server.js - Complete enhanced server with smart bot protection and 2.5x rate limits
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient } from 'redis';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');
const INSTANCE_ID = process.env.RENDER_SERVICE_ID || `local_${Date.now()}`;
const INSTANCE_TTL = 30; // seconds

// Enhanced logging configuration
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = process.env.DEBUG === 'true' || !IS_PRODUCTION;

// Process monitoring variables
let crashCount = 0;
let lastCrashTime = 0;
const MAX_CRASHES_PER_HOUR = 3;

// Logging helpers
function log(message, level = 'info') {
    if (level === 'debug' && !DEBUG_ENABLED) return;
    if (level === 'error' || level === 'warn' || !IS_PRODUCTION) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }
}

function logError(message, error = null) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error || '');
}

// Global variables - declared early
let wss = null;
let httpServer = null;
const connectedClients = new Map(); // channelId → Set of WebSocket connections
const configPanels = new Map(); // sessionId → WebSocket connection

// SMART BOT PROTECTION - High-volume friendly with 2.5x limits
class SmartBotProtection {
    constructor() {
        this.clients = new Map(); // IP → activity data
        this.suspicious = new Set(); // IPs marked as suspicious
        this.blocked = new Set(); // IPs completely blocked
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
    }

    // 2.5x rate limits - designed for viral Twitch extensions
    getLimits(endpoint) {
        const limits = {
            '/click': {
                perSecond: 125,     // 125 clicks per second per IP (7500/minute)
                perMinute: 7500,    // Extremely high for legitimate users
                burst: 250          // Allow bursts of rapid clicking
            },
            '/heatmap': {
                perSecond: 25,      // 25 requests per second  
                perMinute: 1500,    // Very high polling rate
                burst: 50
            },
            '/health': {
                perSecond: 2.5,     // 2.5 per second (round to 3 for burst)
                perMinute: 150,     // Health checks
                burst: 12
            },
            '/start': {
                perSecond: 0.25,    // 1 every 4 seconds
                perMinute: 15,      // Still limited but reasonable
                burst: 5
            },
            '/stop': {
                perSecond: 0.25,    // 1 every 4 seconds  
                perMinute: 15,      // Still limited but reasonable
                burst: 5
            },
            '/reset': {
                perSecond: 0.125,   // 1 every 8 seconds
                perMinute: 8,       // Very limited
                burst: 3
            },
            'default': {
                perSecond: 12.5,    // 12.5 per second for other endpoints
                perMinute: 750,     // 750 per minute
                burst: 25
            }
        };

        return limits[endpoint] || limits['default'];
    }

    // Advanced bot detection - focuses on behavior patterns, not volume
    detectBot(req, clientData) {
        const userAgent = req.headers['user-agent'] || '';
        const referer = req.headers.referer || '';
        const contentType = req.headers['content-type'] || '';

        // Definite bots (block immediately)
        const definiteBot = [
            /curl|wget|python|java|go-http|node-fetch|axios|postman/i,
            /bot|crawler|spider|scraper|scanner|monitor|check|probe/i,
            /apache|nginx|php|perl|ruby|shell/i
        ].some(pattern => pattern.test(userAgent));

        if (definiteBot) {
            return { isBot: true, confidence: 1.0, reason: `Bot user agent: ${userAgent}` };
        }

        // Suspicious patterns (higher scrutiny, but not immediate block)
        let suspicionScore = 0;
        const reasons = [];

        // Missing or suspicious user agent
        if (!userAgent || userAgent.length < 20) {
            suspicionScore += 0.3;
            reasons.push('Short/missing user agent');
        }

        // No referer for non-health endpoints (Twitch extension should have referer)
        if (!referer && req.path !== '/health') {
            suspicionScore += 0.4;
            reasons.push('Missing referer');
        }

        // Wrong referer (should be twitch.tv for extension traffic)
        if (referer && !referer.includes('twitch.tv') && req.path === '/click') {
            suspicionScore += 0.5;
            reasons.push('Non-Twitch referer for click');
        }

        // Missing content-type for POST requests
        if (req.method === 'POST' && !contentType) {
            suspicionScore += 0.3;
            reasons.push('Missing content-type');
        }

        // Behavioral analysis
        if (clientData) {
            const now = Date.now();

            // Perfect timing intervals (bot-like)
            if (clientData.lastRequests && clientData.lastRequests.length >= 3) {
                const intervals = [];
                for (let i = 1; i < clientData.lastRequests.length; i++) {
                    intervals.push(clientData.lastRequests[i] - clientData.lastRequests[i - 1]);
                }

                // Check if intervals are suspiciously consistent
                const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
                const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;

                if (variance < 100 && avgInterval < 1000) { // Very consistent sub-second timing
                    suspicionScore += 0.4;
                    reasons.push('Robot-like timing patterns');
                }
            }

            // Too many requests to control endpoints
            const controlRequests = (clientData.endpointCounts?.['/start'] || 0) +
                (clientData.endpointCounts?.['/stop'] || 0) +
                (clientData.endpointCounts?.['/reset'] || 0);
            if (controlRequests > 25) {
                suspicionScore += 0.6;
                reasons.push('Excessive control endpoint usage');
            }

            // Requests without JWT token to protected endpoints
            if (req.path === '/click' && !req.headers.authorization) {
                suspicionScore += 0.8;
                reasons.push('Click without auth token');
            }
        }

        return {
            isBot: suspicionScore >= 0.7,
            confidence: Math.min(suspicionScore, 1.0),
            reason: reasons.join(', '),
            suspicionScore
        };
    }

    checkRequest(req) {
        const ip = this.getClientIP(req);
        const now = Date.now();
        const endpoint = req.path;

        // Immediately block known bad IPs
        if (this.blocked.has(ip)) {
            return {
                allowed: false,
                reason: 'IP blocked',
                retryAfter: 3600,
                blockType: 'permanent'
            };
        }

        // Get or create client data
        if (!this.clients.has(ip)) {
            this.clients.set(ip, {
                firstSeen: now,
                lastSeen: now,
                requestCount: 0,
                endpointCounts: {},
                lastRequests: [],
                recentRequests: [],
                suspicionLevel: 0,
                violations: 0
            });
        }

        const clientData = this.clients.get(ip);
        clientData.lastSeen = now;
        clientData.requestCount++;

        // Track endpoint usage
        clientData.endpointCounts[endpoint] = (clientData.endpointCounts[endpoint] || 0) + 1;

        // Track recent requests for timing analysis
        clientData.lastRequests.push(now);
        if (clientData.lastRequests.length > 10) {
            clientData.lastRequests.shift();
        }

        // Track requests in current window
        clientData.recentRequests = clientData.recentRequests.filter(time => now - time < 60000);
        clientData.recentRequests.push(now);

        // Bot detection
        const botCheck = this.detectBot(req, clientData);

        if (botCheck.isBot) {
            logError(`🤖 Bot detected: ${ip} - ${botCheck.reason} (confidence: ${botCheck.confidence})`);

            if (botCheck.confidence >= 0.9) {
                this.blocked.add(ip);
                return {
                    allowed: false,
                    reason: 'Bot detected',
                    retryAfter: 3600,
                    blockType: 'bot'
                };
            } else {
                this.suspicious.add(ip);
                clientData.suspicionLevel = Math.max(clientData.suspicionLevel, botCheck.confidence);
            }
        }

        // Rate limiting (very permissive for legitimate traffic)
        const limits = this.getLimits(endpoint);

        // Count requests in last second
        const lastSecond = clientData.recentRequests.filter(time => now - time < 1000).length;

        // Burst protection
        if (lastSecond > limits.burst) {
            clientData.violations++;
            logError(`💨 Burst limit exceeded: ${ip} - ${lastSecond} requests in 1 second to ${endpoint}`);

            // Temporary block for repeated burst violations
            if (clientData.violations > 5) {
                this.suspicious.add(ip);
                return {
                    allowed: false,
                    reason: 'Burst limit exceeded repeatedly',
                    retryAfter: 60,
                    blockType: 'burst'
                };
            }

            return {
                allowed: false,
                reason: 'Burst limit exceeded',
                retryAfter: 5,
                blockType: 'burst'
            };
        }

        // Per-second rate limiting
        if (lastSecond > limits.perSecond) {
            return {
                allowed: false,
                reason: 'Rate limit exceeded',
                retryAfter: 1,
                blockType: 'rate'
            };
        }

        // Per-minute rate limiting
        if (clientData.recentRequests.length > limits.perMinute) {
            clientData.violations++;
            logError(`⏰ Rate limit exceeded: ${ip} - ${clientData.recentRequests.length} requests/minute to ${endpoint}`);

            return {
                allowed: false,
                reason: 'Too many requests per minute',
                retryAfter: 60,
                blockType: 'rate'
            };
        }

        // All good!
        return {
            allowed: true,
            remaining: limits.perMinute - clientData.recentRequests.length,
            suspicionLevel: clientData.suspicionLevel
        };
    }

    getClientIP(req) {
        return req.ip ||
            req.headers['x-forwarded-for']?.split(',')[0] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            'unknown';
    }

    cleanup() {
        const now = Date.now();
        const cutoff = now - 3600000; // 1 hour ago
        let cleaned = 0;

        for (const [ip, data] of this.clients.entries()) {
            if (data.lastSeen < cutoff) {
                this.clients.delete(ip);
                this.suspicious.delete(ip);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            log(`🧹 Cleaned up ${cleaned} old client entries`);
        }
    }

    getStats() {
        const now = Date.now();
        const recentClients = Array.from(this.clients.values()).filter(
            data => now - data.lastSeen < 300000 // 5 minutes
        );

        return {
            totalClients: this.clients.size,
            recentClients: recentClients.length,
            suspiciousIPs: this.suspicious.size,
            blockedIPs: this.blocked.size,
            totalRequests: recentClients.reduce((sum, client) => sum + client.requestCount, 0)
        };
    }

    // Manual IP management
    blockIP(ip, reason = 'Manual block') {
        this.blocked.add(ip);
        logError(`🚫 Manually blocked IP: ${ip} - ${reason}`);
    }

    unblockIP(ip) {
        this.blocked.delete(ip);
        this.suspicious.delete(ip);
        this.clients.delete(ip);
        log(`✅ Unblocked IP: ${ip}`);
    }
}

// Initialize bot protection
const botProtection = new SmartBotProtection();

// Middleware for bot protection
function smartBotProtectionMiddleware(req, res, next) {
    const result = botProtection.checkRequest(req);

    if (!result.allowed) {
        // Set appropriate headers
        res.set({
            'Retry-After': result.retryAfter.toString(),
            'X-RateLimit-Limit': '7500', // Show the generous click limits
            'X-RateLimit-Remaining': '0'
        });

        // Different status codes for different block types
        const statusCode = result.blockType === 'bot' ? 403 : 429;

        return res.status(statusCode).json({
            error: result.blockType === 'bot' ? 'Access denied' : 'Rate limit exceeded',
            reason: result.reason,
            retryAfter: result.retryAfter,
            blockType: result.blockType
        });
    }

    // Add informational headers for monitoring
    res.set({
        'X-RateLimit-Remaining': result.remaining?.toString() || '7500',
        'X-Suspicion-Level': (result.suspicionLevel || 0).toFixed(2)
    });

    next();
}

// Add right after bot protection in server.js
let serverLoad = 0;
let lastLoadCheck = Date.now();

app.use((req, res, next) => {
    const now = Date.now();

    // Update load tracking
    if (now - lastLoadCheck > 1000) {
        serverLoad = Math.max(0, serverLoad - 10); // Decay load
        lastLoadCheck = now;
    }

    serverLoad++;

    // EMERGENCY: Shed load if too high
    if (serverLoad > 1000) { // More than 1000 requests/second
        const shouldShed = Math.random() < 0.8; // Drop 80% of requests

        if (shouldShed) {
            logError(`🚨 LOAD SHEDDING: Dropping request (load: ${serverLoad})`);
            return res.status(503).json({
                error: 'Server overloaded',
                retryAfter: 5
            });
        }
    }

    next();
});



// ENHANCED REDIS SETUP with robust reconnection
const redisConfig = {
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 100, 3000);
            log(`🔄 Redis reconnect attempt ${retries}, delay: ${delay}ms`);
            return delay;
        },
        keepAlive: 30000,
        family: 0
    },
    isolationPoolOptions: {
        min: 2,
        max: 10
    }
};

const redis = createClient(redisConfig);
const redisPub = createClient(redisConfig);
const redisSub = createClient(redisConfig);

// Enhanced Redis error handlers with reconnection logic
redis.on('error', async (err) => {
    logError('Redis Client Error:', err);
    if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
        log('🔄 Attempting Redis main client reconnection...');
        try {
            await redis.disconnect();
            await redis.connect();
        } catch (reconnectErr) {
            logError('Redis main client reconnection failed:', reconnectErr);
        }
    }
});

redis.on('connect', () => log('✅ Redis main client connected'));
redis.on('ready', () => log('🚀 Redis main client ready'));
redis.on('reconnecting', () => log('🔄 Redis main client reconnecting...'));
redis.on('end', () => log('🔌 Redis main client connection ended'));

redisPub.on('error', async (err) => {
    logError('Redis Pub Error:', err);
    if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
        try {
            await redisPub.disconnect();
            await redisPub.connect();
        } catch (reconnectErr) {
            logError('Redis Pub reconnection failed:', reconnectErr);
        }
    }
});

redisSub.on('error', async (err) => {
    logError('Redis Sub Error:', err);
    if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') {
        try {
            await redisSub.unsubscribe();
            await redisSub.disconnect();
            await redisSub.connect();
            await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
            await redisSub.subscribe('clickmap:config', handleConfigMessage);
        } catch (reconnectErr) {
            logError('Redis Sub reconnection failed:', reconnectErr);
        }
    }
});

// Enhanced Redis connection function with retry logic
async function connectRedis() {
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            log(`Attempting Redis connection (attempt ${retryCount + 1}/${maxRetries})...`);

            await Promise.all([
                redis.connect(),
                redisPub.connect(),
                redisSub.connect()
            ]);

            log('✅ All Redis clients connected');

            // Subscribe to broadcast channels
            await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
            await redisSub.subscribe('clickmap:config', handleConfigMessage);
            log('✅ Subscribed to Redis channels');

            return; // Success, exit the retry loop

        } catch (error) {
            retryCount++;
            logError(`❌ Redis connection attempt ${retryCount} failed:`, error);

            if (retryCount < maxRetries) {
                const delay = Math.min(retryCount * 2000, 10000);
                log(`⏳ Retrying Redis connection in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                logError('❌ All Redis connection attempts failed - using in-memory fallback');
                break;
            }
        }
    }
}

await connectRedis();

// Enhanced broadcast message handlers
function handleBroadcastMessage(message) {
    try {
        const data = JSON.parse(message);
        log(`📨 Broadcast from instance ${data.fromInstance}`, 'debug');

        // Don't rebroadcast our own messages
        if (data.fromInstance === INSTANCE_ID) return;

        // Broadcast to local WebSocket clients
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

// ENHANCED GAME STATE with fallback and error handling
const gameState = {
    _memoryState: {}, // Fallback in-memory state

    async setRunning(running) {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const version = Date.now();
            const pipeline = redis.multi();
            pipeline.set('game:running', running.toString());
            pipeline.set('game:lastUpdate', version.toString());
            pipeline.set('game:version', version.toString());
            await pipeline.exec();
            return version;
        } catch (error) {
            logError('Redis setRunning error, using memory fallback:', error);
            this._memoryState.running = running;
            this._memoryState.version = Date.now();
            this._memoryState.lastUpdate = this._memoryState.version;
            return this._memoryState.version;
        }
    },

    async isRunning() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }
            const running = await redis.get('game:running');
            return running === 'true';
        } catch (error) {
            logError('Redis isRunning error, using memory fallback:', error);
            return this._memoryState?.running || false;
        }
    },

    async getVersion() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }
            const version = await redis.get('game:version');
            return version ? parseInt(version) : 0;
        } catch (error) {
            logError('Redis getVersion error, using memory fallback:', error);
            return this._memoryState?.version || 0;
        }
    },

    async getLastUpdate() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }
            const timestamp = await redis.get('game:lastUpdate');
            return timestamp ? parseInt(timestamp) : Date.now();
        } catch (error) {
            logError('Redis getLastUpdate error, using memory fallback:', error);
            return this._memoryState?.lastUpdate || Date.now();
        }
    },

    async compareAndSetRunning(running, expectedVersion) {
        try {
            const currentVersion = await this.getVersion();

            if (expectedVersion && parseInt(expectedVersion) !== currentVersion) {
                return { success: false, conflict: true, currentVersion };
            }

            const newVersion = await this.setRunning(running);
            return { success: true, version: newVersion };
        } catch (error) {
            logError('Redis compareAndSetRunning error:', error);
            throw error;
        }
    },

    async addClick(channelId, userId, x, y) {
        try {
            if (typeof x !== 'number' || typeof y !== 'number' ||
                isNaN(x) || isNaN(y) || x < 0 || x > 1 || y < 0 || y > 1) {
                throw new Error('Invalid coordinates');
            }

            const redisKey = `clicks:${channelId}:${userId}`;

            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            await redis.hSet(redisKey, {
                'x': x.toString(),
                'y': y.toString(),
                'timestamp': Date.now().toString()
            });

            await redis.expire(redisKey, 3600);

        } catch (error) {
            logError('Redis addClick error:', error);
            // Fallback to memory storage
            if (!this._memoryState.clicks) this._memoryState.clicks = new Map();
            const channelClicks = this._memoryState.clicks.get(channelId) || new Map();
            channelClicks.set(userId, { x, y, timestamp: Date.now() });
            this._memoryState.clicks.set(channelId, channelClicks);
        }
    },

    async getChannelClicks(channelId) {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const pattern = `clicks:${channelId}:*`;
            const keys = await redis.keys(pattern);

            if (keys.length === 0) return new Map();

            const clicks = new Map();

            for (const key of keys) {
                try {
                    const userId = key.split(':')[2];
                    const hashData = await redis.hGetAll(key);

                    if (hashData && hashData.x && hashData.y) {
                        clicks.set(userId, {
                            x: parseFloat(hashData.x),
                            y: parseFloat(hashData.y),
                            timestamp: parseInt(hashData.timestamp || Date.now())
                        });
                    }
                } catch (keyError) {
                    await redis.del(key);
                }
            }

            return clicks;
        } catch (error) {
            logError('Redis getChannelClicks error, using memory fallback:', error);
            return this._memoryState?.clicks?.get(channelId) || new Map();
        }
    },

    async getAllChannelClicks() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const pattern = 'clicks:*';
            const keys = await redis.keys(pattern);

            if (keys.length === 0) return new Map();

            const channelGroups = new Map();
            keys.forEach(key => {
                const parts = key.split(':');
                if (parts.length >= 3) {
                    const channelId = parts[1];
                    const userId = parts[2];

                    if (!channelGroups.has(channelId)) {
                        channelGroups.set(channelId, []);
                    }
                    channelGroups.get(channelId).push({ key, userId });
                }
            });

            const allClicks = new Map();

            for (const [channelId, channelKeys] of channelGroups.entries()) {
                const channelClicks = new Map();

                for (const { key, userId } of channelKeys) {
                    try {
                        const hashData = await redis.hGetAll(key);

                        if (hashData && hashData.x && hashData.y) {
                            channelClicks.set(userId, {
                                x: parseFloat(hashData.x),
                                y: parseFloat(hashData.y),
                                timestamp: parseInt(hashData.timestamp || Date.now())
                            });
                        }
                    } catch (keyError) {
                        await redis.del(key);
                    }
                }

                if (channelClicks.size > 0) {
                    allClicks.set(channelId, channelClicks);
                }
            }

            return allClicks;
        } catch (error) {
            logError('Redis getAllChannelClicks error, using memory fallback:', error);
            return this._memoryState?.clicks || new Map();
        }
    },

    async clearAllClicks() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const clickKeys = await redis.keys('clicks:*');
            if (clickKeys.length > 0) {
                await redis.del(clickKeys);
            }
        } catch (error) {
            logError('Redis clearAllClicks error, using memory fallback:', error);
            if (this._memoryState.clicks) {
                this._memoryState.clicks.clear();
            }
        }
    },

    async clearChannelClicks(channelId) {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const clickKeys = await redis.keys(`clicks:${channelId}:*`);
            if (clickKeys.length > 0) {
                await redis.del(clickKeys);
            }
        } catch (error) {
            logError('Redis clearChannelClicks error, using memory fallback:', error);
            if (this._memoryState.clicks) {
                this._memoryState.clicks.delete(channelId);
            }
        }
    },

    async cleanupCorruptedData() {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const clickKeys = await redis.keys('clicks:*');
            let cleaned = 0;

            for (const key of clickKeys) {
                try {
                    const data = await redis.hGetAll(key);
                    if (!data || !data.x || !data.y) {
                        await redis.del(key);
                        cleaned++;
                    }
                } catch (error) {
                    await redis.del(key);
                    cleaned++;
                    log(`Cleaned corrupted key: ${key}`, 'debug');
                }
            }

            if (cleaned > 0) {
                log(`Cleaned up ${cleaned} corrupted click records`);
            }

            return cleaned;
        } catch (error) {
            logError('Failed to cleanup corrupted data:', error);
            return 0;
        }
    },

    async cleanupOldClicks(beforeTimestamp) {
        try {
            if (!redis.isReady) {
                throw new Error('Redis not ready');
            }

            const pattern = 'clicks:*';
            const keys = await redis.keys(pattern);
            let cleaned = 0;

            for (const key of keys) {
                try {
                    const hashData = await redis.hGetAll(key);
                    if (hashData && hashData.timestamp) {
                        const timestamp = parseInt(hashData.timestamp);
                        if (timestamp < beforeTimestamp) {
                            await redis.del(key);
                            cleaned++;
                        }
                    }
                } catch (keyError) {
                    await redis.del(key);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                log(`🧹 Cleaned up ${cleaned} old click records`);
            }

            return cleaned;
        } catch (error) {
            logError('Failed to cleanup old clicks:', error);
            return 0;
        }
    }
};

// Enhanced distributed lock implementation
async function acquireLock(key, ttl = 5000) {
    try {
        if (!redis.isReady) {
            throw new Error('Redis not ready');
        }

        const lockKey = `lock:${key}`;
        const lockValue = `${INSTANCE_ID}_${Date.now()}`;

        const result = await redis.set(lockKey, lockValue, {
            NX: true,
            PX: ttl
        });

        return result === 'OK' ? lockValue : null;
    } catch (error) {
        logError('Failed to acquire lock:', error);
        return null;
    }
}

async function releaseLock(key, lockValue) {
    try {
        if (!redis.isReady) {
            return false;
        }

        const lockKey = `lock:${key}`;
        const currentValue = await redis.get(lockKey);

        if (currentValue === lockValue) {
            await redis.del(lockKey);
            return true;
        }
        return false;
    } catch (error) {
        logError('Failed to release lock:', error);
        return false;
    }
}

// Enhanced instance registration
async function registerInstance() {
    try {
        if (!redis.isReady) {
            throw new Error('Redis not ready');
        }

        const instanceData = {
            id: INSTANCE_ID,
            startTime: Date.now(),
            websocketClients: wss ? wss.clients.size : 0,
            endpoint: process.env.RENDER_SERVICE_URL || `http://localhost:${PORT}`,
            lastHeartbeat: Date.now()
        };

        await redis.setEx(`instance:${INSTANCE_ID}`, INSTANCE_TTL, JSON.stringify(instanceData));
    } catch (error) {
        logError('Failed to register instance:', error);
    }
}

async function getActiveInstances() {
    try {
        if (!redis.isReady) {
            throw new Error('Redis not ready');
        }

        const keys = await redis.keys('instance:*');
        const instances = [];

        for (const key of keys) {
            const data = await redis.get(key);
            if (data) {
                try {
                    instances.push(JSON.parse(data));
                } catch (e) {
                    logError('Failed to parse instance data:', e);
                }
            }
        }

        return instances;
    } catch (error) {
        logError('Failed to get active instances:', error);
        return [];
    }
}

// Performance monitoring
const performanceStats = {
    clickProcessingTimes: [],
    broadcastTimes: [],
    clusterCalculationTimes: [],
    totalRequests: 0,
    startTime: Date.now()
};

// Express app setup
const app = express();

// APPLY BOT PROTECTION FIRST (before CORS)
app.use(smartBotProtectionMiddleware);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Id', 'X-State-Version', 'X-Channel-Id', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, UPGRADE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol');

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
    performanceStats.totalRequests++;
    next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
    log('🏥 Health check called', 'debug');

    const running = await gameState.isRunning();
    const allClicks = await gameState.getAllChannelClicks();

    if (IS_PRODUCTION) {
        res.json({
            status: 'ok',
            running: running,
            timestamp: Date.now(),
            version: '6.0.0-enhanced',
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
            rate_limits: {
                click_per_second: 125,
                click_per_minute: 7500,
                heatmap_per_second: 25,
                heatmap_per_minute: 1500
            }
        });
    } else {
        const uptime = Date.now() - performanceStats.startTime;
        const activeInstances = await getActiveInstances();
        const botStats = botProtection.getStats();

        res.json({
            status: 'ok',
            running: running,
            timestamp: Date.now(),
            version: '6.0.0-enhanced-2.5x-limits',
            instanceId: INSTANCE_ID,
            uptime: Math.floor(uptime / 1000),
            websocket: {
                enabled: !!wss,
                clients: wss ? wss.clients.size : 0,
                configPanels: configPanels.size,
                channels: connectedClients.size
            },
            environment: {
                node_env: process.env.NODE_ENV || 'unknown',
                port: PORT
            },
            redis: {
                connected: redis.isReady,
                pubsubActive: redisSub.isReady && redisPub.isReady
            },
            cluster: {
                totalInstances: activeInstances.length
            },
            game_data: {
                total_channels: allClicks.size,
                total_clicks: Array.from(allClicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0)
            },
            bot_protection: botStats,
            rate_limits: {
                click_per_second: 125,
                click_per_minute: 7500,
                heatmap_per_second: 25,
                heatmap_per_minute: 1500,
                burst_click: 250,
                burst_heatmap: 50
            }
        });
    }
});

// Performance endpoint
app.get('/performance', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(404).json({ error: 'Not available in production' });
    }

    const uptime = Date.now() - performanceStats.startTime;
    const memUsage = process.memoryUsage();

    res.json({
        uptime: Math.floor(uptime / 1000),
        totalRequests: performanceStats.totalRequests,
        requestsPerSecond: Math.round((performanceStats.totalRequests / (uptime / 1000)) * 100) / 100,
        memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024)
        },
        connections: {
            websocket: wss ? wss.clients.size : 0,
            channels: connectedClients.size,
            configPanels: configPanels.size
        }
    });
});

// Bot protection stats (development only)
app.get('/admin/bot-stats', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(404).json({ error: 'Not found' });
    }

    const stats = botProtection.getStats();
    res.json({
        ...stats,
        timestamp: new Date().toISOString(),
        limits: {
            click: { perSecond: 125, perMinute: 7500, burst: 250 },
            heatmap: { perSecond: 25, perMinute: 1500, burst: 50 },
            health: { perSecond: 2.5, perMinute: 150, burst: 12 }
        }
    });
});

// START endpoint
app.post('/start', async (req, res) => {
    log('🚀 START endpoint called');

    const lock = await acquireLock('game:control', 5000);

    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }

    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(true);

        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }

        // INVALIDATE CACHE when game starts
        responseCache.invalidate(channelId);

        log(`✅ Game started (Version: ${result}) - Cache invalidated`);

        const broadcastData = {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start',
            version: result,
            channelId: channelId || 'all'
        };

        if (redisPub.isReady) {
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId || 'all',
                payload: broadcastData,
                fromInstance: INSTANCE_ID
            }));
        }

        broadcastToAll(broadcastData);

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
    } finally {
        await releaseLock('game:control', lock);
    }
});

// Update STOP endpoint to invalidate cache
app.post('/stop', async (req, res) => {
    log('⏹️ STOP endpoint called');

    const lock = await acquireLock('game:control', 5000);

    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }

    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;
        const result = await gameState.setRunning(false);

        // INVALIDATE CACHE when game stops
        responseCache.invalidate(channelId);

        log(`✅ Game stopped (Version: ${result}) - Cache invalidated`);

        const currentData = await getCurrentHeatmapData(channelId || 'all');
        currentData.running = false;
        currentData.action = 'stop';
        currentData.version = result;

        if (redisPub.isReady) {
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId || 'all',
                payload: currentData,
                fromInstance: INSTANCE_ID
            }));
        }

        broadcastToAll(currentData);

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
    } finally {
        await releaseLock('game:control', lock);
    }
});

// Update RESET endpoint to invalidate cache
app.post('/reset', async (req, res) => {
    log('🗑️ RESET endpoint called');

    const lock = await acquireLock('game:control', 5000);

    if (!lock) {
        return res.status(423).json({
            success: false,
            error: 'Another operation in progress'
        });
    }

    try {
        const channelId = req.headers['x-channel-id'] || req.body.channelId;

        if (channelId) {
            await gameState.clearChannelClicks(channelId);
        } else {
            await gameState.clearAllClicks();
        }

        const version = await gameState.getVersion();
        const newVersion = version + 1;
        if (redis.isReady) {
            await redis.set('game:version', newVersion.toString());
        }

        // INVALIDATE CACHE when data is reset
        responseCache.invalidate(channelId);

        log(`✅ Data reset (Version: ${newVersion}) - Cache invalidated`);

        const running = await gameState.isRunning();

        const broadcastData = {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset',
            version: newVersion,
            channelId: channelId || 'all'
        };

        if (redisPub.isReady) {
            await redisPub.publish('clickmap:broadcast', JSON.stringify({
                channelId: channelId || 'all',
                payload: broadcastData,
                fromInstance: INSTANCE_ID
            }));
        }

        broadcastToAll(broadcastData);

        res.json({
            success: true,
            status: 'reset',
            running: running,
            stateVersion: newVersion,
            instanceId: INSTANCE_ID
        });

    } catch (error) {
        logError('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data'
        });
    } finally {
        await releaseLock('game:control', lock);
    }
});

// Add cache stats endpoint for monitoring
app.get('/admin/cache-stats', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(404).json({ error: 'Not found' });
    }

    const stats = responseCache.getStats();
    res.json({
        ...stats,
        timestamp: new Date().toISOString(),
        cache_settings: {
            active_duration_seconds: responseCache.CACHE_DURATION_ACTIVE / 1000,
            inactive_duration_seconds: responseCache.CACHE_DURATION_INACTIVE / 1000
        }
    });
});

// CLICK endpoint with enhanced logging and error handling
app.post('/click', async (req, res) => {
    const startTime = performance.now();
    const requestId = Math.random().toString(36).substr(2, 9);

    console.log(`🎯 CLICK RECEIVED [${requestId}] from ${req.ip || 'unknown'} at ${new Date().toISOString()}`);
    console.log(`📦 CLICK BODY [${requestId}]:`, JSON.stringify(req.body));
    console.log(`🔑 CLICK HEADERS [${requestId}]: Auth=${!!req.headers.authorization}, ContentType=${req.headers['content-type']}`);

    try {
        const running = await gameState.isRunning();
        if (!running) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Game not running`);
            return res.status(400).json({
                success: false,
                error: 'Game not running',
                requestId: requestId
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log(`❌ CLICK REJECTED [${requestId}] - No token provided`);
            return res.status(401).json({
                success: false,
                error: 'No token provided',
                requestId: requestId
            });
        }

        let payload;
        try {
            payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
            console.log(`🔓 JWT VERIFIED [${requestId}] - Role: ${payload.role}, Channel: ${payload.channel_id}, User: ${payload.user_id || payload.opaque_user_id}`);
        } catch (jwtError) {
            console.log(`❌ CLICK REJECTED [${requestId}] - JWT verification failed: ${jwtError.message}`);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                requestId: requestId
            });
        }

        if (payload.exp && payload.exp < Date.now() / 1000) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Token expired`);
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                requestId: requestId
            });
        }

        if (payload.role === 'external') {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid role: ${payload.role}`);
            return res.status(403).json({
                success: false,
                error: 'Invalid role',
                requestId: requestId
            });
        }

        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        console.log(`📍 CLICK DETAILS [${requestId}] Channel: ${channelId}, User: ${uid}, Coords: (${x}, ${y})`);

        if (typeof x !== 'number' || typeof y !== 'number' ||
            isNaN(x) || isNaN(y) ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Invalid coordinates: (${x}, ${y}), types: (${typeof x}, ${typeof y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates - must be numbers between 0 and 1',
                requestId: requestId,
                received: { x, y, types: { x: typeof x, y: typeof y } }
            });
        }

        if (!uid || !channelId) {
            console.log(`❌ CLICK REJECTED [${requestId}] - Missing IDs: uid=${uid}, channelId=${channelId}`);
            return res.status(400).json({
                success: false,
                error: 'Missing user or channel ID',
                requestId: requestId
            });
        }

        console.log(`💾 STORING CLICK [${requestId}] - Channel: ${channelId}, User: ${uid}, Coords: (${x.toFixed(3)}, ${y.toFixed(3)})`);

        try {
            await gameState.addClick(channelId, uid, x, y);
            console.log(`✅ CLICK STORED [${requestId}] - Successfully saved to storage`);
        } catch (storeError) {
            console.log(`❌ CLICK STORAGE FAILED [${requestId}] - ${storeError.message}`);
            throw storeError;
        }

        console.log(`📊 GENERATING HEATMAP [${requestId}] - Getting updated data for channel ${channelId}`);
        const updatedData = await getCurrentHeatmapData(channelId);
        console.log(`📊 HEATMAP DATA [${requestId}] - ${updatedData.clusters?.length || 0} clusters, ${updatedData.totalClicks || 0} total clicks`);

        if (redisPub.isReady) {
            try {
                await redisPub.publish('clickmap:broadcast', JSON.stringify({
                    channelId: channelId,
                    payload: updatedData,
                    fromInstance: INSTANCE_ID
                }));
                console.log(`📡 BROADCAST SENT [${requestId}] - Published to Redis PubSub`);
            } catch (broadcastError) {
                console.log(`⚠️ BROADCAST FAILED [${requestId}] - ${broadcastError.message}`);
            }
        }

        try {
            broadcastToChannel(channelId, updatedData);
            console.log(`📡 LOCAL BROADCAST [${requestId}] - Sent to local WebSocket clients`);
        } catch (localBroadcastError) {
            console.log(`⚠️ LOCAL BROADCAST FAILED [${requestId}] - ${localBroadcastError.message}`);
        }

        if (!IS_PRODUCTION) {
            const totalTime = performance.now() - startTime;
            performanceStats.clickProcessingTimes.push(totalTime);
            performanceStats.totalRequests++;

            if (performanceStats.clickProcessingTimes.length > 100) {
                performanceStats.clickProcessingTimes.shift();
            }
        }

        const channelClicks = await gameState.getChannelClicks(channelId);
        const processingTime = performance.now() - startTime;

        console.log(`✅ CLICK PROCESSED [${requestId}] in ${processingTime.toFixed(1)}ms - Total clicks: ${channelClicks.size}, Clusters: ${updatedData.clusters?.length || 0}`);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: channelClicks.size,
            channelId: channelId,
            instanceId: INSTANCE_ID,
            requestId: requestId,
            processingTime: Math.round(processingTime),
            clusters: updatedData.clusters?.length || 0
        });

    } catch (error) {
        const processingTime = performance.now() - startTime;
        console.log(`❌ CLICK ERROR [${requestId}] after ${processingTime.toFixed(1)}ms: ${error.message}`);
        console.log(`❌ CLICK ERROR STACK [${requestId}]:`, error.stack);

        logError('Click processing failed:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            requestId: requestId,
            processingTime: Math.round(processingTime)
        });
    }
});

// Smart response caching system
class SmartResponseCache {
    constructor() {
        this.cache = new Map(); // channelId -> { data, timestamp, running }
        this.CACHE_DURATION_ACTIVE = 2000;   // 2 seconds when game is running
        this.CACHE_DURATION_INACTIVE = 30000; // 30 seconds when game is stopped

        // Cleanup old cache entries every 5 minutes
        setInterval(() => this.cleanup(), 300000);
    }

    getCacheKey(channelId, threshold) {
        return `${channelId || 'all'}_${threshold}`;
    }

    get(channelId, threshold) {
        const key = this.getCacheKey(channelId, threshold);
        const cached = this.cache.get(key);

        if (!cached) return null;

        const now = Date.now();
        const maxAge = cached.running ? this.CACHE_DURATION_ACTIVE : this.CACHE_DURATION_INACTIVE;

        if (now - cached.timestamp < maxAge) {
            return cached.data;
        }

        // Cache expired
        this.cache.delete(key);
        return null;
    }

    set(channelId, threshold, data) {
        const key = this.getCacheKey(channelId, threshold);
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            running: data.running || false
        });
    }

    invalidate(channelId = null) {
        if (channelId) {
            // Invalidate specific channel
            for (const key of this.cache.keys()) {
                if (key.startsWith(`${channelId}_`)) {
                    this.cache.delete(key);
                }
            }
        } else {
            // Invalidate all
            this.cache.clear();
        }
    }

    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, cached] of this.cache.entries()) {
            const maxAge = cached.running ? this.CACHE_DURATION_ACTIVE : this.CACHE_DURATION_INACTIVE;
            if (now - cached.timestamp > maxAge * 2) { // Keep cache 2x longer than serve time
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            log(`🧹 Cleaned ${cleaned} expired cache entries`);
        }
    }

    getStats() {
        const now = Date.now();
        let activeEntries = 0;
        let inactiveEntries = 0;

        for (const cached of this.cache.values()) {
            if (cached.running) {
                activeEntries++;
            } else {
                inactiveEntries++;
            }
        }

        return {
            totalEntries: this.cache.size,
            activeEntries,
            inactiveEntries
        };
    }
}

// Initialize cache
const responseCache = new SmartResponseCache();

// REPLACE your existing /heatmap endpoint with this cached version:
app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    try {
        // Try cache first
        const cachedData = responseCache.get(channelId, threshold);
        if (cachedData) {
            // Add cache headers to tell browsers they can cache too
            const isRunning = cachedData.running;
            const cacheSeconds = isRunning ? 2 : 30;

            res.set({
                'Cache-Control': `public, max-age=${cacheSeconds}`,
                'X-Cache': 'HIT',
                'X-Game-Running': isRunning.toString()
            });

            log(`💨 Cache HIT for ${channelId || 'all'} (running: ${isRunning})`, 'debug');
            return res.json(cachedData);
        }

        // Cache miss - generate new data
        const data = await getCurrentHeatmapData(channelId, threshold);
        const activeInstances = await getActiveInstances();

        data.instances = activeInstances.length;
        data.instanceId = INSTANCE_ID;

        // Cache the response
        responseCache.set(channelId, threshold, data);

        // Set appropriate cache headers
        const cacheSeconds = data.running ? 2 : 30;
        res.set({
            'Cache-Control': `public, max-age=${cacheSeconds}`,
            'X-Cache': 'MISS',
            'X-Game-Running': data.running.toString()
        });

        log(`🔄 Cache MISS for ${channelId || 'all'} - generated fresh data (running: ${data.running})`, 'debug');
        res.json(data);

    } catch (error) {
        logError('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data'
        });
    }
});

// Cleanup endpoint
app.post('/cleanup', async (req, res) => {
    try {
        const cleaned = await gameState.cleanupCorruptedData();
        res.json({
            success: true,
            cleaned: cleaned,
            message: `Cleaned ${cleaned} corrupted records`
        });
    } catch (error) {
        logError('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Cleanup failed'
        });
    }
});

// Nuclear reset endpoint
app.post('/nuclear-reset', async (req, res) => {
    try {
        if (redis.isReady) {
            const keys = await redis.keys('clicks:*');
            const gameKeys = await redis.keys('game:*');
            const allKeys = [...keys, ...gameKeys];

            if (allKeys.length > 0) {
                await redis.del(allKeys);
            }

            res.json({ success: true, deleted: allKeys.length });
        } else {
            gameState._memoryState = {};
            res.json({ success: true, deleted: 0, message: 'Memory state cleared' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CLUSTERING ALGORITHM ====================
async function getCurrentHeatmapData(channelId, threshold = 3) {
    // EMERGENCY: Skip expensive clustering if under load
    if (serverLoad > 25000) {
        log('🚨 Skipping clustering due to high load');
        const running = await gameState.isRunning();
        return {
            running,
            clusters: [], // Return empty clusters to save CPU
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: Date.now(),
            version: await gameState.getVersion()
        };
    }
    const running = await gameState.isRunning();
    const lastUpdate = await gameState.getLastUpdate();
    const version = await gameState.getVersion();

    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        const allChannelData = await gameState.getAllChannelClicks();
        allChannelData.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        const clusters = processClicksIntoVisualClusters(allPoints, threshold);

        return {
            running: running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: lastUpdate,
            version
        };
    }

    const channelClicks = await gameState.getChannelClicks(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: lastUpdate,
            version
        };
    }

    const points = Array.from(channelClicks.values());
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
        version
    };
}

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
        left: x1 - textWidth1 / 2 - LABEL_PADDING,
        right: x1 + textWidth1 / 2 + LABEL_PADDING,
        top: y1 - textHeight1 / 2 - LABEL_PADDING,
        bottom: y1 + textHeight1 / 2 + LABEL_PADDING
    };

    const box2 = {
        left: x2 - textWidth2 / 2 - LABEL_PADDING,
        right: x2 + textWidth2 / 2 + LABEL_PADDING,
        top: y2 - textHeight2 / 2 - LABEL_PADDING,
        bottom: y2 + textHeight2 / 2 + LABEL_PADDING
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

    return {
        shapeType: 'circle',
        circularity: 0.8,
        eccentricity: 0.2,
        irregularity: 0.1,
        convexity: 0.9,
        preferredSides: 8,
        complexity: 0.3,
        shapeConfidence: 0.9,
        polygonPoints: null
    };
}

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// ==================== WEBSOCKET MANAGEMENT ====================
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
    let failedCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                logError('WebSocket send error:', error);
                clients.delete(ws);
                failedCount++;
            }
        } else {
            clients.delete(ws);
            failedCount++;
        }
    });

    log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters?.length || 0} clusters`, 'debug');
    if (failedCount > 0) {
        log(`⚠️ Cleaned up ${failedCount} stale connections`, 'debug');
    }
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

    let sentCount = 0;

    configPanels.forEach((ws, sessionId) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                logError('Config panel send error:', error);
                configPanels.delete(sessionId);
            }
        } else {
            configPanels.delete(sessionId);
        }
    });

    if (sentCount > 0) {
        log(`📡 Config panel broadcast: ${sentCount} panels`, 'debug');
    }
}

async function broadcastToAll(data) {
    if (!connectedClients) return;

    let totalSent = 0;
    const channelPromises = [];

    connectedClients.forEach((clients, channelId) => {
        const channelPromise = (async () => {
            const channelData = channelId === 'all' ? data : await getCurrentHeatmapData(channelId);
            Object.assign(channelData, { running: data.running, action: data.action });
            broadcastToChannel(channelId, channelData);
            return clients.size;
        })();

        channelPromises.push(channelPromise);
    });

    const results = await Promise.all(channelPromises);
    totalSent = results.reduce((sum, count) => sum + count, 0);

    if (totalSent > 0) {
        log(`📡 Broadcast to all: ${totalSent} clients`, 'debug');
    }
}

// ==================== SERVER SETUP ====================
log('🔧 Creating HTTP server...');
httpServer = createServer(app);

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

// Enhanced WebSocket connection handling with cleanup
wss.on('connection', async (ws, req) => {
    if (wss.clients.size > 25000) {
        log('🚨 Connection limit reached - rejecting new connection');
        ws.close(1013, 'Server overloaded');
        return;
    }
    const connectionId = Math.random().toString(36).substr(2, 9);
    const startTime = Date.now();
    log(`🔗 NEW WEBSOCKET CONNECTION [${connectionId}]: ${req.url}`, 'debug');

    let channelId = null;
    let sessionId = null;
    let isConfigPanel = false;

    // Set connection timeout
    const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            log(`⏰ Connection timeout [${connectionId}]`);
            ws.close(1008, 'Connection timeout');
        }
    }, 300000); // 5 minutes timeout

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
        log(`✅ Config panel connected [${connectionId}]: ${sessionId}`, 'debug');
        clearTimeout(timeout); // Config panels can stay longer

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

        log(`✅ WebSocket connected [${connectionId}]: Channel ${channelId} (${connectedClients.get(channelId).size} clients)`, 'debug');

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

    // Enhanced error handling
    ws.on('error', (error) => {
        logError(`WebSocket error [${connectionId}]:`, error);
        clearTimeout(timeout);

        // Force cleanup
        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
        } else if (channelId && connectedClients.has(channelId)) {
            const clients = connectedClients.get(channelId);
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
    });

    // Enhanced close handler
    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        clearTimeout(timeout);

        if (isConfigPanel && sessionId) {
            configPanels.delete(sessionId);
            log(`🔒 Config panel disconnected [${connectionId}]: ${sessionId} after ${duration}ms (code: ${code})`, 'debug');
        } else if (channelId) {
            const clients = connectedClients.get(channelId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    connectedClients.delete(channelId);
                }
            }
            log(`🔒 WebSocket disconnected [${connectionId}]: ${channelId} after ${duration}ms (code: ${code})`, 'debug');
        }
    });
});

// ==================== MONITORING AND CLEANUP ====================

// Periodic cleanup of stale connections
setInterval(() => {
    let cleanedConnections = 0;

    // Clean up stale client connections
    for (const [channelId, clients] of connectedClients.entries()) {
        const staleClients = [];

        clients.forEach(ws => {
            if (ws.readyState !== WebSocket.OPEN) {
                staleClients.push(ws);
            }
        });

        staleClients.forEach(ws => {
            clients.delete(ws);
            cleanedConnections++;
        });

        if (clients.size === 0) {
            connectedClients.delete(channelId);
        }
    }

    // Clean up stale config panels
    for (const [sessionId, ws] of configPanels.entries()) {
        if (ws.readyState !== WebSocket.OPEN) {
            configPanels.delete(sessionId);
            cleanedConnections++;
        }
    }

    if (cleanedConnections > 0) {
        log(`🧹 Cleaned up ${cleanedConnections} stale WebSocket connections`);
    }
}, 30000); // Every 30 seconds

// Health check for Redis connections
setInterval(async () => {
    try {
        if (!redis.isReady) {
            log('⚠️ Redis main client not ready, attempting reconnection...');
            await redis.connect();
        }

        if (!redisPub.isReady) {
            log('⚠️ Redis Pub client not ready, attempting reconnection...');
            await redisPub.connect();
        }

        if (!redisSub.isReady) {
            log('⚠️ Redis Sub client not ready, attempting reconnection...');
            await redisSub.connect();
            await redisSub.subscribe('clickmap:broadcast', handleBroadcastMessage);
            await redisSub.subscribe('clickmap:config', handleConfigMessage);
        }

        if (redis.isReady) {
            await redis.ping();
        }

    } catch (error) {
        logError('Redis health check failed:', error);
    }
}, 30000); // Every 30 seconds

// Memory and performance monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const totalMB = Math.round(memUsage.rss / 1024 / 1024);

    // Log memory stats every 5 minutes to reduce log spam
    if (Date.now() % 300000 < 60000) {
        log(`💾 Memory: ${memMB}MB heap, ${totalMB}MB total, ${wss ? wss.clients.size : 0} WS clients`);
    }

    // Critical memory warning
    if (memMB > 400) {
        logError(`🚨 CRITICAL MEMORY: ${memMB}MB - forcing cleanup`);

        if (global.gc) {
            global.gc();
            log('🗑️ Forced garbage collection');
        }

        performEmergencyCleanup();
    }
}, 60000); // Every minute

// Emergency cleanup function
async function performEmergencyCleanup() {
    try {
        log('🧹 Performing emergency cleanup...');

        // Clean up old click data (older than 1 hour)
        const oneHourAgo = Date.now() - 3600000;
        await gameState.cleanupOldClicks(oneHourAgo);

        // Force WebSocket cleanup
        if (wss) {
            wss.clients.forEach(ws => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.terminate();
                }
            });
        }

        // Clear Maps of stale entries
        for (const [channelId, clients] of connectedClients.entries()) {
            const validClients = new Set();
            clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    validClients.add(ws);
                }
            });

            if (validClients.size === 0) {
                connectedClients.delete(channelId);
            } else {
                connectedClients.set(channelId, validClients);
            }
        }

        log('✅ Emergency cleanup completed');

    } catch (error) {
        logError('Emergency cleanup failed:', error);
    }
}

// ==================== PROCESS MONITORING ====================

// Enhanced uncaught exception handler
process.on('uncaughtException', (error) => {
    logError('❌ UNCAUGHT EXCEPTION:', error);

    const now = Date.now();
    if (now - lastCrashTime < 3600000) {
        crashCount++;
    } else {
        crashCount = 1;
    }
    lastCrashTime = now;

    if (crashCount >= MAX_CRASHES_PER_HOUR) {
        logError(`🚨 Too many crashes (${crashCount}) in the last hour. Exiting for restart.`);
        process.exit(1);
    }

    setTimeout(() => {
        log('🔄 Attempting recovery from uncaught exception...');
        performEmergencyCleanup();
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('❌ UNHANDLED REJECTION:', reason);
    console.error('Promise:', promise);
});

// Graceful shutdown with timeout
async function gracefulShutdown(signal) {
    log(`📝 Received ${signal}. Starting graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
        logError('❌ Graceful shutdown timeout. Force exiting.');
        process.exit(1);
    }, 15000); // 15 second timeout

    try {
        // Stop accepting new connections
        if (httpServer) {
            httpServer.close();
        }

        // Close WebSocket connections
        if (wss) {
            wss.clients.forEach((ws) => {
                try {
                    ws.close(1001, 'Server shutting down');
                } catch (error) {
                    logError('Error closing WebSocket:', error);
                }
            });
        }

        // Close Redis connections
        try {
            if (redisSub && redisSub.isReady) {
                await redisSub.unsubscribe();
                await redisSub.quit();
            }
            if (redisPub && redisPub.isReady) {
                await redisPub.quit();
            }
            if (redis && redis.isReady) {
                await redis.quit();
            }
            log('✅ Redis connections closed');
        } catch (error) {
            logError('❌ Error closing Redis:', error);
        }

        clearTimeout(shutdownTimeout);
        log('✅ Graceful shutdown completed');
        process.exit(0);

    } catch (error) {
        logError('❌ Error during graceful shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // Render deployment signal

// Periodic health self-check
setInterval(async () => {
    try {
        const testUrl = `http://localhost:${PORT}/health`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(testUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'internal-health-check' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Health check failed: ${response.status}`);
        }

        log('💚 Internal health check passed', 'debug');

    } catch (error) {
        logError('💔 Internal health check failed:', error);

        crashCount++;
        if (crashCount >= 3) {
            logError('🚨 Multiple health check failures. Restarting...');
            process.exit(1);
        }
    }
}, 300000); // Every 5 minutes

// ==================== STARTUP ====================

async function safeRegisterInstance() {
    try {
        await registerInstance();
    } catch (error) {
        logError('Failed to register instance:', error);
    }
}

await safeRegisterInstance();
setInterval(safeRegisterInstance, 20000);

// Start the server
httpServer.listen(PORT, '0.0.0.0', async () => {
    log('🚀 ClickMap EBS v6.0.0-ENHANCED-2.5X-LIMITS PRODUCTION READY');
    log(`📡 Instance ID: ${INSTANCE_ID}`);
    log(`📡 Port: ${PORT}`);
    log(`💾 Redis connected: ${redis.isReady}`);
    log(`📢 PubSub active: ${redisSub.isReady && redisPub.isReady}`);
    log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    log(`📊 Debug logging: ${DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    log(`🛡️ Bot protection: ACTIVE with 2.5x rate limits`);
    log(`🎯 CLICK LIMITS: 125/sec, 7500/min, 250 burst per IP`);
    log(`📊 HEATMAP LIMITS: 25/sec, 1500/min, 50 burst per IP`);

    try {
        const running = await gameState.isRunning();
        const instances = await getActiveInstances();
        log(`📊 Game state: ${running ? 'RUNNING' : 'STOPPED'}`);
        log(`🎯 Cluster: ${instances.length} active instances`);
    } catch (error) {
        logError('❌ Failed to get initial state:', error);
    }

    setTimeout(() => {
        log('🔍 FINAL STATUS:');
        log(`   HTTP server: ${httpServer.listening ? 'LISTENING' : 'NOT LISTENING'}`);
        log(`   WebSocket: ${wss ? 'READY' : 'NOT READY'}`);
        log(`   Channels: ${connectedClients.size}`);
        log(`   Config panels: ${configPanels.size}`);
        log(`   Bot protection: ${botProtection.getStats().blockedIPs} IPs blocked`);
        log('🎊 Enhanced server with 2.5x limits fully operational!');
    }, 1000);
});

export default httpServer;
