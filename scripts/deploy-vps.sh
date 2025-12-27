#!/bin/bash
# ============================================
# ZKP2P Off-Ramp VPS Deployment Script
# ============================================
# This script sets up the solver on a fresh Ubuntu VPS

set -e

echo "🚀 ZKP2P Off-Ramp VPS Deployment"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Please run as root or with sudo"
    exit 1
fi

# ============================================
# Step 1: Install Docker
# ============================================
echo "📦 Step 1: Installing Docker..."

if ! command -v docker &> /dev/null; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# ============================================
# Step 2: Clone repository
# ============================================
echo ""
echo "📥 Step 2: Setting up application..."

APP_DIR="/opt/zkp2p-offramp"

if [ -d "$APP_DIR" ]; then
    echo "Directory $APP_DIR exists. Pulling latest..."
    cd "$APP_DIR"
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/YOUR_USERNAME/zkp2p-offramp.git "$APP_DIR"
    cd "$APP_DIR"
fi

# ============================================
# Step 3: Configure environment
# ============================================
echo ""
echo "⚙️  Step 3: Configuring environment..."

if [ ! -f "$APP_DIR/.env" ]; then
    echo ""
    echo "❌ No .env file found!"
    echo ""
    echo "Please create .env from the template:"
    echo "  cp $APP_DIR/env.production.example $APP_DIR/.env"
    echo "  nano $APP_DIR/.env"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✅ .env file found"

# ============================================
# Step 4: Build and start containers
# ============================================
echo ""
echo "🐳 Step 4: Building and starting containers..."

cd "$APP_DIR"

# Build images
docker compose build

# Start services
docker compose up -d

echo ""
echo "✅ Containers started"

# ============================================
# Step 5: Configure firewall
# ============================================
echo ""
echo "🔒 Step 5: Configuring firewall..."

if command -v ufw &> /dev/null; then
    ufw allow 22/tcp   # SSH
    ufw allow 80/tcp   # HTTP
    ufw allow 443/tcp  # HTTPS
    ufw --force enable
    echo "✅ Firewall configured"
else
    echo "⚠️  ufw not installed. Please configure firewall manually."
fi

# ============================================
# Step 6: Verify deployment
# ============================================
echo ""
echo "🔍 Step 6: Verifying deployment..."

sleep 10  # Wait for services to start

# Check health
if curl -s http://localhost:8080/health | grep -q "healthy"; then
    echo "✅ Solver health check: PASSED"
else
    echo "❌ Solver health check: FAILED"
    echo "   Check logs: docker compose logs solver"
fi

if curl -s http://localhost:4001/health | grep -q "healthy"; then
    echo "✅ Attestation health check: PASSED"
else
    echo "❌ Attestation health check: FAILED"
    echo "   Check logs: docker compose logs attestation"
fi

# ============================================
# Done!
# ============================================
echo ""
echo "============================================"
echo "🎉 Deployment Complete!"
echo "============================================"
echo ""
echo "Services running:"
echo "  • Solver Health:  http://YOUR_IP:8080/health"
echo "  • Quote API:      http://YOUR_IP:8081/api/quote?amount=10&currency=EUR"
echo "  • Attestation:    http://YOUR_IP:4001/health"
echo ""
echo "Useful commands:"
echo "  • View logs:      docker compose logs -f"
echo "  • Restart:        docker compose restart"
echo "  • Stop:           docker compose down"
echo "  • Update:         git pull && docker compose up -d --build"
echo ""
echo "Next steps:"
echo "  1. Point your domain to this server's IP"
echo "  2. Set up SSL with Let's Encrypt"
echo "  3. Update Vercel frontend with your API URL"
echo ""

