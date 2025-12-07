/**
 * Standalone Click Collector
 *
 * High-performance click capture with:
 * - Client-side sampling (1-in-N)
 * - Batch sending (100ms intervals or 50 click max)
 * - WebSocket state synchronization
 * - Visual feedback
 */

class StandaloneClickCollector {
  constructor() {
    // Configuration (loaded from server)
    this.config = null;
    this.streamerSlug = this.getStreamerSlug();

    // Client identity
    this.clientId = this.getOrCreateClientId();

    // Sampling config (1-in-10 default)
    this.sampleRate = 10;

    // Batch settings
    this.clickBatch = [];
    this.BATCH_INTERVAL_MS = 100;      // Send every 100ms
    this.MAX_BATCH_SIZE = 50;          // Or when 50 clicks accumulated
    this.batchTimer = null;

    // State
    this.isRunning = false;
    this.wsConnected = false;
    this.ws = null;

    // Stats
    this.stats = {
      totalClicks: 0,
      sentClicks: 0,
      sampledOut: 0
    };

    this.init();
  }

  async init() {
    await this.loadConfig();
    this.setupTwitchEmbed();
    this.setupClickLayer();
    this.connectWebSocket();
    this.startBatchLoop();

    console.log('✅ Standalone Click Collector initialized');
  }

  getStreamerSlug() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1] || 'default';
  }

  getOrCreateClientId() {
    let clientId = localStorage.getItem('clickmap_client_id');
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem('clickmap_client_id', clientId);
    }
    return clientId;
  }

  async loadConfig() {
    try {
      const res = await fetch('/config');
      this.config = await res.json();
      this.sampleRate = this.config.sampling?.client || 10;
      console.log(`📋 Config loaded: sampling 1-in-${this.sampleRate}, channel: ${this.config.twitchChannel}`);
    } catch (e) {
      console.warn('Using default config:', e.message);
      this.sampleRate = 10;
      this.config = { twitchChannel: this.streamerSlug };
    }
  }

  setupTwitchEmbed() {
    const channel = this.config?.twitchChannel || this.streamerSlug;

    new Twitch.Embed('twitch-embed', {
      channel: channel,
      width: '100%',
      height: '100%',
      layout: 'video',
      muted: true,
      parent: [window.location.hostname, 'localhost']
    });

    console.log(`📺 Twitch embed initialized for channel: ${channel}`);
  }

  setupClickLayer() {
    const layer = document.getElementById('click-layer');

    // Mouse clicks
    layer.addEventListener('click', (e) => this.handleClick(e));

    // Touch support
    layer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.handleClick({ clientX: touch.clientX, clientY: touch.clientY });
    }, { passive: false });

    console.log('👆 Click layer setup complete');
  }

  handleClick(e) {
    if (!this.isRunning) return;

    this.stats.totalClicks++;

    // CLIENT-SIDE SAMPLING: 1-in-N clicks
    if (!this.shouldSample()) {
      this.stats.sampledOut++;
      return;
    }

    // Normalize coordinates to 0-1
    const rect = document.getElementById('click-layer').getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Validate coordinates
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    // Add to batch (don't send immediately!)
    this.clickBatch.push({ x, y, t: Date.now() });

    // Force flush if batch is full
    if (this.clickBatch.length >= this.MAX_BATCH_SIZE) {
      this.flushBatch();
    }

    // Visual feedback
    this.showClickFeedback(e.clientX, e.clientY);
  }

  shouldSample() {
    // Deterministic sampling: 1-in-N
    return Math.random() < (1 / this.sampleRate);
  }

  startBatchLoop() {
    this.batchTimer = setInterval(() => {
      if (this.clickBatch.length > 0) {
        this.flushBatch();
      }
    }, this.BATCH_INTERVAL_MS);

    console.log(`⏱️ Batch loop started (${this.BATCH_INTERVAL_MS}ms interval)`);
  }

  async flushBatch() {
    if (this.clickBatch.length === 0) return;

    const batch = this.clickBatch;
    this.clickBatch = [];

    // Send batch to server
    try {
      const response = await fetch('/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clicks: batch.map(c => ({ x: c.x, y: c.y })),
          clientId: this.clientId,
          count: batch.length
        })
      });

      if (response.ok) {
        this.stats.sentClicks += batch.length;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      console.error('Failed to send batch:', e.message);

      // On failure, re-queue the batch (with limit to prevent memory issues)
      if (this.clickBatch.length < 100) {
        this.clickBatch = [...batch, ...this.clickBatch];
      }
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.wsConnected = true;
      this.updateStatus('Connected');
      console.log('✅ WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if ('running' in data) {
          const wasRunning = this.isRunning;
          this.isRunning = data.running;

          if (wasRunning !== this.isRunning) {
            console.log(`🎮 State changed: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`);
          }

          this.updateStatus(this.isRunning ? 'Active - Click to participate!' : 'Paused');
        }

        if (data.action === 'reset') {
          this.stats = { totalClicks: 0, sentClicks: 0, sampledOut: 0 };
          console.log('🗑️ Stats reset');
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.wsConnected = false;
      this.updateStatus('Reconnecting...');
      console.log('🔌 WebSocket closed, reconnecting in 3s...');

      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  updateStatus(text) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = this.isRunning ? 'active' : (this.wsConnected ? 'connected' : 'connecting');
    }
  }

  showClickFeedback(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.body.appendChild(ripple);

    setTimeout(() => ripple.remove(), 500);
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.clickCollector = new StandaloneClickCollector();
  });
} else {
  window.clickCollector = new StandaloneClickCollector();
}
