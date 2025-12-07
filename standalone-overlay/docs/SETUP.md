# Smart Clickmap - Setup Guide

Complete guide for setting up and running your standalone clickmap.

---

## Prerequisites

### Required

- **Node.js 18+** - [Download](https://nodejs.org/)
- **A Twitch account** - Your channel name

### Optional (for public access)

- **Cloudflare account** (free tier) - [Sign up](https://dash.cloudflare.com/sign-up)
- **cloudflared CLI** - [Install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
- **A domain name** - Can use Cloudflare's free subdomain

---

## Quick Start (5 minutes)

### Step 1: Configure

1. Open `config/default.json`
2. Change `twitchChannel` to your Twitch username:

```json
{
  "twitchChannel": "YOUR_TWITCH_USERNAME",
  ...
}
```

### Step 2: Start Backend

**Linux/Mac:**
```bash
chmod +x scripts/start.sh
./scripts/start.sh
```

**Windows:**
```batch
scripts\start.bat
```

You should see:
```
✅ Node.js v18.x.x detected
🚀 Starting server on port 8080...
📍 Access URLs:
   Viewer:  http://localhost:8080/viewer/YOUR_CHANNEL
   Admin:   http://localhost:8080/admin
   OBS:     http://localhost:8080/obs
```

### Step 3: Test Locally

1. **Open Admin Panel:**
   - Go to `http://localhost:8080/admin`
   - Click **"▶ Start"** button

2. **Open Viewer Page:**
   - Go to `http://localhost:8080/viewer/YOUR_CHANNEL`
   - You should see your Twitch stream
   - Click anywhere on the video

3. **Check Admin Panel:**
   - You should see click stats updating
   - Clusters should appear in the preview

### Step 4: Add to OBS

1. In OBS, add a **Browser Source**
2. Set these properties:
   - **URL:** `http://localhost:8080/obs`
   - **Width:** `1920`
   - **Height:** `1080`
   - **FPS:** `60` (recommended)
   - ✅ Check **"Shutdown source when not visible"**
   - ✅ Check **"Refresh browser when scene becomes active"**

3. Position the source above your game/video source

### Step 5: Test the Full Flow

1. Start collection in Admin Panel (▶ Start)
2. Click on the viewer page multiple times
3. Watch clusters appear in OBS overlay
4. Stop collection (⏸ Stop)
5. Reset data (🗑 Reset)

**Success!** Your clickmap is working locally. 🎉

---

## Cloudflare Tunnel Setup (Public Access)

To allow viewers to click from anywhere, you need to expose your local server publicly.

### Install cloudflared

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Windows:**
Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

**Linux (Debian/Ubuntu):**
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### Run Setup Script

```bash
chmod +x scripts/tunnel.sh
./scripts/tunnel.sh
```

The script will:
1. Check if cloudflared is installed
2. Log you in to Cloudflare
3. Create a tunnel named "clickmap"
4. Generate a config file

### Complete Manual Steps

Follow the instructions printed by the script:

1. **Edit config file** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: YOUR_TUNNEL_ID
   credentials-file: /path/to/credentials.json

   ingress:
     - hostname: clickmap.yourdomain.com  # Change this!
       service: http://localhost:8080
     - service: http_status:404
   ```

2. **Add DNS record:**
   ```bash
   cloudflared tunnel route dns clickmap clickmap.yourdomain.com
   ```

3. **Start the tunnel:**
   ```bash
   cloudflared tunnel run clickmap
   ```

4. **Test public access:**
   - Go to `https://clickmap.yourdomain.com/viewer/YOUR_CHANNEL`
   - Clicks should work from any device

### Run Tunnel as Service (Auto-start)

**Linux/Mac:**
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

**Windows:**
```batch
cloudflared service install
```

For detailed instructions, see [CLOUDFLARE.md](CLOUDFLARE.md).

---

## Sharing with Viewers

Once your tunnel is running, share this URL with your viewers:

```
https://clickmap.yourdomain.com/viewer/YOUR_CHANNEL
```

**In your Twitch chat:**
```
Click on the stream! 👉 https://clickmap.yourdomain.com/viewer/YOUR_CHANNEL
```

**As a panel below your stream:**
- Create a custom panel
- Link to your clickmap URL
- Add instructions for viewers

---

## Hotkeys (Admin Panel)

When the admin panel is focused:

- **Ctrl+1** - Toggle Start/Stop
- **Ctrl+2** - Reset all data

---

## Configuration Options

Edit `config/default.json` to customize:

### Client Sampling
```json
"sampling": {
  "client": 10,  // Only send 1-in-10 clicks to server
  "server": 5    // Only process 1-in-5 received clicks
}
```

**Lower = more accurate, higher server load**

### Clustering
```json
"clustering": {
  "threshold": 3,      // Min % to display a cluster
  "maxClusters": 20    // Max clusters shown
}
```

### Memory
```json
"memory": {
  "maxClicksInMemory": 10000,     // Max clicks to store
  "clickMaxAge": 3600000,         // 1 hour in ms
  "cleanupInterval": 30000        // 30 seconds
}
```

For detailed config docs, see `config/README.md`.

---

## Workflow: Streaming with Clickmap

### Before Stream

1. Start backend: `./scripts/start.sh`
2. Start tunnel: `cloudflared tunnel run clickmap`
3. Open OBS and verify overlay is connected
4. Test with admin panel

### During Stream

1. **Start collection:** Admin panel → ▶ Start (or Ctrl+1)
2. **Share viewer URL** in chat
3. **Monitor:** Watch admin panel for stats
4. **Reset when needed:** 🗑 Reset button (or Ctrl+2)

### After Stream

1. **Stop collection:** Admin panel → ⏸ Stop
2. **Optional:** Reset data for next stream
3. Stop backend (Ctrl+C)
4. Stop tunnel (Ctrl+C)

---

## Troubleshooting

### Backend won't start

- Check Node.js version: `node -v` (need 18+)
- Check port 8080 is not in use: `lsof -i :8080` (Mac/Linux)
- Check logs for errors

### Clicks not appearing

- Check admin panel shows "Running" status
- Check WebSocket is connected (green dot)
- Check browser console for errors (F12)
- Verify sampling isn't too aggressive

### OBS overlay blank

- Check URL is correct: `http://localhost:8080/obs`
- Check backend is running
- Refresh browser source
- Check OBS logs

### Cloudflare Tunnel issues

- Check tunnel is running: `cloudflared tunnel list`
- Check DNS record is correct
- Check config file hostname matches DNS
- See [CLOUDFLARE.md](CLOUDFLARE.md) for detailed troubleshooting

For more issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Performance Tuning

### For High-Click Scenarios (20k+ clicks/sec)

Increase sampling rates:
```json
"sampling": {
  "client": 20,
  "server": 10
}
```

This reduces clicks to ~100/sec processed.

### For Low-Latency

Decrease broadcast interval:
```json
"server": {
  "broadcastInterval": 3000
}
```

Lower = more real-time, higher CPU usage.

---

## Next Steps

- ✅ Basic setup complete
- 📖 Read [CLOUDFLARE.md](CLOUDFLARE.md) for tunnel details
- 🔧 Read [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
- ⚙️ Customize `config/default.json` for your needs
- 🚀 Go live and test with viewers!

---

## Support

- **Issues:** [GitHub Issues](https://github.com/anthropics/smart-clickmap/issues)
- **Documentation:** See `docs/` folder
- **Config Help:** See `config/README.md`
