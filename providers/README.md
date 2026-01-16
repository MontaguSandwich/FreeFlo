# Providers

Payment providers for FreeFlo offramp. Each provider implements support for one or more Real-Time Payment Networks (RTPNs).

## Supported Providers

| Provider | RTPNs | Status |
|----------|-------|--------|
| [Qonto](./qonto/) | SEPA Instant | Live |

## Architecture

Each provider has two components:

### Executor (TypeScript)
Located in `solver/src/providers/`. Handles:
- Verification of Payee (VoP) checks
- Transfer creation and monitoring
- Status polling

### Prover (Rust)
Located in `providers/prover/adapters/`. Handles:
- TLSNotary proof generation
- Presentation creation for attestation service

## Adding a New Provider

1. **Create executor** in `solver/src/providers/`:
   - Implement provider class extending `BaseProvider`
   - Add API client for the bank/payment service
   - Register in `solver/src/providers/index.ts`

2. **Create prover adapter** in `providers/prover/adapters/`:
   - Add new crate under `adapters/`
   - Implement TLSNotary proof generation for the provider's API
   - Update `providers/prover/Cargo.toml` workspace members

3. **Document** in `providers/<name>/README.md`

## Prover

The prover is a Rust workspace that generates TLSNotary proofs for payment verification.

### Build
```bash
cd providers/prover
cargo build --release
```

### Binaries
- `qonto_prove_transfer` - Generate attestation from Qonto API
- `qonto_present_transfer` - Create presentation from attestation
