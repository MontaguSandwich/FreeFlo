# Providers (TLSNotary Prover)

Payment provider implementations for generating TLSNotary proofs.

## Structure

- prover/ - Rust TLSNotary prover workspace
- prover/adapters/qonto/ - Qonto-specific prover
- qonto/ - Qonto provider documentation

## Building

cd providers/prover
cargo build --release --bin qonto_prove_transfer

## Dependencies

tlsnotary/tlsn v0.1.0-alpha.13. Must match attestation service.

## Adding New Providers

See providers/README.md. Each provider needs:
1. Prover adapter in providers/prover/adapters/<name>/
2. Provider docs in providers/<name>/
3. ALLOWED_SERVERS entry in attestation env
