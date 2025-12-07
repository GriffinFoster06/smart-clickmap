/**
 * High-Throughput Click Engine
 *
 * Designed to handle 20,000 clicks/sec spike loads with:
 * - Server-side sampling (1-in-N)
 * - Batch processing (50ms timeout, 1000 click batches)
 * - Memory limits with age-based pruning
 * - Stats tracking
 */

export class HighThroughputClickEngine {
  constructor(config = {}) {
    // Configuration
    this.samplingRate = config.sampling?.server || 5;  // 1-in-5 default
    this.maxClicksInMemory = config.memory?.maxClicksInMemory || 10000;
    this.clickMaxAge = config.memory?.clickMaxAge || 3600000;  // 1 hour

    // Data structures (optimized for high throughput)
    this.clicks = new Map();           // clientId → [{x, y, ts}]
    this.clickCount = 0;               // Total clicks processed
    this.uniqueClients = new Set();    // Unique viewer tracking

    // Batch processing
    this.pendingBatch = [];
    this.batchTimer = null;
    this.BATCH_SIZE = 1000;
    this.BATCH_TIMEOUT_MS = 50;

    // Stats
    this.stats = {
      received: 0,
      sampled: 0,
      processed: 0,
      lastBatchTime: 0,
      batchesFlushed: 0
    };

    // Memory cleanup
    this.cleanupInterval = config.memory?.cleanupInterval || 30000;
    this.startCleanupTimer();
  }

  /**
   * Fast click ingestion with server-side sampling
   * @param {number} x - Normalized X coordinate (0-1)
   * @param {number} y - Normalized Y coordinate (0-1)
   * @param {string} clientId - Unique client identifier
   * @returns {Object} Result with processed and sampled flags
   */
  addClick(x, y, clientId) {
    this.stats.received++;

    // Server-side sampling: 1-in-N
    if (!this.shouldProcess()) {
      this.stats.sampled++;
      return { processed: false, sampled: true };
    }

    // Add to pending batch
    this.pendingBatch.push({ x, y, clientId, ts: Date.now() });

    // Process batch when full or after timeout
    if (this.pendingBatch.length >= this.BATCH_SIZE) {
      this.flushBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushBatch(), this.BATCH_TIMEOUT_MS);
    }

    return { processed: true, sampled: false };
  }

  /**
   * Deterministic sampling
   * @returns {boolean} True if click should be processed
   */
  shouldProcess() {
    return Math.random() < (1 / this.samplingRate);
  }

  /**
   * Flush pending batch to memory
   */
  flushBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingBatch.length === 0) return;

    const batch = this.pendingBatch;
    this.pendingBatch = [];

    for (const click of batch) {
      this.storeClick(click);
    }

    this.stats.lastBatchTime = Date.now();
    this.stats.batchesFlushed++;
  }

  /**
   * Store click in memory with limits
   * @param {Object} click - Click data {x, y, clientId, ts}
   */
  storeClick({ x, y, clientId, ts }) {
    this.uniqueClients.add(clientId);

    if (!this.clicks.has(clientId)) {
      this.clicks.set(clientId, []);
    }

    const clientClicks = this.clicks.get(clientId);
    clientClicks.push({ x, y, ts });

    // Limit per-client clicks (prevent single client from filling memory)
    if (clientClicks.length > 100) {
      clientClicks.shift();
    }

    this.clickCount++;
    this.stats.processed++;

    // Global memory limit
    if (this.clickCount > this.maxClicksInMemory) {
      this.pruneOldest();
    }
  }

  /**
   * Get all clicks for clustering
   * @returns {Array} Array of {x, y, clientId}
   */
  getAllClicks() {
    const allClicks = [];
    for (const [clientId, clicks] of this.clicks) {
      for (const click of clicks) {
        allClicks.push({ x: click.x, y: click.y, clientId });
      }
    }
    return allClicks;
  }

  /**
   * Memory management - prune clicks older than max age
   */
  pruneOldest() {
    const cutoff = Date.now() - this.clickMaxAge;
    let prunedCount = 0;

    for (const [clientId, clicks] of this.clicks) {
      const filtered = clicks.filter(c => c.ts > cutoff);
      const removed = clicks.length - filtered.length;

      if (filtered.length === 0) {
        this.clicks.delete(clientId);
        this.uniqueClients.delete(clientId);
      } else {
        this.clicks.set(clientId, filtered);
      }

      prunedCount += removed;
    }

    this.clickCount -= prunedCount;

    if (prunedCount > 0) {
      console.log(`[ClickEngine] Pruned ${prunedCount} old clicks (age > ${this.clickMaxAge}ms)`);
    }
  }

  /**
   * Start automatic cleanup timer
   */
  startCleanupTimer() {
    setInterval(() => {
      this.pruneOldest();
    }, this.cleanupInterval);
  }

  /**
   * Full reset - clear all data
   */
  reset() {
    this.clicks.clear();
    this.uniqueClients.clear();
    this.clickCount = 0;
    this.pendingBatch = [];

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.stats.received = 0;
    this.stats.sampled = 0;
    this.stats.processed = 0;

    console.log('[ClickEngine] Reset complete');
  }

  /**
   * Get current stats
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      totalClicks: this.clickCount,
      uniqueUsers: this.uniqueClients.size,
      received: this.stats.received,
      sampled: this.stats.sampled,
      processed: this.stats.processed,
      batchesFlushed: this.stats.batchesFlushed,
      lastBatchTime: this.stats.lastBatchTime,
      samplingRate: this.samplingRate,
      memoryUsage: {
        clients: this.clicks.size,
        totalClicks: this.clickCount,
        maxClicks: this.maxClicksInMemory
      }
    };
  }
}
