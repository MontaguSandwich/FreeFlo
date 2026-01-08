#!/bin/bash
# FreeFlo Attestation Service - Server Setup Script
# Run on server: 77.42.68.242
#
# Usage: ssh root@77.42.68.242 'bash -s' < deploy/attestation/setup-server.sh

set -e

echo "=== FreeFlo Attestation Service Setup ==="
echo ""

# ============================================
# STEP 1: Remove old solver deployment
# ============================================
echo "[1/7] Removing old solver deployment..."

# Stop pm2 processes if running
if command -v pm2 &> /dev/null; then
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    echo "  - Stopped pm2 processes"
fi

# Stop systemd services if they exist
systemctl stop zkp2p-solver 2>/dev/null || true
systemctl disable zkp2p-solver 2>/dev/null || true
rm -f /etc/systemd/system/zkp2p-solver.service
echo "  - Removed systemd solver service"

# Remove solver directories
SOLVER_DIRS=(
    "/opt/solver"
    "/opt/zkp2p"
    "/opt/freeflo/solver"
    "/home/*/solver"
    "/root/solver"
)

for dir in "${SOLVER_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        rm -rf "$dir"
        echo "  - Removed $dir"
    fi
done

# Remove solver data
rm -rf /var/lib/solver 2>/dev/null || true
rm -rf /tmp/solver* 2>/dev/null || true

echo "  ✓ Old solver deployment removed"
echo ""

# ============================================
# STEP 2: Install dependencies
# ============================================
echo "[2/7] Installing dependencies..."

apt-get update -qq
apt-get install -y -qq curl git build-essential pkg-config libssl-dev

# Install Rust if not present
if ! command -v cargo &> /dev/null; then
    echo "  - Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Install Caddy
if ! command -v caddy &> /dev/null; then
    echo "  - Installing Caddy..."
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
fi

echo "  ✓ Dependencies installed"
echo ""

# ============================================
# STEP 3: Create service user and directories
# ============================================
echo "[3/7] Setting up directories..."

# Create service user
id -u freeflo &>/dev/null || useradd -r -s /bin/false freeflo

# Create directories
mkdir -p /opt/freeflo
mkdir -p /etc/freeflo
mkdir -p /var/log/freeflo

chown -R freeflo:freeflo /opt/freeflo
chown -R freeflo:freeflo /var/log/freeflo

echo "  ✓ Directories created"
echo ""

# ============================================
# STEP 4: Clone and build attestation service
# ============================================
echo "[4/7] Cloning repository..."

cd /opt/freeflo

# Clone if not exists, otherwise pull
if [ -d "FreeFlo" ]; then
    cd FreeFlo
    git fetch origin
    git reset --hard origin/main
else
    git clone https://github.com/MontaguSandwich/FreeFlo.git
    cd FreeFlo
fi

chown -R freeflo:freeflo /opt/freeflo

echo "  ✓ Repository cloned"
echo ""

echo "[5/7] Building attestation service (this may take a few minutes)..."

cd /opt/freeflo/FreeFlo/attestation-service
sudo -u freeflo bash -c 'source "$HOME/.cargo/env" 2>/dev/null || true; cargo build --release'

echo "  ✓ Attestation service built"
echo ""

# ============================================
# STEP 5: Configure environment
# ============================================
echo "[6/7] Configuring service..."

# Check if env file exists, if not create template
if [ ! -f /etc/freeflo/attestation.env ]; then
    cat > /etc/freeflo/attestation.env << 'ENVEOF'
# FreeFlo Attestation Service Configuration
# IMPORTANT: Fill in WITNESS_PRIVATE_KEY before starting the service

# Witness signing key (REQUIRED - get from cast wallet new)
WITNESS_PRIVATE_KEY=0x_REPLACE_WITH_YOUR_WITNESS_PRIVATE_KEY

# Chain configuration
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe

# TLS proof validation
ALLOWED_SERVERS=thirdparty.qonto.com

# Service configuration
PORT=4001
RUST_LOG=info,attestation_service=debug
ENVEOF

    chmod 600 /etc/freeflo/attestation.env
    chown freeflo:freeflo /etc/freeflo/attestation.env

    echo ""
    echo "  ⚠️  IMPORTANT: Edit /etc/freeflo/attestation.env and set WITNESS_PRIVATE_KEY"
    echo ""
fi

# Install systemd service
cat > /etc/systemd/system/freeflo-attestation.service << 'SERVICEEOF'
[Unit]
Description=FreeFlo Attestation Service
After=network.target

[Service]
Type=simple
User=freeflo
Group=freeflo
WorkingDirectory=/opt/freeflo/FreeFlo/attestation-service
EnvironmentFile=/etc/freeflo/attestation.env
ExecStart=/opt/freeflo/FreeFlo/attestation-service/target/release/attestation-service
Restart=on-failure
RestartSec=5s

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=freeflo-attestation

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload

echo "  ✓ Systemd service installed"
echo ""

# ============================================
# STEP 6: Configure Caddy
# ============================================
echo "[7/7] Configuring Caddy reverse proxy..."

cat > /etc/caddy/Caddyfile << 'CADDYEOF'
attestation.free-flo.xyz {
    reverse_proxy localhost:4001

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        -Server
    }

    log {
        output file /var/log/freeflo/caddy-access.log
        format json
    }
}
CADDYEOF

# Reload Caddy
systemctl enable caddy
systemctl restart caddy

echo "  ✓ Caddy configured"
echo ""

# ============================================
# DONE
# ============================================
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit the environment file with your witness private key:"
echo "   nano /etc/freeflo/attestation.env"
echo ""
echo "2. Start the attestation service:"
echo "   systemctl enable freeflo-attestation"
echo "   systemctl start freeflo-attestation"
echo ""
echo "3. Check status:"
echo "   systemctl status freeflo-attestation"
echo "   journalctl -u freeflo-attestation -f"
echo ""
echo "4. Test the endpoint:"
echo "   curl https://attestation.free-flo.xyz/api/v1/health"
echo ""
