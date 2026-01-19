# FreeFlo Protocol

**Permissionless, fast, intent-based on-chain ↔ off-chain interoperability**

[![CI Status](https://github.com/MontaguSandwich/FreeFlo/actions/workflows/ci.yml/badge.svg)](https://github.com/MontaguSandwich/FreeFlo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Note**: FreeFlo is currently deployed on Base Sepolia testnet.

## Overview

FreeFlo is a modular, intent-based off-ramp protocol enabling USDC ↔ Fiat swaps.

Unlike cross-chain protocols where both input and output occur on-chain, FreeFlo settles the output leg off-chain via real-time payment networks (SEPA Instant), with fulfillment proven cryptographically using [TLSNotary](https://tlsnotary.org).

End-to-end settlement: **~10-15 seconds**.

### Key Properties

- **Permissionless**: Anyone can run a solver—no whitelisting required
- **Trust-minimized**: Payment verification via zkTLS proofs, not trusted oracles
- **Non-custodial**: Users retain control until payment is cryptographically proven
- **RTPN-agnostic**: Extensible to any real-time payment network with API capability

## Dictionary

| Term | Definition |
|------|------------|
| **Intent** | A user's request to convert USDC to fiat at a specified destination: RTPN, fiat currency, and recipient details |
| **Solver** | An entity that fulfills intents by sending fiat and proving payment. Permissionless—anyone can run a solver |
| **Quote** | A solver's offer to fulfill an intent, specifying the amount to be sent in the requested fiat currency |
| **Commitment** | User's selection of a specific quote, locking USDC for the duration of the fulfillment window |
| **Fulfillment** | Completing an intent: sending fiat, generating proof, submitting on-chain, and claiming USDC |
| **Attestation** | An EIP-712 signed statement from an authorized witness confirming payment was verified via zkTLS |
| **Witness** | The authorized signer (controlled by FreeFlo) that validates zkTLS proofs and signs attestations |
| **RTPN** | Real-Time Payment Network — a payment network with near-instant settlement (e.g., SEPA Instant) |
| **Nullifier** | A unique payment identifier preventing double-claims, derived from the provider's transaction ID |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

     User                    Solvers                FreeFlo               Chain
       │                        │                      │                    │
       │ 1. createIntent()      │                      │                    │
       │────────────────────────────────────────────────────────────────────►│
       │                        │                      │          [PENDING_QUOTE]
       │                        │                      │                    │
       │     2. submitQuote()   │                      │                    │
       │◄───────────────────────│──────────────────────────────────────────►│
       │                        │                      │                    │
       │ 3. selectQuote()       │                      │                    │
       │────────────────────────────────────────────────────────────────────►│
       │                        │                      │           [COMMITTED]
       │                        │                      │                    │
       │                        │ 4. Send fiat (SEPA)  │                    │
       │                        │─────────────────────►│                    │
       │                        │                      │                    │
       │                        │ 5. Generate zkTLS    │                    │
       │                        │    proof             │                    │
       │                        │─────────────────────►│                    │
       │                        │                      │                    │
       │                        │ 6. POST /attest      │                    │
       │                        │─────────────────────►│ 7. Validate on-chain
       │                        │                      │    intent status   │
       │                        │                      │───────────────────►│
       │                        │                      │◄───────────────────│
       │                        │                      │                    │
       │                        │ 8. EIP-712 signature │                    │
       │                        │◄─────────────────────│                    │
       │                        │                      │                    │
       │                        │ 9. fulfillIntentWithProof()               │
       │                        │──────────────────────────────────────────►│
       │                        │                      │          [FULFILLED]
       │                        │                      │                    │
       │  10. EUR in bank       │◄─────────── USDC released ───────────────►│
       │                        │                      │                    │
```

### Component Overview

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **OffRampV3** | [`contracts/src/OffRampV3.sol`](./contracts/src/OffRampV3.sol) | Intent lifecycle, USDC escrow, quote management |
| **PaymentVerifier** | [`contracts/src/PaymentVerifier.sol`](./contracts/src/PaymentVerifier.sol) | EIP-712 verification, witness registry, nullifier tracking |
| **Attestation Service** | [`attestation/`](./attestation/) | zkTLS proof validation, on-chain state verification, attestation signing |
| **Solver** | [`solver/`](./solver/) | Quote API, fiat execution, proof generation, intent monitoring |
| **Prover** | [`providers/prover/`](./providers/prover/) | TLSNotary proof generation per RTPN |
| **Frontend** | [`frontend/`](./frontend/) | Web application for users |

## Intent Lifecycle

```
┌──────────────┐    timeout    ┌───────────┐
│              │──────────────►│           │
│ PENDING_QUOTE│               │  EXPIRED  │
│              │◄──────────────│           │
└──────┬───────┘   user cancel └───────────┘
       │
       │ selectQuote()
       ▼
┌──────────────┐    timeout    ┌───────────┐
│              │──────────────►│           │
│  COMMITTED   │               │ CANCELLED │
│              │               │           │
└──────┬───────┘               └───────────┘
       │
       │ fulfillIntentWithProof()
       ▼
┌──────────────┐
│              │
│  FULFILLED   │
│              │
└──────────────┘
```

1. **PENDING_QUOTE** — User calls `createIntent()`, deposits USDC. Solvers call `submitQuote()` with competing offers.

2. **COMMITTED** — User calls `selectQuote()`, locks funds to chosen solver. Solver has fulfillment window to complete.

3. **FULFILLED** — Solver sends fiat, proves via zkTLS, calls `fulfillIntentWithProof()`. Contract verifies attestation, releases USDC to solver.

4. **CANCELLED / EXPIRED** — Timeout reached without fulfillment. User calls `cancelIntent()`, USDC returned.

## Security Model

FreeFlo separates concerns between untrusted solvers and trusted infrastructure:

| Actor | Trust | Responsibility |
|-------|-------|----------------|
| Solver | Untrusted | Execute fiat transfers, generate proofs |
| Attestation Service | Trusted (FreeFlo) | Validate proofs, verify on-chain state, sign attestations |
| Smart Contracts | Trustless | Verify signatures, enforce time windows, release funds |

### Solver Protections

Solvers **cannot**:
- **Forge payment proofs** — TLSNotary proofs are cryptographically bound to the TLS session
- **Claim without valid attestation** — On-chain signature verification required
- **Double-claim payments** — Nullifier (payment ID) tracked on-chain
- **Claim for wrong intent** — Attestation includes intent hash

### User Protections

Users are protected against:
- **Solver non-fulfillment** — Funds auto-release after timeout via `cancelIntent()`
- **Quote manipulation** — Committed quote amount verified in attestation
- **Incorrect payment amount** — Attestation service validates proof amount ≥ committed amount

### Risk Considerations

| Risk | Mitigation |
|------|------------|
| **Attestation service downtime** | Solvers cannot claim, but user funds remain safe. Timeout allows cancellation. |
| **Quote window front-running** | Short quote windows (5 min). Future: commit-reveal scheme. |
| **Solver commits but never sends fiat** | Commitment timeout returns funds to user automatically. |
| **Malicious solver underpayment** | Attestation service validates on-chain committed amount against proof. |
| **Witness key compromise** | Single point of failure. Future: threshold signatures or TEE. |

For security concerns, see [SECURITY.md](docs/SECURITY.md). Do not open public issues for vulnerabilities.

## Quick Start

### Prerequisites

- Node.js 20+
- Rust 1.75+ (for attestation service and TLSNotary)
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Setup

```bash
# Clone
git clone https://github.com/MontaguSandwich/FreeFlo.git
cd FreeFlo

# Install dependencies
cd contracts && forge install && cd ..
cd solver && npm install && cd ..
cd frontend && npm install && cd ..

# Configure environment
cp solver/env.example solver/.env
cp frontend/env.example frontend/.env.local
# Edit .env files with your values

# Start services
cd solver && npm run dev:v3      # Terminal 1: Solver
cd frontend && npm run dev       # Terminal 2: Frontend

# Open http://localhost:3000
```

See [Solver Onboarding Guide](docs/SOLVER_ONBOARDING.md) for production deployment.

## Extending FreeFlo

FreeFlo is designed to support any RTPN with API capability.

### Adding a New Payment Provider

1. **Implement the Prover** — Create a TLSNotary prover in `providers/prover/adapters/<provider>/`:
   ```rust
   // Must generate a Presentation proving:
   // - Transaction ID
   // - Amount in cents
   // - Beneficiary identifier (IBAN, account number, etc.)
   ```

2. **Register the Server** — Add the provider's API domain to `ALLOWED_SERVERS` in attestation config

3. **Implement Solver Integration** — Add provider execution logic in `solver/src/providers/<provider>.ts`:
   ```typescript
   // Must implement:
   // - OAuth/auth flow
   // - Transfer execution
   // - Prover invocation
   ```

4. **Register RTPN On-Chain** — Solvers declare supported RTPNs via `setSolverRtpn()`

See [`providers/README.md`](./providers/README.md) for detailed integration guide.

## Deployed Contracts

### Base Sepolia (Testnet)

| Contract | Address |
|----------|---------|
| OffRampV3 | [`0x34249F4AB741F0661A38651A08213DDe1469b60f`](https://sepolia.basescan.org/address/0x34249F4AB741F0661A38651A08213DDe1469b60f) |
| PaymentVerifier | [`0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe`](https://sepolia.basescan.org/address/0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe) |
| USDC | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/ARCHITECTURE.md) | System design and security model |
| [Solver Onboarding](docs/SOLVER_ONBOARDING.md) | Run your own solver |
| [Attestation Separation](docs/ATTESTATION_SEPARATION_SPEC.md) | Security architecture |
| [Operations Runbook](docs/OPERATIONS_RUNBOOK.md) | Production operations |

## Development

### Build

```bash
cd contracts && forge build
cd solver && npm run build
cd attestation && cargo build --release
cd frontend && npm run build
```

### Test

```bash
cd contracts && forge test -vvv
cd solver && npm test
cd attestation && cargo test
```

### Lint

```bash
cd contracts && forge fmt --check
cd solver && npm run lint
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For major changes, please open an issue first to discuss the proposed change.

- [Open Issues](https://github.com/MontaguSandwich/FreeFlo/issues)
- [Pull Requests](https://github.com/MontaguSandwich/FreeFlo/pulls)

## License

MIT License. See [LICENSE](LICENSE).

## Acknowledgments

- [TLSNotary](https://tlsnotary.org) — Privacy-preserving TLS proofs
- [ZKP2P](https://zkp2p.xyz) — Research and inspiration
- [Across Protocol](https://across.to) — Intent-based architecture patterns
