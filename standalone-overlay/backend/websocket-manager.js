/**
 * WebSocket Manager
 *
 * Handles WebSocket connections, broadcasting, and automatic update loops
 */

export class WebSocketManager {
  constructor(wss, config = {}) {
    this.wss = wss;
    this.clients = new Set();
    this.broadcastInterval = config.server?.broadcastInterval || 5000;  // 5 seconds default
    this.broadcastTimer = null;
    this.onBroadcastCallback = null;

    this.setupServer();
  }

  /**
   * Setup WebSocket server event handlers
   */
  setupServer() {
    this.wss.on('connection', (ws, req) => {
      console.log(`[WebSocket] Client connected (${this.clients.size + 1} total)`);
      this.clients.add(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch (e) {
          console.error('[WebSocket] Failed to parse message:', e.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected (${this.clients.size} remaining)`);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Client error:', error.message);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Handle incoming messages from clients
   * @param {WebSocket} ws - Client WebSocket connection
   * @param {Object} msg - Parsed message object
   */
  handleClientMessage(ws, msg) {
    if (msg.type === 'heartbeat' || msg.type === 'ping') {
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: Date.now()
      }));
    }
  }

  /**
   * Broadcast data to all connected clients
   * @param {Object} data - Data to broadcast
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    let sentCount = 0;

    for (const client of this.clients) {
      if (client.readyState === 1) {  // WebSocket.OPEN
        try {
          client.send(message);
          sentCount++;
        } catch (e) {
          console.error('[WebSocket] Failed to send to client:', e.message);
        }
      }
    }

    if (sentCount > 0) {
      console.log(`[WebSocket] Broadcast to ${sentCount} clients`);
    }
  }

  /**
   * Force immediate broadcast (for critical updates like start/stop/reset)
   * @param {Object} data - Data to broadcast
   */
  forceImmediateBroadcast(data) {
    console.log('[WebSocket] Force immediate broadcast');
    this.broadcast(data);
  }

  /**
   * Start automatic broadcast loop
   * @param {Function} callback - Function to call to get broadcast data
   */
  startBroadcastLoop(callback) {
    this.onBroadcastCallback = callback;

    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
    }

    this.broadcastTimer = setInterval(() => {
      if (this.onBroadcastCallback && this.clients.size > 0) {
        const data = this.onBroadcastCallback();
        if (data) {
          this.broadcast(data);
        }
      }
    }, this.broadcastInterval);

    console.log(`[WebSocket] Broadcast loop started (interval: ${this.broadcastInterval}ms)`);
  }

  /**
   * Stop broadcast loop
   */
  stopBroadcastLoop() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
      console.log('[WebSocket] Broadcast loop stopped');
    }
  }

  /**
   * Get current client count
   * @returns {number} Number of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }
}
