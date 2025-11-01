import fs from 'fs';
import path from 'path';
import url from 'url';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import readline from 'readline';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, 'config.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'selfhosted');
const DEFAULT_CONFIG = {
  port: 4173,
  defaultStreamer: 'phummylw',
  allowedStreamers: ['phummylw', 'dougdoug'],
  retentionMinutes: 30,
  hotkeys: {
    resetAll: 'r',
    quit: 'q',
    resetChannels: {
      phummylw: '1',
      dougdoug: '2'
    }
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const mergedHotkeys = { ...DEFAULT_CONFIG.hotkeys, ...parsed.hotkeys };
      mergedHotkeys.resetChannels = {
        ...(DEFAULT_CONFIG.hotkeys?.resetChannels || {}),
        ...(parsed.hotkeys?.resetChannels || {})
      };
      return { ...DEFAULT_CONFIG, ...parsed, hotkeys: mergedHotkeys };
    }
  } catch (error) {
    console.error('Failed to read config.json, using defaults.', error);
  }
  return { ...DEFAULT_CONFIG };
}

const config = loadConfig();

const GRID_X = 48;
const GRID_Y = 27;
const MAX_CLUSTERS = 32;
const RETENTION_MS = Math.max(1, config.retentionMinutes || 30) * 60 * 1000;

const channelState = new Map();
const overlayClients = new Map();

function sanitizeChannelName(value) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function isChannelAllowed(channel) {
  if (!channel) return false;
  if (!Array.isArray(config.allowedStreamers) || config.allowedStreamers.length === 0) {
    return true;
  }
  return config.allowedStreamers.map((c) => c.toLowerCase()).includes(channel);
}

function ensureChannelState(channel) {
  if (!channelState.has(channel)) {
    channelState.set(channel, {
      clicks: [],
      lastUpdated: 0,
      totalClicks: 0
    });
  }
  return channelState.get(channel);
}

function pruneOldClicks(state) {
  const cutoff = Date.now() - RETENTION_MS;
  if (state.clicks.length === 0) return;
  if (state.clicks[state.clicks.length - 1].ts >= cutoff && state.clicks[0].ts >= cutoff) {
    return;
  }
  state.clicks = state.clicks.filter((click) => click.ts >= cutoff);
  state.totalClicks = state.clicks.length;
}

function recordClick(channel, x, y) {
  const state = ensureChannelState(channel);
  const timestamp = Date.now();
  state.clicks.push({ x, y, ts: timestamp });
  state.totalClicks = state.clicks.length;
  state.lastUpdated = timestamp;
  pruneOldClicks(state);
  return state;
}

function resetChannel(channel) {
  if (!channelState.has(channel)) return false;
  channelState.set(channel, {
    clicks: [],
    lastUpdated: Date.now(),
    totalClicks: 0
  });
  broadcast(channel, { type: 'reset', channel });
  console.log(`🔄 Reset data for channel ${channel}`);
  return true;
}

function resetAllChannels() {
  for (const channel of channelState.keys()) {
    resetChannel(channel);
  }
}

function aggregateChannel(channel) {
  const state = ensureChannelState(channel);
  pruneOldClicks(state);

  const total = state.clicks.length;
  if (total === 0) {
    return {
      channel,
      totalClicks: 0,
      updatedAt: state.lastUpdated,
      clusters: []
    };
  }

  const grid = new Map();
  for (const click of state.clicks) {
    const gx = Math.min(GRID_X - 1, Math.max(0, Math.floor(click.x * GRID_X)));
    const gy = Math.min(GRID_Y - 1, Math.max(0, Math.floor(click.y * GRID_Y)));
    const key = `${gx}:${gy}`;
    const cell = grid.get(key) || { count: 0, gx, gy };
    cell.count += 1;
    grid.set(key, cell);
  }

  const clusters = Array.from(grid.values())
    .map((cell) => {
      const x = (cell.gx + 0.5) / GRID_X;
      const y = (cell.gy + 0.5) / GRID_Y;
      const percentage = (cell.count / total) * 100;
      const radius = Math.max(0.04, Math.min(0.18, Math.sqrt(cell.count / total) * 0.25));
      return {
        id: `${cell.gx}-${cell.gy}`,
        x,
        y,
        count: cell.count,
        percentage,
        radius
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CLUSTERS);

  return {
    channel,
    totalClicks: total,
    updatedAt: state.lastUpdated,
    clusters
  };
}

function broadcast(channel, payload) {
  const clients = overlayClients.get(channel);
  if (!clients || clients.size === 0) {
    return;
  }
  const message = JSON.stringify(payload);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    uptime: process.uptime(),
    channels: Array.from(channelState.keys())
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    defaultStreamer: config.defaultStreamer,
    allowedStreamers: config.allowedStreamers,
    retentionMinutes: config.retentionMinutes,
    hotkeys: config.hotkeys
  });
});

app.get('/api/summary', (req, res) => {
  const channel = sanitizeChannelName(req.query.channel || config.defaultStreamer);
  if (!isChannelAllowed(channel)) {
    return res.status(403).json({ ok: false, error: 'Channel not allowed' });
  }
  const summary = aggregateChannel(channel);
  res.json({ ok: true, summary });
});

app.post('/api/click', (req, res) => {
  const { channel: rawChannel, x, y } = req.body || {};
  const channel = sanitizeChannelName(rawChannel || config.defaultStreamer);

  if (!isChannelAllowed(channel)) {
    return res.status(403).json({ ok: false, error: 'Channel not allowed' });
  }

  const numericX = Number(x);
  const numericY = Number(y);

  if (!Number.isFinite(numericX) || !Number.isFinite(numericY)) {
    return res.status(400).json({ ok: false, error: 'Missing coordinates' });
  }

  if (numericX < 0 || numericX > 1 || numericY < 0 || numericY > 1) {
    return res.status(400).json({ ok: false, error: 'Coordinates out of bounds' });
  }

  recordClick(channel, numericX, numericY);
  const summary = aggregateChannel(channel);
  broadcast(channel, { type: 'heatmap', channel, summary });

  res.json({ ok: true });
});

app.use('/static', express.static(FRONTEND_DIR, { index: false }));

function serveViewer(req, res) {
  const filePath = path.join(FRONTEND_DIR, 'viewer.html');
  res.sendFile(filePath);
}

function serveOverlay(req, res) {
  const filePath = path.join(FRONTEND_DIR, 'overlay.html');
  res.sendFile(filePath);
}

app.get('/overlay/:channel', serveOverlay);
app.get('/overlay', serveOverlay);

app.get('/:channel', serveViewer);
app.get('/', serveViewer);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function registerClient(channel, socket) {
  if (!overlayClients.has(channel)) {
    overlayClients.set(channel, new Set());
  }
  overlayClients.get(channel).add(socket);
}

function unregisterClient(channel, socket) {
  const clients = overlayClients.get(channel);
  if (!clients) return;
  clients.delete(socket);
  if (clients.size === 0) {
    overlayClients.delete(channel);
  }
}

function handleWebSocketConnection(socket, channel) {
  registerClient(channel, socket);

  const summary = aggregateChannel(channel);
  socket.send(
    JSON.stringify({
      type: 'hello',
      channel,
      summary,
      config: {
        retentionMinutes: config.retentionMinutes,
        hotkeys: config.hotkeys
      }
    })
  );

  socket.on('close', () => {
    unregisterClient(channel, socket);
  });

  socket.on('message', (data) => {
    if (data.toString() === 'ping') {
      socket.send('pong');
    }
  });
}

server.on('upgrade', (request, socket, head) => {
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const channel = sanitizeChannelName(searchParams.get('channel') || config.defaultStreamer);
  if (!isChannelAllowed(channel)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleWebSocketConnection(ws, channel);
  });
});

server.listen(config.port, () => {
  console.log('📡 Self-hosted Smart ClickMap server ready');
  console.log(`➡️  Viewer URL: http://localhost:${config.port}/${config.defaultStreamer}`);
  console.log(`➡️  Overlay URL: http://localhost:${config.port}/overlay/${config.defaultStreamer}`);

  const { hotkeys } = config;
  console.log('\nHotkeys:');
  if (hotkeys.resetAll) {
    console.log(`  [${hotkeys.resetAll}] Reset all channels`);
  }
  if (hotkeys.resetChannels) {
    for (const [channel, key] of Object.entries(hotkeys.resetChannels)) {
      console.log(`  [${key}] Reset channel ${channel}`);
    }
  }
  if (hotkeys.quit) {
    console.log(`  [${hotkeys.quit}] Quit server`);
  }
});

const socketsForHeartbeat = new Set();
wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socketsForHeartbeat.add(socket);
  socket.on('close', () => socketsForHeartbeat.delete(socket));
});

setInterval(() => {
  for (const socket of socketsForHeartbeat) {
    if (socket.isAlive === false) {
      socket.terminate();
      socketsForHeartbeat.delete(socket);
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    const { hotkeys } = config;

    if (hotkeys.quit && key.sequence === hotkeys.quit) {
      console.log('👋 Stopping server');
      process.exit(0);
    }

    if (hotkeys.resetAll && key.sequence === hotkeys.resetAll) {
      console.log('🔁 Resetting all channels');
      resetAllChannels();
      return;
    }

    if (hotkeys.resetChannels) {
      for (const [channel, binding] of Object.entries(hotkeys.resetChannels)) {
        if (binding && key.sequence === binding) {
          resetChannel(sanitizeChannelName(channel));
          return;
        }
      }
    }
  });

  console.log('\nFocus this terminal window to use hotkeys. Press Ctrl+C at any time to exit.');
} else {
  console.log('Hotkeys disabled (stdin not attached).');
}
