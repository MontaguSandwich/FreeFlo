# FreeFlo Solver Deployment Guide

A practical, step-by-step guide to deploying a FreeFlo solver. Based on real deployment experience.

> **Important**: You do NOT run your own attestation service. FreeFlo operates the attestation
> service with the witness key. This ensures trustless operation - solvers cannot forge proofs.

---

## Prerequisites

Before starting, you need:

| Item | Notes |
|------|-------|
| **Qonto Business Account** | EU business, already approved |
| **VPS** | Ubuntu 22.04+, 4GB RAM (Hetzner €4-8/mo) |
| **Your laptop** | Mac/Linux, for running OAuth flow |
| **FreeFlo API Key** | Contact FreeFlo team to register as a solver |

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

## Part 2: Get FreeFlo API Key

**The attestation service is operated by FreeFlo.** You need an API key to request attestations.

### 2.1 Register with FreeFlo

Contact the FreeFlo team to register as a solver:
- GitHub: Open an issue at https://github.com/MontaguSandwich/FreeFlo/issues
- Email: (contact info TBD)

Provide:
1. Your **solver Ethereum address** (the address that will submit on-chain transactions)
2. Your **company/organization name**
3. Brief description of your setup

### 2.2 Receive API Key

FreeFlo will issue you:
- **API Key**: A unique key tied to your solver address
- **Attestation Service URL**: `https://attestation.freeflo.live`

**Keep your API key secret!** It authenticates your solver to the attestation service.

### 2.3 Why FreeFlo Controls the Attestation Service

This architecture ensures trustless operation:
- **Solvers cannot forge proofs**: Only FreeFlo's witness key can sign valid attestations
- **On-chain validation**: Before signing, the service verifies the intent exists and you're the selected solver
- **Audit trail**: All attestation requests are logged

---

## Part 3: VPS Setup

### 3.1 Connect to VPS

```bash
ssh root@YOUR_VPS_IP
```

### 3.2 Install System Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y git curl build-essential pkg-config libssl-dev jq

# Configure firewall
ufw allow 22/tcp    # SSH
ufw allow 8080/tcp  # Health check
ufw allow 8081/tcp  # Quote API
ufw --force enable
```

### 3.3 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version  # Should show v20.x
```

### 3.4 Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Verify
rustc --version  # Should show 1.70+
```

### 3.5 Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup

# Verify
cast --version
```

### 3.6 Clone FreeFlo Repository

```bash
cd /opt
git clone https://github.com/MontaguSandwich/FreeFlo.git
```

---

## Part 4: TLSNotary Prover Setup

### 4.1 Clone TLSNotary

```bash
cd /opt
git clone --branch v0.1.0-alpha.13 https://github.com/tlsnotary/tlsn.git
```

### 4.2 Copy Qonto Prover Examples

```bash
cp -r /opt/FreeFlo/tlsn/crates/examples/qonto /opt/tlsn/crates/examples/
```

### 4.3 Configure TLSNotary Cargo.toml

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

### 4.4 Build Prover (Takes 5-10 Minutes)

```bash
cargo build --release --example qonto_prove_transfer
cargo build --release --example qonto_present_transfer

# Verify binaries exist
ls /opt/tlsn/target/release/examples/qonto_*
```

You'll see deprecation warnings - ignore them, they're from upstream code.

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

Replace all placeholder values with your actual credentials:

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
# FREEFLO ATTESTATION SERVICE (from Part 2)
# =============================================================================
ATTESTATION_ENABLED=true
ATTESTATION_SERVICE_URL=https://attestation.freeflo.live
ATTESTATION_API_KEY=your_api_key_from_freeflo

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

> **Important**:
> - `ATTESTATION_SERVICE_URL` points to FreeFlo's service, NOT localhost
> - `ATTESTATION_API_KEY` is issued by FreeFlo (Part 2)
> - `QONTO_BANK_ACCOUNT_ID` must be UUID format, not slug

### 5.3 Build and Start Solver

```bash
cd /opt/FreeFlo/solver
npm install
npm run build
npm run start:v3
```

You should see logs showing:
- Qonto provider registered
- Attestation client configured (pointing to FreeFlo)
- Quote API started on port 8081
- "V3 Orchestrator started with zkTLS verification"

---

## Part 6: On-Chain Registration (Optional)

### 6.1 Get Testnet ETH

Get Base Sepolia ETH from:
- https://www.alchemy.com/faucets/base-sepolia
- https://www.coinbase.com/faucets/base-sepolia-faucet

### 6.2 Register Solver On-Chain

Registration is optional but helps with reputation tracking:

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

### 6.3 Verify On-Chain Status

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"

# Check solver info (returns name, fulfillment count, volume)
cast call $OFFRAMP "solverInfo(address)" YOUR_SOLVER_ADDRESS --rpc-url $RPC

# Check SEPA_INSTANT support
cast call $OFFRAMP "solverSupportsRtpn(address,uint8)" YOUR_SOLVER_ADDRESS 0 --rpc-url $RPC
```

> **Note**: OffRampV3 is **permissionless** - there's no `authorizedSolvers` check.
> Any address can be a solver. FreeFlo's witness is already authorized on-chain.

---

## Part 7: Verify Everything Works

```bash
# Health check
curl http://127.0.0.1:8080/health

# Quote API (should return quotes)
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"

# External access (from your laptop)
curl "http://YOUR_VPS_IP:8081/api/quote?amount=100&currency=EUR"
```

### End-to-End Test

1. Create a small test intent on the frontend (https://free-flo.vercel.app)
2. Watch solver logs - should see:
   - "Processing committed intents for fulfillment"
   - "Step 1/4: Executing fiat transfer"
   - "Step 2/4: Generating TLSNotary proof"
   - "Step 3/4: Requesting attestation" (to FreeFlo)
   - "Step 4/4: Submitting fulfillment"
   - "✅ Intent fulfilled with zkTLS verification"

---

## Running in Production (PM2)

```bash
# Install PM2
npm install -g pm2

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

### `Invalid API key` or `Missing X-Solver-API-Key header`

**Cause**: FreeFlo API key not configured or incorrect.

**Fix**:
- Ensure `ATTESTATION_API_KEY` is set in your `.env`
- Verify the key matches what FreeFlo issued you
- Contact FreeFlo if you need a new key

### `Intent not found` or `Intent is not ready for fulfillment`

**Cause**: Intent doesn't exist on-chain, already fulfilled, or not in COMMITTED status.

**Fix**:
- Check intent status: `cast call $OFFRAMP "getIntent(bytes32)" $INTENT_ID --rpc-url $RPC`
- Ensure you're the `selectedSolver` for that intent

### `Solver mismatch`

**Cause**: Your solver address doesn't match the `selectedSolver` on-chain.

**Fix**: The user selected a different solver. You can only fulfill intents assigned to your address.

### `example not found` or `urlencoding not found`

**Cause**: Cargo.toml not configured properly.

**Fix**: Run Part 4.3 again.

### `QuoteWindowClosed`

**Cause**: Trying to quote an intent after the 5-minute quote window.

**Fix**: Wait for new intents. The solver automatically detects and quotes new intents.

### Qonto tokens expired

**Cause**: OAuth tokens expire after 1 hour.

**Fix**: The solver auto-refreshes if `QONTO_CLIENT_ID`, `QONTO_CLIENT_SECRET`, and `QONTO_REFRESH_TOKEN` are all set. If refresh fails, re-run the OAuth flow on your laptop.

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
[ ] ATTESTATION_API_KEY (from FreeFlo!)
```

---

## Architecture Overview

```
Your Solver VPS                FreeFlo Infrastructure           On-Chain
────────────────               ─────────────────────           ────────
1. Detect intent
2. Submit quote ──────────────────────────────────────────────► OffRampV3
3. User selects your quote
4. Execute SEPA transfer
5. Generate TLSNotary proof
6. Request attestation ─────► Validate intent on-chain
   (with API key)              Verify you're selectedSolver
                               Verify proof
                               Sign attestation
                        ◄───── Return signature
7. Submit fulfillment ────────────────────────────────────────► PaymentVerifier
                                                                 Verify signature
                                                                 Release USDC to you
```

---

## Support

- GitHub Issues: https://github.com/MontaguSandwich/FreeFlo/issues
- Architecture docs: `docs/ARCHITECTURE.md`
- Security model: `docs/SECURITY.md`
