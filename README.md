# FreeFlo

**Intent-based, permissionless Crypto <> Fiat swaps**

[![CI Status](https://github.com/MontaguSandwich/FreeFlo/actions/workflows/ci.yml/badge.svg)](https://github.com/MontaguSandwich/FreeFlo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Note**: FreeFlo is currently deployed on Base Sepolia testnet.

## Overview

FreeFlo is a trust-minimized off-ramp protocol that converts USDC to fiat currency (EUR) via real-time payment networks. Users deposit USDC into an on-chain intent, solvers compete to fulfill the order by sending fiat via SEPA Instant, and payment is cryptographically verified using [TLSNotary](https://tlsnotary.org) before USDC is released.

End-to-end settlement: ~10-15 seconds.

### Key Properties

- **Permissionless**: Anyone can run a solver—no whitelisting required
- **Trust-minimized**: Payment verification via zkTLS proofs, not trusted oracles
- **Non-custodial**: Users retain control until payment is cryptographically proven
- **Real-time**: SEPA Instant delivery in seconds, not days

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                FreeFlo                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐    │
│  │   Frontend   │────▶│  Smart Contracts │◀────│      Solver      │    │
│  │   (Next.js)  │     │  (Base Sepolia)  │     │   (TypeScript)   │    │
│  └──────────────┘     └──────────────────┘     └────────┬─────────┘    │
│                                                         │              │
│                       ┌─────────────────────────────────┼──────────┐   │
│                       │                                 │          │   │
│                       ▼                                 ▼          │   │
│               ┌──────────────┐                  ┌──────────────┐   │   │
│               │  Qonto API   │   TLSNotary      │ Attestation  │   │   │
│               │   (SEPA)     │ ────────────────▶│   Service    │   │   │
│               └──────────────┘                  │    (Rust)    │   │   │
│                                                 └──────────────┘   │   │
│                                                                    │   │
└────────────────────────────────────────────────────────────────────┘   │
```

### Transaction Flow

```
User                                                           Solver
  │                                                               │
  │  1. Create Intent (deposit USDC)                              │
  │──────────────────────────────────▶                            │
  │                                                               │
  │                                     2. Submit Quote           │
  │                                 ◀──────────────────────────────│
  │                                                               │
  │  3. Select Quote                                              │
  │──────────────────────────────────▶                            │
  │                                                               │
  │                                     4. Send SEPA Instant      │
  │                                     5. Generate TLSNotary proof
  │                                     6. Get attestation        │
  │                                     7. Fulfill on-chain       │
  │                                 ◀──────────────────────────────│
  │                                                               │
  │  8. EUR received in bank account                              │
  │◀──────────────────────────────────                            │
```

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

## Components

| Component | Description | Stack |
|-----------|-------------|-------|
| [`/contracts`](contracts/) | Intent management and payment verification | Solidity, Foundry |
| [`/solver`](solver/) | Quote API and fulfillment orchestrator | TypeScript, Node.js |
| [`/attestation-service`](attestation-service/) | TLSNotary proof verification and EIP-712 signing | Rust, Axum |
| [`/frontend`](frontend/) | Web application for users | Next.js, React |
| [`/tlsn`](tlsn/) | TLSNotary prover for Qonto | Rust |

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
cd attestation-service && cargo build --release
cd frontend && npm run build
```

### Test

```bash
cd contracts && forge test -vvv
cd solver && npm test
```

### Lint

```bash
cd contracts && forge fmt --check
cd solver && npm run lint
```

## Docker Deployment

```bash
# Configure
cp env.production.example .env
# Edit .env with your values

# Start
docker compose up -d

# Verify
curl http://localhost:8080/health    # Solver
curl http://localhost:4001/health    # Attestation
```

## Security

FreeFlo uses a separated trust model where the attestation service (controlled by FreeFlo infrastructure) validates TLSNotary proofs before signing EIP-712 attestations. Solvers cannot forge payment proofs.

For security concerns, see [SECURITY.md](docs/SECURITY.md). Do not open public issues for vulnerabilities.

## Contributing

Contributions welcome. Please open an issue to discuss significant changes before submitting a PR.

- [Open Issues](https://github.com/MontaguSandwich/FreeFlo/issues)
- [Pull Requests](https://github.com/MontaguSandwich/FreeFlo/pulls)

## License

MIT License. See [LICENSE](LICENSE).

## Acknowledgments

- [TLSNotary](https://tlsnotary.org) — Privacy-preserving TLS proofs
- [ZKP2P](https://zkp2p.xyz) — Research and inspiration
- [Across Protocol](https://across.to) — Intent-based architecture patterns
