/**
 * Admin Panel
 *
 * Controls for starting/stopping/resetting clickmap
 * Includes hotkey support and live preview
 */

class AdminPanel {
  constructor() {
    this.isRunning = false;
    this.ws = null;
    this.reconnectTimer = null;

    this.init();
  }

  init() {
    this.setupButtons();
    this.setupHotkeys();
    this.connectWebSocket();

    console.log('✅ Admin panel initialized');
  }

  setupButtons() {
    document.getElementById('btn-start').onclick = () => this.start();
    document.getElementById('btn-stop').onclick = () => this.stop();
    document.getElementById('btn-reset').onclick = () => this.reset();

    console.log('🔘 Buttons configured');
  }

  setupHotkeys() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+1: Toggle start/stop
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        this.isRunning ? this.stop() : this.start();
        console.log('⌨️ Hotkey: Toggle');
      }

      // Ctrl+2: Reset
      if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        this.reset();
        console.log('⌨️ Hotkey: Reset');
      }
    });

    console.log('⌨️ Hotkeys configured');
  }

  async start() {
    try {
      const response = await fetch('/start', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        console.log('▶️ Started');
      }
    } catch (e) {
      console.error('Failed to start:', e);
    }
  }

  async stop() {
    try {
      const response = await fetch('/stop', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        console.log('⏸️ Stopped');
      }
    } catch (e) {
      console.error('Failed to stop:', e);
    }
  }

  async reset() {
    if (!confirm('Reset all click data? This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('/reset', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        console.log('🗑️ Reset complete');
      }
    } catch (e) {
      console.error('Failed to reset:', e);
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(`🔌 Connecting to: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('✅ WebSocket connected');
      this.updateWsStatus(true);

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.updateUI(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('🔌 WebSocket closed');
      this.updateWsStatus(false);

      // Reconnect after 3 seconds
      this.reconnectTimer = setTimeout(() => {
        console.log('🔄 Reconnecting...');
        this.connectWebSocket();
      }, 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  updateUI(data) {
    this.isRunning = data.running || false;

    // Status indicator
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    indicator.className = data.running ? 'status-running' : 'status-stopped';
    statusText.textContent = data.running ? 'Running' : 'Stopped';

    // Stats
    document.getElementById('stat-clicks').textContent = (data.totalClicks || 0).toLocaleString();
    document.getElementById('stat-users').textContent = (data.uniqueUsers || 0).toLocaleString();
    document.getElementById('stat-clusters').textContent = data.clusters?.length || 0;

    // Preview canvas
    this.renderPreview(data.clusters || []);
  }

  updateWsStatus(connected) {
    const wsStatus = document.getElementById('ws-status');
    wsStatus.className = connected ? 'ws-connected' : 'ws-disconnected';
    wsStatus.title = connected ? 'WebSocket Connected' : 'WebSocket Disconnected';
  }

  renderPreview(clusters) {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (clusters.length === 0) {
      // Show "No data" message
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No clusters', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Render clusters
    for (const cluster of clusters) {
      const x = cluster.x * canvas.width;
      const y = cluster.y * canvas.height;
      const r = (cluster.visualSize || 30) * (canvas.width / 1920);

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = cluster.isTop
        ? 'rgba(0, 255, 255, 0.3)'
        : 'rgba(147, 51, 234, 0.3)';
      ctx.fill();

      ctx.strokeStyle = cluster.isTop
        ? 'rgba(0, 255, 255, 0.8)'
        : 'rgba(147, 51, 234, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Percentage text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Text shadow for readability
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(`${cluster.percentage}%`, x, y);

      // Reset shadow
      ctx.shadowBlur = 0;
    }
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
  });
} else {
  window.adminPanel = new AdminPanel();
}
