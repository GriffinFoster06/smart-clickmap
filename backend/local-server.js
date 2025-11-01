import fs from 'fs';
import path from 'path';
import process from 'process';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import readline from 'readline';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'local-config.json');
const DEFAULT_GRID_X = 48;
const DEFAULT_GRID_Y = 27;
const BROADCAST_DEBOUNCE_MS = 250;

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const absolute = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(configPath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Configuration file not found: ${absolute}`);
  }

  const raw = fs.readFileSync(absolute, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse configuration file ${absolute}: ${error.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Configuration file must contain a JSON object');
  }

  if (!data.streamers || typeof data.streamers !== 'object' || Object.keys(data.streamers).length === 0) {
    throw new Error('Configuration must include at least one streamer in the "streamers" object');
  }

  const defaultStreamer = data.defaultStreamer || Object.keys(data.streamers)[0];
  if (!data.streamers[defaultStreamer]) {
    throw new Error(`defaultStreamer "${defaultStreamer}" is not present in the streamers configuration`);
  }

  return {
    port: Number.parseInt(data.port, 10) || 4000,
    host: data.host || '0.0.0.0',
    defaultStreamer,
    hotkeys: normaliseHotkeys(data.hotkeys || {}),
    grid: {
      x: Number.isFinite(data.grid?.x) ? Math.max(8, Math.floor(data.grid.x)) : DEFAULT_GRID_X,
      y: Number.isFinite(data.grid?.y) ? Math.max(8, Math.floor(data.grid.y)) : DEFAULT_GRID_Y
    },
    streamers: normaliseStreamers(data.streamers)
  };
}

function normaliseHotkeys(raw) {
  const mapKey = (value) => {
    if (!value) return undefined;
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value;
  };

  const switchToStreamer = {};
  if (raw.switchToStreamer && typeof raw.switchToStreamer === 'object') {
    for (const [streamerId, key] of Object.entries(raw.switchToStreamer)) {
      const mapped = mapKey(key);
      if (mapped) {
        switchToStreamer[streamerId] = mapped;
      }
    }
  }

  return {
    resetHeatmap: mapKey(raw.resetHeatmap) || 'r',
    nextStreamer: mapKey(raw.nextStreamer) || ']',
    previousStreamer: mapKey(raw.previousStreamer) || '[',
    switchToStreamer
  };
}

function normaliseStreamers(rawStreamers) {
  const streamers = {};
  for (const [id, config] of Object.entries(rawStreamers)) {
    if (!config || typeof config !== 'object') continue;
    const twitchChannel = config.twitchChannel || id;
    streamers[id] = {
      id,
      twitchChannel,
      displayName: config.displayName || twitchChannel,
      overlaySlug: config.overlaySlug || id,
      description: config.description || ''
    };
  }
  return streamers;
}

function createInitialState(streamerId, grid) {
  return {
    streamerId,
    gridX: grid.x,
    gridY: grid.y,
    buckets: new Map(),
    totalClicks: 0,
    lastReset: Date.now(),
    clients: new Set(),
    lastBroadcast: 0
  };
}

class OverlayServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.httpServer = createServer(this.app);
    this.wsServer = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.streamerState = new Map();
    this.activeStreamer = config.defaultStreamer;

    this.setupExpress();
    this.setupWebSocket();
    this.setupHotkeys();
  }

  getState(streamerId) {
    if (!this.streamerState.has(streamerId)) {
      this.streamerState.set(streamerId, createInitialState(streamerId, this.config.grid));
    }
    return this.streamerState.get(streamerId);
  }

  setupExpress() {
    const frontendDir = path.resolve(__dirname, '../frontend');

    this.app.use(express.json({ limit: '128kb' }));
    this.app.use('/static', express.static(frontendDir, { maxAge: 0 }));

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        mode: 'local',
        activeStreamer: this.activeStreamer,
        streamers: Object.keys(this.config.streamers)
      });
    });

    this.app.get('/api/overlay/:streamer/config', (req, res) => {
      const streamer = this.getStreamer(req.params.streamer);
      if (!streamer) {
        res.status(404).json({ error: 'Streamer not found' });
        return;
      }

      res.json({
        streamerId: streamer.id,
        twitchChannel: streamer.twitchChannel,
        displayName: streamer.displayName,
        hotkeys: this.config.hotkeys,
        grid: this.config.grid,
        availableStreamers: Object.keys(this.config.streamers),
        activeStreamer: this.activeStreamer,
        streamers: Object.values(this.config.streamers).map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          twitchChannel: entry.twitchChannel
        }))
      });
    });

    this.app.get('/api/overlay/:streamer/heatmap', (req, res) => {
      const state = this.getStateForRequest(req, res);
      if (!state) return;
      res.json(this.buildHeatmapResponse(state));
    });

    this.app.post('/api/overlay/:streamer/click', (req, res) => {
      const state = this.getStateForRequest(req, res);
      if (!state) return;
      const { x, y } = req.body || {};
      if (!isValidCoordinate(x) || !isValidCoordinate(y)) {
        res.status(400).json({ error: 'Invalid coordinates' });
        return;
      }
      this.registerClick(state, { x, y, source: 'http' });
      res.json({ success: true });
    });

    this.app.get('/', (req, res) => {
      res.redirect(`/overlay/${encodeURIComponent(this.activeStreamer)}`);
    });

    this.app.get('/overlay/:streamer', (req, res) => {
      const streamer = this.getStreamer(req.params.streamer);
      if (!streamer) {
        res.status(404).send(`Unknown streamer "${req.params.streamer}"`);
        return;
      }
      res.sendFile(path.join(frontendDir, 'local', 'index.html'));
    });
  }

  getStateForRequest(req, res) {
    const streamer = this.getStreamer(req.params.streamer);
    if (!streamer) {
      res.status(404).json({ error: 'Streamer not found' });
      return null;
    }
    return this.getState(streamer.id);
  }

  getStreamer(slug) {
    if (!slug) return null;
    if (this.config.streamers[slug]) return this.config.streamers[slug];
    for (const streamer of Object.values(this.config.streamers)) {
      if (streamer.overlaySlug === slug || streamer.twitchChannel === slug) {
        return streamer;
      }
    }
    return null;
  }

  setupWebSocket() {
    this.wsServer.on('connection', (socket, request) => {
      const params = new URLSearchParams(request.url.replace(/^.*\?/, ''));
      const streamerParam = params.get('streamer');
      const streamer = this.getStreamer(streamerParam || this.activeStreamer);
      if (!streamer) {
        socket.send(JSON.stringify({ type: 'error', error: 'unknown-streamer' }));
        socket.close(1008, 'Unknown streamer');
        return;
      }

      const state = this.getState(streamer.id);
      state.clients.add(socket);

      socket.send(JSON.stringify({
        type: 'welcome',
        streamerId: streamer.id,
        displayName: streamer.displayName,
        totalClicks: state.totalClicks,
        lastReset: state.lastReset,
        heatmap: this.buildHeatmapResponse(state)
      }));

      socket.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }

        if (!message || typeof message !== 'object') return;
        if (message.type === 'click') {
          const { x, y } = message;
          if (isValidCoordinate(x) && isValidCoordinate(y)) {
            this.registerClick(state, { x, y, source: 'ws' });
          }
        }
      });

      socket.on('close', () => {
        state.clients.delete(socket);
      });
    });
  }

  registerClick(state, { x, y, source }) {
    const gx = Math.min(state.gridX - 1, Math.max(0, Math.floor(x * state.gridX)));
    const gy = Math.min(state.gridY - 1, Math.max(0, Math.floor(y * state.gridY)));
    const key = `${gx}:${gy}`;

    const bucket = state.buckets.get(key) || { count: 0 };
    bucket.count += 1;
    state.buckets.set(key, bucket);
    state.totalClicks += 1;

    const now = Date.now();
    if (now - state.lastBroadcast > BROADCAST_DEBOUNCE_MS) {
      this.broadcastHeatmap(state);
      state.lastBroadcast = now;
    }

    if (source === 'http' && state.clients.size === 0) {
      setTimeout(() => this.broadcastHeatmap(state), BROADCAST_DEBOUNCE_MS);
    }
  }

  broadcastHeatmap(state) {
    const payload = JSON.stringify({
      type: 'heatmap',
      streamerId: state.streamerId,
      data: this.buildHeatmapResponse(state)
    });

    for (const client of state.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  buildHeatmapResponse(state) {
    const clusters = [];
    const total = state.totalClicks || 1;

    for (const [key, bucket] of state.buckets.entries()) {
      const [gx, gy] = key.split(':').map(Number);
      const x = (gx + 0.5) / state.gridX;
      const y = (gy + 0.5) / state.gridY;
      const count = bucket.count;
      clusters.push({
        id: key,
        x,
        y,
        count,
        percentage: (count / total) * 100
      });
    }

    clusters.sort((a, b) => b.count - a.count);

    return {
      clusters,
      totalClicks: state.totalClicks,
      lastReset: state.lastReset
    };
  }

  setupHotkeys() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    readline.emitKeypressEvents(process.stdin, rl);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.on('keypress', (str, key) => {
      if (key && key.ctrl && key.name === 'c') {
        this.shutdown();
        return;
      }

      const sequence = key?.sequence || str;
      if (!sequence) return;

      this.handleHotkey(sequence);
    });

    console.log('');
    console.log('Local ClickMap server ready. Hotkeys:');
    console.log(`  • Reset active streamer (${this.activeStreamer}): ${this.config.hotkeys.resetHeatmap}`);
    console.log(`  • Next streamer: ${this.config.hotkeys.nextStreamer}`);
    console.log(`  • Previous streamer: ${this.config.hotkeys.previousStreamer}`);

    const switchers = Object.entries(this.config.hotkeys.switchToStreamer);
    if (switchers.length > 0) {
      for (const [streamerId, key] of switchers) {
        console.log(`  • Switch to ${streamerId}: ${key}`);
      }
    }

    console.log('Press Ctrl+C to stop the server.');
    console.log('');
  }

  handleHotkey(sequence) {
    if (sequence === this.config.hotkeys.resetHeatmap) {
      this.resetStreamer(this.activeStreamer, 'hotkey');
      return;
    }

    if (sequence === this.config.hotkeys.nextStreamer) {
      this.cycleStreamer(1);
      return;
    }

    if (sequence === this.config.hotkeys.previousStreamer) {
      this.cycleStreamer(-1);
      return;
    }

    for (const [streamerId, key] of Object.entries(this.config.hotkeys.switchToStreamer)) {
      if (sequence === key) {
        this.setActiveStreamer(streamerId, 'hotkey');
        return;
      }
    }
  }

  setActiveStreamer(streamerId, source = 'system') {
    if (!this.config.streamers[streamerId]) {
      console.warn(`Cannot set active streamer to "${streamerId}" – not found in configuration.`);
      return;
    }
    this.activeStreamer = streamerId;
    console.log(`🎯 Active streamer changed to ${streamerId} (${source})`);
  }

  cycleStreamer(delta) {
    const ids = Object.keys(this.config.streamers);
    const currentIndex = ids.indexOf(this.activeStreamer);
    const nextIndex = (currentIndex + delta + ids.length) % ids.length;
    this.setActiveStreamer(ids[nextIndex], 'cycle');
  }

  resetStreamer(streamerId, source = 'manual') {
    const state = this.getState(streamerId);
    state.buckets.clear();
    state.totalClicks = 0;
    state.lastReset = Date.now();
    console.log(`♻️  Heatmap reset for ${streamerId} (${source})`);
    const payload = JSON.stringify({ type: 'reset', streamerId });
    for (const client of state.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  start() {
    const { host, port } = this.config;
    this.httpServer.listen(port, host, () => {
      console.log(`🚀 Local ClickMap server listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    });
  }

  shutdown() {
    console.log('\nShutting down ClickMap server...');
    this.wsServer.close(() => {
      this.httpServer.close(() => {
        process.exit(0);
      });
    });
  }
}

function isValidCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--config' || current === '-c') {
      args.set('config', argv[++i]);
    } else if (current === '--check-config') {
      args.set('check-config', true);
    } else if (current === '--help' || current === '-h') {
      args.set('help', true);
    }
  }
  return args;
}

function printHelp() {
  console.log('Smart ClickMap local server');
  console.log('');
  console.log('Usage: node local-server.js [--config path/to/config.json]');
  console.log('');
  console.log('Options:');
  console.log('  --config, -c        Path to configuration JSON file');
  console.log('  --check-config      Validate configuration and exit');
  console.log('  --help, -h          Show this help message');
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.get('help')) {
    printHelp();
    process.exit(0);
  }

  const configPath = args.get('config') || process.env.CLICKMAP_CONFIG || DEFAULT_CONFIG_PATH;

  try {
    const config = loadConfig(configPath);

    if (args.get('check-config')) {
      console.log('Configuration OK');
      console.log(`Configured streamers: ${Object.keys(config.streamers).join(', ')}`);
      process.exit(0);
    }

    const server = new OverlayServer(config);
    server.start();
  } catch (error) {
    console.error('Failed to start local ClickMap server:', error.message);
    process.exit(1);
  }
})();
