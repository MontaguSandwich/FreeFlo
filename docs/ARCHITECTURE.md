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
                      │              SOLVER VPS (Untrusted)           │
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
                      │  │       TLSNOTARY PROVER (Rust)           │  │
                      │  │        /opt/tlsn/crates/examples        │  │
                      │  │  - qonto_prove_transfer                 │  │
                      │  │  - qonto_present_transfer               │  │
                      │  └─────────────────────────────────────────┘  │
                      └──────────────────────┬────────────────────────┘
                                             │
                                  POST /attest (with API key)
                                             │
                      ┌──────────────────────▼────────────────────────┐
                      │         FREEFLO INFRASTRUCTURE (Trusted)      │
                      │              77.42.68.242 / attestation.freeflo.live │
                      │                                                │
                      │  ┌─────────────────────────────────────────┐  │
                      │  │      ATTESTATION SERVICE (Rust)         │  │
                      │  │              Port 4001                   │  │
                      │  │  - API key authentication               │  │
                      │  │  - On-chain intent validation           │  │
                      │  │  - TLSNotary proof verification         │  │
                      │  │  - EIP-712 attestation signing          │  │
                      │  │  - Audit logging                        │  │
                      │  │  - Rate limiting                        │  │
                      │  └─────────────────────────────────────────┘  │
                      │                                                │
                      │  ┌─────────────────────────────────────────┐  │
                      │  │       WITNESS PRIVATE KEY               │  │
                      │  │  (Never shared with solvers)            │  │
                      │  │  Address: 0x343830917e4e5f6291146af...  │  │
                      │  └─────────────────────────────────────────┘  │
                      └────────────────────────────────────────────────┘
                                             │
                      ┌──────────────────────▼────────────────────────┐
                      │              BASE SEPOLIA                      │
                      │  OffRampV3: 0x34249F4AB741F0661A38651A08213DDe │
                      │  PaymentVerifier: 0xd72ddbFAfFc390947CB6fE26af │
                      │  USDC: 0x036CbD53842c5426634e7929541eC2318f3dC │
                      └────────────────────────────────────────────────┘
```

## Security Model: Trust Boundaries

### Untrusted: Solvers
Solvers are third-party operators who:
- Process fiat transfers (SEPA Instant via Qonto)
- Generate TLSNotary proofs
- Submit attestation requests
- Claim USDC on-chain

**Solvers CANNOT:**
- Forge payment proofs (TLSNotary cryptographic guarantee)
- Sign attestations (don't have witness key)
- Claim USDC without valid proof (on-chain verification)

### Trusted: FreeFlo Protocol
FreeFlo controls:
- **Attestation Service**: Verifies proofs, validates intents on-chain
- **Witness Private Key**: Signs EIP-712 attestations
- **Smart Contracts**: Verify signatures, manage intents

**Security Guarantees:**
1. **On-chain validation**: Before signing, attestation service verifies:
   - Intent exists and is in COMMITTED status
   - Requesting solver matches `selectedSolver` on-chain
2. **API authentication**: Each solver has unique API key tied to their address
3. **Audit logging**: All attestation requests logged for forensics

## Transaction Flow

### Typical Timeline (~10-15 seconds total)

| Step | Duration | Actor |
|------|----------|-------|
| User creates intent | - | User |
| Solver quotes on-chain | ~3s | Solver |
| User selects quote & commits USDC | (user action) | User |
| **Step 1/4:** SEPA Instant transfer | ~4-6s | Solver |
| **Step 2/4:** TLSNotary proof generation | ~5s | Solver |
| **Step 3/4:** Attestation request | ~100ms | Solver → FreeFlo |
| **Step 4/4:** On-chain fulfillment | ~3s | Solver |

### Intent Lifecycle

```
PENDING_QUOTE → COMMITTED → FULFILLED
                    ↓
              CANCELLED/EXPIRED (on timeout)
```

1. **PENDING_QUOTE**: User creates intent with amount/currency (no USDC locked yet)
2. **COMMITTED**: User selects solver's quote, provides IBAN, USDC transferred to contract
3. **FULFILLED**: Solver proves payment with zkTLS, claims USDC
4. **CANCELLED**: User cancels after timeout (30 min for COMMITTED, 15 min for PENDING_QUOTE)

### Attestation Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SOLVER (Untrusted)                            │
│                                                                         │
│  1. Execute SEPA Instant transfer via Qonto                             │
│  2. Generate TLSNotary proof of transfer API response                   │
│  3. POST /attest to FreeFlo attestation service                         │
│     Headers: X-Solver-API-Key: <api_key>                                │
│     Body: { presentation, intent_hash, expected_amount_cents }          │
│                                                                         │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ATTESTATION SERVICE (Trusted)                       │
│                                                                         │
│  4. Authenticate solver via API key                                      │
│  5. Query OffRampV3.getIntent(intentHash) on-chain                       │
│     - Verify intent.status == COMMITTED                                  │
│     - Verify intent.selectedSolver == requesting solver                  │
│  6. Verify TLSNotary proof                                               │
│     - Check server certificate (thirdparty.qonto.com)                    │
│     - Parse payment data from revealed content                           │
│     - Verify amount matches expected                                     │
│  7. Sign EIP-712 PaymentAttestation with witness key                     │
│  8. Return { signature, payment_data }                                   │
│  9. Log to audit trail                                                   │
│                                                                         │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SOLVER (Untrusted)                            │
│                                                                         │
│  10. Submit fulfillIntentWithProof(intentId, attestation, signature)    │
│                                                                         │
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        ON-CHAIN (PaymentVerifier)                        │
│                                                                         │
│  11. Recover signer from EIP-712 signature                               │
│  12. Verify authorizedWitnesses[signer] == true                          │
│  13. Verify domain separator matches                                     │
│  14. Check nullifier not used (prevent replay)                           │
│  15. Transfer USDC to solver                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
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
| Deployment | Vercel (frontend), VPS (solver), VPS (attestation) |
| Process Mgmt | PM2 (solver), systemd (attestation) |

## TLSNotary Proof Structure

```
qonto_prove_transfer    → qonto_transfer.attestation.tlsn + secrets.tlsn
qonto_present_transfer  → qonto_transfer.presentation.tlsn (sent to attestation service)
```

The presentation contains:
- Server certificate (proves connection to thirdparty.qonto.com)
- Revealed HTTP response content (payment details)
- Cryptographic commitments hiding other data

## Component Ownership

| Component | Owner | Location | Notes |
|-----------|-------|----------|-------|
| TLSNotary Prover | Solver | Solver's VPS | Generates cryptographic proofs |
| Attestation Service | FreeFlo | FreeFlo infrastructure | Validates and signs attestations |
| Witness Private Key | FreeFlo | FreeFlo infrastructure | NEVER shared with solvers |
| Solver Service | Solver | Solver's VPS | Quote API, fiat transfers |
| Smart Contracts | FreeFlo | Base Sepolia | Immutable, deployed |

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
