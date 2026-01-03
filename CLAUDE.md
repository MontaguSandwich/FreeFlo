# CLAUDE.md - Project Context for Claude Code

## Project Overview

**FreeFlo (zkp2p-offramp)** is a trustless USDC-to-EUR offramp using zkTLS (TLSNotary) proofs. Users deposit USDC on-chain, solvers send fiat via SEPA Instant, then claim USDC by proving the bank transfer happened using cryptographic proofs from the bank's API response.

**Repository**: https://github.com/MontaguSandwich/FreeFlo

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Frontend   │────▶│  Contracts  │◀────│     Solver       │
│  (Next.js)  │     │  (Solidity) │     │   (TypeScript)   │
└─────────────┘     └─────────────┘     └────────┬─────────┘
                                                 │
                    ┌─────────────┐     ┌────────▼─────────┐
                    │ Attestation │◀────│    TLSNotary     │
                    │   Service   │     │     Prover       │
                    │   (Rust)    │     │     (Rust)       │
                    └─────────────┘     └──────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Qonto     │
                    │  Bank API   │
                    └─────────────┘
```

## Directory Structure

```
/
├── frontend/                 # Next.js frontend (Vercel deployed)
│   ├── src/app/             # App router pages
│   ├── src/components/      # React components
│   └── src/lib/             # Utilities, wagmi config
│
├── solver/                   # TypeScript solver service
│   ├── src/
│   │   ├── index-v3.ts      # Main entry point (V3 with zkTLS)
│   │   ├── orchestrator-v3.ts   # Intent processing logic
│   │   ├── chain-v3.ts      # On-chain interactions
│   │   ├── providers/
│   │   │   └── qonto.ts     # Qonto bank provider (SEPA Instant)
│   │   ├── attestation-client.ts  # Talks to attestation service
│   │   └── tlsnotary-prover.ts    # Generates TLSNotary proofs
│   └── .env                 # Configuration (tokens, keys)
│
├── contracts/               # Solidity smart contracts
│   ├── src/
│   │   ├── OffRampV3.sol    # Main intent/quote/fulfillment contract
│   │   └── PaymentVerifier.sol  # EIP-712 signature verification
│   └── script/
│       └── DeployV3.s.sol   # Deployment script
│
├── attestation-service/     # Rust attestation service
│   ├── src/
│   │   ├── main.rs          # HTTP server entry
│   │   ├── api.rs           # Endpoints
│   │   ├── attestation.rs   # TLSNotary verification + attestation creation
│   │   ├── eip712.rs        # EIP-712 signing logic
│   │   ├── config.rs        # Environment configuration
│   │   └── verification.rs  # TLSNotary presentation verification
│   └── Cargo.toml
│
└── api/                     # Quote API (Vercel serverless)
    └── quote.ts
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind, wagmi, viem |
| Contracts | Solidity 0.8.24, Foundry |
| Solver | TypeScript, Node.js, viem |
| Attestation | Rust, axum, alloy, k256 |
| TLSNotary | Rust (tlsn crate) |
| Database | SQLite (solver state) |
| Deployment | Vercel (frontend/api), VPS (solver/attestation) |

## Smart Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| OffRampV3 | `0x34249F4AB741F0661A38651A08213DDe1469b60f` |
| PaymentVerifier | `0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe` |
| USDC (testnet) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Key Flows

### Intent Lifecycle
1. **PENDING_QUOTE**: User deposits USDC, creates intent with IBAN/name
2. **COMMITTED**: User selects a solver's quote
3. **FULFILLED**: Solver proves payment, claims USDC
4. **CANCELLED/EXPIRED**: User cancels or timeout

### Solver Fulfillment (4 Steps)
1. Execute SEPA Instant transfer via Qonto API
2. Generate TLSNotary proof of bank response
3. Submit proof to attestation service, get signed attestation
4. Call `fulfillIntentWithProof()` on-chain with attestation

## Environment Variables

### Solver (.env)
```bash
# Chain
CHAIN_ID=84532
RPC_URL=https://base-sepolia-rpc.publicnode.com
SOLVER_PRIVATE_KEY=0x...

# Contracts
OFFRAMP_V3_ADDRESS=0x34249F4AB741F0661A38651A08213DDe1469b60f
PAYMENT_VERIFIER_ADDRESS=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe

# Qonto OAuth
QONTO_CLIENT_ID=...
QONTO_CLIENT_SECRET=...
QONTO_ACCESS_TOKEN=ory_at_...
QONTO_REFRESH_TOKEN=ory_rt_...
QONTO_BANK_ACCOUNT_ID=...

# Services
ATTESTATION_SERVICE_URL=http://localhost:4001
TLSN_PATH=/opt/tlsn/crates/examples
```

### Attestation Service (Docker env)
```bash
WITNESS_PRIVATE_KEY=0x...        # Signs attestations
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddb...    # Must match PaymentVerifier address
RUST_LOG=info
ATTESTATION_PORT=4001
```

## Common Commands

### Solver
```bash
cd solver
npm run build              # Compile TypeScript
npm run start:v3           # Run V3 solver (zkTLS enabled)
pm2 start npm --name zkp2p-solver -- run start:v3
pm2 logs zkp2p-solver
```

### Contracts
```bash
cd contracts
forge build
forge test
forge script script/DeployV3.s.sol --rpc-url $RPC_URL --broadcast
```

### Attestation Service
```bash
cd attestation-service
cargo build --release
docker build -t zkp2p-attestation .
docker run -d --name zkp2p-attestation -p 4001:4001 \
  -e WITNESS_PRIVATE_KEY=0x... \
  -e CHAIN_ID=84532 \
  -e VERIFIER_CONTRACT=0xd72ddb... \
  zkp2p-offramp-attestation-service:latest
```

### TLSNotary Prover
```bash
cd /opt/tlsn/crates/examples
cargo run --release --example qonto_transfer -- \
  --transfer-id <ID> \
  --access-token <TOKEN>
```

## Important Patterns

### EIP-712 Domain (CRITICAL)
The attestation service and PaymentVerifier contract MUST use matching EIP-712 domains:
```
name: "WisePaymentVerifier"
version: "1"
chainId: 84532
verifyingContract: <PaymentVerifier address>
```
Mismatch causes `NotAuthorizedWitness` errors.

### Qonto OAuth Token Refresh
Tokens expire after 1 hour. The solver auto-refreshes on 401 responses. New tokens are persisted to `.env` file.

### VoP (Verification of Payee)
Before sending money, the solver calls Qonto's VoP API to verify the recipient name matches the IBAN. Must use `beneficiary.name` and `beneficiary.iban` from VoP response (not stored beneficiary_id) because the proof token is cryptographically bound to that specific name/IBAN combination.

## Error Signatures

| Selector | Error | Cause |
|----------|-------|-------|
| `0x41110897` | NotAuthorizedWitness | EIP-712 domain mismatch or wrong witness key |
| `0x8baa579f` | InvalidSignature | Signature verification failed |
| `0xcad2ae02` | NullifierAlreadyUsed | Payment ID already claimed |
| `0x69388023` | PaymentVerificationFailed | Generic verification failure |
| `0xbd8ba84d` | InvalidAttestation | Malformed attestation data |

## Debugging Tips

1. **Check attestation service env vars**: `docker exec zkp2p-attestation env`
2. **Verify witness is authorized**: Call `authorizedWitnesses(address)` on PaymentVerifier
3. **Compare domain separators**: Contract's `DOMAIN_SEPARATOR()` must match computed value
4. **Clear solver cache**: `rm -rf solver/data/ solver/*.db` then restart
5. **Check Qonto token validity**: Look for 401 errors and auto-refresh in logs

## Testing Checklist

- [ ] Solver authorized on OffRampV3 contract
- [ ] Witness authorized on PaymentVerifier contract
- [ ] EIP-712 domain matches between attestation service and contract
- [ ] Qonto OAuth tokens are fresh
- [ ] TLSNotary prover binary is built (`cargo build --release`)
- [ ] Attestation service is running and healthy (`curl localhost:4001/health`)

## Production Considerations (TODO)

- [ ] Replace Foundry test witness key with secure key management
- [ ] Multi-sig witness setup for attestation service
- [ ] Rate limiting on quote API
- [ ] Monitoring and alerting
- [ ] Mainnet contract deployment
- [ ] Production Qonto account (not sandbox)

## Links

- **Frontend**: https://free-flo.vercel.app
- **API**: https://api.freeflo.live
- **Contracts**: Base Sepolia (see addresses above)
- **VPS**: 95.217.235.164 (solver + attestation)
