# ZKP2P Off-Ramp Documentation

Welcome to the ZKP2P Off-Ramp documentation.

## 📖 Overview

ZKP2P Off-Ramp is a permissionless protocol for converting USDC to fiat currency using zkTLS (TLSNotary) proofs for trustless payment verification.

## 📚 Documentation Index

### Architecture

Deep-dive into how the system works:

| Document | Description |
|----------|-------------|
| [Overview](architecture/overview.md) | System architecture and components |
| [Intent Lifecycle](architecture/intent-lifecycle.md) | States, transitions, and timeouts |
| [zkTLS Verification](architecture/zktls-verification.md) | TLSNotary proof generation and verification |

### Guides

Step-by-step instructions:

| Guide | Description |
|-------|-------------|
| [Quick Start](guides/quickstart.md) | Get running locally in 5 minutes |
| [Running a Solver](guides/running-solver.md) | Production solver operation |

### Deployment & Operations

| Document | Description |
|----------|-------------|
| [Deployment](DEPLOYMENT.md) | Deploy to testnet and production |
| [Security](SECURITY.md) | Security policy and known limitations |
| [Improvements](IMPROVEMENTS.md) | Proposed improvements and roadmap |

## 🔗 Quick Links

- [Main README](../README.md) - Project overview
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute
- [License](../LICENSE) - MIT License

## 📬 Getting Help

- **GitHub Issues**: [Report bugs or request features](https://github.com/your-org/zkp2p-offramp/issues)
- **Discussions**: [Ask questions](https://github.com/your-org/zkp2p-offramp/discussions)

## 🗺️ Roadmap

### Phase 1: MVP ✅
- [x] USDC → EUR via SEPA Instant
- [x] TLSNotary proof generation
- [x] EIP-712 attestation verification
- [x] Basic frontend

### Phase 2: Production Hardening
- [ ] Multi-signature attestation
- [ ] Chainlink price feeds
- [ ] Comprehensive monitoring
- [ ] Security audit

### Phase 3: Multi-Currency
- [ ] GBP via Faster Payments
- [ ] USD via FedNow
- [ ] BRL via PIX

### Phase 4: Decentralization
- [ ] Decentralized notary network
- [ ] Solver staking/slashing
- [ ] On-chain dispute resolution

