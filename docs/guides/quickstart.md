# Quick Start Guide

Get ZKP2P Off-Ramp running locally in 5 minutes.

## Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **Rust 1.75+** - [Install](https://rustup.rs/)
- **Foundry** - [Install](https://book.getfoundry.sh/getting-started/installation)
- **Git** - [Download](https://git-scm.com/)

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/zkp2p-offramp.git
cd zkp2p-offramp
```

## 2. Install Dependencies

```bash
# Contracts
cd contracts && forge install && cd ..

# Solver
cd solver && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

## 3. Configure Environment

### Solver Configuration

```bash
cd solver
cp env.example .env
```

Edit `.env` with your values:

```bash
# Required
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249f4ab741f0661a38651a08213dde1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd54e8219d30c2d04a8faec64657f06f440889d70
SOLVER_PRIVATE_KEY=0x_YOUR_PRIVATE_KEY_HERE

# Qonto (for real transfers)
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=your_token
QONTO_REFRESH_TOKEN=your_refresh_token
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret
QONTO_BANK_ACCOUNT_ID=your_account_id

# Attestation
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001
```

### Frontend Configuration

```bash
cd frontend
cp env.example .env.local
```

Edit `.env.local`:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_SOLVER_API_URL=http://127.0.0.1:8081
```

## 4. Start Services

You need 3 terminal windows:

### Terminal 1: Attestation Service

```bash
cd attestation-service
cargo run
```

You should see:
```
[INFO] Attestation service started on 127.0.0.1:4001
```

### Terminal 2: Solver

```bash
cd solver
npm run dev:v3
```

You should see:
```
[INFO] OffRamp V3 Solver (zkTLS Enabled)
[INFO] Health check server started on port 8080
[INFO] Quote API server started on port 8081
[INFO] V3 Orchestrator started with zkTLS verification
```

### Terminal 3: Frontend

```bash
cd frontend
npm run dev
```

You should see:
```
▲ Next.js 14.2.13
- Local: http://localhost:3000
✓ Ready
```

## 5. Test the App

1. Open http://localhost:3000
2. Connect your wallet (MetaMask, etc.)
3. Make sure you're on **Base Sepolia** network
4. Get testnet USDC from a faucet
5. Enter an amount (e.g., 1.50 USDC)
6. Select the SEPA Instant quote
7. Enter a test IBAN and recipient name
8. Click "Confirm & Send"
9. Sign the transactions

## Troubleshooting

### "No quotes available"

- Check the solver is running
- Check the solver logs for errors
- Verify `QONTO_ENABLED=true` in solver `.env`

### "Connect Wallet" not working

- Install MetaMask or another Web3 wallet
- Switch to Base Sepolia network
- Refresh the page

### Solver crashes on startup

- Check all required environment variables are set
- Verify the contract addresses are correct
- Check the attestation service is running first

### Frontend build fails

```bash
# Clear cache and rebuild
cd frontend
rm -rf .next node_modules
npm install
npm run dev
```

## Next Steps

- [Running a Solver](./running-solver.md) - Production solver setup
- [Architecture Overview](../architecture/overview.md) - System design
- [Intent Lifecycle](../architecture/intent-lifecycle.md) - How intents work
- [zkTLS Verification](../architecture/zktls-verification.md) - How proofs work

## Getting Help

- **Discord**: [Join our server](https://discord.gg/xxx)
- **GitHub Issues**: [Report a bug](https://github.com/your-org/zkp2p-offramp/issues)
- **Twitter**: [@zkp2p_offramp](https://twitter.com/zkp2p_offramp)

