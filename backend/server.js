import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8080;
const SECRET = Buffer.from(process.env.TWITCH_SECRET || '', 'base64');

// Simple in-memory storage
const gameState = {
    running: false,
    clicks: new Map(), // channelId → Map(userId → { x, y, timestamp })
    lastUpdate: Date.now()
};

const connectedClients = new Map(); // channelId → Set of WebSocket connections

const app = express();

// CORS setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol'],
    credentials: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add WebSocket headers
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

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    res.set('Cache-Control', 'no-store');
    next();
});

// Health check with comprehensive diagnostics
app.get('/health', (req, res) => {
    console.log('🏥 Health check called');
    res.json({
        status: 'ok',
        running: gameState.running,
        timestamp: Date.now(),
        version: '3.4.0',
        uptime: process.uptime(),
        websocket: {
            enabled: !!wss,
            clients: wss ? wss.clients.size : 0,
            channels: connectedClients.size,
            connections_by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        environment: {
            node_env: process.env.NODE_ENV || 'unknown',
            port: PORT,
            render_service: process.env.RENDER_SERVICE_NAME || 'unknown',
            render_service_id: process.env.RENDER_SERVICE_ID || 'unknown'
        },
        game_data: {
            total_channels: gameState.clicks.size,
            total_clicks: Array.from(gameState.clicks.values()).reduce((sum, channelClicks) => sum + channelClicks.size, 0),
            channels: Array.from(gameState.clicks.entries()).map(([channel, clicks]) => ({
                channel,
                clicks: clicks.size
            }))
        }
    });
});

// WebSocket debug endpoint  
app.get('/ws-debug', (req, res) => {
    console.log('🔍 WebSocket Debug requested');

    const debug = {
        timestamp: new Date().toISOString(),
        websocket_server: {
            exists: !!wss,
            clients: wss ? wss.clients.size : 0,
            integrated_with_http: true,
            ready_state: wss ? 'operational' : 'not_initialized'
        },
        connected_clients: {
            channels: connectedClients.size,
            total_connections: Array.from(connectedClients.values()).reduce((sum, set) => sum + set.size, 0),
            by_channel: Array.from(connectedClients.entries()).map(([channel, clients]) => ({
                channel,
                count: clients.size
            }))
        },
        server_info: {
            listening: !!httpServer && httpServer.listening,
            address: httpServer ? httpServer.address() : null,
            port: PORT,
            single_port_mode: true,
            environment: process.env.NODE_ENV || 'development'
        }
    };

    console.log('🔍 Debug result:', JSON.stringify(debug, null, 2));
    res.json(debug);
});

// WebSocket connection test helper
app.get('/ws-test/:channelId', (req, res) => {
    const { channelId } = req.params;
    const wsUrl = `wss://${req.get('host')}/ws/${channelId}`;

    res.json({
        test_url: wsUrl,
        server_ready: !!httpServer && httpServer.listening,
        websocket_ready: !!wss,
        client_count: wss ? wss.clients.size : 0,
        instructions: [
            'Test WebSocket connection in browser console:',
            `const ws = new WebSocket('${wsUrl}');`,
            `ws.onopen = () => console.log('✅ Connected to ${channelId}');`,
            `ws.onerror = (e) => console.log('❌ Connection error:', e);`,
            `ws.onclose = (e) => console.log('🔒 Connection closed:', e.code, e.reason);`,
            `ws.onmessage = (e) => console.log('📨 Message received:', e.data);`
        ]
    });
});

// START endpoint
app.post('/start', (req, res) => {
    console.log('🚀 START endpoint called');

    try {
        gameState.running = true;
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Game started successfully');

        // Broadcast to all connected clients
        broadcastToAll({
            running: true,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'start'
        });

        res.json({
            success: true,
            status: 'started',
            running: true,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Start error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start session',
            details: error.message
        });
    }
});

// STOP endpoint
app.post('/stop', (req, res) => {
    console.log('⏹️ STOP endpoint called');

    try {
        gameState.running = false;
        gameState.lastUpdate = Date.now();

        console.log('✅ Game stopped successfully');

        const currentData = getCurrentHeatmapData('all');
        currentData.running = false;
        currentData.action = 'stop';

        broadcastToAll(currentData);

        res.json({
            success: true,
            status: 'stopped',
            running: false,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop session',
            details: error.message
        });
    }
});

// RESET endpoint
app.post('/reset', (req, res) => {
    console.log('🗑️ RESET endpoint called');

    try {
        gameState.clicks.clear();
        gameState.lastUpdate = Date.now();

        console.log('✅ Data reset successfully');

        broadcastToAll({
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            action: 'reset'
        });

        res.json({
            success: true,
            status: 'reset',
            running: gameState.running,
            timestamp: gameState.lastUpdate
        });

    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset data',
            details: error.message
        });
    }
});

// Click handling with enhanced logging
app.post('/click', (req, res) => {
    console.log('🖱️ CLICK endpoint called');

    try {
        if (!gameState.running) {
            console.log('   ❌ Game not running');
            return res.status(400).json({
                success: false,
                error: 'Game not running'
            });
        }

        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) {
            console.log('   ❌ No token provided');
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
        const { x, y } = req.body;
        const uid = payload.user_id || payload.opaque_user_id;
        const channelId = payload.channel_id;

        if (typeof x !== 'number' || typeof y !== 'number' ||
            x < 0 || x > 1 || y < 0 || y > 1) {
            console.log(`   ❌ Invalid coordinates: (${x}, ${y})`);
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates'
            });
        }

        // Store click
        if (!gameState.clicks.has(channelId)) {
            gameState.clicks.set(channelId, new Map());
            console.log(`   📝 Created new channel: ${channelId}`);
        }

        gameState.clicks.get(channelId).set(uid, { x, y, timestamp: Date.now() });
        gameState.lastUpdate = Date.now();

        console.log(`✅ Click stored: Channel ${channelId}, User ${uid}, Pos (${x.toFixed(3)}, ${y.toFixed(3)})`);
        console.log(`   Total clicks in channel: ${gameState.clicks.get(channelId).size}`);

        // Get updated data and broadcast immediately
        const updatedData = getCurrentHeatmapData(channelId);
        console.log(`   📡 Broadcasting: ${updatedData.clusters.length} clusters to channel ${channelId}`);
        broadcastToChannel(channelId, updatedData);

        res.json({
            success: true,
            status: 'click recorded',
            totalClicks: gameState.clicks.get(channelId)?.size || 0,
            channelId: channelId
        });

    } catch (error) {
        console.error('❌ Click error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token or request',
            details: error.message
        });
    }
});

// Enhanced heatmap endpoint with detailed logging
app.get('/heatmap', (req, res) => {
    const channelId = req.query.channel;
    const threshold = parseInt(req.query.threshold) || 3;

    console.log(`📊 HEATMAP endpoint: channel=${channelId || 'ALL'}, threshold=${threshold}%`);

    try {
        const data = getCurrentHeatmapData(channelId, threshold);

        if (data.totalClicks > 0) {
            console.log(`✅ Heatmap: ${data.totalClicks} clicks → ${data.clusters.length} clusters`);
            data.clusters.forEach((c, i) => {
                console.log(`   Cluster ${i}: ${c.percentage}% (${c.count} clicks) at (${c.x.toFixed(3)}, ${c.y.toFixed(3)})`);
            });
        }

        res.json(data);

    } catch (error) {
        console.error('❌ Heatmap error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get heatmap data',
            details: error.message
        });
    }
});

// Get current heatmap data with FIXED clustering and percentage calculation
function getCurrentHeatmapData(channelId, threshold = 3) {
    // If no specific channel requested, aggregate all channels
    if (!channelId || channelId === 'all') {
        let allPoints = [];
        let totalClicks = 0;
        let totalUsers = 0;

        // Collect all points from all channels
        gameState.clicks.forEach((channelClicks) => {
            totalClicks += channelClicks.size;
            totalUsers += channelClicks.size;

            // Add all points to the aggregate
            Array.from(channelClicks.values()).forEach(point => {
                allPoints.push(point);
            });
        });

        // Process ALL points into clusters
        const clusters = processClicksIntoSimpleClusters(allPoints, threshold, totalClicks);

        return {
            running: gameState.running,
            clusters,
            totalClicks,
            uniqueUsers: totalUsers,
            coverage: Math.min(100, clusters.length * 10),
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    // Handle specific channel
    const channelClicks = gameState.clicks.get(channelId);

    if (!channelClicks || channelClicks.size === 0) {
        return {
            running: gameState.running,
            clusters: [],
            totalClicks: 0,
            uniqueUsers: 0,
            coverage: 0,
            threshold,
            lastUpdate: gameState.lastUpdate
        };
    }

    const points = Array.from(channelClicks.values());
    const totalClicks = points.length;
    const clusters = processClicksIntoSimpleClusters(points, threshold, totalClicks);

    console.log(`🔍 Channel ${channelId}: ${points.length} points → ${clusters.length} clusters`);

    return {
        running: gameState.running,
        clusters,
        totalClicks: points.length,
        uniqueUsers: channelClicks.size,
        coverage: Math.min(100, clusters.length * 10),
        threshold,
        lastUpdate: gameState.lastUpdate
    };
}

// SIMPLIFIED CLUSTERING with proper merging and percentage calculation
function processClicksIntoSimpleClusters(points, threshold, totalClicksGlobal) {
    if (points.length === 0) return [];

    console.log(`🧮 SIMPLIFIED clustering: ${points.length} points, ${threshold}% threshold`);

    // Step 1: Spatial clustering with aggressive merging
    const spatialClusters = performAggressiveClustering(points);
    console.log(`   Spatial clustering: ${points.length} points → ${spatialClusters.length} spatial clusters`);
    
    // Step 2: Calculate metrics with CORRECT percentages
    const enrichedClusters = spatialClusters.map((cluster, index) => {
        const count = cluster.length;
        const percentage = Math.round((count / totalClicksGlobal) * 100); // FIXED: Use global total
        
        // Calculate centroid
        const centroidX = cluster.reduce((sum, p) => sum + p.x, 0) / count;
        const centroidY = cluster.reduce((sum, p) => sum + p.y, 0) / count;
        
        // Calculate size
        const visualSize = calculateSimpleVisualSize(percentage, count);
        
        console.log(`   Cluster ${index}: ${count} clicks = ${percentage}% (size: ${visualSize}px)`);
        
        return {
            id: index,
            x: centroidX,
            y: centroidY,
            count: count,
            percentage: percentage,
            visualSize: visualSize,
            shapeType: 'circle', // Always circles now
            density: 1,
            eccentricity: 0,
            complexity: 0,
            isTop: false
        };
    });

    // Step 3: Filter by threshold
    const filteredClusters = enrichedClusters.filter(c => c.percentage >= threshold);
    console.log(`   Threshold filter: ${enrichedClusters.length} → ${filteredClusters.length} (threshold: ${threshold}%)`);

    // Step 4: TEXT OVERLAP MERGING - merge clusters whose text would overlap
    const textMergedClusters = mergeOverlappingTextClusters(filteredClusters, totalClicksGlobal);
    console.log(`   Text overlap merging: ${filteredClusters.length} → ${textMergedClusters.length} final clusters`);

    // Step 5: Sort and mark top cluster
    textMergedClusters.sort((a, b) => b.percentage - a.percentage);
    if (textMergedClusters.length > 0) {
        textMergedClusters[0].isTop = true;
    }

    console.log(`✅ SIMPLIFIED clustering result: ${spatialClusters.length} spatial → ${textMergedClusters.length} final`);
    
    return textMergedClusters;
}

// AGGRESSIVE CLUSTERING - merges nearby points aggressively
function performAggressiveClustering(points) {
    if (points.length === 0) return [];
    if (points.length === 1) return [points];

    const clusters = [];
    const visited = new Set();

    // MUCH more aggressive epsilon for merging
    const epsilon = calculateAggressiveEpsilon(points);
    console.log(`   Using aggressive epsilon: ${epsilon.toFixed(4)}`);

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;

        // Start a new cluster
        const cluster = [points[i]];
        visited.add(i);

        // Find all points within epsilon and add them
        for (let j = i + 1; j < points.length; j++) {
            if (visited.has(j)) continue;

            const distance = euclideanDistance(points[i], points[j]);
            console.log(`   Distance between point ${i} and ${j}: ${distance.toFixed(4)} (epsilon: ${epsilon.toFixed(4)})`);
            
            if (distance <= epsilon) {
                cluster.push(points[j]);
                visited.add(j);
                console.log(`   ✅ Merged point ${j} into cluster (distance: ${distance.toFixed(4)})`);
            }
        }

        clusters.push(cluster);
        console.log(`   Created cluster with ${cluster.length} points`);
    }

    return clusters;
}

// Calculate aggressive epsilon for merging very close points
function calculateAggressiveEpsilon(points) {
    if (points.length < 2) return 0.15;

    // Calculate all pairwise distances
    const distances = [];
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const dist = euclideanDistance(points[i], points[j]);
            distances.push(dist);
        }
    }
    
    distances.sort((a, b) => a - b);
    console.log(`   All distances: [${distances.map(d => d.toFixed(4)).join(', ')}]`);
    
    if (distances.length === 0) return 0.15;
    
    // For very close overlapping points, use a small epsilon
    // For spread out points, use larger epsilon
    const minDistance = distances[0];
    const maxDistance = distances[distances.length - 1];
    const range = maxDistance - minDistance;
    
    let epsilon;
    if (minDistance < 0.01) {
        // Very close points exist - use small epsilon to separate tight clusters
        epsilon = Math.max(0.02, minDistance * 3);
        console.log(`   Very close points detected (min: ${minDistance.toFixed(4)}), using tight epsilon: ${epsilon.toFixed(4)}`);
    } else if (range < 0.1) {
        // All points are close together - merge them
        epsilon = maxDistance * 1.1;
        console.log(`   All points close together (range: ${range.toFixed(4)}), using large epsilon: ${epsilon.toFixed(4)}`);
    } else {
        // Mixed distances - use median
        const median = distances[Math.floor(distances.length / 2)];
        epsilon = Math.max(0.05, Math.min(0.2, median * 1.5));
        console.log(`   Mixed distances, using median-based epsilon: ${epsilon.toFixed(4)}`);
    }
    
    return epsilon;
}

// TEXT OVERLAP MERGING - merge clusters whose percentage text would overlap
function mergeOverlappingTextClusters(clusters, totalClicksGlobal) {
    if (clusters.length <= 1) return clusters;

    console.log(`🔤 TEXT OVERLAP MERGING: Checking ${clusters.length} clusters for text overlaps`);

    let mergedClusters = [...clusters];
    let didMerge = true;

    while (didMerge) {
        didMerge = false;

        for (let i = 0; i < mergedClusters.length; i++) {
            for (let j = i + 1; j < mergedClusters.length; j++) {
                const cluster1 = mergedClusters[i];
                const cluster2 = mergedClusters[j];

                // Check if text labels would overlap
                if (wouldTextLabelsOverlap(cluster1, cluster2)) {
                    console.log(`   🔗 Merging clusters ${i} and ${j} due to text overlap`);
                    console.log(`      Cluster ${i}: ${cluster1.percentage}% at (${cluster1.x.toFixed(3)}, ${cluster1.y.toFixed(3)})`);
                    console.log(`      Cluster ${j}: ${cluster2.percentage}% at (${cluster2.x.toFixed(3)}, ${cluster2.y.toFixed(3)})`);

                    // Merge the clusters
                    const mergedCluster = mergeTwoClusters(cluster1, cluster2, totalClicksGlobal);
                    
                    // Remove the two old clusters and add the merged one
                    mergedClusters.splice(j, 1); // Remove j first (higher index)
                    mergedClusters.splice(i, 1); // Remove i second
                    mergedClusters.push(mergedCluster);

                    console.log(`      Result: ${mergedCluster.percentage}% at (${mergedCluster.x.toFixed(3)}, ${mergedCluster.y.toFixed(3)})`);

                    didMerge = true;
                    break;
                }
            }
            if (didMerge) break;
        }
    }

    console.log(`✅ Text merging complete: ${clusters.length} → ${mergedClusters.length} clusters`);
    return mergedClusters;
}

// Check if two clusters' text labels would overlap on screen
function wouldTextLabelsOverlap(cluster1, cluster2) {
    // Estimate text dimensions (this is approximate)
    const fontSize = 24; // Base font size
    const textWidth = 40; // Approximate width of "XX%" text
    const textHeight = fontSize;
    
    // Calculate distance between cluster centers (in screen coordinates)
    // Assuming a 1920x1080 screen for estimation
    const screenWidth = 1920;
    const screenHeight = 1080;
    
    const x1 = cluster1.x * screenWidth;
    const y1 = cluster1.y * screenHeight;
    const x2 = cluster2.x * screenWidth;
    const y2 = cluster2.y * screenHeight;
    
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    
    // Consider text overlap if clusters are closer than combined text size + padding
    const minDistance = textWidth + 20; // 20px padding
    
    console.log(`   Text overlap check: distance=${distance.toFixed(0)}px, minDistance=${minDistance}px`);
    
    return distance < minDistance;
}

// Merge two clusters into one
function mergeTwoClusters(cluster1, cluster2, totalClicksGlobal) {
    const totalCount = cluster1.count + cluster2.count;
    const newPercentage = Math.round((totalCount / totalClicksGlobal) * 100);
    
    // Calculate weighted centroid
    const newX = (cluster1.x * cluster1.count + cluster2.x * cluster2.count) / totalCount;
    const newY = (cluster1.y * cluster1.count + cluster2.y * cluster2.count) / totalCount;
    
    // Calculate new visual size
    const newVisualSize = calculateSimpleVisualSize(newPercentage, totalCount);
    
    return {
        id: `merged_${cluster1.id}_${cluster2.id}`,
        x: newX,
        y: newY,
        count: totalCount,
        percentage: newPercentage,
        visualSize: newVisualSize,
        shapeType: 'circle',
        density: 1,
        eccentricity: 0,
        complexity: 0,
        isTop: false
    };
}

// Simple visual size calculation
function calculateSimpleVisualSize(percentage, count) {
    const MIN_SIZE = 40;
    const MAX_SIZE = 200;
    
    // Base size on percentage primarily
    let size = MIN_SIZE + (percentage / 100) * (MAX_SIZE - MIN_SIZE);
    
    // Small bonus for click count
    const countBonus = Math.min(20, Math.log10(count + 1) * 8);
    size += countBonus;
    
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
}

// Utility function
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// WebSocket broadcasting functions
function broadcastToChannel(channelId, data) {
    const clients = connectedClients.get(channelId);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(data);
    let sentCount = 0;

    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                sentCount++;
            } catch (error) {
                console.error('WebSocket send error:', error);
                clients.delete(ws);
            }
        } else {
            clients.delete(ws);
        }
    });

    if (sentCount > 0) {
        console.log(`📡 Broadcast to ${channelId}: ${sentCount} clients, ${data.clusters.length} clusters`);
    }
}

function broadcastToAll(data) {
    let totalSent = 0;
    connectedClients.forEach((clients, channelId) => {
        const channelData = channelId === 'all' ? data : getCurrentHeatmapData(channelId);
        Object.assign(channelData, { running: data.running, action: data.action });
        broadcastToChannel(channelId, channelData);
        totalSent += clients.size;
    });

    if (totalSent > 0) {
        console.log(`📡 Broadcast to all: ${totalSent} clients`);
    }
}

// ===== HTTP SERVER CREATION =====
console.log('🔧 Creating HTTP server...');
const httpServer = createServer(app);

// ===== WEBSOCKET SERVER INTEGRATION =====
console.log('🔧 Creating WebSocket server integrated with HTTP server...');
let wss;
try {
    // CRITICAL: Use the HTTP server, not a separate port
    wss = new WebSocketServer({
        server: httpServer,  // Use the same HTTP server - this is the key fix!
        perMessageDeflate: false,
        clientTracking: true
    });
    console.log('✅ WebSocket server integrated with HTTP server on single port');
} catch (error) {
    console.error('❌ WebSocket server creation failed:', error);
    process.exit(1);
}

// Handle WebSocket upgrade requests explicitly
httpServer.on('upgrade', (request, socket, head) => {
    console.log('🔗 WebSocket upgrade request received:');
    console.log(`   URL: ${request.url}`);
    console.log(`   Origin: ${request.headers.origin}`);
    console.log(`   Connection: ${request.headers.connection}`);
    console.log(`   Upgrade: ${request.headers.upgrade}`);

    // Only handle WebSocket upgrade requests for /ws/ paths
    if (request.url && request.url.startsWith('/ws/')) {
        console.log('✅ Valid WebSocket path, handling upgrade...');
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log('❌ Invalid WebSocket path, closing connection');
        socket.destroy();
    }
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const startTime = Date.now();
    console.log(`🔗 NEW WEBSOCKET CONNECTION`);
    console.log(`   URL: ${req.url}`);
    console.log(`   Origin: ${req.headers.origin}`);
    console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);

    // Extract channel ID from URL: /ws/channelId
    let channelId = null;
    if (req.url) {
        const match = req.url.match(/\/ws\/([^?&\/]+)/);
        if (match) {
            channelId = match[1];
            console.log(`   Channel: ${channelId}`);
        }
    }

    if (!channelId) {
        console.error('❌ No channel ID found in WebSocket URL');
        ws.close(1008, 'Channel ID required: /ws/CHANNEL_ID');
        return;
    }

    // Add to tracking
    if (!connectedClients.has(channelId)) {
        connectedClients.set(channelId, new Set());
    }
    connectedClients.get(channelId).add(ws);

    const clientCount = connectedClients.get(channelId).size;
    const totalClients = wss.clients.size;

    console.log(`✅ WebSocket connected: Channel ${channelId} (${clientCount} in channel, ${totalClients} total)`);

    // Send initial data immediately
    try {
        const initialData = getCurrentHeatmapData(channelId);
        ws.send(JSON.stringify(initialData));
        console.log(`📨 Initial data sent: ${initialData.clusters.length} clusters, ${initialData.totalClicks} clicks`);
    } catch (error) {
        console.error('❌ Error sending initial data:', error);
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`📨 Message from ${channelId}:`, data);

            // Echo back for testing
            ws.send(JSON.stringify({
                type: 'echo',
                received: data,
                timestamp: Date.now(),
                channelId: channelId
            }));
        } catch (error) {
            console.error('❌ Message parsing error:', error);
        }
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
        const duration = Date.now() - startTime;
        const clients = connectedClients.get(channelId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                connectedClients.delete(channelId);
            }
        }
        console.log(`🔒 WebSocket disconnected: ${channelId} after ${duration}ms`);
        console.log(`   Code: ${code}, Reason: ${reason || 'none'}`);
        console.log(`   Remaining clients in channel: ${clients ? clients.size : 0}`);
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${channelId}:`, error);
    });

    // Keep-alive mechanism
    const keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (pingError) {
                console.error('❌ Keep-alive ping error:', pingError);
                clearInterval(keepAlive);
            }
        } else {
            clearInterval(keepAlive);
        }
    }, 25000); // 25 second keep-alive

    ws.on('close', () => {
        clearInterval(keepAlive);
    });

    ws.on('pong', () => {
        console.log(`🏓 Pong received from ${channelId}`);
    });
});

// WebSocket server error handling
wss.on('error', (error) => {
    console.error('❌ WebSocket server error:', error);
    console.error('   Stack:', error.stack);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📝 Received SIGTERM, starting graceful shutdown...');

    // Close all WebSocket connections
    connectedClients.forEach((clients, channelId) => {
        clients.forEach(ws => {
            try {
                ws.close(1000, 'Server shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            }
        });
    });

    httpServer.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ClickMap EBS v3.4.0 SIMPLIFIED CLUSTERING - Text Overlap Merging!');
    console.log(`📡 HTTP Server: https://smart-clickmap-backend.onrender.com`);
    console.log(`🔗 WebSocket URL: wss://smart-clickmap-backend.onrender.com/ws/[CHANNEL_ID]`);
    console.log(`🎯 Health check: https://smart-clickmap-backend.onrender.com/health`);
    console.log(`🔍 Debug endpoint: https://smart-clickmap-backend.onrender.com/ws-debug`);
    console.log(`🧪 Test endpoint: https://smart-clickmap-backend.onrender.com/ws-test/167556274`);
    console.log(`📊 Game state: ${gameState.running ? 'RUNNING' : 'STOPPED'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Final status verification
    setTimeout(() => {
        console.log('🔍 FINAL STATUS CHECK:');
        console.log(`   HTTP server listening: ${httpServer.listening}`);
        console.log(`   HTTP server address: ${JSON.stringify(httpServer.address())}`);
        console.log(`   WebSocket server integrated: ${!!wss}`);
        console.log(`   WebSocket clients: ${wss ? wss.clients.size : 0}`);
        console.log(`   Connected channels: ${connectedClients.size}`);
        console.log(`   Single port mode: ${PORT}`);
        console.log('🎉 SIMPLIFIED clustering with text merging fully operational!');
    }, 1000);
});

export default httpServer;
