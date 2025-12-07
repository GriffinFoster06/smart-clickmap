#!/bin/bash

# Smart Clickmap - Cloudflare Tunnel Setup Script
# Prerequisites: Install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

set -e

TUNNEL_NAME="clickmap"
LOCAL_PORT="${PORT:-8080}"

echo ""
echo "=================================================="
echo "  Smart Clickmap - Cloudflare Tunnel Setup"
echo "=================================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ Error: cloudflared is not installed"
    echo ""
    echo "Install cloudflared:"
    echo ""
    echo "macOS (Homebrew):"
    echo "  brew install cloudflare/cloudflare/cloudflared"
    echo ""
    echo "Linux (Debian/Ubuntu):"
    echo "  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    echo "  sudo dpkg -i cloudflared-linux-amd64.deb"
    echo ""
    echo "Or download from:"
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
    echo ""
    exit 1
fi

echo "✅ cloudflared found: $(cloudflared --version | head -n 1)"
echo ""

# Check if already logged in
if ! cloudflared tunnel list &> /dev/null; then
    echo "🔐 Logging in to Cloudflare..."
    echo ""
    cloudflared login
    echo ""
fi

# Check if tunnel exists
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
    echo "✅ Tunnel '$TUNNEL_NAME' already exists"
    echo ""
else
    echo "📡 Creating tunnel '$TUNNEL_NAME'..."
    echo ""
    cloudflared tunnel create "$TUNNEL_NAME"
    echo ""
fi

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}')

if [ -z "$TUNNEL_ID" ]; then
    echo "❌ Error: Failed to get tunnel ID"
    exit 1
fi

echo "📝 Tunnel ID: $TUNNEL_ID"
echo ""

# Create config file
CONFIG_FILE="$HOME/.cloudflared/config.yml"
echo "📄 Writing tunnel config to $CONFIG_FILE"
echo ""

cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: overlay.YOUR_DOMAIN.com
    service: http://localhost:$LOCAL_PORT
  - service: http_status:404
EOF

echo "✅ Config file created"
echo ""
echo "=================================================="
echo "  MANUAL STEPS REQUIRED"
echo "=================================================="
echo ""
echo "1. Edit your config file and replace 'overlay.YOUR_DOMAIN.com'"
echo "   with your actual domain:"
echo ""
echo "   nano $CONFIG_FILE"
echo ""
echo "2. Add DNS record in Cloudflare Dashboard:"
echo ""
echo "   cloudflared tunnel route dns $TUNNEL_NAME overlay.YOUR_DOMAIN.com"
echo ""
echo "3. Start the tunnel:"
echo ""
echo "   cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "4. (Optional) Run as a system service for auto-start:"
echo ""
echo "   sudo cloudflared service install"
echo ""
echo "=================================================="
echo "  NEXT STEPS"
echo "=================================================="
echo ""
echo "After completing the steps above, your clickmap will be"
echo "accessible at:"
echo ""
echo "  https://overlay.YOUR_DOMAIN.com"
echo ""
echo "Viewer page:"
echo "  https://overlay.YOUR_DOMAIN.com/viewer/YOUR_CHANNEL"
echo ""
echo "Admin panel (local only):"
echo "  http://localhost:$LOCAL_PORT/admin"
echo ""
echo "For detailed instructions, see:"
echo "  docs/CLOUDFLARE.md"
echo ""
