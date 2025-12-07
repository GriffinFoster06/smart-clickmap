# Configuration Guide

This file documents all configuration options for the Smart Clickmap standalone server.

## Configuration File Location

The default configuration is located at `config/default.json`.

You can override the location by setting the `CONFIG_PATH` environment variable:

```bash
CONFIG_PATH=/path/to/custom-config.json node backend/server.js
```

---

## Configuration Options

### `twitchChannel` (string, required)

Your Twitch channel username.

**Example:**
```json
"twitchChannel": "phummylw"
```

**Used by:**
- Viewer page: Embeds your Twitch stream
- Server: Default redirect from root URL

---

### `server` (object)

Server-level configuration.

#### `server.port` (number, default: 8080)

Port number for the HTTP/WebSocket server.

**Example:**
```json
"server": {
  "port": 8080
}
```

**Range:** 1024-65535 (avoid ports below 1024 on Linux without sudo)

#### `server.broadcastInterval` (number, default: 5000)

How often (in milliseconds) to broadcast cluster updates to connected clients via WebSocket.

**Example:**
```json
"server": {
  "broadcastInterval": 5000
}
```

**Range:** 1000-30000 ms
- Lower = More real-time, higher CPU usage
- Higher = Less real-time, lower CPU usage

**Recommended:** 5000ms (5 seconds) for balance

---

### `sampling` (object)

Click sampling configuration for performance.

#### `sampling.client` (number, default: 10)

Client-side sampling rate. Only 1-in-N clicks are sent to the server.

**Example:**
```json
"sampling": {
  "client": 10
}
```

**Math:**
- `10` = Only 10% of clicks sent to server (1-in-10)
- `20` = Only 5% of clicks sent to server (1-in-20)

**Recommended:** 10-20 for most streams

#### `sampling.server` (number, default: 5)

Server-side sampling rate. Only 1-in-N received clicks are processed.

**Example:**
```json
"sampling": {
  "server": 5
}
```

**Math:**
- With client=10, server=5: Only 2% of total clicks are processed
- 20,000 clicks/sec → 2,000 sent → 400 processed

**Recommended:** 5-10

---

### `clustering` (object)

Clustering algorithm parameters.

#### `clustering.threshold` (number, default: 3)

Minimum percentage required for a cluster to be displayed.

**Example:**
```json
"clustering": {
  "threshold": 3
}
```

**Range:** 1-10
- Lower = More clusters shown (including small ones)
- Higher = Only major clusters shown

**Recommended:** 3-5

#### `clustering.maxClusters` (number, default: 20)

Maximum number of clusters to display.

**Example:**
```json
"clustering": {
  "maxClusters": 20
}
```

**Range:** 5-50
- Too many clusters = visual clutter
- Too few = miss important data

**Recommended:** 15-25

#### `clustering.mergeDistance` (number, default: 0.05)

Base distance for merging nearby clusters (normalized 0-1 coordinate space).

**Example:**
```json
"clustering": {
  "mergeDistance": 0.05
}
```

**Range:** 0.01-0.15
- Lower = More distinct clusters
- Higher = More aggressive merging

**Note:** The clustering algorithm dynamically adjusts this based on click density.

---

### `memory` (object)

Memory management configuration.

#### `memory.maxClicksInMemory` (number, default: 10000)

Maximum number of clicks to keep in memory.

**Example:**
```json
"memory": {
  "maxClicksInMemory": 10000
}
```

**Memory usage estimate:** ~100 bytes per click
- 10,000 clicks ≈ 1 MB
- 100,000 clicks ≈ 10 MB

**Recommended:** 10,000-50,000

#### `memory.clickMaxAge` (number, default: 3600000)

Maximum age of clicks in milliseconds before they are pruned.

**Example:**
```json
"memory": {
  "clickMaxAge": 3600000
}
```

**Common values:**
- `3600000` = 1 hour
- `1800000` = 30 minutes
- `7200000` = 2 hours

**Recommended:** 1-2 hours for most use cases

#### `memory.cleanupInterval` (number, default: 30000)

How often (in milliseconds) to run memory cleanup.

**Example:**
```json
"memory": {
  "cleanupInterval": 30000
}
```

**Range:** 10000-60000 ms (10-60 seconds)

**Recommended:** 30000ms (30 seconds)

---

### `hotkeys` (object)

Hotkey configuration (future: Electron global hotkeys).

#### `hotkeys.toggle` (string, default: "Ctrl+1")

Hotkey to start/stop click collection.

**Example:**
```json
"hotkeys": {
  "toggle": "Ctrl+1"
}
```

**Supported modifiers:** Ctrl, Alt, Shift
**Supported keys:** 0-9, A-Z, Numpad0-Numpad9

**Note:** Currently browser-based (admin panel only). Future Electron version will support global hotkeys.

#### `hotkeys.reset` (string, default: "Ctrl+2")

Hotkey to reset all click data.

**Example:**
```json
"hotkeys": {
  "reset": "Ctrl+2"
}
```

---

## Example Configurations

### High-Performance Configuration (Minimal CPU usage)

```json
{
  "twitchChannel": "your_channel",
  "server": {
    "port": 8080,
    "broadcastInterval": 10000
  },
  "sampling": {
    "client": 20,
    "server": 10
  },
  "clustering": {
    "threshold": 5,
    "maxClusters": 15
  },
  "memory": {
    "maxClicksInMemory": 5000,
    "clickMaxAge": 1800000,
    "cleanupInterval": 60000
  }
}
```

**Characteristics:**
- Aggressive sampling (only 0.5% of clicks processed)
- Higher threshold (fewer clusters)
- Lower memory usage
- Less frequent updates

---

### High-Fidelity Configuration (Maximum detail)

```json
{
  "twitchChannel": "your_channel",
  "server": {
    "port": 8080,
    "broadcastInterval": 3000
  },
  "sampling": {
    "client": 5,
    "server": 3
  },
  "clustering": {
    "threshold": 2,
    "maxClusters": 30
  },
  "memory": {
    "maxClicksInMemory": 50000,
    "clickMaxAge": 7200000,
    "cleanupInterval": 20000
  }
}
```

**Characteristics:**
- Light sampling (6.7% of clicks processed)
- Lower threshold (more small clusters visible)
- Higher memory usage
- More frequent updates
- Requires more powerful hardware

---

## Validation Rules

When editing the configuration file, ensure:

1. **JSON syntax is valid** - Use a JSON validator
2. **Numbers are within recommended ranges**
3. **Twitch channel name is correct** - Must match your Twitch username exactly
4. **Port is not in use** - Check if another application is using the port

---

## Applying Configuration Changes

After editing `config/default.json`:

1. Save the file
2. Restart the backend server:
   ```bash
   # Press Ctrl+C to stop
   # Then restart:
   npm start
   ```

3. Configuration changes take effect immediately on restart

---

## Troubleshooting

### Server won't start

- Check JSON syntax with a validator
- Ensure port is not already in use
- Check file permissions

### Too many/too few clusters

- Adjust `clustering.threshold` and `clustering.maxClusters`
- Lower threshold = more clusters
- Higher threshold = fewer clusters

### Performance issues

- Increase sampling rates (higher numbers = less load)
- Increase `broadcastInterval`
- Reduce `maxClicksInMemory`

### Clicks not appearing

- Check `sampling.client` and `sampling.server` aren't too aggressive
- Ensure game is started (POST /start)
- Check browser console for errors

---

## Advanced: Environment Variables

You can override configuration via environment variables:

```bash
PORT=9000 CONFIG_PATH=/custom/config.json node backend/server.js
```

**Supported variables:**
- `PORT` - Overrides `server.port`
- `NODE_ENV` - Set to `production` for production mode
- `CONFIG_PATH` - Path to custom config file
