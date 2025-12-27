# Deployment Guide

This guide covers deploying the ZKP2P Off-Ramp to testnet and production.

## Overview

The system has 4 components to deploy:

1. **Smart Contracts** → Base Sepolia / Base Mainnet
2. **Attestation Service** → VPS / Cloud Run
3. **Solver** → VPS / Cloud Run
4. **Frontend** → Vercel / Netlify

## Prerequisites

- Funded deployer wallet (ETH for gas)
- Solver wallet (ETH for gas + will hold USDC)
- Attestation witness wallet (for signing attestations)
- Qonto business account with API access
- Domain name (optional, for frontend)

---

## 1. Smart Contract Deployment

### Setup

```bash
cd contracts

# Install Foundry if not installed
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install

# Copy and fill environment
cp env.example .env
source .env
```

### Deploy to Base Sepolia

```bash
# Deploy PaymentVerifier + OffRampV3
forge script script/DeployV3.s.sol:DeployV3Script \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv

# Save the deployed addresses!
```

### Post-Deployment Configuration

```bash
# 1. Add attestation witness to PaymentVerifier
cast send $PAYMENT_VERIFIER_ADDRESS \
  "addWitness(address)" $WITNESS_ADDRESS \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY

# 2. Verify witness is authorized
cast call $PAYMENT_VERIFIER_ADDRESS \
  "authorizedWitnesses(address)(bool)" $WITNESS_ADDRESS \
  --rpc-url $BASE_SEPOLIA_RPC_URL
# Should return: true
```

### Verify Contracts on Basescan

If auto-verification failed:

```bash
forge verify-contract \
  $OFFRAMP_V3_ADDRESS \
  src/OffRampV3.sol:OffRampV3 \
  --chain base-sepolia \
  --constructor-args $(cast abi-encode "constructor(address,address)" $USDC_ADDRESS $PAYMENT_VERIFIER_ADDRESS)
```

---

## 2. Attestation Service Deployment

### Option A: Local / VPS

```bash
cd attestation-service

# Build
cargo build --release

# Create environment
cp env.example .env
# Edit .env with ATTESTATION_PRIVATE_KEY

# Run
./target/release/attestation-service
```

### Option B: Docker

```dockerfile
# Dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/attestation-service /usr/local/bin/
CMD ["attestation-service"]
```

```bash
docker build -t attestation-service .
docker run -d \
  -p 4001:4001 \
  -e ATTESTATION_PRIVATE_KEY=$WITNESS_PRIVATE_KEY \
  attestation-service
```

### Health Check

```bash
curl http://localhost:4001/health
# Should return: {"status":"healthy",...}
```

---

## 3. Solver Deployment

### Option A: Local / VPS

```bash
cd solver

# Install dependencies
npm install

# Build
npm run build

# Create environment
cp env.example .env
# Edit .env with all required values

# Run
npm start:v3
```

### Option B: PM2 (Production)

```bash
# Install PM2
npm install -g pm2

# Start solver
pm2 start npm --name "solver" -- run start:v3

# Save process list
pm2 save

# Setup startup script
pm2 startup
```

### Option C: Docker

```dockerfile
# Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index-v3.js"]
```

```bash
docker build -t solver .
docker run -d \
  -p 8080:8080 \
  -p 8081:8081 \
  --env-file .env \
  solver
```

### Health Check

```bash
curl http://localhost:8080/health
curl http://localhost:8081/api/quote?amount=10&currency=EUR
```

---

## 4. Frontend Deployment

### Option A: Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Set environment variables:
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   - `NEXT_PUBLIC_SOLVER_API_URL` (your solver's public URL)
4. Deploy

### Option B: Manual Build

```bash
cd frontend

# Install dependencies
npm install

# Build
npm run build

# Start
npm start
```

### Environment Variables for Production

Update `lib/contracts.ts` with mainnet addresses before production deploy.

---

## Production Checklist

### Security

- [ ] Use secrets manager (not .env files) for private keys
- [ ] Enable rate limiting on all APIs
- [ ] Set up WAF/DDoS protection
- [ ] Use HTTPS everywhere
- [ ] Restrict CORS to known domains
- [ ] Audit smart contracts

### Monitoring

- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)
- [ ] Configure log aggregation (Datadog, Papertrail)
- [ ] Create alerts for:
  - Solver balance low
  - Failed intents spike
  - Attestation service down
  - High gas prices

### Backup

- [ ] Backup solver database regularly
- [ ] Store deployment artifacts securely
- [ ] Document recovery procedures

### Operations

- [ ] Create runbooks for common operations
- [ ] Set up on-call rotation
- [ ] Test disaster recovery

---

## Environment-Specific Configs

### Testnet (Base Sepolia)

```bash
# Contracts
OFFRAMP_V3_ADDRESS=0x34249f4ab741f0661a38651a08213dde1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd54e8219d30c2d04a8faec64657f06f440889d70
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# Chain
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532

# Qonto
QONTO_USE_SANDBOX=true
```

### Mainnet (Base)

```bash
# Contracts
OFFRAMP_V3_ADDRESS=0x...  # Deploy new
PAYMENT_VERIFIER_ADDRESS=0x...  # Deploy new
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Chain
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# Qonto
QONTO_USE_SANDBOX=false
```

---

## Troubleshooting

### Contract Deployment Fails

```bash
# Check balance
cast balance $DEPLOYER_ADDRESS --rpc-url $RPC_URL

# Check nonce
cast nonce $DEPLOYER_ADDRESS --rpc-url $RPC_URL

# Retry with higher gas
forge script ... --gas-price 2gwei
```

### Attestation Service Won't Start

```bash
# Check Rust version
rustc --version  # Should be 1.75+

# Check port availability
lsof -i :4001

# Check logs
RUST_LOG=debug cargo run
```

### Solver Can't Connect to Attestation

```bash
# Check network connectivity
curl -v http://attestation-service:4001/health

# Check firewall rules
sudo ufw status

# Use IP instead of hostname
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001
```

### Frontend Build Fails

```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run build

# Check Node version
node --version  # Should be 20+
```

---

## Cost Estimates

### Gas Costs (Base Sepolia/Mainnet)

| Operation | Gas | Cost @ 0.01 gwei |
|-----------|-----|------------------|
| createIntent | 120k | ~$0.001 |
| submitQuote | 80k | ~$0.0008 |
| selectQuoteAndCommit | 150k | ~$0.0015 |
| fulfillIntentWithProof | 200k | ~$0.002 |

### Infrastructure Costs

| Service | Estimated Monthly |
|---------|-------------------|
| VPS (2 CPU, 4GB RAM) | $20-40 |
| Vercel (Hobby) | Free |
| Domain | $10-15/year |
| Monitoring | $0-50 |

---

## Support

For deployment help:
- Open an issue on GitHub
- Join our Discord (TBD)
- Email: support@example.com

