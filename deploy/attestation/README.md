# FreeFlo Attestation Service Deployment

This guide deploys the attestation service on FreeFlo-controlled infrastructure.

## Prerequisites

- Ubuntu 22.04+ server
- Domain `attestation.free-flo.xyz` pointing to server IP
- Root or sudo access

## Step 1: DNS Setup

Add an A record for your domain:

```
attestation.free-flo.xyz  →  YOUR_SERVER_IP
```

Verify DNS propagation:
```bash
dig attestation.free-flo.xyz +short
# Should return your server IP
```

## Step 2: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Caddy (recommended - auto TLS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# OR install Nginx (manual TLS with certbot)
# sudo apt install nginx certbot python3-certbot-nginx
```

## Step 3: Create Service User

```bash
sudo useradd -r -s /bin/false freeflo
sudo mkdir -p /opt/freeflo /etc/freeflo
sudo chown freeflo:freeflo /opt/freeflo
```

## Step 4: Build Attestation Service

```bash
# Clone repo (or copy from local)
cd /opt/freeflo
sudo -u freeflo git clone https://github.com/MontaguSandwich/FreeFlo.git .

# Build the attestation service
cd attestation-service
sudo -u freeflo cargo build --release

# Binary will be at: /opt/freeflo/attestation-service/target/release/attestation-service
```

## Step 5: Generate Witness Key

**IMPORTANT:** Do this on a secure machine. The witness key signs all attestations.

```bash
# Generate a new keypair
cast wallet new

# Output:
# Successfully created new keypair.
# Address:     0xYOUR_WITNESS_ADDRESS
# Private key: 0xYOUR_PRIVATE_KEY

# Save the private key securely!
# The address needs to be authorized on-chain.
```

## Step 6: Configure Environment

```bash
# Copy example config
sudo cp /opt/freeflo/deploy/attestation/attestation.env.example /etc/freeflo/attestation.env

# Edit with your witness key
sudo nano /etc/freeflo/attestation.env

# Secure the file
sudo chmod 600 /etc/freeflo/attestation.env
sudo chown freeflo:freeflo /etc/freeflo/attestation.env
```

## Step 7: Authorize Witness On-Chain

The witness address must be authorized in `PaymentVerifier` contract.

**Note:** Only the contract owner can add witnesses.

```bash
# Check who owns the contract
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
  "owner()" \
  --rpc-url https://base-sepolia-rpc.publicnode.com

# Add witness (requires owner's private key)
cast send 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
  "addWitness(address)" \
  YOUR_WITNESS_ADDRESS \
  --private-key $OWNER_PRIVATE_KEY \
  --rpc-url https://base-sepolia-rpc.publicnode.com

# Verify authorization
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
  "authorizedWitnesses(address)" \
  YOUR_WITNESS_ADDRESS \
  --rpc-url https://base-sepolia-rpc.publicnode.com
# Should return: true (0x0000...0001)
```

## Step 8: Install Systemd Service

```bash
# Copy service file
sudo cp /opt/freeflo/deploy/attestation/systemd/freeflo-attestation.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable freeflo-attestation
sudo systemctl start freeflo-attestation

# Check status
sudo systemctl status freeflo-attestation
sudo journalctl -u freeflo-attestation -f
```

## Step 9: Configure Reverse Proxy

### Option A: Caddy (Recommended)

```bash
# Copy Caddyfile
sudo cp /opt/freeflo/deploy/attestation/caddy/Caddyfile /etc/caddy/Caddyfile

# Reload Caddy (auto-obtains TLS cert)
sudo systemctl reload caddy

# Check logs
sudo journalctl -u caddy -f
```

### Option B: Nginx + Certbot

```bash
# Copy nginx config
sudo cp /opt/freeflo/deploy/attestation/nginx/attestation.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/attestation.conf /etc/nginx/sites-enabled/

# Get TLS certificate
sudo certbot --nginx -d attestation.free-flo.xyz

# Reload nginx
sudo systemctl reload nginx
```

## Step 10: Verify Deployment

```bash
# Test health endpoint
curl https://attestation.free-flo.xyz/api/v1/health

# Expected response:
# {"status":"healthy","witnessAddress":"0xYOUR_WITNESS","chainId":84532}

# Verify witness is authorized on-chain
WITNESS=$(curl -s https://attestation.free-flo.xyz/api/v1/health | jq -r '.witnessAddress')
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
  "authorizedWitnesses(address)" \
  $WITNESS \
  --rpc-url https://base-sepolia-rpc.publicnode.com
```

## Step 11: Firewall Configuration

```bash
# Allow HTTPS
sudo ufw allow 443/tcp

# Block direct access to attestation service port (only via reverse proxy)
sudo ufw deny 4001/tcp

# Verify
sudo ufw status
```

## Monitoring

### Check service status
```bash
sudo systemctl status freeflo-attestation
```

### View logs
```bash
# Attestation service logs
sudo journalctl -u freeflo-attestation -f

# Caddy logs
sudo tail -f /var/log/caddy/attestation.log

# Nginx logs
sudo tail -f /var/log/nginx/attestation.access.log
```

### Health check script
```bash
#!/bin/bash
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" https://attestation.free-flo.xyz/api/v1/health)
if [ "$HEALTH" != "200" ]; then
  echo "ALERT: Attestation service unhealthy (HTTP $HEALTH)"
  # Add alerting here (PagerDuty, Slack, etc.)
fi
```

## Troubleshooting

### Service won't start
```bash
# Check logs
sudo journalctl -u freeflo-attestation -e

# Common issues:
# - WITNESS_PRIVATE_KEY not set or invalid
# - Port 4001 already in use
# - Missing binary (cargo build not run)
```

### TLS certificate issues
```bash
# Caddy: Check cert status
sudo caddy trust

# Nginx: Renew cert manually
sudo certbot renew
```

### Witness authorization failed
```bash
# Check current witness address
curl https://attestation.free-flo.xyz/api/v1/health | jq '.witnessAddress'

# Verify on-chain
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
  "authorizedWitnesses(address)" \
  <witness_address> \
  --rpc-url https://base-sepolia-rpc.publicnode.com
```

## Security Notes

1. **Witness key** is the most critical secret - store securely
2. **Environment file** should be readable only by service user
3. **Firewall** should block direct access to port 4001
4. **Logs** may contain sensitive info - rotate and secure
5. **Updates** - regularly update the service for security patches
