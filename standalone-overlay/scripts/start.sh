#!/bin/bash

# Smart Clickmap - Standalone Server Startup Script (Linux/Mac)
# Usage: ./scripts/start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"
CONFIG_FILE="$ROOT_DIR/config/default.json"

echo ""
echo "=================================================="
echo "  Smart Clickmap - Standalone Server"
echo "=================================================="
echo ""

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo ""
    echo "Please install Node.js 18 or higher:"
    echo "  https://nodejs.org/"
    echo ""
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ required (found v$NODE_VERSION)"
    echo ""
    echo "Please upgrade Node.js:"
    echo "  https://nodejs.org/"
    echo ""
    exit 1
fi

echo "✅ Node.js v$(node -v) detected"
echo ""

# Install dependencies if needed
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd "$BACKEND_DIR" && npm install
    echo ""
fi

# Load port from config
PORT=8080
if [ -f "$CONFIG_FILE" ]; then
    PORT=$(cat "$CONFIG_FILE" | grep -o '"port": [0-9]*' | grep -o '[0-9]*' || echo "8080")
fi

# Display URLs
echo "🚀 Starting server on port $PORT..."
echo ""
echo "📍 Access URLs:"
echo "   Viewer:  http://localhost:$PORT/viewer/YOUR_CHANNEL"
echo "   Admin:   http://localhost:$PORT/admin"
echo "   OBS:     http://localhost:$PORT/obs"
echo "   Status:  http://localhost:$PORT/status"
echo ""
echo "💡 Press Ctrl+C to stop the server"
echo ""
echo "=================================================="
echo ""

# Start the server
cd "$BACKEND_DIR"
exec node server.js
