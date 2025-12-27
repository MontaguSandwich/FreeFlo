<p align="center">
  <h1 align="center">ZKP2P Off-Ramp</h1>
  <p align="center">
    <strong>Permissionless USDC → Fiat using zkTLS</strong>
  </p>
  <p align="center">
    <a href="https://github.com/your-org/zkp2p-offramp/actions/workflows/ci.yml">
      <img src="https://github.com/your-org/zkp2p-offramp/actions/workflows/ci.yml/badge.svg" alt="CI Status">
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
    </a>
    <a href="https://github.com/your-org/zkp2p-offramp/issues">
      <img src="https://img.shields.io/github/issues/your-org/zkp2p-offramp" alt="Issues">
    </a>
  </p>
</p>

---

A trust-minimized off-ramp that converts USDC to EUR via real-time payment networks (SEPA Instant), with cryptographic proof of payment using [TLSNotary](https://tlsnotary.org).

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **Permissionless** | Anyone can run a solver, no whitelisting required |
| 🔗 **Trust-minimized** | Payment verification via zkTLS (TLSNotary) proofs |
| ⚡ **Real-time** | SEPA Instant delivery in ~10 seconds |
| 📊 **Live Rates** | Dynamic USDC/EUR rates from CoinGecko |
| 🔄 **Auto Retry** | Failed intents retry with exponential backoff |
| 🔑 **Token Refresh** | Automatic OAuth token refresh and persistence |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              ZKP2P Off-Ramp                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐    │
│  │   Frontend   │────▶│   Smart Contracts │◀────│      Solver      │    │
│  │   (Next.js)  │     │   (Base Sepolia)  │     │   (TypeScript)   │    │
│  └──────────────┘     └──────────────────┘     └────────┬─────────┘    │
│                                                          │              │
│                       ┌──────────────────────────────────┼──────────┐   │
│                       │                                  │          │   │
│                       ▼                                  ▼          │   │
│               ┌──────────────┐                   ┌──────────────┐  │   │
│               │  Qonto API   │   TLSNotary       │ Attestation  │  │   │
│               │   (SEPA)     │ ──────────────────▶   Service    │  │   │
│               └──────────────┘                   │    (Rust)    │  │   │
│                                                  └──────────────┘  │   │
│                                                                    │   │
└────────────────────────────────────────────────────────────────────┘   │
```

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Documentation](#-documentation)
- [Components](#-components)
- [Deployed Contracts](#-deployed-contracts)
- [Development](#-development)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Rust 1.75+ (for attestation service)
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Setup

```bash
# Clone
git clone https://github.com/your-org/zkp2p-offramp.git
cd zkp2p-offramp

# Install dependencies
cd contracts && forge install && cd ..
cd solver && npm install && cd ..
cd frontend && npm install && cd ..

# Configure
cp solver/env.example solver/.env
cp frontend/env.example frontend/.env.local
# Edit .env files with your values

# Start services (3 terminals)
cd solver && npm run dev:v3      # Terminal 1
cd frontend && npm run dev       # Terminal 2
# Attestation service             # Terminal 3

# Open http://localhost:3000
```

📖 See [Quick Start Guide](docs/guides/quickstart.md) for detailed instructions.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](docs/architecture/overview.md) | System design and components |
| [Intent Lifecycle](docs/architecture/intent-lifecycle.md) | How intents work |
| [zkTLS Verification](docs/architecture/zktls-verification.md) | TLSNotary integration |
| [Quick Start](docs/guides/quickstart.md) | Get running in 5 minutes |
| [Running a Solver](docs/guides/running-solver.md) | Production solver setup |
| [Deployment](docs/DEPLOYMENT.md) | Deploy to testnet/mainnet |
| [Security](docs/SECURITY.md) | Security policy |

## 📦 Components

| Component | Description | Tech Stack |
|-----------|-------------|------------|
| [`/contracts`](contracts/) | Smart contracts | Solidity, Foundry |
| [`/solver`](solver/) | Solver service | TypeScript, Node.js |
| [`/attestation-service`](attestation-service/) | zkTLS proof verification | Rust, Axum |
| [`/frontend`](frontend/) | Web application | Next.js, React |
| [`/tlsn`](tlsn/) | TLSNotary libraries | Rust |

## 📍 Deployed Contracts

### Base Sepolia (Testnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| OffRampV3 | `0x34249f4ab741f0661a38651a08213dde1469b60f` | [View ↗](https://sepolia.basescan.org/address/0x34249f4ab741f0661a38651a08213dde1469b60f) |
| PaymentVerifier | `0xd54e8219d30c2d04a8faec64657f06f440889d70` | [View ↗](https://sepolia.basescan.org/address/0xd54e8219d30c2d04a8faec64657f06f440889d70) |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | [View ↗](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

## 🐳 Docker Deployment

Deploy the full stack using Docker Compose:

```bash
# Copy environment template
cp env.production.example .env
# Edit .env with your values

# Build and start all services
docker compose up -d

# Check health
curl http://localhost:8080/health    # Solver
curl http://localhost:4001/health    # Attestation

# View logs
docker compose logs -f
```

Services included:
- **solver**: Quote API + fulfillment orchestrator
- **attestation-service**: TLSNotary proof verification + EIP-712 signing
- **nginx**: Reverse proxy with rate limiting

📖 See [VPS Deployment Guide](docs/guides/running-solver.md#vps-deployment) for production setup.

## 🛠️ Development

### Build

```bash
# Contracts
cd contracts && forge build

# Solver
cd solver && npm run build

# Attestation Service
cd attestation-service && cargo build --release

# Frontend
cd frontend && npm run build
```

### Test

```bash
# Contracts
cd contracts && forge test -vvv

# Solver
cd solver && npm test

# E2E Test
cd solver && node scripts/test-e2e-v3.mjs
```

### Format

```bash
# Contracts
cd contracts && forge fmt

# TypeScript
cd solver && npm run lint
```

## 🔄 How It Works

```
┌─────────┐                                                      ┌─────────┐
│  User   │                                                      │ Solver  │
└────┬────┘                                                      └────┬────┘
     │                                                                │
     │  1. Create Intent (deposit USDC)                               │
     │────────────────────────────────▶                               │
     │                                                                │
     │                                    2. Submit Quote             │
     │                                ◀───────────────────────────────│
     │                                                                │
     │  3. Select Quote (commit)                                      │
     │────────────────────────────────▶                               │
     │                                                                │
     │                                    4. Execute SEPA Transfer    │
     │                                    5. Generate TLSNotary Proof │
     │                                    6. Get Attestation          │
     │                                    7. Fulfill On-Chain         │
     │                                ◀───────────────────────────────│
     │                                                                │
     │  8. Receive EUR in bank account                                │
     │◀───────────────────────────────                                │
     │                                                                │
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Links

- [Open Issues](https://github.com/your-org/zkp2p-offramp/issues)
- [Good First Issues](https://github.com/your-org/zkp2p-offramp/labels/good%20first%20issue)
- [Feature Requests](https://github.com/your-org/zkp2p-offramp/labels/enhancement)

## 🔒 Security

For security concerns, please see [SECURITY.md](docs/SECURITY.md).

**Do not open public issues for security vulnerabilities.**

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [TLSNotary](https://tlsnotary.org) - Privacy-preserving TLS proofs
- [ZKP2P](https://zkp2p.xyz) - Inspiration and research
- [Across Protocol](https://across.to) - Intent-based architecture patterns
- [Open Intents Framework](https://openintents.xyz) - ERC-7683 reference

---

<p align="center">
  Built with ❤️ for the decentralized future of payments
</p>
