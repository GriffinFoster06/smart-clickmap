# Cloudflare Tunnel - Complete Guide

Detailed guide for exposing your local clickmap server publicly using Cloudflare Tunnel.

---

## Why Cloudflare Tunnel?

✅ **Free** - No hosting costs
✅ **Secure** - No port forwarding, no exposed IP
✅ **Fast** - Cloudflare's global CDN
✅ **Easy** - No complex networking setup
✅ **HTTPS** - Free SSL certificates

---

## Prerequisites

- Cloudflare account (free tier is fine)
- A domain name added to Cloudflare (or use Cloudflare's free subdomain)
- Backend server running locally (`./scripts/start.sh`)

---

## Part 1: Installing cloudflared

### macOS

**Via Homebrew (recommended):**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Via Direct Download:**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz | tar -xz
sudo mv cloudflared /usr/local/bin/
sudo chmod +x /usr/local/bin/cloudflared
```

### Windows

**Via Download:**
1. Download from: https://github.com/cloudflare/cloudflared/releases/latest
2. Look for `cloudflared-windows-amd64.exe`
3. Rename to `cloudflared.exe`
4. Move to `C:\Windows\System32\` (or add to PATH)

**Via winget:**
```powershell
winget install --id Cloudflare.cloudflared
```

### Linux (Debian/Ubuntu)

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

### Linux (Generic)

```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
```

### Verify Installation

```bash
cloudflared --version
```

You should see something like: `cloudflared version 2024.x.x`

---

## Part 2: Creating a Tunnel

### Login to Cloudflare

```bash
cloudflared login
```

This will:
1. Open your browser
2. Ask you to select a domain
3. Authorize cloudflared

A credentials file will be saved to:
- **Mac/Linux:** `~/.cloudflared/cert.pem`
- **Windows:** `C:\Users\YOUR_USER\.cloudflared\cert.pem`

### Create Named Tunnel

```bash
cloudflared tunnel create clickmap
```

This creates:
- A tunnel with ID like `abc123-def456-ghi789`
- Credentials file: `~/.cloudflared/ABC123.json`

### List Tunnels

```bash
cloudflared tunnel list
```

You should see:
```
ID                                   NAME      CREATED              CONNECTIONS
abc123-def456-ghi789                clickmap  2024-01-15T10:30:00Z  0
```

Copy the **tunnel ID** - you'll need it next.

---

## Part 3: Configure the Tunnel

### Create Config File

Create or edit `~/.cloudflared/config.yml`:

```yaml
tunnel: abc123-def456-ghi789  # Your tunnel ID
credentials-file: /home/USER/.cloudflared/abc123-def456-ghi789.json

ingress:
  - hostname: clickmap.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

**Important:**
- Replace `abc123-def456-ghi789` with your tunnel ID
- Replace `/home/USER/` with your actual home directory path
- Replace `clickmap.yourdomain.com` with your desired hostname

**For Windows:**
```yaml
tunnel: abc123-def456-ghi789
credentials-file: C:\Users\YOUR_USER\.cloudflared\abc123-def456-ghi789.json

ingress:
  - hostname: clickmap.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

### Advanced: Multiple Services

You can route different paths to different ports:

```yaml
tunnel: abc123-def456-ghi789
credentials-file: /path/to/credentials.json

ingress:
  - hostname: clickmap.yourdomain.com
    path: /viewer/*
    service: http://localhost:8080
  - hostname: clickmap.yourdomain.com
    path: /obs
    service: http://localhost:8080
  - hostname: clickmap.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

---

## Part 4: DNS Configuration

### Option A: Using Cloudflared CLI

```bash
cloudflared tunnel route dns clickmap clickmap.yourdomain.com
```

This automatically creates a CNAME record.

### Option B: Manual DNS Setup

1. Go to Cloudflare Dashboard
2. Select your domain
3. Go to **DNS** → **Records**
4. Add a CNAME record:
   - **Type:** CNAME
   - **Name:** `clickmap` (or subdomain of your choice)
   - **Target:** `abc123-def456-ghi789.cfargotunnel.com`
   - **Proxy status:** Proxied (orange cloud)

### Verify DNS

```bash
nslookup clickmap.yourdomain.com
```

Should return a Cloudflare IP (like `104.x.x.x`).

---

## Part 5: Running the Tunnel

### Run Manually (Foreground)

```bash
cloudflared tunnel run clickmap
```

You should see:
```
2024-01-15T10:30:00Z INF Connection registered connIndex=0
2024-01-15T10:30:00Z INF Connection registered connIndex=1
2024-01-15T10:30:00Z INF Connection registered connIndex=2
2024-01-15T10:30:00Z INF Connection registered connIndex=3
```

**Test it:**
- Go to `https://clickmap.yourdomain.com/viewer/YOUR_CHANNEL`
- You should see the viewer page

### Run in Background

**Linux/Mac:**
```bash
nohup cloudflared tunnel run clickmap > /var/log/cloudflared.log 2>&1 &
```

**Or use tmux/screen:**
```bash
tmux new -s tunnel
cloudflared tunnel run clickmap
# Press Ctrl+B, then D to detach
```

### Stop Tunnel

If running in foreground: **Ctrl+C**

If running in background:
```bash
pkill cloudflared
```

---

## Part 6: Auto-Start as Service

### Linux (systemd)

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

**Check status:**
```bash
sudo systemctl status cloudflared
```

**View logs:**
```bash
sudo journalctl -u cloudflared -f
```

**Stop service:**
```bash
sudo systemctl stop cloudflared
```

### macOS (launchd)

```bash
sudo cloudflared service install
```

This creates: `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`

**Start:**
```bash
sudo launchctl load /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

**Stop:**
```bash
sudo launchctl unload /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

### Windows (Service)

**Install as service:**
```powershell
cloudflared service install
```

**Start service:**
```powershell
sc start cloudflared
```

**Stop service:**
```powershell
sc stop cloudflared
```

**Set to auto-start:**
```powershell
sc config cloudflared start=auto
```

---

## Part 7: Security Best Practices

### 1. Restrict Admin Panel

The admin panel should **ONLY** be accessible locally.

In your config, do NOT route `/admin`:
```yaml
ingress:
  - hostname: clickmap.yourdomain.com
    path: /viewer/*
    service: http://localhost:8080
  - hostname: clickmap.yourdomain.com
    path: /obs
    service: http://localhost:8080
  # DO NOT expose /admin publicly
  - service: http_status:404
```

Access admin panel only via: `http://localhost:8080/admin`

### 2. Use Access Control (Optional)

Add Cloudflare Access to require login:

```yaml
ingress:
  - hostname: clickmap.yourdomain.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true
```

Then set up Cloudflare Access rules in the dashboard.

### 3. Monitor Tunnel

Check tunnel status regularly:
```bash
cloudflared tunnel info clickmap
```

---

## Part 8: Troubleshooting

### Tunnel won't start

**Check config file:**
```bash
cat ~/.cloudflared/config.yml
```

**Validate config:**
```bash
cloudflared tunnel ingress validate
```

**Check logs:**
```bash
cloudflared tunnel run clickmap --loglevel debug
```

### DNS not resolving

**Wait for propagation** (can take 5-10 minutes)

**Check DNS:**
```bash
dig clickmap.yourdomain.com
nslookup clickmap.yourdomain.com
```

**Force CNAME update:**
```bash
cloudflared tunnel route dns clickmap clickmap.yourdomain.com --overwrite-dns
```

### 502 Bad Gateway

**Causes:**
- Backend server not running
- Wrong port in config
- Firewall blocking localhost

**Fix:**
1. Ensure backend is running: `curl http://localhost:8080/status`
2. Check config port matches backend port
3. Check firewall: `sudo ufw status` (Linux)

### Connection refused

**Check tunnel is running:**
```bash
cloudflared tunnel list
# Should show 4 connections
```

**Restart tunnel:**
```bash
sudo systemctl restart cloudflared  # Linux
# or
cloudflared tunnel run clickmap     # Manual
```

### Multiple tunnels conflict

**List all tunnels:**
```bash
cloudflared tunnel list
```

**Delete old tunnels:**
```bash
cloudflared tunnel delete OLD_TUNNEL_NAME
```

### Credentials file not found

**Check file exists:**
```bash
ls -la ~/.cloudflared/
```

**File should be named:** `YOUR_TUNNEL_ID.json`

**Update config with correct path:**
```yaml
credentials-file: /full/path/to/YOUR_TUNNEL_ID.json
```

---

## Part 9: Advanced Topics

### Custom Domain (No Cloudflare DNS)

If your domain isn't on Cloudflare DNS:

1. Create tunnel: `cloudflared tunnel create clickmap`
2. Get tunnel ID: `cloudflared tunnel list`
3. Add CNAME manually:
   - **Name:** `clickmap.yourdomain.com`
   - **Value:** `YOUR_TUNNEL_ID.cfargotunnel.com`
4. Run tunnel: `cloudflared tunnel run clickmap`

### Load Balancing Multiple Servers

```yaml
ingress:
  - hostname: clickmap.yourdomain.com
    service: http_status:200
    originRequest:
      connectTimeout: 30s
      noTLSVerify: true
```

### IPv6 Support

Cloudflare Tunnel supports IPv6 automatically. No extra config needed.

### Tunnel Replicas (High Availability)

Run the same tunnel on multiple machines:

1. Copy `config.yml` and credentials to multiple servers
2. Run `cloudflared tunnel run clickmap` on each
3. Cloudflare automatically load-balances

---

## Part 10: Monitoring

### Check Tunnel Health

```bash
cloudflared tunnel info clickmap
```

### Monitor Connections

```bash
watch -n 5 'cloudflared tunnel list'
```

### Cloudflare Dashboard

Go to: **Zero Trust** → **Networks** → **Tunnels**

You'll see:
- Connection status (4 connections = healthy)
- Traffic metrics
- Last seen timestamp

---

## Summary Checklist

- [ ] cloudflared installed
- [ ] Logged in to Cloudflare
- [ ] Tunnel created
- [ ] Config file created with correct paths
- [ ] DNS record added (CNAME)
- [ ] Backend server running
- [ ] Tunnel running
- [ ] Tested public URL
- [ ] Service auto-start configured (optional)

---

## Quick Reference

```bash
# Install (macOS)
brew install cloudflare/cloudflare/cloudflared

# Login
cloudflared login

# Create tunnel
cloudflared tunnel create clickmap

# Configure DNS
cloudflared tunnel route dns clickmap clickmap.yourdomain.com

# Run tunnel
cloudflared tunnel run clickmap

# Install as service
sudo cloudflared service install

# Check status
cloudflared tunnel list
```

---

## Need Help?

- **Cloudflare Docs:** https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- **GitHub Issues:** https://github.com/cloudflare/cloudflared/issues
- **Community:** https://community.cloudflare.com/
