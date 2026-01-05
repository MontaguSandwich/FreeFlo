# FreeFlo Architecture

## System Overview

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

## Transaction Flow

### Typical Timeline (~14 seconds total)

| Step | Duration |
|------|----------|
| User creates intent | - |
| Solver quotes on-chain | ~3s |
| User selects quote | (user action) |
| **Step 1/4:** SEPA Instant transfer | ~6s |
| **Step 2/4:** TLSNotary proof | ~4.5s |
| **Step 3/4:** Attestation signing | ~12ms |
| **Step 4/4:** On-chain fulfillment | ~3s |

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

### Quote Flow

```
Frontend                    Solver (VPS)
   │                            │
   ├─── GET /api/quote ────────►│  (via Next.js proxy)
   │    ?amount=100&currency=EUR│
   │                            │
   │◄── { quotes: [...] } ─────┤  (real rates from Qonto)
   │                            │
```

### Solver Fulfillment Code Path

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

## TLSNotary Proof Structure

```
qonto_prove_transfer    → qonto_transfer.attestation.tlsn + secrets.tlsn
qonto_present_transfer  → qonto_transfer.presentation.tlsn (sent to attestation service)
```

---

# Future: Solver Marketplace Design

> **Status**: Planning phase. See GitHub issues labeled "Stove".

## Vision

Fully permissionless marketplace where anyone can run a solver:
- Independent solvers bring their own banking relationships
- Protocol sets exchange rate via enshrined oracle
- Solvers compete on fees (basis points)
- zkTLS proof = atomic swap enforcement (no slashing needed)

## Planned Contracts

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

## Key Design Decisions

- **Oracle**: Protocol-set rate, solvers cannot deviate (compete on fees only)
- **Tiered fees**: Solvers can offer lower fees for larger amounts
- **Provider verification**: zkTLS proves TLS session domain (e.g., `api.qonto.com`)
- **Intent relay**: If solver times out, intent goes to next available solver
- **Proof retry**: Extended window if fiat sent but proof generation fails

## Automation

### Barbossa Integration

The project uses [Barbossa](https://github.com/ADWilkinson/barbossa-dev) for autonomous PR creation:
- Picks up GitHub issues
- Implements changes
- Creates PRs with tests
- Can auto-merge when CI passes

### Branch Naming

- `barbossa/*` - Autonomous PRs from Barbossa
- `claude/*` - Claude Code session branches
