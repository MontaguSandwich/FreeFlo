# Running a Solver

This guide explains how to set up and operate a ZKP2P Off-Ramp solver in production.

## Overview

A solver watches for off-ramp intents, submits quotes, executes fiat transfers, and fulfills intents on-chain using zkTLS proofs.

### Solver Responsibilities

1. **Monitor** - Watch for new `IntentCreated` events
2. **Quote** - Calculate and submit competitive quotes
3. **Execute** - Send fiat via banking API when selected
4. **Prove** - Generate TLSNotary proof of payment
5. **Fulfill** - Submit proof on-chain to claim USDC

### Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB |
| Network | 10 Mbps | 100 Mbps |
| OS | Linux/macOS | Ubuntu 22.04 |

### Financial Requirements

| Asset | Purpose | Recommended |
|-------|---------|-------------|
| ETH (Base) | Gas for transactions | 0.1 ETH |
| EUR (Qonto) | Fiat liquidity | €1,000+ |

---

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/zkp2p-offramp.git
cd zkp2p-offramp/solver
```

### 2. Install Dependencies

```bash
npm install
npm run build
```

### 3. Configure Environment

```bash
cp env.example .env
```

#### Required Variables

```bash
# Blockchain
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x34249f4ab741f0661a38651a08213dde1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd54e8219d30c2d04a8faec64657f06f440889d70

# Solver Wallet
SOLVER_PRIVATE_KEY=0x...  # Has ETH for gas

# Qonto Banking
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=...
QONTO_REFRESH_TOKEN=...
QONTO_CLIENT_ID=...
QONTO_CLIENT_SECRET=...
QONTO_BANK_ACCOUNT_ID=...

# Attestation Service
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001

# Prover (for automatic proof generation)
PROVER_ENABLED=true
TLSN_EXAMPLES_PATH=/path/to/tlsn/crates/examples
QONTO_API_KEY_LOGIN=your-org-slug
QONTO_API_KEY_SECRET=your-api-secret
QONTO_BANK_ACCOUNT_SLUG=your-org-slug
```

#### Optional Tuning

```bash
# Polling interval (ms)
POLL_INTERVAL=5000

# Amount limits (6 decimals)
MIN_USDC_AMOUNT=1000000      # 1 USDC
MAX_USDC_AMOUNT=10000000000  # 10,000 USDC

# Fee (basis points)
QONTO_FEE_BPS=50  # 0.5%

# Server ports
HEALTH_PORT=8080
QUOTE_API_PORT=8081
```

---

## Running

### Development Mode

```bash
npm run dev:v3
```

### Production Mode

```bash
npm run build
npm run start:v3
```

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start solver
pm2 start npm --name "solver" -- run start:v3

# View logs
pm2 logs solver

# Restart
pm2 restart solver

# Stop
pm2 stop solver

# Auto-start on reboot
pm2 save
pm2 startup
```

### Using Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index-v3.js"]
```

```bash
docker build -t solver .
docker run -d --env-file .env -p 8080:8080 -p 8081:8081 solver
```

---

## Monitoring

### Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Full health status |
| `GET /ready` | Kubernetes readiness |
| `GET /live` | Kubernetes liveness |
| `GET /stats` | Basic statistics |

### Example Health Response

```json
{
  "status": "healthy",
  "timestamp": "2024-12-26T18:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "checks": {
    "chain": { "status": "ok" },
    "database": { "status": "ok" },
    "providers": { "status": "ok" },
    "attestation": { "status": "ok" }
  }
}
```

### Key Metrics to Monitor

| Metric | Warning | Critical |
|--------|---------|----------|
| Solver ETH balance | < 0.05 ETH | < 0.01 ETH |
| Qonto EUR balance | < €500 | < €100 |
| Failed intents (24h) | > 5 | > 20 |
| Quote success rate | < 95% | < 80% |
| Fulfillment time | > 60s | > 120s |

### Log Analysis

```bash
# View recent logs
pm2 logs solver --lines 100

# Filter for errors
pm2 logs solver | grep ERROR

# Filter for specific intent
pm2 logs solver | grep "intentId=0x..."
```

---

## Database Management

The solver uses SQLite for state persistence.

### Location

```bash
./solver-v3.db
```

### Schema

```sql
-- Intents table
SELECT * FROM intents WHERE status = 'committed';

-- Quotes table
SELECT * FROM quotes WHERE intent_id = '0x...';
```

### Backup

```bash
# Create backup
cp solver-v3.db solver-v3.db.backup

# Restore from backup
cp solver-v3.db.backup solver-v3.db
```

### Reset (CAUTION)

```bash
# Stop solver first!
rm solver-v3.db
# Restart solver - will recreate DB
```

---

## Qonto Setup

### OAuth Authentication

1. Create OAuth application in Qonto dashboard
2. Get authorization code via OAuth flow
3. Exchange for access + refresh tokens
4. Configure in `.env`

### Token Refresh

Tokens are automatically refreshed when expired. New tokens are persisted to `.env` file.

### API Key Authentication (Alternative)

For the TLSNotary prover, use API key authentication:

1. Go to Qonto Settings → API Keys
2. Create new key with `organization.read` scope
3. Configure `QONTO_API_KEY_LOGIN` and `QONTO_API_KEY_SECRET`

---

## Troubleshooting

### Solver Not Submitting Quotes

**Check:**
- Provider is enabled: `QONTO_ENABLED=true`
- Provider is healthy: `curl localhost:8080/health`
- Logs for errors: `pm2 logs solver | grep ERROR`

### Fiat Transfers Failing

**Check:**
- Qonto balance is sufficient
- Beneficiary name matches IBAN (VoP check)
- OAuth tokens are valid

### Proof Generation Timeout

**Check:**
- TLSNotary prover is compiled: `cd $TLSN_EXAMPLES_PATH && cargo build --release`
- Prover timeout is sufficient: `PROVER_TIMEOUT=300000`
- Notary is reachable

### Attestation Failing

**Check:**
- Attestation service is running
- Witness key is correct
- Witness is authorized on-chain

---

## Security Best Practices

### Private Key Management

❌ **Don't:**
- Store private keys in `.env` in production
- Commit `.env` to git
- Share keys over insecure channels

✅ **Do:**
- Use secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Use hardware security modules (HSM) for high-value operations
- Rotate keys periodically

### Network Security

- Run behind reverse proxy (nginx, Cloudflare)
- Enable rate limiting
- Use TLS for all external connections
- Restrict firewall to needed ports only

### Monitoring & Alerting

- Set up PagerDuty/Opsgenie for critical alerts
- Monitor balance thresholds
- Alert on unusual failure rates
- Log all transactions for audit

---

## Upgrading

### Minor Updates

```bash
git pull origin main
npm install
npm run build
pm2 restart solver
```

### Major Updates (with DB changes)

```bash
# Backup first
cp solver-v3.db solver-v3.db.pre-upgrade

# Pull and rebuild
git pull origin main
npm install
npm run build

# Restart
pm2 restart solver

# Verify
curl localhost:8080/health
```

---

## Economics

### Revenue

- **Solver fee**: 0.5% per transaction (configurable)
- **Example**: 1,000 USDC → €920 = ~5 USDC profit

### Costs

| Cost | Estimate |
|------|----------|
| Gas (per intent) | ~0.0001 ETH |
| Server | $20-50/month |
| Banking fees | €0-1/transfer |

### Break-Even

At 0.5% fee, you need ~$10,000 monthly volume to cover a $50/month server.

---

## FAQ

### Can anyone run a solver?

Yes! The protocol is permissionless. Anyone with the required infrastructure can run a solver.

### How do I compete with other solvers?

- Lower fees
- Faster fulfillment
- Higher reliability
- Better exchange rates

### What if my transfer fails?

The intent will expire and the user can cancel to reclaim their USDC. You won't lose money, but you won't earn the fee either.

### How do I add support for other currencies?

See [Adding Providers](./adding-providers.md) for how to integrate new payment rails.

