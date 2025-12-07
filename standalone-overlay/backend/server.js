/**
 * Smart Clickmap - Standalone Backend Server
 *
 * High-performance local server for clickmap visualization
 * Designed to handle 20,000 clicks/sec spike loads
 */

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

import { HighThroughputClickEngine } from './click-engine.js';
import { processClicksIntoVisualClusters } from './clustering.js';
import { WebSocketManager } from './websocket-manager.js';
import { HotkeyHandler } from './hotkey-handler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
let config;
try {
  const configPath = process.env.CONFIG_PATH || join(__dirname, '../config/default.json');
  config = JSON.parse(readFileSync(configPath, 'utf8'));
  console.log('Configuration loaded successfully');
} catch (e) {
  console.error('Failed to load config, using defaults:', e.message);
  config = {
    twitchChannel: 'phummylw',
    server: { port: 8080, broadcastInterval: 5000 },
    sampling: { client: 10, server: 5 },
    clustering: { threshold: 3, maxClusters: 20 },
    memory: { maxClicksInMemory: 10000, clickMaxAge: 3600000 },
    hotkeys: { toggle: 'Ctrl+1', reset: 'Ctrl+2' }
  };
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || config.server?.port || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Initialize components
const clickEngine = new HighThroughputClickEngine(config);
const wsManager = new WebSocketManager(wss, config);

// Game state
let gameState = {
  running: false,
  version: 0,
  lastUpdate: Date.now()
};

// Hotkey handler
const hotkeyHandler = new HotkeyHandler(config, {
  toggle: () => {
    if (gameState.running) {
      stopGame();
    } else {
      startGame();
    }
  },
  reset: () => {
    resetGame();
  }
});

// Static file serving
const frontendPath = join(__dirname, '../frontend');
app.use('/viewer', express.static(join(frontendPath, 'viewer')));
app.use('/obs', express.static(join(frontendPath, 'obs')));
app.use('/admin', express.static(join(frontendPath, 'admin')));

// Root route - redirect to viewer
app.get('/', (req, res) => {
  res.redirect(`/viewer/${config.twitchChannel || 'phummylw'}`);
});

// Get configuration
app.get('/config', (req, res) => {
  res.json({
    twitchChannel: config.twitchChannel,
    sampling: config.sampling,
    hotkeys: config.hotkeys,
    clustering: config.clustering
  });
});

// Get server status
app.get('/status', (req, res) => {
  const stats = clickEngine.getStats();
  res.json({
    running: gameState.running,
    version: gameState.version,
    websocketClients: wsManager.getClientCount(),
    ...stats,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Click ingestion endpoint
app.post('/click', (req, res) => {
  if (!gameState.running) {
    return res.status(400).json({
      success: false,
      error: 'Game not running'
    });
  }

  const { clicks, clientId } = req.body;

  if (!clicks || !Array.isArray(clicks) || !clientId) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request format. Expected: { clicks: [{x, y}], clientId: "uuid" }'
    });
  }

  // Process batch of clicks
  let processed = 0;
  let sampled = 0;

  for (const click of clicks) {
    const { x, y } = click;

    // Validate coordinates
    if (typeof x !== 'number' || typeof y !== 'number' ||
        x < 0 || x > 1 || y < 0 || y > 1) {
      continue;
    }

    const result = clickEngine.addClick(x, y, clientId);
    if (result.processed) {
      processed++;
    } else if (result.sampled) {
      sampled++;
    }
  }

  res.json({
    success: true,
    received: clicks.length,
    processed,
    sampled,
    running: gameState.running
  });
});

// Start game
app.post('/start', (req, res) => {
  startGame();
  res.json({
    success: true,
    running: true
  });
});

// Stop game
app.post('/stop', (req, res) => {
  stopGame();
  res.json({
    success: true,
    running: false
  });
});

// Reset game
app.post('/reset', (req, res) => {
  resetGame();
  res.json({
    success: true,
    running: false,
    allDataCleared: true
  });
});

// Get heatmap data (HTTP fallback for overlay)
app.get('/heatmap', (req, res) => {
  const data = getGameStateData();
  res.json(data);
});

// Helper functions
function startGame() {
  if (gameState.running) return;

  gameState.running = true;
  gameState.version++;
  gameState.lastUpdate = Date.now();

  console.log('[Game] Started');

  // Broadcast immediately
  wsManager.forceImmediateBroadcast(getGameStateData());
}

function stopGame() {
  if (!gameState.running) return;

  gameState.running = false;
  gameState.version++;
  gameState.lastUpdate = Date.now();

  console.log('[Game] Stopped');

  // Broadcast immediately
  wsManager.forceImmediateBroadcast(getGameStateData());
}

function resetGame() {
  gameState.running = false;
  gameState.version++;
  gameState.lastUpdate = Date.now();

  clickEngine.reset();

  console.log('[Game] Reset');

  // Broadcast reset signal
  wsManager.forceImmediateBroadcast({
    action: 'reset',
    running: false,
    clusters: [],
    totalClicks: 0,
    uniqueUsers: 0,
    allDataCleared: true,
    hardReset: true,
    resetSignalId: `reset_${Date.now()}`,
    version: gameState.version
  });
}

function getGameStateData() {
  const stats = clickEngine.getStats();
  const clicks = clickEngine.getAllClicks();
  const threshold = config.clustering?.threshold || 3;
  const maxClusters = config.clustering?.maxClusters || 20;

  let clusters = [];
  if (clicks.length > 0 && gameState.running) {
    clusters = processClicksIntoVisualClusters(clicks, threshold);

    // Limit to max clusters
    if (clusters.length > maxClusters) {
      clusters = clusters.slice(0, maxClusters);
    }
  }

  return {
    running: gameState.running,
    clusters,
    totalClicks: stats.totalClicks,
    uniqueUsers: stats.uniqueUsers,
    lastUpdate: Date.now(),
    version: gameState.version
  };
}

// Start WebSocket broadcast loop
wsManager.startBroadcastLoop(() => {
  if (gameState.running) {
    return getGameStateData();
  }
  return null;
});

// Start server
httpServer.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log('  Smart Clickmap - Standalone Server');
  console.log('==============================================');
  console.log('');
  console.log(`  Port:              ${PORT}`);
  console.log(`  Twitch Channel:    ${config.twitchChannel}`);
  console.log(`  Client Sampling:   1-in-${config.sampling?.client || 10}`);
  console.log(`  Server Sampling:   1-in-${config.sampling?.server || 5}`);
  console.log('');
  console.log('  URLs:');
  console.log(`    Viewer:   http://localhost:${PORT}/viewer/${config.twitchChannel}`);
  console.log(`    Admin:    http://localhost:${PORT}/admin`);
  console.log(`    OBS:      http://localhost:${PORT}/obs`);
  console.log(`    Status:   http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Server is ready!');
  console.log('==============================================');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  wsManager.stopBroadcastLoop();
  httpServer.close(() => {
    console.log('[Server] Stopped');
    process.exit(0);
  });
});
