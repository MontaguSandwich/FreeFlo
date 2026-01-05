# Changelog

All notable changes to FreeFlo are documented here.

## [Unreleased]

### 2026-01-05
- Reorganized documentation: lean CLAUDE.md + detailed docs/ARCHITECTURE.md

### 2026-01-03
- Added Quote API proxy to frontend (`/api/quote`) - fixes CORS/mixed-content
- Fixed IPv6 issue: `localhost` → `127.0.0.1` for attestation service URL
- Increased prover timeout to 5 minutes (300000ms)
- Added Qonto TLSNotary prover examples to repo (`tlsn/crates/examples/qonto/`)
- Cleaned `.env.backup` from git history
- Merged PR #8 (IBAN flow fix) and PR #9 (Prometheus metrics)

### 2026-01-02
- Full end-to-end automated flow working (~14s fulfillment)
- TLSNotary proof generation operational
- Attestation service signing EIP-712 proofs
- Real quotes via solver Quote API

### Earlier
- Initial V3 contracts deployed to Base Sepolia
- Qonto provider integration
- Frontend deployed to Vercel
