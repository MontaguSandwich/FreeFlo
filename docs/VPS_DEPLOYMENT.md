# VPS Deployment Guide

This guide walks you through deploying ZKP2P Off-Ramp to a VPS for testing with colleagues.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Colleagues    │────▶│  Vercel Frontend │────▶│      Your VPS       │
│   (Browsers)    │     │   (Free tier)    │     │                     │
└─────────────────┘     └──────────────────┘     │  ┌───────────────┐  │
                                                 │  │    Nginx      │  │
                                                 │  │  (Port 80)    │  │
                                                 │  └───────┬───────┘  │
                                                 │          │          │
                                                 │  ┌───────▼───────┐  │
                                                 │  │    Solver     │  │
                                                 │  │ (8080, 8081)  │  │
                                                 │  └───────────────┘  │
                                                 └─────────────────────┘
```

## Prerequisites

- Ubuntu 22.04 VPS (DigitalOcean, Hetzner, AWS, etc.)
- Domain name (optional but recommended)
- GitHub repository with your code

## Cost Estimates

| Provider | Spec | Cost |
|----------|------|------|
| DigitalOcean | 2GB RAM, 1 vCPU | $12/month |
| Hetzner | 2GB RAM, 2 vCPU | €4/month |
| AWS Lightsail | 2GB RAM, 1 vCPU | $10/month |
| Vercel Frontend | Free tier | $0/month |

---

## Step 1: Provision VPS

### DigitalOcean (Example)

1. Go to [digitalocean.com](https://digitalocean.com)
2. Create Droplet:
   - **Image**: Ubuntu 22.04
   - **Size**: Basic, 2GB RAM ($12/mo)
   - **Region**: Closest to you
   - **Authentication**: SSH key (recommended)
3. Note the IP address

### Connect via SSH

```bash
ssh root@YOUR_VPS_IP
```

---

## Step 2: Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y git curl ufw

# Configure firewall
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw enable
```

---

## Step 3: Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Verify
docker --version
docker compose version
```

---

## Step 4: Clone Repository

```bash
# Clone your repo
cd /opt
git clone https://github.com/YOUR_USERNAME/zkp2p-offramp.git
cd zkp2p-offramp
```

---

## Step 5: Configure Environment

```bash
# Create .env from template
cp env.production.example .env

# Edit with your values
nano .env
```

### Required Environment Variables

```bash
# Blockchain
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249f4ab741f0661a38651a08213dde1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd54e8219d30c2d04a8faec64657f06f440889d70
SOLVER_PRIVATE_KEY=0x_YOUR_SOLVER_PRIVATE_KEY

# Qonto
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=your_access_token
QONTO_REFRESH_TOKEN=your_refresh_token
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret
QONTO_BANK_ACCOUNT_ID=your_account_id

# Attestation (run separately or use your local machine)
ATTESTATION_SERVICE_URL=http://YOUR_LOCAL_IP:4001
```

---

## Step 6: Build and Start

```bash
# Build Docker images
docker compose build

# Start services
docker compose up -d

# Check logs
docker compose logs -f
```

### Verify Deployment

```bash
# Health check
curl http://localhost:8080/health

# Quote API
curl "http://localhost:8081/api/quote?amount=10&currency=EUR"
```

---

## Step 7: Domain & SSL (Recommended)

### Point Domain to VPS

Add an A record in your DNS:
```
api.yourdomain.com → YOUR_VPS_IP
```

### Setup SSL with Let's Encrypt

```bash
# Run SSL setup script
./scripts/setup-ssl.sh

# Follow prompts to enter domain and email
```

---

## Step 8: Deploy Frontend to Vercel

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Set root directory to `frontend`
5. Add environment variables:
   ```
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_id
   NEXT_PUBLIC_SOLVER_API_URL=https://api.yourdomain.com
   ```
6. Deploy

---

## Step 9: Running Attestation Service

The attestation service requires Rust and TLSNotary. For testing, you can run it on your local machine:

### Option A: Run Locally (Easiest for Testing)

On your local machine:
```bash
cd ~/zkp2p-research/attestation-service
cargo run
```

Then update your VPS `.env`:
```bash
ATTESTATION_SERVICE_URL=http://YOUR_LOCAL_PUBLIC_IP:4001
```

Note: You'll need to expose port 4001 (use ngrok or port forwarding).

### Option B: Run on VPS (Advanced)

Copy the attestation service to your VPS and build:
```bash
# On your local machine
scp -r ~/zkp2p-research/attestation-service root@YOUR_VPS_IP:/opt/

# On VPS
cd /opt/attestation-service
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
# Build and run
cargo build --release
./target/release/attestation-service &
```

---

## Monitoring & Maintenance

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f solver
```

### Restart Services

```bash
docker compose restart
```

### Update Deployment

```bash
cd /opt/zkp2p-offramp
git pull origin main
docker compose up -d --build
```

### Check Resource Usage

```bash
docker stats
```

---

## Troubleshooting

### Solver Won't Start

```bash
# Check logs
docker compose logs solver

# Common issues:
# - Missing env vars
# - RPC URL not responding
# - Invalid private key format
```

### Quote API Returns 502

```bash
# Check if solver container is running
docker ps

# Check nginx logs
docker compose logs nginx
```

### Attestation Fails

```bash
# Check if attestation service is reachable
curl http://ATTESTATION_URL:4001/health

# Check solver logs for attestation errors
docker compose logs solver | grep -i attestation
```

### SSL Certificate Issues

```bash
# Renew certificate
certbot renew

# Copy to nginx
cp /etc/letsencrypt/live/YOUR_DOMAIN/*.pem /opt/zkp2p-offramp/nginx/ssl/

# Restart nginx
docker compose restart nginx
```

---

## Security Checklist

- [ ] SSH key authentication (disable password login)
- [ ] Firewall enabled (only 22, 80, 443 open)
- [ ] SSL/HTTPS enabled
- [ ] Private keys in .env (not in code)
- [ ] .env not committed to git
- [ ] Regular security updates

---

## Quick Reference

| Service | URL |
|---------|-----|
| Health Check | `http://YOUR_IP:8080/health` |
| Quote API | `http://YOUR_IP:8081/api/quote?amount=10&currency=EUR` |
| Frontend | `https://your-app.vercel.app` |

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start services |
| `docker compose down` | Stop services |
| `docker compose logs -f` | View logs |
| `docker compose restart` | Restart services |
| `docker compose up -d --build` | Rebuild and restart |

