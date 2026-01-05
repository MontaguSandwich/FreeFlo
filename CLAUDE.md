# CLAUDE.md

Trustless USDC-to-fiat offramp using zkTLS. User deposits USDC, solver sends fiat (SEPA Instant), proves payment via TLSNotary, claims USDC. End-to-end: ~14 seconds.

## Directory Structure

```
frontend/           Next.js on Vercel (free-flo.vercel.app)
├── app/api/quote/  Proxy to solver Quote API (avoids CORS)
├── components/     OffRampForm.tsx is the main wizard
└── lib/quotes.ts   Quote fetching logic

solver/             TypeScript service on VPS (95.217.235.164:8080-8081)
├── src/index-v3.ts         Entry point
├── src/orchestrator-v3.ts  Intent processing & fulfillment
├── src/providers/qonto.ts  Qonto SEPA provider
└── src/attestation/        Prover + attestation client

contracts/          Solidity (Foundry)
├── src/OffRampV3.sol       Intent/quote/fulfillment
└── src/PaymentVerifier.sol EIP-712 verification

attestation-service/  Rust service on VPS (:4001)
└── src/              Verifies TLSNotary proofs, signs attestations

tlsn/crates/examples/qonto/  TLSNotary prover for Qonto
├── prove_transfer.rs        Generate attestation
└── present_transfer.rs      Create presentation
```

## Contracts (Base Sepolia)

```
OffRampV3:        0x34249F4AB741F0661A38651A08213DDe1469b60f
PaymentVerifier:  0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
USDC:             0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

## Run & Test

```bash
# Frontend
cd frontend && npm run dev
curl "http://localhost:3000/api/quote?amount=100&currency=EUR"

# Contracts
cd contracts && forge build && forge test

# Solver (VPS)
cd solver && npm run build && npm run start:v3
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"

# Attestation (VPS)
cd attestation-service && cargo build --release
curl http://127.0.0.1:4001/health

# TLSNotary prover (VPS)
cd /opt/tlsn/crates/examples
cargo build --release --example qonto_prove_transfer
```

## Critical Invariants

**EIP-712 domain MUST match** between attestation service and PaymentVerifier:
```
name: "WisePaymentVerifier"
version: "1"
chainId: 84532
verifyingContract: 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
```
Mismatch → `NotAuthorizedWitness` error.

**Witness must be authorized**: `PaymentVerifier.authorizedWitnesses(addr) == true`

**Solver must be authorized**: `OffRampV3.authorizedSolvers(addr) == true`

## Error Signatures

| Selector | Error | Fix |
|----------|-------|-----|
| `0x41110897` | NotAuthorizedWitness | Check EIP-712 domain + witness authorization |
| `0x8baa579f` | InvalidSignature | Signature verification failed |
| `0xcad2ae02` | NullifierAlreadyUsed | Payment ID already claimed |
| `0x69388023` | PaymentVerificationFailed | Check attestation data format |

## Gotchas

- **IPv6**: Use `127.0.0.1` not `localhost` for `ATTESTATION_SERVICE_URL`. Node resolves localhost to IPv6, Rust binds IPv4.
- **Prover timeout**: Set `PROVER_TIMEOUT=300000` (5 min). First run compiles Rust.
- **Qonto tokens**: Expire in 1 hour. Solver auto-refreshes on 401.
- **Duplicate prevention**: Solver saves `provider_transfer_id` after fiat transfer. On retry, skips transfer if ID exists.
- **Quote API 404**: Ensure `SOLVER_API_URL` is set in Vercel env vars.

## Environment Variables

### Solver (key ones)
```bash
ATTESTATION_SERVICE_URL=http://127.0.0.1:4001  # NOT localhost
PROVER_TIMEOUT=300000
TLSN_EXAMPLES_PATH=/opt/tlsn/crates/examples
```

### Vercel
```bash
SOLVER_API_URL=http://95.217.235.164:8081
```

### Attestation Service
```bash
WITNESS_PRIVATE_KEY=0x...
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
```

## Quick Debug

```bash
# Check witness authorized
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe "authorizedWitnesses(address)" $WITNESS --rpc-url https://base-sepolia-rpc.publicnode.com

# Check domain separator
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe "DOMAIN_SEPARATOR()" --rpc-url https://base-sepolia-rpc.publicnode.com

# Clear solver state
rm -rf solver/data/ solver/*.db solver/proofs/ && pm2 restart zkp2p-solver
```

## More Info

- Detailed architecture: `docs/ARCHITECTURE.md`
- Change history: `CHANGELOG.md`
- GitHub: https://github.com/MontaguSandwich/FreeFlo
