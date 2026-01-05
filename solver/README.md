# FreeFlo Solver

Modular solver service for fulfilling USDC → Fiat off-ramp intents via various Real-Time Payment Networks (RTPNs) with **zkTLS verification**.

> **New solver?** See the complete setup guide: [docs/SOLVER_ONBOARDING.md](../docs/SOLVER_ONBOARDING.md)

## Overview

The solver (V3 with zkTLS):
1. Watches for `IntentCreated` events from the OffRampV3 contract
2. Generates quotes via registered RTPN providers (currently Qonto for SEPA Instant)
3. Submits quotes on-chain
4. Executes fiat transfers when quotes are selected
5. Generates TLSNotary proofs of the bank transfer
6. Gets EIP-712 attestation from the attestation service
7. Submits fulfillment with cryptographic proof to claim USDC

## Architecture

```
solver/src/
├── providers/           # RTPN provider implementations
│   ├── base.ts          # Abstract base class
│   ├── registry.ts      # Provider registry
│   ├── qonto.ts         # Qonto - SEPA Instant (EUR)
│   ├── qonto-client.ts  # Qonto API client
│   └── qonto-types.ts   # Qonto types
├── chain/               # Blockchain interaction
│   ├── abi.ts           # Contract ABI
│   └── client.ts        # Chain client
├── db/                  # Local state persistence
│   └── intents.ts       # SQLite database
├── orchestrator.ts      # Main solver loop
├── health.ts            # Health check endpoints
├── config.ts            # Configuration
└── index.ts             # Entry point
```

## Prerequisites

- Node.js 20+
- Authorized solver wallet with ETH for gas
- At least one configured RTPN provider

## Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
```

## Running

```bash
# Development (with hot reload)
npm run dev

# Production (V3 with zkTLS)
npm run build
npm run start:v3
```

## Configuration

### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Base RPC endpoint | - |
| `CHAIN_ID` | Chain ID (84532 for Base Sepolia) | 84532 |
| `OFFRAMP_V3_ADDRESS` | OffRampV3 contract address | - |
| `PAYMENT_VERIFIER_ADDRESS` | PaymentVerifier contract address | - |
| `SOLVER_PRIVATE_KEY` | Solver wallet private key | - |
| `ATTESTATION_SERVICE_URL` | Attestation service URL | http://127.0.0.1:4001 |
| `PROVER_ENABLED` | Enable TLSNotary prover | false |
| `TLSN_EXAMPLES_PATH` | Path to TLSNotary examples | - |
| `HEALTH_PORT` | Health check server port | 8080 |
| `QUOTE_API_PORT` | Quote API server port | 8081 |

See [.env.example](.env.example) for all configuration options.

### Qonto Provider (SEPA Instant - EUR)

| Variable | Description | Default |
|----------|-------------|---------|
| `QONTO_ENABLED` | Enable Qonto provider | false |
| `QONTO_ACCESS_TOKEN` | OAuth access token | - |
| `QONTO_BANK_ACCOUNT_ID` | Bank account UUID | - |
| `QONTO_USE_SANDBOX` | Use sandbox environment | false |
| `QONTO_STAGING_TOKEN` | Staging token (for sandbox) | - |
| `QONTO_FEE_BPS` | Fee in basis points | 50 (0.5%) |

## Supported Providers

| Provider | RTPNs | Currencies | Status |
|----------|-------|------------|--------|
| Qonto | SEPA Instant | EUR | ✅ Implemented |

## Adding New Providers

1. Create provider files in `src/providers/`:
   - `new-provider.ts` - Main provider class
   - `new-provider-client.ts` - API client
   - `new-provider-types.ts` - Types

2. Extend `BaseProvider` and implement all methods:
   ```typescript
   export class NewProvider extends BaseProvider {
     readonly id = "new-provider";
     readonly name = "New Provider";
     readonly supportedRtpns = [RTPN.FPS]; // Example
     readonly supportedCurrencies = [Currency.GBP];

     async getQuote(request: QuoteRequest): Promise<Quote> { /* ... */ }
     async executeTransfer(request: TransferRequest): Promise<TransferResult> { /* ... */ }
     async getTransferStatus(transferId: string): Promise<TransferStatus> { /* ... */ }
     async getBalance(currency: Currency): Promise<number> { /* ... */ }
     async healthCheck(): Promise<boolean> { /* ... */ }
   }
   ```

3. Export from `src/providers/index.ts`

4. Register in `src/index.ts`

5. Add configuration to `src/config.ts`

## Health Endpoints

The solver exposes health check endpoints:

- `GET /health` - Full health status with all checks
- `GET /ready` - Kubernetes readiness probe
- `GET /live` - Kubernetes liveness probe
- `GET /stats` - Uptime and basic stats

## Database Schema

The solver uses SQLite to track intent and quote state:

```sql
CREATE TABLE intents (
  intent_id TEXT PRIMARY KEY,
  depositor TEXT NOT NULL,
  usdc_amount TEXT NOT NULL,
  currency INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  selected_solver TEXT,
  selected_rtpn INTEGER,
  selected_fiat_amount TEXT,
  receiving_info TEXT,
  recipient_name TEXT,
  quotes_submitted INTEGER NOT NULL DEFAULT 0,
  fulfillment_tx_hash TEXT,
  provider_transfer_id TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  rtpn INTEGER NOT NULL,
  fiat_amount TEXT NOT NULL,
  fee TEXT NOT NULL,
  estimated_time INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_on_chain INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);
```

## Production Considerations

1. **Secure key management** - Use a secrets manager, not env vars
2. **Monitoring** - Set up alerts for failed intents and low balance
3. **Redundancy** - Run multiple solver instances with database locking
4. **Balance monitoring** - Alert when fiat balance is low
5. **Rate limiting** - Be aware of provider API rate limits
