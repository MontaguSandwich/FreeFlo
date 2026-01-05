# CLAUDE.md - Project Context for Claude Code

## Project Overview

**FreeFlo** is a trustless, permissionless USDC-to-fiat offramp using zkTLS (TLSNotary) proofs. Users deposit USDC on-chain, solvers send fiat via real-time payment networks (SEPA Instant, FPS, PIX, etc.), then claim USDC by proving the bank transfer happened using cryptographic proofs from the bank's API response.

**Repository**: https://github.com/MontaguSandwich/FreeFlo

### Core Value Proposition
- **Trustless**: Solver can ONLY claim USDC with valid zkTLS proof of payment
- **Permissionless**: Anyone with provider API keys can run a solver
- **Fast**: End-to-end flow completes in ~14 seconds

## Current State (January 2026)

### What's Working
- Full end-to-end flow on Base Sepolia testnet
- Qonto provider for SEPA Instant transfers
- TLSNotary proof generation (~4.5 seconds)
- Attestation service signing EIP-712 proofs
- On-chain verification with `verifiedByZkTLS: true`
- Real quotes via solver Quote API (not mock data)
- Frontend on Vercel with live quote fetching

### Typical Transaction Timeline
| Step | Duration |
|------|----------|
| User creates intent | - |
| Solver quotes on-chain | ~3s |
| User selects quote | (user action) |
| **Step 1/4:** SEPA Instant transfer | ~6s |
| **Step 2/4:** TLSNotary proof | ~4.5s |
| **Step 3/4:** Attestation signing | ~12ms |
| **Step 4/4:** On-chain fulfillment | ~3s |
| **Total fulfillment time** | **~14s** |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                         (Vercel - Next.js)                              │
│  free-flo.vercel.app                                                    │
│    └── /api/quote (proxy) ──────────────────┐                           │
└─────────────────────────────────────────────┼───────────────────────────┘
                                              │
                      ┌───────────────────────▼───────────────────────┐
                      │                    VPS                         │
                      │              95.217.235.164                    │
                      │                                                │
                      │  ┌─────────────────────────────────────────┐  │
                      │  │           SOLVER (TypeScript)           │  │
                      │  │              Port 8080/8081              │  │
                      │  │  - Quote API (/api/quote)               │  │
                      │  │  - Chain listener (intents/quotes)      │  │
                      │  │  - Qonto provider integration           │  │
                      │  │  - TLSNotary prover orchestration       │  │
                      │  └──────────────────┬──────────────────────┘  │
                      │                     │                          │
                      │  ┌──────────────────▼──────────────────────┐  │
                      │  │      ATTESTATION SERVICE (Rust)         │  │
                      │  │              Port 4001                   │  │
                      │  │  - Verifies TLSNotary presentations     │  │
                      │  │  - Signs EIP-712 attestations           │  │
                      │  └─────────────────────────────────────────┘  │
                      │                                                │
                      │  ┌─────────────────────────────────────────┐  │
                      │  │       TLSNOTARY PROVER (Rust)           │  │
                      │  │        /opt/tlsn/crates/examples        │  │
                      │  │  - qonto_prove_transfer                 │  │
                      │  │  - qonto_present_transfer               │  │
                      │  └─────────────────────────────────────────┘  │
                      └────────────────────────────────────────────────┘
                                              │
                      ┌───────────────────────▼───────────────────────┐
                      │              BASE SEPOLIA                      │
                      │  OffRampV3: 0x34249F4AB741F0661A38651A08213DDe │
                      │  PaymentVerifier: 0xd72ddbFAfFc390947CB6fE26af │
                      │  USDC: 0x036CbD53842c5426634e7929541eC2318f3dC │
                      └────────────────────────────────────────────────┘
```

## Directory Structure

```
/
├── frontend/                      # Next.js frontend (Vercel)
│   ├── app/
│   │   ├── api/quote/route.ts    # Proxy to solver Quote API
│   │   ├── page.tsx              # Main page
│   │   └── layout.tsx
│   ├── components/
│   │   └── OffRampForm.tsx       # Main off-ramp wizard
│   └── lib/
│       ├── quotes.ts             # Quote fetching & types
│       └── contracts.ts          # Contract ABIs & addresses
│
├── solver/                        # TypeScript solver service
│   ├── src/
│   │   ├── index-v3.ts           # Entry point (V3 with zkTLS)
│   │   ├── orchestrator-v3.ts    # Intent processing & fulfillment
│   │   ├── chain-v3.ts           # On-chain interactions
│   │   ├── api/
│   │   │   └── quote-api.ts      # Real-time quote endpoint
│   │   ├── providers/
│   │   │   ├── registry.ts       # Provider registry
│   │   │   ├── qonto.ts          # Qonto SEPA Instant provider
│   │   │   └── qonto-client.ts   # Qonto API client
│   │   ├── attestation/
│   │   │   ├── client.ts         # Attestation service client
│   │   │   └── prover.ts         # TLSNotary prover orchestration
│   │   ├── db/
│   │   │   └── intents.ts        # SQLite intent storage
│   │   └── types/
│   │       └── index.ts          # Shared types (RTPN, Currency, etc.)
│   └── .env                       # Configuration
│
├── contracts/                     # Solidity smart contracts
│   ├── src/
│   │   ├── OffRampV3.sol         # Intent/quote/fulfillment logic
│   │   └── PaymentVerifier.sol   # EIP-712 proof verification
│   ├── test/
│   │   └── OffRampV3.t.sol
│   └── script/
│       └── DeployV3.s.sol
│
├── attestation-service/           # Rust attestation service
│   ├── src/
│   │   ├── main.rs               # HTTP server
│   │   ├── api.rs                # /attest endpoint
│   │   ├── attestation.rs        # Proof verification & signing
│   │   ├── eip712.rs             # EIP-712 domain & signing
│   │   └── verification.rs       # TLSNotary presentation parsing
│   └── Cargo.toml
│
├── tlsn/                          # TLSNotary (git submodule)
│   └── crates/examples/
│       ├── Cargo.toml            # Includes qonto examples
│       └── qonto/
│           ├── prove_transfer.rs  # Generate attestation
│           └── present_transfer.rs # Create presentation
│
└── docs/
    └── cursor_back_to_work_prompt.md  # Historical context
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind, wagmi, viem, RainbowKit |
| Contracts | Solidity 0.8.24, Foundry |
| Solver | TypeScript, Node.js, viem, better-sqlite3 |
| Attestation | Rust, axum, alloy, k256 |
| TLSNotary | Rust (tlsn v0.1.0-alpha.13) |
| Database | SQLite (solver state) |
| Deployment | Vercel (frontend), VPS (solver/attestation) |
| Process Mgmt | PM2 |

## Smart Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| OffRampV3 | `0x34249F4AB741F0661A38651A08213DDe1469b60f` |
| PaymentVerifier | `0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe` |
| USDC (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Key Flows

### Intent Lifecycle
```
PENDING_QUOTE → COMMITTED → FULFILLED
                    ↓
              CANCELLED/EXPIRED (on timeout)
```

1. **PENDING_QUOTE**: User deposits USDC, creates intent with amount/currency
2. **COMMITTED**: User selects solver's quote, provides IBAN/recipient name
3. **FULFILLED**: Solver proves payment with zkTLS, claims USDC
4. **CANCELLED**: User cancels after timeout (if solver doesn't fulfill)

### Solver Fulfillment (4 Steps)

```typescript
// Step 1: Execute fiat transfer
const transfer = await qontoProvider.executeTransfer({
  iban: intent.receivingInfo,
  name: intent.recipientName,
  amount: fiatAmount,
  reference: intentId
});

// Step 2: Generate TLSNotary proof
const proof = await prover.generateProof(transfer.id);

// Step 3: Get attestation signature
const attestation = await attestationClient.attest({
  intentHash: intentId,
  proof: proof,
  expectedAmount: fiatAmountCents
});

// Step 4: Submit on-chain
await contract.fulfillIntentWithProof(intentId, attestation);
```

### Quote Flow (Frontend → Solver)
```
Frontend                    Solver (VPS)
   │                            │
   ├─── GET /api/quote ────────►│  (via Next.js proxy)
   │    ?amount=100&currency=EUR│
   │                            │
   │◄── { quotes: [...] } ─────┤  (real rates from Qonto)
   │                            │
```

## Environment Variables

### Solver (.env)
```bash
# Chain
CHAIN_ID=84532
RPC_URL=https://base-sepolia-rpc.publicnode.com
SOLVER_PRIVATE_KEY=0x...

# Contracts
OFFRAMP_V3_ADDRESS=0x34249F4AB741F0661A38651A08213DDe1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe

# Qonto OAuth
QONTO_CLIENT_ID=...
QONTO_CLIENT_SECRET=...
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...
QONTO_BANK_ACCOUNT_ID=...

# Qonto API Key (for TLSNotary prover)
QONTO_API_KEY_LOGIN=org-slug
QONTO_API_KEY_SECRET=...
QONTO_BANK_ACCOUNT_SLUG=org-slug-bank-account-1

# Attestation Service
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001  # Use IP, not localhost (IPv6 issue)
ATTESTATION_ENABLED=true

# TLSNotary Prover
PROVER_ENABLED=true
TLSN_EXAMPLES_PATH=/opt/tlsn/crates/examples
PROOF_STORAGE_PATH=./proofs
PROVER_TIMEOUT=300000  # 5 minutes (includes first-run compilation)

# Ports
HEALTH_PORT=8080
QUOTE_API_PORT=8081
```

### Attestation Service
```bash
WITNESS_PRIVATE_KEY=0x...
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
RUST_LOG=info
ATTESTATION_PORT=4001
```

### Frontend (Vercel Environment Variables)
```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
SOLVER_API_URL=http://95.217.235.164:8081  # Server-side, for /api/quote proxy
```

## Common Commands

### Solver (VPS)
```bash
cd /root/FreeFlo/solver
npm run build
npm run start:v3

# Production (PM2)
pm2 start npm --name zkp2p-solver -- run start:v3
pm2 logs zkp2p-solver
pm2 restart zkp2p-solver
```

### Contracts
```bash
cd contracts
forge build
forge test
forge script script/DeployV3.s.sol --rpc-url $RPC_URL --broadcast --verify
```

### Attestation Service (VPS)
```bash
cd /root/FreeFlo/attestation-service
cargo build --release
./target/release/attestation-service

# Or via Docker
docker run -d --name zkp2p-attestation -p 4001:4001 \
  -e WITNESS_PRIVATE_KEY=0x... \
  -e CHAIN_ID=84532 \
  -e VERIFIER_CONTRACT=0xd72ddb... \
  zkp2p-attestation:latest
```

### TLSNotary Prover (VPS)
```bash
cd /opt/tlsn/crates/examples

# Build (first time or after changes)
cargo build --release --example qonto_prove_transfer
cargo build --release --example qonto_present_transfer

# Manual run (for debugging)
QONTO_API_KEY_LOGIN=org-slug \
QONTO_API_KEY_SECRET=secret \
QONTO_BANK_ACCOUNT_SLUG=org-slug-bank-account-1 \
QONTO_REFERENCE=0xintentid... \
cargo run --release --example qonto_prove_transfer
```

### Testing Quote API
```bash
# From VPS (local)
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"

# From external (verify firewall)
curl "http://95.217.235.164:8081/api/quote?amount=100&currency=EUR"

# From Vercel (via proxy)
curl "https://free-flo.vercel.app/api/quote?amount=100&currency=EUR"
```

## Important Patterns

### EIP-712 Domain (CRITICAL)
The attestation service and PaymentVerifier contract MUST use matching EIP-712 domains:
```
name: "WisePaymentVerifier"
version: "1"
chainId: 84532
verifyingContract: 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
```
**Mismatch causes `NotAuthorizedWitness` errors.**

### IPv6 vs IPv4
Use `127.0.0.1` instead of `localhost` for `ATTESTATION_SERVICE_URL`. Node.js resolves `localhost` to IPv6 `::1`, but Rust services typically bind to IPv4 only.

### Duplicate Transfer Prevention
The solver saves `provider_transfer_id` after Step 1 (fiat transfer). On retry, it skips Step 1 if transfer ID exists. This prevents sending multiple fiat transfers for one intent.

### Qonto OAuth Token Refresh
Tokens expire after 1 hour. The solver auto-refreshes on 401 responses. New tokens are persisted to `.env` file.

### VoP (Verification of Payee)
Before sending money, the solver calls Qonto's VoP API to verify the recipient name matches the IBAN. The `matchResult` must be `MATCH_RESULT_MATCH`.

### TLSNotary Proof Structure
```
qonto_prove_transfer    → qonto_transfer.attestation.tlsn + secrets.tlsn
qonto_present_transfer  → qonto_transfer.presentation.tlsn (sent to attestation service)
```

## Error Signatures

| Selector | Error | Cause |
|----------|-------|-------|
| `0x41110897` | NotAuthorizedWitness | EIP-712 domain mismatch or wrong witness key |
| `0x8baa579f` | InvalidSignature | Signature verification failed |
| `0xcad2ae02` | NullifierAlreadyUsed | Payment ID already claimed |
| `0x69388023` | PaymentVerificationFailed | Generic verification failure |
| `0xbd8ba84d` | InvalidAttestation | Malformed attestation data |

## Debugging Tips

1. **Attestation signature mismatch**
   ```bash
   # Check domain separator on contract
   cast call $VERIFIER "DOMAIN_SEPARATOR()" --rpc-url $RPC

   # Check witness is authorized
   cast call $VERIFIER "authorizedWitnesses(address)" $WITNESS_ADDR --rpc-url $RPC
   ```

2. **Quote API returning mock data**
   - Check `SOLVER_API_URL` is set in Vercel environment variables
   - Verify solver Quote API is running: `curl http://VPS_IP:8081/api/quote?amount=1&currency=EUR`
   - Check Vercel function logs for errors

3. **TLSNotary proof timeout**
   - Ensure `PROVER_TIMEOUT=300000` (5 min) for first-run compilation
   - Pre-compile: `cargo build --release --example qonto_prove_transfer`
   - Check TLSNotary examples path: `ls /opt/tlsn/crates/examples/qonto/`

4. **SEPA transfer not settling**
   - Check Qonto API credentials are valid
   - Verify VoP check passed (`MATCH_RESULT_MATCH`)
   - Check for 401 errors (token refresh needed)

5. **Clear solver state**
   ```bash
   rm -rf solver/data/ solver/*.db solver/proofs/
   pm2 restart zkp2p-solver
   ```

## Testing Checklist

- [ ] Solver wallet has ETH for gas on Base Sepolia
- [ ] Solver authorized on OffRampV3: `authorizedSolvers(address) == true`
- [ ] Witness authorized on PaymentVerifier: `authorizedWitnesses(address) == true`
- [ ] EIP-712 domain matches between attestation service and contract
- [ ] Qonto OAuth tokens are fresh (< 1 hour old)
- [ ] TLSNotary examples compiled: `ls /opt/tlsn/target/release/examples/qonto_*`
- [ ] Attestation service healthy: `curl http://127.0.0.1:4001/health`
- [ ] Quote API responding: `curl http://127.0.0.1:8081/api/quote?amount=1&currency=EUR`
- [ ] Port 8081 open in firewall: `ufw allow 8081/tcp`

## Future: Solver Marketplace Design

### Vision
Fully permissionless marketplace where anyone can run a solver:
- Independent solvers bring their own banking relationships
- Protocol sets exchange rate via enshrined oracle
- Solvers compete on fees (basis points)
- zkTLS proof = atomic swap enforcement (no slashing needed)

### Planned Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         ON-CHAIN                                │
├─────────────────────────────────────────────────────────────────┤
│  PriceOracle.sol        - Enshrined EUR/USD rate               │
│  SolverRegistry.sol     - Solver registration + tiered fees    │
│  ProviderRegistry.sol   - Proof templates per provider domain  │
│  OffRampV4.sol          - Intent relay on timeout              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions
- **Oracle**: Protocol-set rate, solvers cannot deviate (compete on fees only)
- **Tiered fees**: Solvers can offer lower fees for larger amounts
- **Provider verification**: zkTLS proves TLS session domain (e.g., `api.qonto.com`)
- **Intent relay**: If solver times out, intent goes to next available solver
- **Proof retry**: Extended window if fiat sent but proof generation fails

### GitHub Issues (Label: Stove)
- Price Oracle implementation
- ProviderRegistry with proof templates
- SolverRegistry with tiered fees
- Intent relay mechanism
- Proof retry/extension window

## CI/CD & Automation

### Barbossa Integration
The project uses [Barbossa](https://github.com/ADWilkinson/barbossa-dev) for autonomous PR creation:
- Picks up GitHub issues
- Implements changes
- Creates PRs with tests
- Can auto-merge when CI passes

### Branch Naming
- `barbossa/*` - Autonomous PRs from Barbossa
- `claude/*` - Claude Code session branches

## Links

- **Frontend**: https://free-flo.vercel.app
- **Repository**: https://github.com/MontaguSandwich/FreeFlo
- **VPS**: 95.217.235.164 (solver on 8080/8081, attestation on 4001)
- **Contracts**: Base Sepolia (addresses above)

## Changelog

### 2026-01-03
- Added Quote API proxy to frontend (`/api/quote`)
- Fixed IPv6 issue (localhost → 127.0.0.1)
- Increased prover timeout to 5 minutes
- Added Qonto TLSNotary prover examples to repo
- Cleaned secrets from git history
- Merged PR #8 (IBAN flow fix) and PR #9 (Prometheus metrics)
