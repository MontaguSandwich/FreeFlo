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
| **FreeFlo API Key** | Contact FreeFlo team to register as a solver |
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
│  4. FreeFlo API Key   → Register with FreeFlo                       │
│  5. Solver            → Configure and run                           │
│  6. On-chain          → Register solver (optional)                  │
│  7. Verify            → Test end-to-end                             │
└─────────────────────────────────────────────────────────────────────┘
```

**Important**: You do NOT need to run your own attestation service. FreeFlo operates the attestation service with the witness key. This ensures trustless operation - solvers cannot forge payment proofs.

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

# OR if you saved your variable in an solver/.env file
(set -a; source .env; set +a; \
node scripts/qonto-oauth-simple.mjs)
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

> ⚠️ **Important**: The `QONTO_BANK_ACCOUNT_ID` shown above is in **slug format**. The Qonto transfer API requires the **UUID format** instead. After completing OAuth, you must fetch the correct UUID (see Step 1.5 below).

**Save these values** - you'll copy them to your VPS in Step 5.

> **Note**: You need `QONTO_CLIENT_ID` and `QONTO_CLIENT_SECRET` from the Qonto Partner Portal first (Settings → Integrations → OAuth Applications).

#### Why Run OAuth Locally?

The OAuth flow requires a callback URL. Qonto only allows:
- `http://localhost:*` - Works locally without HTTPS
- `https://your-domain.com` - Requires valid SSL certificate

Since most VPS setups don't have SSL configured initially, it's simpler to:
1. Run the OAuth script on your laptop (uses localhost)
2. Copy the resulting tokens to your VPS

The tokens work from any server once obtained.

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

### 1.5 Get Correct Bank Account UUID

The OAuth script outputs a **slug-format** bank account ID (e.g., `your-org-slug-bank-account-1`), but the Qonto transfer API requires the **UUID format** (e.g., `019b224e-3c54-78cc-a6cb-b29a798874b0`).

**After getting your OAuth tokens**, fetch the correct UUID:

```bash
# Using the access token from the OAuth flow
curl -s -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  "https://thirdparty.qonto.com/v2/organization" | jq '.organization.bank_accounts[] | {id, iban, name, balance}'

# OR if you saved your variable in an solver/.env file
(set -a; source .env; set +a; \
curl -s -H "Authorization: Bearer $QONTO_ACCESS_TOKEN" \
  "https://thirdparty.qonto.com/v2/organization" | jq '.organization.bank_accounts[] | {id, iban, name, balance}')
```

**Example output:**
```json
{
  "id": "019b224e-3c54-78cc-a6cb-b29a798874b0",
  "iban": "FR7616958000012912340967682",
  "name": "Compte principal",
  "balance": 1234.56
}
```

Use the `id` field (UUID format) as your `QONTO_BANK_ACCOUNT_ID` in the solver `.env`.

> **Note**: If you don't have `jq` installed, you can install it with `apt install -y jq` or just view the raw JSON response.

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

### 3.1 Build Prover

```bash
cd /opt/FreeFlo/tlsn/qonto

# Build (first run takes 5-10 minutes)
cargo build --release --bin qonto_prove_transfer
cargo build --release --bin qonto_present_transfer

# Verify binaries exist
ls -la /opt/FreeFlo/tlsn/target/release/qonto_*
```

> **Note**: You'll see deprecation warnings during build - these are from upstream TLSNotary code and can be safely ignored.

### 3.2 Test Prover (Optional)

```bash
# Set environment (for instance in .env file)
export QONTO_API_KEY_LOGIN=your-org-slug
export QONTO_API_KEY_SECRET=your_api_key_secret
export QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1
export QONTO_REFERENCE=test-reference

# Run prover (will fail if no matching transaction, but confirms build works)
cd /opt/FreeFlo/tlsn/qonto
cargo run --release --bin qonto_prove_transfer
```

---

## Step 4: Get FreeFlo API Key

**The attestation service is operated by FreeFlo.** You need an API key to request attestations.

### 4.1 Register with FreeFlo

Contact the FreeFlo team to register as a solver:
- Email: (contact info TBD)
- Discord: (link TBD)
- GitHub: Open an issue at https://github.com/MontaguSandwich/FreeFlo/issues

Provide:
1. Your **solver Ethereum address** (the address that will submit on-chain transactions)
2. Your **company/organization name**
3. Brief description of your setup

### 4.2 Receive API Key

FreeFlo will issue you:
- **API Key**: A unique key tied to your solver address
- **Attestation Service URL**: `https://attestation.freeflo.live` (or current endpoint)

**Keep your API key secret!** It authenticates your solver to the attestation service.

### 4.3 Why FreeFlo Controls the Attestation Service

This architecture ensures trustless operation:
- **Solvers cannot forge proofs**: Only FreeFlo's witness key can sign valid attestations
- **On-chain validation**: Before signing, the service verifies the intent exists and you're the selected solver
- **Audit trail**: All attestation requests are logged

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
# =============================================================================
# BLOCKCHAIN
# =============================================================================
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249F4AB741F0661A38651A08213DDe1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
SOLVER_PRIVATE_KEY=0x_YOUR_SOLVER_PRIVATE_KEY

# =============================================================================
# QONTO - Copy these from OAuth script output (Step 1.3)
# =============================================================================
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth

# OAuth tokens (from running the script on your laptop)
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...

# OAuth app credentials (from Qonto Partner Portal)
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret

# Bank account - MUST be UUID format from Step 1.5
QONTO_BANK_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Your fee (50 = 0.5%, 100 = 1%, 0 = free)
QONTO_FEE_BPS=50

# =============================================================================
# FREEFLO ATTESTATION SERVICE
# =============================================================================
ATTESTATION_ENABLED=true
ATTESTATION_SERVICE_URL=https://attestation.freeflo.live
ATTESTATION_API_KEY=your_api_key_from_freeflo  # From Step 4

# =============================================================================
# TLSNOTARY PROVER
# =============================================================================
PROVER_ENABLED=true
PROVER_TIMEOUT=300000
TLSN_EXAMPLES_PATH=/opt/tlsn/crates/examples

# API key credentials (from Qonto dashboard, different from OAuth)
QONTO_API_KEY_LOGIN=your-org-slug
QONTO_API_KEY_SECRET=your_api_key_secret
QONTO_BANK_ACCOUNT_SLUG=your-org-slug-bank-account-1

# =============================================================================
# SERVER
# =============================================================================
HEALTH_PORT=8080
QUOTE_API_PORT=8081
```

> ⚠️ **Important Notes**:
> - `QONTO_BANK_ACCOUNT_ID` must be in **UUID format** (see Step 1.5), not the slug format
> - `ATTESTATION_SERVICE_URL` should be the FreeFlo endpoint, NOT `127.0.0.1`
> - `ATTESTATION_API_KEY` is issued by FreeFlo (Step 4)

### 5.2.1 Generate Solver Wallet

The solver needs a dedicated wallet to pay gas fees for submitting attestations and fulfillment transactions on-chain. Create a new wallet for this purpose:

```bash
# Generate a new wallet
cast wallet new

# Output example:
# Successfully created new keypair.
# Address:     0x1234567890abcdef1234567890abcdef12345678
# Private key: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
```

**Add the private key to your `.env` file:**

```bash
SOLVER_PRIVATE_KEY=0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
```

> 🔒 **Security**: Keep this private key secret! Anyone with access to it can control your solver wallet and submit transactions on your behalf.

**Fund the address** with Base Sepolia ETH (~0.01 ETH recommended) for gas fees. The solver will use this wallet to:
- Submit fulfillment transactions with attestations
- Register on-chain (optional)
- Enable payment methods (optional)

See [Step 6.1](#61-fund-solver-wallet) for faucet links.
> 

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

## Step 6: On-Chain Setup (Optional)

### 6.1 Fund Solver Wallet

Get testnet ETH for gas:
- [Alchemy Faucet](https://www.alchemy.com/faucets/base-sepolia)
- [Coinbase Faucet](https://www.coinbase.com/faucets/base-sepolia-faucet)

```bash
# Check balance
cast balance YOUR_SOLVER_ADDRESS --rpc-url https://base-sepolia-rpc.publicnode.com
```

### 6.2 Register Solver (Optional)

Registration is optional but helps with reputation tracking:

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"

# Register solver
cast send $OFFRAMP "registerSolver(string)" "MySolver" \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC

# Enable SEPA_INSTANT (RTPN 0)
cast send $OFFRAMP "setSolverRtpn(uint8,bool)" 0 true \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC
```

### 6.3 Verify On-Chain Status

```bash
RPC="https://base-sepolia-rpc.publicnode.com"
OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"

# Check solver registration
cast call $OFFRAMP "solverInfo(address)" $SOLVER_ADDRESS --rpc-url $RPC

# Check SEPA_INSTANT support
cast call $OFFRAMP "solverSupportsRtpn(address,uint8)" $SOLVER_ADDRESS 0 --rpc-url $RPC
```

**Note**: You do NOT need to authorize a witness - FreeFlo's witness is already authorized in the PaymentVerifier contract.

---

## Step 7: Verification Checklist

Before going live, verify everything works:

### Infrastructure
- [ ] VPS accessible via SSH
- [ ] Firewall configured (22, 8080, 8081 open)
- [ ] Node.js 20+ installed
- [ ] Rust installed
- [ ] TLSNotary prover built

### Services
- [ ] Solver running: `curl http://127.0.0.1:8080/health`
- [ ] Quote API working: `curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"`

### Credentials
- [ ] Qonto OAuth tokens configured
- [ ] Qonto API keys configured (for prover)
- [ ] Solver private key has ETH for gas
- [ ] FreeFlo API key configured (`ATTESTATION_API_KEY`)

### On-Chain (Optional)
- [ ] Solver registered on OffRampV3
- [ ] SEPA_INSTANT support enabled

### End-to-End Test
- [ ] Create small test intent on frontend
- [ ] Solver quotes the intent
- [ ] Fiat transfer executes
- [ ] TLSNotary proof generates
- [ ] Attestation received from FreeFlo
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

### Attestation request fails

```bash
# Check API key is correct
# Check attestation service URL
# Check solver logs for detailed error

# Common errors:
# - "Invalid API key": Check ATTESTATION_API_KEY in .env
# - "Intent not found": Intent may have expired or wrong hash
# - "Solver mismatch": Your address doesn't match selectedSolver on-chain
```

### TLSNotary proof timeout

```bash
# Ensure prover timeout is high enough (5 min for first run)
PROVER_TIMEOUT=300000

# Pre-build the prover to avoid compilation during first transfer
cd /opt/tlsn/crates/examples
cargo build --release --example qonto_prove_transfer
```

### Qonto tokens expired

Tokens expire after 1 hour. The solver auto-refreshes if you have `QONTO_REFRESH_TOKEN`, `QONTO_CLIENT_ID`, and `QONTO_CLIENT_SECRET` configured.

If refresh fails:
```bash
# Re-authorize via OAuth flow and update .env
pm2 restart zkp2p-solver
```

### VoP proof token invalid

If you see `vop_proof_token_invalid: VOP proof token validation failed: invalid signature`:

```bash
# Check server clock is synchronized
timedatectl status

# If NTP is not synchronized:
timedatectl set-ntp true
systemctl restart systemd-timesyncd
```

Clock drift can cause VoP tokens to fail validation. See also [Appendix: Multiple Solvers](#appendix-multiple-solvers-same-qonto-account) if running multiple solver instances.

### Bank account not found

If you see `bank_account_not_found`:

```bash
# You're using the wrong bank account ID format
# The OAuth script outputs slug format: your-org-slug-bank-account-1
# The API requires UUID format: 019b224e-3c54-78cc-a6cb-b29a798874b0

# Fetch the correct UUID:
source .env
curl -s -H "Authorization: Bearer $QONTO_ACCESS_TOKEN" \
  "https://thirdparty.qonto.com/v2/organization" | jq '.organization.bank_accounts[] | {id, iban}'

# Update .env with the UUID from the "id" field
```

### Build errors: missing dependencies

If you see `use of unresolved module or unlinked crate`:

```bash
# For urlencoding error in TLSNotary:
cd /opt/tlsn/crates/examples
cargo add urlencoding
cargo build --release --example qonto_prove_transfer
```

### Build errors: example not found

If you see `no example target named 'qonto_prove_transfer'`:

```bash
# The Cargo.toml doesn't have the example entries
# Add them manually:
cat >> /opt/tlsn/crates/examples/Cargo.toml << 'EOF'

[[example]]
name = "qonto_prove_transfer"
path = "qonto/prove_transfer.rs"

[[example]]
name = "qonto_present_transfer"
path = "qonto/present_transfer.rs"
EOF
```

---

## Production Considerations

1. **SSL/HTTPS**: Set up nginx with Let's Encrypt for Quote API
2. **Monitoring**: Use PM2 monitoring or set up alerts
3. **Backup**: Backup `.env` and `solver.db` regularly
4. **Key Security**: Consider using a secrets manager
5. **Rate Limits**: Be aware of Qonto API rate limits
6. **Balance Alerts**: Monitor Qonto and solver wallet balances
7. **Clock Sync**: Ensure NTP is enabled (`timedatectl set-ntp true`)

---

## Appendix: Multiple Solvers (Same Qonto Account)

If you're testing multiple solver instances using the **same Qonto business account**, be aware of these constraints:

### Each Solver Needs Its Own OAuth Application

Qonto's VoP (Verification of Payee) proof tokens appear to be scoped to the OAuth application/session. If two solvers share the same OAuth app credentials (`QONTO_CLIENT_ID`/`QONTO_CLIENT_SECRET`), you may encounter:

```
vop_proof_token_invalid: VOP proof token validation failed: invalid signature
```

**Solution**: Create a separate OAuth application in Qonto Partner Portal for each solver instance:
1. Go to Qonto → Settings → Integrations → OAuth Applications
2. Create a new application (e.g., "FreeFlo Solver 2")
3. Use different `QONTO_CLIENT_ID` and `QONTO_CLIENT_SECRET` for each solver
4. Run the OAuth flow separately for each solver

### Token Refresh Conflicts

If two solvers share OAuth credentials, token refreshes can invalidate each other's tokens since refresh tokens are rotated on use.

### Same Bank Account is OK

Multiple solvers can use the same Qonto bank account (`QONTO_BANK_ACCOUNT_ID`) - just ensure they have separate OAuth applications.

### Frontend Multi-Solver Support

To display quotes from multiple solvers on the frontend, set the `SOLVER_API_URLS` environment variable in Vercel:

```
SOLVER_API_URLS=http://solver1-ip:8081,http://solver2-ip:8081
```

---

## Support

- **GitHub Issues**: https://github.com/MontaguSandwich/FreeFlo/issues
- **Documentation**: See `CLAUDE.md` for quick reference
- **Architecture**: See `docs/ARCHITECTURE.md` for system design
