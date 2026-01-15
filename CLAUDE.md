# CLAUDE.md

Trustless USDC-to-fiat offramp using zkTLS. User deposits USDC, solver sends fiat (SEPA Instant), proves payment via TLSNotary, claims USDC. End-to-end: ~10-15 seconds.

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
├── src/OffRampV3.sol       Intent/quote/fulfillment (permissionless)
└── src/PaymentVerifier.sol EIP-712 verification

attestation-service/  Rust service on FreeFlo infrastructure (:4001)
└── src/              Verifies TLSNotary proofs, validates on-chain, signs attestations

tlsn/qonto/                 TLSNotary prover for Qonto (uses git dep to tlsnotary/tlsn)
├── src/prove_transfer.rs   Generate attestation
└── src/present_transfer.rs Create presentation
```

## Contracts (Base Sepolia)

```
OffRampV3:        0x34249F4AB741F0661A38651A08213DDe1469b60f
PaymentVerifier:  0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
USDC:             0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

## Security Model

**FreeFlo controls the attestation service and witness key.** This ensures:
- Solvers cannot forge payment proofs
- Attestations are only signed after on-chain intent validation
- All attestation requests are authenticated and audit-logged

```
Solver (Untrusted)          FreeFlo (Trusted)           On-Chain
─────────────────           ─────────────────           ────────
1. Send fiat (SEPA)
2. Generate TLSNotary proof
3. POST /attest ──────────► 4. Validate on-chain intent
   (with API key)              (status, solver match)
                            5. Verify proof
                            6. Sign EIP-712 attestation
                     ◄────── 7. Return signature
8. Submit to contract ─────────────────────────────────► 9. Verify & release USDC
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

# Attestation (FreeFlo infrastructure)
cd attestation-service && cargo build --release
curl http://127.0.0.1:4001/api/v1/health

# TLSNotary prover (VPS)
cd /opt/FreeFlo/tlsn/qonto
cargo build --release --bin qonto_prove_transfer
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

**OffRampV3 is permissionless**: Any address can be a solver. On-chain intent tracks `selectedSolver`.

## Error Signatures

| Selector | Error | Fix |
|----------|-------|-----|
| `0x41110897` | NotAuthorizedWitness | Check EIP-712 domain + witness authorization |
| `0x8baa579f` | InvalidSignature | Signature verification failed |
| `0xcad2ae02` | NullifierAlreadyUsed | Payment ID already claimed |
| `0x69388023` | PaymentVerificationFailed | Check attestation data format |
| `0x88366b0a` | QuoteWindowClosed | Intent expired (>5 min), create new intent |

## Gotchas

- **IPv6**: Use `127.0.0.1` not `localhost` for `ATTESTATION_SERVICE_URL`. Node resolves localhost to IPv6, Rust binds IPv4.
- **Prover timeout**: Set `PROVER_TIMEOUT=300000` (5 min). First run compiles Rust.
- **Qonto tokens**: Expire in 1 hour. Solver auto-refreshes on 401.
- **Duplicate prevention**: Solver saves `provider_transfer_id` after fiat transfer. On retry, skips transfer if ID exists.
- **Quote API 404**: Ensure `SOLVER_API_URL` is set in Vercel env vars.
- **Intent detection**: Solver event watchers only start after historical sync. Wait for "V3 Orchestrator started" log before creating intents.
- **tlsn dependency**: Attestation service uses git dependency (`tlsnotary/tlsn` tag v0.1.0-alpha.14), not crates.io. First build downloads and compiles tlsn.
- **Env sourcing**: Use `set -a && source file.env && set +a` to properly export env vars for the attestation service.

## Environment Variables

### Solver (key ones)
```bash
ATTESTATION_SERVICE_URL=https://attestation.freeflo.live  # FreeFlo's service
ATTESTATION_API_KEY=your_api_key_from_freeflo            # Issued by FreeFlo
PROVER_TIMEOUT=300000
TLSN_EXAMPLES_PATH=/opt/FreeFlo/tlsn/qonto
```

### Vercel
```bash
SOLVER_API_URL=http://95.217.235.164:8081
```

### Attestation Service (FreeFlo-managed)
```bash
WITNESS_PRIVATE_KEY=0x...                                 # FreeFlo controls this
CHAIN_ID=84532
VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
RPC_URL=https://base-sepolia-rpc.publicnode.com
OFFRAMP_CONTRACT=0x34249F4AB741F0661A38651A08213DDe1469b60f
SOLVER_API_KEYS=key1:solver1_addr,key2:solver2_addr       # Registered solvers
```

## Quick Debug

```bash
# Check witness authorized
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe "authorizedWitnesses(address)" $WITNESS --rpc-url https://base-sepolia-rpc.publicnode.com

# Check domain separator
cast call 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe "DOMAIN_SEPARATOR()" --rpc-url https://base-sepolia-rpc.publicnode.com

# Check intent status
cast call 0x34249F4AB741F0661A38651A08213DDe1469b60f "getIntent(bytes32)" $INTENT_ID --rpc-url https://base-sepolia-rpc.publicnode.com

# Clear solver state
rm -rf solver/data/ solver/*.db solver/proofs/ && pm2 restart zkp2p-solver
```

## Development & Deployment

**Active branch**: `claude/review-deployment-feedback-bQM6t` (both servers run this)

| Server | IP | Code Path |
|--------|-----|-----------|
| Solver | 95.217.235.164 | `/opt/zkp2p-offramp/` |
| Attestation | 77.42.68.242 | `/opt/freeflo/attestation-service/` |

To update servers, see `docs/OPERATIONS_RUNBOOK.md`.

## More Info

- **Operations runbook**: `docs/OPERATIONS_RUNBOOK.md` (server commands, debugging)
- Detailed architecture: `docs/ARCHITECTURE.md`
- Solver setup: `docs/SOLVER_ONBOARDING.md`
- Security model: `docs/ATTESTATION_SEPARATION_SPEC.md`
- Change history: `CHANGELOG.md`
- GitHub: https://github.com/MontaguSandwich/FreeFlo
