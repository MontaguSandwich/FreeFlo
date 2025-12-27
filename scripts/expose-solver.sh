#!/bin/bash
# Expose local solver to the internet using Cloudflare Tunnel
# This allows the Vercel frontend to reach your local solver

set -e

echo "🚀 ZKP2P Solver Exposure Script"
echo "================================"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared not found. Installing..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install cloudflared
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
        chmod +x /tmp/cloudflared
        sudo mv /tmp/cloudflared /usr/local/bin/
    else
        echo "Please install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
        exit 1
    fi
fi

echo "✅ cloudflared installed"
echo ""

# Check if solver is running
if ! curl -s http://localhost:8081/api/supported > /dev/null 2>&1; then
    echo "⚠️  Solver Quote API not running on port 8081"
    echo "   Start the solver first: cd solver && npm run dev:v3"
    echo ""
    read -p "Start solver now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Starting solver in background..."
        cd "$(dirname "$0")/../solver"
        npm run dev:v3 &
        sleep 5
    else
        exit 1
    fi
fi

echo "✅ Solver is running"
echo ""
echo "Starting Cloudflare Tunnel..."
echo "This will expose your Quote API to the internet."
echo ""
echo "📋 IMPORTANT: Copy the URL that appears and:"
echo "   1. Go to Vercel → Your Project → Settings → Environment Variables"
echo "   2. Set NEXT_PUBLIC_SOLVER_API_URL to the tunnel URL"
echo "   3. Redeploy your frontend"
echo ""
echo "Press Ctrl+C to stop the tunnel"
echo "================================"
echo ""

cloudflared tunnel --url http://localhost:8081

