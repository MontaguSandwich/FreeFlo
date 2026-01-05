# Solver Onboarding Guide

This guide walks you through setting up a FreeFlo solver from scratch. A solver processes USDC-to-fiat off-ramp requests by sending fiat payments (SEPA Instant) and proving them via TLSNotary.

**Time estimate**: 2-4 hours (excluding Qonto account approval)

## Prerequisites

Before you begin, you'll need:

| Requirement | Notes |
|-------------|-------|
| **Qonto Business Account** | EU business required, 2-4 week approval |
| **VPS** | Ubuntu 22.04, 2GB+ RAM (Hetzner €4/mo, DigitalOcean $12/mo) |
| **ETH on Base Sepolia** | For gas fees (~0.01 ETH) |
| **Domain** (optional) | For SSL/HTTPS |

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SOLVER SETUP STEPS                                │
├─────────────────────────────────────────────────────────────────────┤
│  1. Qonto Account     → Get API credentials                         │
│  2. VPS Setup         → Install dependencies                        │
│  3. TLSNotary         → Build Qonto prover                          │
│  4. Attestation       → Run attestation service                     │
│  5. Solver            → Configure and run                           │
│  6. On-chain          → Register solver, authorize witness          │
│  7. Verify            → Test end-to-end                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Qonto Account Setup

### 1.1 Create Business Account

1. Go to [qonto.com](https://qonto.com) and sign up for a business account
2. Complete verification (requires EU business registration)
3. Wait for approval (typically 2-4 weeks)

### 1.2 Enable API Access

Once approved:

1. Log into Qonto dashboard
2. Go to **Settings** → **Integrations** → **API**
3. Create an API application:
   - Name: "FreeFlo Solver"
   - Permissions: `organization.read`, `transaction.read`, `payment.write`

### 1.3 Get OAuth Credentials

You need both **OAuth tokens** (for transfers) and **API keys** (for TLSNotary prover).

#### OAuth Credentials (for transfers)

Use the helper script to get OAuth tokens.

> **Important**: Run this script on your **local machine** (laptop/Mac), not the VPS. Qonto requires HTTPS for non-localhost OAuth redirects. The script uses `localhost:3456` which only works locally.

**On your local machine:**

```bash
# Clone the repo locally if you haven't
git clone https://github.com/MontaguSandwich/FreeFlo.git
cd FreeFlo/solver

# Run OAuth flow (starts local callback server on port 3456)
QONTO_CLIENT_ID=your_client_id \
QONTO_CLIENT_SECRET=your_client_secret \
node scripts/qonto-oauth-simple.mjs
```

The script will:
1. Print a URL to open in your browser
2. Start a local callback server on port 3456
3. After you authorize in Qonto, automatically capture the code
4. Exchange for tokens and print your `.env` values

**Output example:**
```
🎉 SUCCESS! Add these to your solver/.env file:
============================================================
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...

# Available bank accounts:
# 1. Main Account - FR76... (Balance: €1234.56)
QONTO_BANK_ACCOUNT_ID=your-org-slug-bank-account-1
```

**Then copy these values to your VPS** when configuring the solver `.env` file in Step 5.

> **Note**: You need `QONTO_CLIENT_ID` and `QONTO_CLIENT_SECRET` from the Qonto Partner Portal first (Settings → Integrations → OAuth Applications).

#### API Key Credentials (for TLSNotary)
```
API Key Login:  your-org-slug
API Key Secret: your_api_key_secret
```

Find these in Qonto dashboard under **Settings** → **Integrations** → **API Keys**.

> **Note**: The OAuth script above also outputs your `QONTO_BANK_ACCOUNT_ID` automatically.

### 1.4 Set Up Trusted Beneficiaries (Optional)

For fully automated transfers without SCA (Strong Customer Authentication):

1. In Qonto dashboard, go to **Transfers** → **Beneficiaries**
2. Add beneficiaries you'll be sending to
3. Mark them as "Trusted"

---

## Step 2: VPS Setup

### 2.1 Provision VPS

Recommended specs:
- **OS**: Ubuntu 22.04 LTS
- **RAM**: 2GB minimum (4GB recommended for TLSNotary)
- **CPU**: 2 vCPU
- **Storage**: 20GB SSD

Providers:
- Hetzner CX21: €4.15/month
- DigitalOcean: $12/month
- AWS Lightsail: $10/month

### 2.2 Initial Server Setup

```bash
# Connect to VPS
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y git curl build-essential pkg-config libssl-dev

# Configure firewall
ufw allow 22/tcp   # SSH
ufw allow 8080/tcp # Health check
ufw allow 8081/tcp # Quote API
ufw allow 4001/tcp # Attestation service
ufw enable
```

### 2.3 Install Node.js

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version  # Should be v20.x
npm --version
```

### 2.4 Install Rust

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Verify
rustc --version  # Should be 1.70+
cargo --version
```

### 2.5 Install Foundry (for contract interaction)

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup

# Verify
cast --version
```

### 2.6 Clone Repository

```bash
cd /opt
git clone https://github.com/MontaguSandwich/FreeFlo.git
cd FreeFlo
```

---

## Step 3: TLSNotary Setup

TLSNotary generates cryptographic proofs of your bank API responses.

### 3.1 Clone TLSNotary

```bash
cd /opt
git clone --branch v0.1.0-alpha.13 https://github.com/tlsnotary/tlsn.git
cd tlsn
```

> **Important**: Use version `v0.1.0-alpha.13` for compatibility.

### 3.2 Copy Qonto Prover

```bash
# Copy Qonto prover examples from FreeFlo repo
cp -r /opt/FreeFlo/tlsn/crates/examples/qonto /opt/tlsn/crates/examples/
```

### 3.3 Build Prover

```bash
cd /opt/tlsn/crates/examples

# Build (first run takes 5-10 minutes)
cargo build --release --example qonto_prove_transfer
cargo build --release --example qonto_present_transfer

# Verify binaries exist
ls -la /opt/tlsn/target/release/examples/qonto_*
```

### 3.4 Test Prover (Optional)

```bash
# Set environment
export QONTO_API_KEY_LOGIN=your-org-slug
export QONTO_API_KEY_SECRET=your_api_key_secret
export QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1
export QONTO_REFERENCE=test-reference

# Run prover (will fail if no matching transaction, but confirms build works)
cd /opt/tlsn/crates/examples
cargo run --release --example qonto_prove_transfer
```

---

## Step 4: Attestation Service Setup

The attestation service verifies TLSNotary proofs and signs EIP-712 attestations.

### 4.1 Generate Witness Key

```bash
# Generate a new private key for the attestation service
cast wallet new

# Output:
# Address: 0x...YOUR_WITNESS_ADDRESS
# Private key: 0x...YOUR_WITNESS_PRIVATE_KEY
```

Save both - you'll need the address for on-chain authorization.

### 4.2 Build Attestation Service

```bash
cd /opt/FreeFlo/attestation-service
cargo build --release
```

### 4.3 Configure Attestation Service

Create `/opt/FreeFlo/attestation-service/.env`:

```bash
# Witness key (signs attestations)
WITNESS_PRIVATE_KEY=0x_YOUR_WITNESS_PRIVATE_KEY

# Must match PaymentVerifier contract
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe

# Logging
RUST_LOG=info

# Port
ATTESTATION_PORT=4001
```

### 4.4 Run Attestation Service

```bash
cd /opt/FreeFlo/attestation-service
./target/release/attestation-service

# Or with PM2 for production
pm2 start ./target/release/attestation-service --name zkp2p-attestation
```

### 4.5 Verify Attestation Service

```bash
curl http://127.0.0.1:4001/health

# Expected response:
# {"status":"ok","witness_address":"0x...","chain_id":84532}
```

---

## Step 5: Solver Setup

### 5.1 Install Dependencies

```bash
cd /opt/FreeFlo/solver
npm install
```

### 5.2 Configure Solver

```bash
cp .env.example .env
nano .env
```

Fill in all required values. Key settings:

```bash
# Blockchain
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249F4AB741F0661A38651A08213DDe1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
SOLVER_PRIVATE_KEY=0x_YOUR_SOLVER_PRIVATE_KEY

# Qonto OAuth
QONTO_ENABLED=true
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret
QONTO_BANK_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Attestation - IMPORTANT: Use 127.0.0.1, NOT localhost
ATTESTATION_ENABLED=true
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001

# TLSNotary Prover
PROVER_ENABLED=true
TLSN_EXAMPLES_PATH=/opt/tlsn/crates/examples
QONTO_API_KEY_LOGIN=your-org-slug
QONTO_API_KEY_SECRET=your_api_key_secret
QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1
```

### 5.3 Build Solver

```bash
npm run build
```

### 5.4 Run Solver

```bash
# Development
npm run start:v3

# Production with PM2
pm2 start npm --name zkp2p-solver -- run start:v3
pm2 save
```

### 5.5 Verify Solver

```bash
# Health check
curl http://127.0.0.1:8080/health

# Quote API
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"
```

---

## Step 6: On-Chain Setup

### 6.1 Fund Solver Wallet

Get testnet ETH for gas:
- [Alchemy Faucet](https://www.alchemy.com/faucets/base-sepolia)
- [Coinbase Faucet](https://www.coinbase.com/faucets/base-sepolia-faucet)

```bash
# Check balance
cast balance YOUR_SOLVER_ADDRESS --rpc-url https://base-sepolia-rpc.publicnode.com
```

### 6.2 Run Setup Script

```bash
cd /opt/FreeFlo
./scripts/setup-solver.sh
```

The script will:
1. Register your solver (optional, for reputation)
2. Enable SEPA_INSTANT support
3. Authorize your witness (requires contract owner key)

### 6.3 Manual Setup (Alternative)

If you prefer manual commands:

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"
VERIFIER="0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe"

# Register solver (optional)
cast send $OFFRAMP "registerSolver(string)" "MySolver" \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC

# Enable SEPA_INSTANT (RTPN 0)
cast send $OFFRAMP "setSolverRtpn(uint8,bool)" 0 true \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC

# Authorize witness (requires contract owner)
cast send $VERIFIER "addWitness(address)" $WITNESS_ADDRESS \
  --private-key $OWNER_PRIVATE_KEY --rpc-url $RPC
```

### 6.4 Verify On-Chain Status

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"
VERIFIER="0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe"

# Check solver registration
cast call $OFFRAMP "solverInfo(address)" $SOLVER_ADDRESS --rpc-url $RPC

# Check SEPA_INSTANT support
cast call $OFFRAMP "solverSupportsRtpn(address,uint8)" $SOLVER_ADDRESS 0 --rpc-url $RPC

# Check witness authorization
cast call $VERIFIER "authorizedWitnesses(address)" $WITNESS_ADDRESS --rpc-url $RPC
```

---

## Step 7: Verification Checklist

Before going live, verify everything works:

### Infrastructure
- [ ] VPS accessible via SSH
- [ ] Firewall configured (22, 8080, 8081, 4001 open)
- [ ] Node.js 20+ installed
- [ ] Rust installed
- [ ] TLSNotary prover built

### Services
- [ ] Attestation service running: `curl http://127.0.0.1:4001/health`
- [ ] Solver running: `curl http://127.0.0.1:8080/health`
- [ ] Quote API working: `curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"`

### Credentials
- [ ] Qonto OAuth tokens configured
- [ ] Qonto API keys configured (for prover)
- [ ] Solver private key has ETH for gas
- [ ] Witness private key configured in attestation service

### On-Chain
- [ ] Solver registered on OffRampV3
- [ ] SEPA_INSTANT support enabled
- [ ] Witness authorized on PaymentVerifier
- [ ] EIP-712 domain matches (check CLAUDE.md for domain details)

### End-to-End Test
- [ ] Create small test intent on frontend
- [ ] Solver quotes the intent
- [ ] Fiat transfer executes
- [ ] TLSNotary proof generates
- [ ] Attestation signs proof
- [ ] Fulfillment transaction succeeds

---

## Troubleshooting

### Solver won't start

```bash
# Check logs
pm2 logs zkp2p-solver

# Common issues:
# - Missing env vars: check .env file
# - RPC not responding: try different RPC URL
# - Invalid private key: ensure 0x prefix
```

### Quote API returns error

```bash
# Check Qonto credentials
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://thirdparty.qonto.com/v2/organization
```

### Attestation service unreachable

```bash
# IMPORTANT: Use IP, not localhost
# Wrong: ATTESTATION_SERVICE_URL=http://localhost:4001
# Right: ATTESTATION_SERVICE_URL=http://127.0.0.1:4001

# Check service is running
ps aux | grep attestation
```

### TLSNotary proof timeout

```bash
# Ensure prover timeout is high enough (5 min for first run)
PROVER_TIMEOUT=300000

# Pre-build the prover to avoid compilation during first transfer
cd /opt/tlsn/crates/examples
cargo build --release --example qonto_prove_transfer
```

### NotAuthorizedWitness error

```bash
# Check witness is authorized
cast call $VERIFIER "authorizedWitnesses(address)" $WITNESS_ADDRESS --rpc-url $RPC

# Check EIP-712 domain matches
# Domain must be:
#   name: "WisePaymentVerifier"
#   version: "1"
#   chainId: 84532
#   verifyingContract: 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
```

### Qonto tokens expired

Tokens expire after 1 hour. The solver auto-refreshes if you have `QONTO_REFRESH_TOKEN`, `QONTO_CLIENT_ID`, and `QONTO_CLIENT_SECRET` configured.

If refresh fails:
```bash
# Re-authorize via OAuth flow and update .env
pm2 restart zkp2p-solver
```

---

## Production Considerations

1. **SSL/HTTPS**: Set up nginx with Let's Encrypt for Quote API
2. **Monitoring**: Use PM2 monitoring or set up alerts
3. **Backup**: Backup `.env` and `solver.db` regularly
4. **Key Security**: Consider using a secrets manager
5. **Rate Limits**: Be aware of Qonto API rate limits
6. **Balance Alerts**: Monitor Qonto and solver wallet balances

---

## Support

- **GitHub Issues**: https://github.com/MontaguSandwich/FreeFlo/issues
- **Documentation**: See `CLAUDE.md` for quick reference
- **Architecture**: See `docs/ARCHITECTURE.md` for system design
