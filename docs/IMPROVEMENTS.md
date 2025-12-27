# Proposed Improvements

This document outlines recommended improvements before pushing to GitHub and deploying to a public testnet.

## 🔴 Critical (Must Fix Before Public Release)

### 1. Remove Sensitive Data from Repo

**Issue**: The repo likely contains sensitive files that shouldn't be committed.

**Files to Check/Remove**:
```bash
# Check for these patterns
solver/.env              # Contains API keys and private keys
solver/solver.db         # Contains intent history
solver/solver-v3.db      # Contains intent history
solver/proofs/*.tlsn     # TLSNotary proof files
solver/swan-private.jwk  # Private key file
contracts/broadcast/     # Contains deployment transactions with addresses
```

**Fix**:
```bash
# Create proper .gitignore
cat >> .gitignore << 'EOF'
# Environment files
.env
.env.local
.env.*.local

# Databases
*.db
*.sqlite

# Proofs (may contain sensitive data)
solver/proofs/

# Private keys
*.jwk
*.pem
*.key

# Build artifacts
contracts/out/
contracts/cache/
solver/dist/
node_modules/

# IDE
.idea/
.vscode/
*.swp
EOF
```

### 2. Create Example Environment Files

**Create**: `solver/.env.example`
```bash
# Chain Configuration
RPC_URL=https://base-sepolia-rpc.publicnode.com
CHAIN_ID=84532
OFFRAMP_V3_ADDRESS=0x...
PAYMENT_VERIFIER_ADDRESS=0x...
SOLVER_PRIVATE_KEY=0x_YOUR_PRIVATE_KEY_HERE

# Qonto Configuration (OAuth)
QONTO_ENABLED=true
QONTO_AUTH_METHOD=oauth
QONTO_ACCESS_TOKEN=your_access_token
QONTO_REFRESH_TOKEN=your_refresh_token
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret
QONTO_BANK_ACCOUNT_ID=your_bank_account_uuid

# Attestation Service
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001

# TLSNotary Prover (Optional - for automated proof generation)
PROVER_ENABLED=false
# TLSN_EXAMPLES_PATH=/path/to/tlsn/crates/examples
# QONTO_API_KEY_LOGIN=your_api_key_login
# QONTO_API_KEY_SECRET=your_api_key_secret
# QONTO_BANK_ACCOUNT_SLUG=your_org_slug

# Server Ports
HEALTH_PORT=8080
QUOTE_API_PORT=8081
```

**Create**: `frontend/.env.example`
```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_SOLVER_API_URL=http://127.0.0.1:8081
```

**Create**: `attestation-service/.env.example`
```bash
ATTESTATION_PRIVATE_KEY=0x_WITNESS_PRIVATE_KEY_HERE
SERVICE_HOST=127.0.0.1
SERVICE_PORT=4001
```

### 3. Audit Smart Contracts

**Issue**: Contracts haven't been audited.

**Recommendation**:
- Run Slither static analysis
- Get at least 1 informal security review
- Add security contact in README

```bash
cd contracts
pip install slither-analyzer
slither src/OffRampV3.sol
slither src/PaymentVerifier.sol
```

---

## 🟡 Important (Should Fix Before Production)

### 4. Add Proper Error Handling for Token Refresh

**Issue**: If token refresh fails, the `.env` write could corrupt the file.

**File**: `solver/src/providers/qonto.ts`

**Fix**: Use atomic writes
```typescript
import { writeFileSync, renameSync } from 'fs';

function persistTokensToEnv(accessToken: string, refreshToken: string) {
  // Write to temp file first
  const tempPath = envPath + '.tmp';
  writeFileSync(tempPath, newContent, 'utf8');
  
  // Atomic rename
  renameSync(tempPath, envPath);
}
```

### 5. Add Rate Limiting to Quote API

**Issue**: Quote API has no rate limiting, could be abused.

**File**: `solver/src/api/quote-api.ts`

**Fix**: Add simple in-memory rate limiter
```typescript
const rateLimit = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const requests = rateLimit.get(ip) || [];
  const recent = requests.filter(t => t > now - RATE_LIMIT_WINDOW);
  
  if (recent.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  recent.push(now);
  rateLimit.set(ip, recent);
  return true;
}
```

### 6. Add CORS Configuration

**Issue**: Quote API allows all origins (`*`).

**Fix**: Restrict to known frontends
```typescript
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://your-app.vercel.app',
];

res.setHeader("Access-Control-Allow-Origin", 
  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
);
```

### 7. Add Input Validation

**Issue**: IBAN validation could be stronger.

**File**: `frontend/lib/quotes.ts`

**Fix**: Use proper IBAN validation library
```typescript
import IBAN from 'iban';

export function validateIBAN(iban: string): boolean {
  return IBAN.isValid(iban);
}
```

### 8. Add Structured Logging

**Issue**: Current logging is good but could be more structured for production.

**Recommendation**: Ensure all logs include:
- Correlation ID (intentId)
- Timestamp
- Component name
- Structured data (JSON)

---

## 🟢 Nice to Have (Can Do Later)

### 9. Add Docker Support

**Create**: `docker-compose.yml`
```yaml
version: '3.8'

services:
  attestation-service:
    build: ./attestation-service
    ports:
      - "4001:4001"
    environment:
      - ATTESTATION_PRIVATE_KEY=${ATTESTATION_PRIVATE_KEY}

  solver:
    build: ./solver
    ports:
      - "8080:8080"
      - "8081:8081"
    depends_on:
      - attestation-service
    environment:
      - ATTESTATION_SERVICE_URL=http://attestation-service:4001
      # ... other env vars

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - solver
```

### 10. Add GitHub Actions CI/CD

**Create**: `.github/workflows/ci.yml`
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - run: cd contracts && forge build
      - run: cd contracts && forge test -vvv

  solver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd solver && npm ci
      - run: cd solver && npm run build
      - run: cd solver && npm test

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd frontend && npm ci
      - run: cd frontend && npm run build
```

### 11. Add Monitoring Dashboard

**Recommendation**: Create a simple stats endpoint that can feed into Grafana.

```typescript
// solver/src/api/stats.ts
app.get('/api/stats', (req, res) => {
  res.json({
    intents: {
      pending: db.getStats().pendingQuote,
      committed: db.getStats().committed,
      fulfilled: db.getStats().fulfilled,
      failed: db.getStats().failed,
    },
    providers: {
      qonto: {
        healthy: provider.healthCheck(),
        balance: provider.getBalance(Currency.EUR),
      },
    },
    uptime: process.uptime(),
    version: pkg.version,
  });
});
```

### 12. Add OpenAPI/Swagger Docs

**Create**: `solver/src/api/openapi.yaml`

Document the Quote API endpoints for third-party integrations.

### 13. Add Frontend Testing

```bash
cd frontend
npm install -D vitest @testing-library/react
```

### 14. Create Architecture Diagram

**Create**: `docs/architecture.png`

Use Excalidraw or Mermaid to create a visual diagram.

---

## 📁 Proposed File Structure After Cleanup

```
zkp2p-offramp/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore                    # Comprehensive gitignore
├── README.md                     # Updated main readme
├── LICENSE                       # MIT license
├── docker-compose.yml            # Docker setup
├── docs/
│   ├── IMPROVEMENTS.md           # This file
│   ├── DEPLOYMENT.md             # Deployment guide
│   ├── CONTRIBUTING.md           # Contribution guidelines
│   ├── SECURITY.md               # Security policy
│   └── architecture.png          # Architecture diagram
├── contracts/
│   ├── .env.example
│   ├── README.md                 # ✅ Already exists
│   ├── src/
│   ├── test/
│   └── script/
├── solver/
│   ├── .env.example              # ⚠️ Create this
│   ├── README.md                 # ✅ Already exists
│   └── src/
├── frontend/
│   ├── .env.example              # ⚠️ Create this
│   └── README.md                 # ⚠️ Create this
└── attestation-service/          # May be in separate location
    ├── .env.example
    └── README.md
```

---

## 🚀 Deployment Checklist

### Before GitHub Push

- [ ] Remove all `.env` files from git history
- [ ] Add `.env.example` files
- [ ] Update `.gitignore`
- [ ] Remove `solver.db` and `solver-v3.db`
- [ ] Remove `proofs/` directory or add to gitignore
- [ ] Remove `contracts/broadcast/` or add to gitignore
- [ ] Run `git filter-branch` if secrets were ever committed
- [ ] Add LICENSE file
- [ ] Create security contact

### Before Public Testnet

- [ ] Deploy fresh contracts (don't reuse test deployments)
- [ ] Create new attestation witness key
- [ ] Set up monitoring/alerting
- [ ] Document known limitations
- [ ] Create a simple landing page explaining the project

### Commands to Clean Git History (if needed)

```bash
# Remove sensitive files from entire git history
# WARNING: This rewrites history

# Install BFG Repo-Cleaner
brew install bfg

# Remove files containing secrets
bfg --delete-files .env
bfg --delete-files solver.db
bfg --delete-files '*.jwk'

# Clean up
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

---

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 3 | Must fix before GitHub |
| 🟡 Important | 5 | Should fix before production |
| 🟢 Nice to Have | 6 | Can do later |

**Estimated Time**: 
- Critical: 1-2 hours
- Important: 3-4 hours
- Nice to Have: 1-2 days

