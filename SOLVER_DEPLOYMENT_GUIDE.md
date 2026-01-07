# FreeFlo Solver Deployment Guide

A practical, step-by-step guide to deploying a FreeFlo solver. Based on real deployment experience.

---

## Prerequisites

Before starting, you need:

| Item | Notes |
|------|-------|
| **Qonto Business Account** | EU business, already approved |
| **VPS** | Ubuntu 22.04+, 4GB RAM (Hetzner €4-8/mo) |
| **Your laptop** | Mac/Linux, for running OAuth flow |

---

## Part 1: Get Qonto Credentials (On Your Laptop)

### 1.1 Create OAuth Application in Qonto

1. Go to **Qonto Partner Portal** → Settings → Integrations → OAuth Applications
2. Create new application: "FreeFlo Solver"
3. Set redirect URI: `http://localhost:3456/callback`
4. Permissions needed: `organization.read`, `payment.write`, `offline_access`
5. **Save these values:**
   - `QONTO_CLIENT_ID`
   - `QONTO_CLIENT_SECRET`

### 1.2 Get API Key (for TLSNotary prover)

1. In Qonto dashboard → Settings → Integrations → API Keys
2. Create new key
3. **Save these values:**
   - `QONTO_API_KEY_LOGIN` (your org slug, e.g., `my-company-1234`)
   - `QONTO_API_KEY_SECRET`
   - `QONTO_BANK_ACCOUNT_SLUG` (e.g., `my-company-1234-bank-account-1`)

### 1.3 Run OAuth Flow (Must Be On Your Laptop)

Qonto only allows `http://localhost` without HTTPS. You cannot run this on the VPS.

```bash
# Clone repo on your laptop
git clone https://github.com/MontaguSandwich/FreeFlo.git
cd FreeFlo/solver

# Install dependencies
npm install

# Run OAuth flow
QONTO_CLIENT_ID=your_client_id \
QONTO_CLIENT_SECRET=your_client_secret \
node scripts/qonto-oauth-simple.mjs
```

A browser window opens. Log in and authorize. The script outputs:
- `QONTO_ACCESS_TOKEN`
- `QONTO_REFRESH_TOKEN`
- `QONTO_BANK_ACCOUNT_ID` (in slug format - **you need to convert this!**)

### 1.4 Get Correct Bank Account UUID

**Critical**: The OAuth script outputs slug format, but the API needs UUID format.

```bash
# Replace YOUR_ACCESS_TOKEN with the token from step 1.3
curl -s -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "https://thirdparty.qonto.com/v2/organization" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for acc in data['organization']['bank_accounts']:
    print(f\"UUID: {acc['id']}\")
    print(f\"IBAN: {acc['iban']}\")
    print(f\"Name: {acc['name']}\")
    print()
"
```

**Save the UUID** (looks like `019b224e-3c54-78cc-a6cb-b29a798874b0`).

### 1.5 Summary: Values You Should Have

Save all these values - you'll need them on the VPS:

```
QONTO_CLIENT_ID=...
QONTO_CLIENT_SECRET=...
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...
QONTO_BANK_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  (UUID format!)
QONTO_API_KEY_LOGIN=your-org-slug
QONTO_API_KEY_SECRET=...
QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1
```

---

## Part 2: VPS Setup

### 2.1 Connect to VPS

```bash
ssh root@YOUR_VPS_IP
```

### 2.2 Install System Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y git curl build-essential pkg-config libssl-dev jq

# Configure firewall
ufw allow 22/tcp    # SSH
ufw allow 8080/tcp  # Health check
ufw allow 8081/tcp  # Quote API
ufw allow 4001/tcp  # Attestation service
ufw --force enable
```

### 2.3 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version  # Should show v20.x
```

### 2.4 Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Verify
rustc --version  # Should show 1.70+
```

### 2.5 Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup

# Verify
cast --version
```

### 2.6 Clone FreeFlo Repository

```bash
cd /opt
git clone https://github.com/MontaguSandwich/FreeFlo.git
```

---

## Part 3: TLSNotary Prover Setup

### 3.1 Clone TLSNotary

```bash
cd /opt
git clone --branch v0.1.0-alpha.13 https://github.com/tlsnotary/tlsn.git
```

### 3.2 Copy Qonto Prover Examples

```bash
cp -r /opt/FreeFlo/tlsn/crates/examples/qonto /opt/tlsn/crates/examples/
```

### 3.3 Configure TLSNotary Cargo.toml

```bash
cd /opt/tlsn/crates/examples

# Add required dependency
cargo add urlencoding

# Register the Qonto examples
cat >> Cargo.toml << 'EOF'

[[example]]
name = "qonto_prove_transfer"
path = "qonto/prove_transfer.rs"

[[example]]
name = "qonto_present_transfer"
path = "qonto/present_transfer.rs"
EOF
```

### 3.4 Build Prover (Takes 5-10 Minutes)

```bash
cargo build --release --example qonto_prove_transfer
cargo build --release --example qonto_present_transfer

# Verify binaries exist
ls /opt/tlsn/target/release/examples/qonto_*
```

You'll see deprecation warnings - ignore them, they're from upstream code.

---

## Part 4: Attestation Service Setup

### 4.1 Generate Witness Key

```bash
cast wallet new
```

**Save both values:**
- Address: `0x...` (this is your WITNESS_ADDRESS)
- Private key: `0x...` (this is your WITNESS_PRIVATE_KEY)

### 4.2 Build Attestation Service

```bash
cd /opt/FreeFlo/attestation-service
cargo build --release
```

### 4.3 Configure Attestation Service

```bash
cat > /opt/FreeFlo/attestation-service/.env << 'EOF'
WITNESS_PRIVATE_KEY=0xYOUR_WITNESS_PRIVATE_KEY_HERE
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
RUST_LOG=info
PORT=4001
EOF
```

### 4.4 Start Attestation Service

Open a new terminal (or use tmux/screen):

```bash
cd /opt/FreeFlo/attestation-service
./target/release/attestation-service
```

Leave this running. Open another terminal for the next steps.

### 4.5 Verify Attestation Service

```bash
curl http://127.0.0.1:4001/health
```

Should return JSON with witness address.

---

## Part 5: Solver Setup

### 5.1 Generate Solver Wallet

```bash
cast wallet new
```

**Save both values:**
- Address: `0x...` (this is your SOLVER_ADDRESS)
- Private key: `0x...` (this is your SOLVER_PRIVATE_KEY)

### 5.2 Create Solver Configuration

Replace all placeholder values with your actual credentials from Part 1:

```bash
cat > /opt/FreeFlo/solver/.env << 'EOF'
# =============================================================================
# BLOCKCHAIN
# =============================================================================
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249F4AB741F0661A38651A08213DDe1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
SOLVER_PRIVATE_KEY=0xYOUR_SOLVER_PRIVATE_KEY

# =============================================================================
# QONTO OAUTH (from Part 1.3)
# =============================================================================
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=ory_at_YOUR_ACCESS_TOKEN
QONTO_REFRESH_TOKEN=ory_rt_YOUR_REFRESH_TOKEN
QONTO_CLIENT_ID=your_qonto_client_id
QONTO_CLIENT_SECRET=your_qonto_client_secret

# Bank account - MUST BE UUID FORMAT (from Part 1.4)
QONTO_BANK_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Your fee in basis points (50 = 0.5%, 100 = 1%, 0 = free)
QONTO_FEE_BPS=50

# =============================================================================
# ATTESTATION SERVICE
# =============================================================================
ATTESTATION_ENABLED=true
# IMPORTANT: Use 127.0.0.1, NOT localhost
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001

# =============================================================================
# TLSNOTARY PROVER
# =============================================================================
PROVER_ENABLED=true
PROVER_TIMEOUT=300000
TLSN_EXAMPLES_PATH=/opt/tlsn/crates/examples

# API key credentials (from Part 1.2 - different from OAuth!)
QONTO_API_KEY_LOGIN=your-org-slug
QONTO_API_KEY_SECRET=your_api_key_secret
QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1

# =============================================================================
# SERVER
# =============================================================================
HEALTH_PORT=8080
QUOTE_API_PORT=8081
EOF
```

### 5.3 Build and Start Solver

```bash
cd /opt/FreeFlo/solver
npm install
npm run build
npm run start:v3
```

You should see logs showing:
- Qonto provider registered
- Attestation service connected
- Quote API started on port 8081

---

## Part 6: On-Chain Registration

### 6.1 Get Testnet ETH

Get Base Sepolia ETH from:
- https://www.alchemy.com/faucets/base-sepolia
- https://www.coinbase.com/faucets/base-sepolia-faucet

### 6.2 Register Solver On-Chain

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"
SOLVER_KEY="0xYOUR_SOLVER_PRIVATE_KEY"

# Register solver with a name
cast send $OFFRAMP "registerSolver(string)" "MySolverName" \
  --private-key $SOLVER_KEY --rpc-url $RPC

# Enable SEPA_INSTANT support (RTPN 0)
cast send $OFFRAMP "setSolverRtpn(uint8,bool)" 0 true \
  --private-key $SOLVER_KEY --rpc-url $RPC
```

### 6.3 Authorize Witness (Requires Contract Owner)

**Contact the FreeFlo team** to authorize your witness address:

```bash
VERIFIER="0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe"
WITNESS_ADDRESS="0xYOUR_WITNESS_ADDRESS"

# This must be run by contract owner
cast send $VERIFIER "addWitness(address)" $WITNESS_ADDRESS \
  --private-key OWNER_KEY --rpc-url $RPC
```

### 6.4 Verify On-Chain Status

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"
VERIFIER="0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe"

# Check solver is registered
cast call $OFFRAMP "authorizedSolvers(address)" YOUR_SOLVER_ADDRESS --rpc-url $RPC

# Check witness is authorized
cast call $VERIFIER "authorizedWitnesses(address)" YOUR_WITNESS_ADDRESS --rpc-url $RPC
```

Both should return `true`.

---

## Part 7: Verify Everything Works

```bash
# Health check
curl http://127.0.0.1:8080/health

# Attestation service
curl http://127.0.0.1:4001/health

# Quote API (should return quotes)
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"

# External access (from your laptop)
curl "http://YOUR_VPS_IP:8081/api/quote?amount=100&currency=EUR"
```

---

## Running in Production (PM2)

```bash
# Install PM2
npm install -g pm2

# Start attestation service
cd /opt/FreeFlo/attestation-service
pm2 start ./target/release/attestation-service --name zkp2p-attestation

# Start solver
cd /opt/FreeFlo/solver
pm2 start npm --name zkp2p-solver -- run start:v3

# Save PM2 config
pm2 save
pm2 startup
```

---

## Common Errors and Fixes

### `bank_account_not_found`

**Cause**: Using slug format instead of UUID format for bank account ID.

**Fix**: Get the UUID using the curl command in Part 1.4.

### `vop_proof_token_invalid`

**Cause**: Server clock is out of sync.

**Fix**:
```bash
timedatectl set-ntp true
systemctl restart systemd-timesyncd
```

### `example not found` or `urlencoding not found`

**Cause**: Cargo.toml not configured properly.

**Fix**: Run Part 3.3 again.

### `localhost connection refused`

**Cause**: Using `localhost` instead of `127.0.0.1`.

**Fix**: Always use `127.0.0.1` in ATTESTATION_SERVICE_URL.

### `NotAuthorizedWitness`

**Cause**: Witness not authorized on-chain.

**Fix**: Contact FreeFlo team to run the addWitness transaction.

---

## Credentials Checklist

Before starting, make sure you have all these values:

```
[ ] QONTO_CLIENT_ID
[ ] QONTO_CLIENT_SECRET
[ ] QONTO_ACCESS_TOKEN
[ ] QONTO_REFRESH_TOKEN
[ ] QONTO_BANK_ACCOUNT_ID (UUID format!)
[ ] QONTO_API_KEY_LOGIN
[ ] QONTO_API_KEY_SECRET
[ ] QONTO_BANK_ACCOUNT_SLUG
[ ] SOLVER_PRIVATE_KEY
[ ] WITNESS_PRIVATE_KEY
```

---

## Support

- GitHub Issues: https://github.com/MontaguSandwich/FreeFlo/issues
- Architecture docs: `docs/ARCHITECTURE.md`
