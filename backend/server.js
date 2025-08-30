import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Redis from 'redis';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// GLOBAL SESSION STATE - SINGLE SOURCE OF TRUTH
let GLOBAL_SESSION_STATE = {
    isRunning: false,
    startedAt: null,
    stoppedAt: null,
    totalClicks: 0,
    lastActivity: null
};

const useRedis = !!process.env.REDIS_URL;
let clicks;
let redis;
if (useRedis) {
    redis = Redis.createClient({ url: process.env.REDIS_URL });
    await redis.connect();
} else {
    clicks = new Map(); // channelId → Map(userId → { x, y, timestamp })
}

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// COMPREHENSIVE REQUEST LOGGING
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n📝 [${timestamp}] ${req.method} ${req.url}`);
    console.log(`📝 Session State: ${GLOBAL_SESSION_STATE.isRunning ? 'RUNNING' : 'STOPPED'}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('📝 Body:', req.body);
    }
    next();
});

// ========================================
// CLUSTERING ALGORITHM (UNCHANGED)
// ========================================
class DensityClusterer {
    constructor(points) {
        this.points = points.map((p, i) => ({ ...p, id: i, visited: false, cluster: -1 }));
    }

    calculateOptimalEps() {
        const n = this.points.length;
        if (n < 4) return 0.05;
        const k = Math.max(3, Math.min(10, Math.floor(n * 0.08)));
        const distances = [];
        this.points.forEach(point => {
            const dists = this.points
                .filter(p => p.id !== point.id)
                .map(p => this.distance(point, p))
                .sort((a, b) => a - b)
                .slice(0, k);
            distances.push(dists[dists.length - 1]);
        });
        distances.sort((a, b) => a - b);
        let maxChange = 0;
        let optimalEps = distances[Math.floor(distances.length * 0.75)];
        for (let i = 1; i < distances.length - 1; i++) {
            const change = distances[i + 1] - distances[i - 1];
            if (change > maxChange) {
                maxChange = change;
                optimalEps = distances[i];
            }
        }
        return Math.max(0.03, Math.min(0.12, optimalEps));
    }

    distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getNeighbors(point, eps) {
        return this.points.filter(p =>
            p.id !== point.id && this.distance(point, p) <= eps
        );
    }

    cluster() {
        if (this.points.length === 0) return [];
        const eps = this.calculateOptimalEps();
        const minPts = Math.max(2, Math.floor(this.points.length * 0.04));
        let clusterId = 0;
        this.points.forEach(point => {
            if (point.visited) return;
            point.visited = true;
            const neighbors = this.getNeighbors(point, eps);
            if (neighbors.length < minPts) {
                point.cluster = -1;
            } else {
                this.expandCluster(point, neighbors, clusterId, eps, minPts);
                clusterId++;
            }
        });
        const clusterMap = new Map();
        this.points.forEach(point => {
            if (point.cluster >= 0) {
                if (!clusterMap.has(point.cluster)) {
                    clusterMap.set(point.cluster, []);
                }
                clusterMap.get(point.cluster).push(point);
            }
        });
        const result = [];
        clusterMap.forEach(clusterPoints => {
            const totalWeight = clusterPoints.length;
            const centroid = {
                x: clusterPoints.reduce((sum, p) => sum + p.x, 0) / totalWeight,
                y: clusterPoints.reduce((sum, p) => sum + p.y, 0) / totalWeight,
                count: totalWeight,
                density: totalWeight / (Math.PI * eps * eps),
                radius: eps,
                points: clusterPoints
            };
            result.push(centroid);
        });
        if (this.points.length <= 20) {
            const noise = this.points.filter(p => p.cluster === -1);
            noise.forEach(point => {
                result.push({
                    x: point.x, y: point.y, count: 1, density: 1,
                    radius: eps * 0.6, points: [point]
                });
            });
        }
        return result.sort((a, b) => b.count - a.count);
    }

    expandCluster(point, neighbors, clusterId, eps, minPts) {
        point.cluster = clusterId;
        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (!neighbor.visited) {
                neighbor.visited = true;
                const newNeighbors = this.getNeighbors(neighbor, eps);
                if (newNeighbors.length >= minPts) {
                    neighbors.push(...newNeighbors.filter(n =>
                        !neighbors.some(existing => existing.id === n.id)
                    ));
                }
            }
            if (neighbor.cluster === -1 || neighbor.cluster === undefined) {
                neighbor.cluster = clusterId;
            }
        }
    }
}

// ========================================
// WEBSOCKET BROADCASTING
// ========================================
function broadcastToAllClients(data) {
    console.log(`📡 Broadcasting to all channels...`);
    let totalSent = 0;
    let totalErrors = 0;

    connectedClients.forEach((clients, channelId) => {
        clients.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.send(JSON.stringify(data));
                    totalSent++;
                } catch (error) {
                    console.error(`📡 WebSocket send error for channel ${channelId}:`, error);
                    clients.delete(ws);
                    totalErrors++;
                }
            } else {
                clients.delete(ws);
                totalErrors++;
            }
        });
    });

    console.log(`📡 Broadcast complete: ${totalSent} sent, ${totalErrors} errors`);
}

function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) {
        console.log(`📡 No clients for channel: ${channelId}`);
        return;
    }

    const message = JSON.stringify(data);
    let successCount = 0;
    let errorCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            try {
                ws.send(message);
                successCount++;
            } catch (error) {
                console.error(`📡 Send error:`, error);
                clients.delete(ws);
                errorCount++;
            }
        } else {
            clients.delete(ws);
            errorCount++;
        }
    });

    console.log(`📡 Channel ${channelId}: ${successCount} sent, ${errorCount} errors`);
}

// ========================================
// SESSION MANAGEMENT
// ========================================
app.post('/start', async (req, res) => {
    console.log('\n🚀 START SESSION REQUEST');

    try {
        // CLEAR ALL DATA
        if (useRedis) {
            const keys = await redis.keys('click:*');
            if (keys.length > 0) {
                await redis.del(keys);
                console.log(`🧹 Cleared ${keys.length} Redis keys`);
            }
        } else {
            clicks.clear();
            console.log('🧹 Cleared in-memory clicks');
        }

        // UPDATE GLOBAL STATE
        GLOBAL_SESSION_STATE = {
            isRunning: true,
            startedAt: Date.now(),
            stoppedAt: null,
            totalClicks: 0,
            lastActivity: Date.now()
        };

        console.log('🚀 SESSION STARTED - Global State:', GLOBAL_SESSION_STATE);

        // BROADCAST TO ALL CLIENTS
        const broadcastData = {
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: 3,
            sessionState: GLOBAL_SESSION_STATE
        };

        broadcastToAllClients(broadcastData);

        res.json({
            status: 'started',
            running: true,
            sessionState: GLOBAL_SESSION_STATE
        });

    } catch (error) {
        console.error('❌ Start session error:', error);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

app.post('/stop', async (req, res) => {
    console.log('\n🛑 STOP SESSION REQUEST');

    try {
        // UPDATE GLOBAL STATE FIRST
        GLOBAL_SESSION_STATE.isRunning = false;
        GLOBAL_SESSION_STATE.stoppedAt = Date.now();

        console.log('🛑 SESSION STOPPED - Global State:', GLOBAL_SESSION_STATE);

        // GET FINAL STATE FOR ALL CHANNELS
        const channelIds = Array.from(connectedClients.keys());

        for (const channelId of channelIds) {
            try {
                const data = await getHeatmapData(channelId, 3);
                data.running = false;
                data.sessionState = GLOBAL_SESSION_STATE;
                broadcastToChannel(channelId, data);
            } catch (error) {
                console.error(`❌ Error broadcasting stop to ${channelId}:`, error);
            }
        }

        res.json({
            status: 'stopped',
            running: false,
            sessionState: GLOBAL_SESSION_STATE
        });

    } catch (error) {
        console.error('❌ Stop session error:', error);
        res.status(500).json({ error: 'Failed to stop session' });
    }
});

app.post('/reset', async (req, res) => {
    console.log('\n🧹 RESET SESSION REQUEST');

    try {
        // CLEAR DATA
        if (useRedis) {
            const keys = await redis.keys('click:*');
            if (keys.length > 0) {
                await redis.del(keys);
                console.log(`🧹 Cleared ${keys.length} Redis keys`);
            }
        } else {
            clicks.clear();
            console.log('🧹 Cleared in-memory clicks');
        }

        // RESET COUNTERS BUT KEEP RUNNING STATE
        GLOBAL_SESSION_STATE.totalClicks = 0;
        GLOBAL_SESSION_STATE.lastActivity = Date.now();

        console.log('🧹 DATA RESET - Global State:', GLOBAL_SESSION_STATE);

        // BROADCAST TO ALL CLIENTS
        const broadcastData = {
            running: GLOBAL_SESSION_STATE.isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: 3,
            sessionState: GLOBAL_SESSION_STATE
        };

        broadcastToAllClients(broadcastData);

        res.json({
            status: 'reset',
            sessionState: GLOBAL_SESSION_STATE
        });

    } catch (error) {
        console.error('❌ Reset session error:', error);
        res.status(500).json({ error: 'Failed to reset session' });
    }
});

// ========================================
// CLICK HANDLING - BULLETPROOF
// ========================================
app.post('/click', async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`\n👆 [${timestamp}] CLICK REQUEST`);
    console.log(`👆 Global Session Running: ${GLOBAL_SESSION_STATE.isRunning}`);

    // IMMEDIATE REJECTION IF NOT RUNNING
    if (!GLOBAL_SESSION_STATE.isRunning) {
        console.log('🚫 CLICK REJECTED - SESSION NOT RUNNING');
        return res.status(403).json({
            error: 'session_not_running',
            sessionState: GLOBAL_SESSION_STATE
        });
    }

    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log('🚫 CLICK REJECTED - INVALID COORDINATES');
            return res.status(400).json({ error: 'invalid_coordinates' });
        }

        console.log(`👆 Processing click for channel ${channelId}, user ${uid}`);

        const clickData = { x, y, timestamp: Date.now() };

        // SAVE CLICK
        if (useRedis) {
            await redis.hSet(`click:${channelId}:${uid}`, clickData);
        } else {
            if (!clicks.has(channelId)) {
                clicks.set(channelId, new Map());
            }
            clicks.get(channelId).set(uid, clickData);
        }

        // UPDATE GLOBAL STATE
        GLOBAL_SESSION_STATE.totalClicks++;
        GLOBAL_SESSION_STATE.lastActivity = Date.now();

        // BROADCAST UPDATE
        const updatedData = await getHeatmapData(channelId, 3);
        broadcastToChannel(channelId, updatedData);

        console.log(`✅ CLICK PROCESSED - Total clicks: ${GLOBAL_SESSION_STATE.totalClicks}`);
        return res.sendStatus(200);

    } catch (e) {
        console.error('❌ Click processing error:', e);
        return res.status(401).json({ error: 'invalid_token' });
    }
});

// ========================================
// DATA RETRIEVAL
// ========================================
async function getHeatmapData(channelId, requestedThreshold = 3) {
    let points = [];
    let userCount = 0;

    if (useRedis) {
        const keys = await redis.keys(`click:${channelId}:*`);
        userCount = keys.length;
        for (const k of keys) {
            const data = await redis.hGetAll(k);
            if (data.x && data.y) {
                points.push({
                    x: parseFloat(data.x),
                    y: parseFloat(data.y),
                    timestamp: parseInt(data.timestamp) || Date.now()
                });
            }
        }
    } else {
        const channelClicks = clicks.get(channelId);
        if (channelClicks) {
            userCount = channelClicks.size;
            points = Array.from(channelClicks.values());
        }
    }

    if (points.length === 0) {
        return {
            running: GLOBAL_SESSION_STATE.isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: requestedThreshold,
            sessionState: GLOBAL_SESSION_STATE
        };
    }

    const clusterer = new DensityClusterer(points);
    const rawClusters = clusterer.cluster();

    const formattedClusters = rawClusters
        .map((cluster, index) => ({
            id: index,
            x: cluster.x,
            y: cluster.y,
            count: cluster.count,
            percentage: Math.round((cluster.count / points.length) * 100),
            density: cluster.density,
            radius: cluster.radius,
            isTop: false
        }))
        .filter(cluster => cluster.percentage >= requestedThreshold)
        .sort((a, b) => b.percentage - a.percentage);

    if (formattedClusters.length > 0) {
        formattedClusters[0].isTop = true;
    }

    const coverage = Math.min(100, Math.round((formattedClusters.length / Math.max(1, points.length * 0.1)) * 100));

    return {
        running: GLOBAL_SESSION_STATE.isRunning,
        clusters: formattedClusters,
        totalClicks: points.length,
        uniqueUsers: userCount,
        coverage,
        threshold: requestedThreshold,
        sessionState: GLOBAL_SESSION_STATE
    };
}

app.get('/heatmap', async (req, res) => {
    const channelId = req.query.channel;
    const requestedThreshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 Heatmap request for channel: ${channelId || 'ALL'}`);
    console.log(`📊 Session running: ${GLOBAL_SESSION_STATE.isRunning}`);

    if (!channelId) {
        return res.json({
            running: GLOBAL_SESSION_STATE.isRunning,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold: requestedThreshold,
            sessionState: GLOBAL_SESSION_STATE
        });
    }

    const data = await getHeatmapData(channelId, requestedThreshold);
    res.json(data);
});

// ========================================
// SERVER SETUP
// ========================================
app.get('/health', (_, res) => {
    res.json({
        status: 'ok',
        sessionState: GLOBAL_SESSION_STATE,
        timestamp: Date.now(),
        version: '2.1.0',
        websocket: true,
        connectedChannels: connectedClients.size,
        totalConnections: Array.from(connectedClients.values()).reduce((sum, clients) => sum + clients.size, 0)
    });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');
    const channelId = pathParts[pathParts.length - 1];

    if (!channelId || channelId === 'ws') {
        ws.close(1000, 'Channel ID required');
        return;
    }

    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    console.log(`📡 WebSocket connected: ${channelId} (${connectedClients.get(channelId).size} total for channel)`);

    // Send current state immediately
    getHeatmapData(channelId, 3).then(data => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });

    ws.on('close', () => {
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`📡 WebSocket disconnected: ${channelId}`);
    });
});

server.listen(PORT, () => {
    console.log('\n🚀 CLICKMAP SERVER v2.1.0 STARTED');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📊 Redis: ${useRedis ? 'enabled' : 'disabled'}`);
    console.log(`📡 WebSocket: enabled`);
    console.log(`🎯 Session State:`, GLOBAL_SESSION_STATE);
    console.log('=====================================\n');
});

export default server;