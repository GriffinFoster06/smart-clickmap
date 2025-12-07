# Troubleshooting Guide

Common issues and solutions for Smart Clickmap.

---

## Backend Issues

### Backend won't start

**Error: "Node.js is not installed"**

**Solution:**
```bash
# Check Node.js installation
node --version

# If not installed, download from:
# https://nodejs.org/ (version 18+)
```

**Error: "Port 8080 already in use"**

**Check what's using port 8080:**
```bash
# Mac/Linux
lsof -i :8080

# Windows
netstat -ano | findstr :8080
```

**Solutions:**
1. Stop the other process
2. Or change port in `config/default.json`:
   ```json
   {
     "server": {
       "port": 8081
     }
   }
   ```

**Error: "Cannot find module 'express'"**

**Solution:**
```bash
cd backend
npm install
```

**Error: "Permission denied"**

**Linux/Mac:**
```bash
chmod +x scripts/start.sh
./scripts/start.sh
```

**Windows:** Run as Administrator

### Backend crashes immediately

**Check logs for errors:**
```bash
cd backend
node server.js
# Read error message carefully
```

**Common causes:**
- Invalid JSON in `config/default.json`
- Missing dependencies
- File permissions

**Validate config JSON:**
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config/default.json')))"
```

### High CPU usage

**Reduce sampling and broadcast frequency:**

`config/default.json`:
```json
{
  "sampling": {
    "client": 20,
    "server": 10
  },
  "server": {
    "broadcastInterval": 10000
  }
}
```

**Check memory usage:**
```bash
# While server is running
curl http://localhost:8080/status
```

---

## WebSocket Issues

### WebSocket won't connect

**Symptoms:**
- Red dot in admin panel
- "WebSocket closed" in console
- No real-time updates

**Check 1: Backend is running**
```bash
curl http://localhost:8080/status
```

Should return JSON, not an error.

**Check 2: WebSocket endpoint**

Open browser console (F12) on admin or viewer page:
```
🔌 Connecting to: ws://localhost:8080/ws
```

If you see errors, check:
- Backend is listening on port 8080
- Firewall allows WebSocket connections

**Check 3: Browser console errors**

Look for:
- `WebSocket connection failed`
- `ERR_CONNECTION_REFUSED`
- `403 Forbidden`

**Solution: Firewall**
```bash
# Mac
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /path/to/node

# Linux
sudo ufw allow 8080

# Windows
# Windows Defender Firewall → Allow an app
```

### WebSocket disconnects frequently

**Increase heartbeat interval:**

Edit `frontend/obs/overlay.js` or `frontend/admin/admin.js`:
```javascript
const HEARTBEAT_INTERVAL = 25000; // Change to 60000 for 1 minute
```

**Check network stability:**
```bash
ping localhost
# Should have 0% packet loss
```

**For Cloudflare Tunnel:**
- Cloudflare may close idle connections after 100 seconds
- Heartbeat prevents this (already implemented)

---

## Click Detection Issues

### Clicks not appearing in admin panel

**Check 1: Game is running**
- Admin panel shows "Running" status
- Green dot indicator

**Start game if stopped:**
```bash
curl -X POST http://localhost:8080/start
```

**Check 2: Sampling not too aggressive**

`config/default.json`:
```json
{
  "sampling": {
    "client": 10,  // Lower = more clicks sent
    "server": 5    // Lower = more clicks processed
  }
}
```

Try setting both to 1 temporarily:
```json
{
  "sampling": {
    "client": 1,
    "server": 1
  }
}
```

**Check 3: Browser console**

Open viewer page, press F12, click on video.

Look for:
```
Failed to send batch: ...
```

If you see errors, backend may not be reachable.

**Check 4: Click layer is on top**

Viewer page should have transparent click layer over video.

Inspect element (F12) → check `#click-layer` has:
```css
z-index: 100;
pointer-events: auto;
```

### Clicks detected but not showing in OBS

**Check 1: OBS browser source URL**
```
http://localhost:8080/obs
```

**NOT:**
- `http://localhost:8080/viewer/...`
- `http://localhost:8080/admin`

**Check 2: Refresh OBS browser source**

Right-click source → **Refresh**

**Check 3: OBS browser source logs**

Right-click source → **Interact** → press F12 for console

Look for errors.

**Check 4: Clustering threshold**

If percentage < 3%, cluster won't show.

Lower threshold in `config/default.json`:
```json
{
  "clustering": {
    "threshold": 1
  }
}
```

---

## OBS Overlay Issues

### Overlay is blank/black

**Check 1: Backend is running**
```bash
curl http://localhost:8080/status
```

**Check 2: Correct URL**
- URL: `http://localhost:8080/obs`
- Width: 1920
- Height: 1080

**Check 3: Canvas element**

OBS browser → Interact → F12 → Console

Check for:
```
❌ Canvas not found
```

If you see this, overlay.html is corrupt. Re-download.

**Check 4: Hardware acceleration**

OBS Settings → Advanced → enable **"Enable Browser Source Hardware Acceleration"**

### Overlay frozen/not updating

**Check WebSocket connection:**

OBS browser → Interact → F12 → Console

Look for:
```
✅ WebSocket connected
```

If disconnected:
```
🔌 WebSocket closed
```

**Solution:** Backend might have restarted. Refresh OBS source.

**Check HTTP fallback:**

Should see:
```
📡 Falling back to HTTP polling
```

This is normal if WebSocket fails.

### Clusters not animating smoothly

**Increase OBS FPS:**

Browser source properties:
- FPS: **60** (not 30)

**Disable frame skipping:**

Browser source properties:
- ✅ Check "Shutdown source when not visible"
- ✅ Check "Refresh browser when scene becomes active"

**Check CPU usage:**

If CPU is high, reduce cluster count:

`config/default.json`:
```json
{
  "clustering": {
    "maxClusters": 10
  }
}
```

### Text is too small/big

**Modify overlay.js:**

`frontend/obs/overlay.js` line ~326:
```javascript
const fontSize = Math.max(35, Math.min(75, radius * 0.75));
// Change multiplier: 0.75 = current size
// Try 0.5 for smaller, 1.0 for larger
```

Refresh OBS browser source after saving.

---

## Cloudflare Tunnel Issues

### Tunnel won't start

**Error: "cloudflared: command not found"**

Not installed. See [CLOUDFLARE.md](CLOUDFLARE.md) for installation.

**Error: "failed to sufficiently increase receive buffer size"**

**Linux solution:**
```bash
sudo sysctl -w net.core.rmem_max=2500000
```

**Error: "Invalid tunnel configuration"**

**Check config file:**
```bash
cat ~/.cloudflared/config.yml
```

**Validate:**
```bash
cloudflared tunnel ingress validate
```

**Common issues:**
- Wrong tunnel ID
- Wrong credentials file path
- Invalid YAML syntax (check indentation)

### 502 Bad Gateway on public URL

**Cause:** Backend server not running or wrong port

**Check backend:**
```bash
curl http://localhost:8080/status
```

**Check tunnel config:**
```yaml
ingress:
  - hostname: clickmap.yourdomain.com
    service: http://localhost:8080  # Port must match backend
```

**Check firewall:**
```bash
# Mac
sudo lsof -i :8080

# Should show node process listening
```

### DNS not resolving

**Wait 5-10 minutes** for propagation

**Check DNS:**
```bash
nslookup clickmap.yourdomain.com
dig clickmap.yourdomain.com
```

**Should return Cloudflare IP** (104.x.x.x range)

**Force DNS update:**
```bash
cloudflared tunnel route dns clickmap clickmap.yourdomain.com --overwrite-dns
```

**Check Cloudflare Dashboard:**
- DNS → Records
- Should have CNAME: `clickmap` → `YOUR_TUNNEL_ID.cfargotunnel.com`

### Tunnel disconnects randomly

**Check tunnel status:**
```bash
cloudflared tunnel list
```

**Should show 4 connections.** If 0:
```bash
cloudflared tunnel run clickmap
```

**Check logs:**
```bash
# Linux
sudo journalctl -u cloudflared -f

# Mac
tail -f /var/log/cloudflared.log

# Manual run
cloudflared tunnel run clickmap --loglevel debug
```

**Common causes:**
- Internet connection issues
- Cloudflare outage (check status.cloudflare.com)
- Tunnel expired (recreate: `cloudflared tunnel delete clickmap && cloudflared tunnel create clickmap`)

---

## Performance Issues

### High memory usage

**Check memory:**
```bash
curl http://localhost:8080/status
```

Look at `memory.heapUsed`.

**Reduce click retention:**

`config/default.json`:
```json
{
  "memory": {
    "maxClicksInMemory": 5000,
    "clickMaxAge": 1800000
  }
}
```

**Force garbage collection:**

Restart backend: `Ctrl+C` then `./scripts/start.sh`

### High bandwidth usage

**Reduce broadcast frequency:**

`config/default.json`:
```json
{
  "server": {
    "broadcastInterval": 10000
  }
}
```

**Increase sampling:**
```json
{
  "sampling": {
    "client": 20,
    "server": 10
  }
}
```

### Slow cluster updates

**Symptoms:** OBS overlay updates every 10+ seconds

**Check broadcast interval:**

Should be 5000ms (5 seconds) by default.

**Check WebSocket connection:**

OBS browser → Interact → F12 → Console

Should see:
```
✅ WebSocket connected
```

If using HTTP fallback:
```
📡 Falling back to HTTP polling
```

HTTP is slower (8-15 second intervals).

**Fix:** Ensure WebSocket connects properly.

---

## Common Configuration Mistakes

### Wrong Twitch channel name

`config/default.json`:
```json
{
  "twitchChannel": "phummylw"  // Must be exact Twitch username
}
```

**Check your Twitch username:**
- Go to twitch.tv
- Click your profile
- Username is in URL: `twitch.tv/YOUR_USERNAME`

### Invalid JSON

**Error: "Unexpected token ..."**

**Validate JSON:**
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config/default.json')))"
```

**Common mistakes:**
- Trailing comma: `"port": 8080,` (remove last comma)
- Missing quotes: `twitchChannel: phummylw` (should be `"twitchChannel": "phummylw"`)
- Comments in JSON (not allowed)

### Wrong file paths

**Backend can't find config:**

```bash
# Check config exists
ls -la config/default.json

# Check backend looks in right place
cd backend
node -e "console.log(require('path').join(__dirname, '../config/default.json'))"
```

---

## Debugging Tips

### Enable verbose logging

**Backend:**

Edit `backend/server.js`, add at top:
```javascript
process.env.DEBUG = '*';
```

Restart backend.

### Check HTTP endpoints manually

```bash
# Get status
curl http://localhost:8080/status

# Get heatmap data
curl http://localhost:8080/heatmap

# Start game
curl -X POST http://localhost:8080/start

# Stop game
curl -X POST http://localhost:8080/stop

# Reset data
curl -X POST http://localhost:8080/reset
```

### Browser console debugging

**Viewer page (F12):**
```javascript
// Check click collector
console.log(window.clickCollector);

// Check WebSocket
console.log(window.clickCollector.ws.readyState);
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED

// Manual click test
window.clickCollector.handleClick({ clientX: 500, clientY: 500 });
```

**Admin page (F12):**
```javascript
// Check panel
console.log(window.adminPanel);

// Check WebSocket
console.log(window.adminPanel.ws.readyState);

// Force UI update
window.adminPanel.updateUI({
  running: true,
  totalClicks: 100,
  uniqueUsers: 50,
  clusters: []
});
```

**OBS overlay (Interact → F12):**
```javascript
// Check overlay
console.log(window.optimalOverlay);

// Get status
console.log(window.optimalOverlay.getStatus());

// Force update
window.optimalOverlay.renderer.updateClusters([
  { x: 0.5, y: 0.5, percentage: 50, visualSize: 100, isTop: true }
]);
```

---

## Still Having Issues?

### Check System Requirements

- **Node.js:** 18.0.0 or higher
- **RAM:** 2GB minimum, 4GB recommended
- **CPU:** 2 cores minimum
- **OS:** Windows 10+, macOS 10.15+, Linux (any modern distro)

### Collect Debug Info

Before reporting an issue:

1. **Backend version:**
   ```bash
   node --version
   cat backend/package.json | grep version
   ```

2. **System info:**
   ```bash
   uname -a  # Mac/Linux
   systeminfo  # Windows
   ```

3. **Logs:**
   - Backend console output
   - Browser console (F12)
   - Cloudflare tunnel logs

4. **Config:**
   ```bash
   cat config/default.json
   ```

### Report an Issue

Include:
- Debug info (above)
- Steps to reproduce
- Expected vs actual behavior
- Screenshots/videos if applicable

---

## Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| Port in use | Change port in config |
| WebSocket fails | Check firewall, restart backend |
| Clicks not appearing | Check game is running, lower sampling |
| OBS blank | Check URL is `/obs`, refresh source |
| High CPU | Increase sampling, reduce broadcast |
| Tunnel 502 | Check backend running, check port |
| DNS not resolving | Wait 10 min, check CNAME record |

---

Need more help? See:
- [SETUP.md](SETUP.md) - Setup instructions
- [CLOUDFLARE.md](CLOUDFLARE.md) - Tunnel guide
- `config/README.md` - Configuration options
