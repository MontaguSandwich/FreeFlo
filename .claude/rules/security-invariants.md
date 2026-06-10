# Security Invariants

These MUST hold true. Violating any of these will break the system.

## EIP-712 Domain (MUST Match Exactly)

The attestation service and PaymentVerifier contract must use identical EIP-712 domain:
- name: "WisePaymentVerifier"
- version: "1"
- chainId: 8453 (mainnet) or 84532 (testnet)
- verifyingContract: 0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905 (mainnet)

Mismatch produces NotAuthorizedWitness (0x41110897). This is the #1 cause of attestation failures.

## Witness Authorization

The witness address (0x343830917e4e5f6291146af68f76eada08631a27) must be authorized on PaymentVerifier. Check: cast call <verifier> "authorizedWitnesses(address)" <witness> --rpc-url <rpc>

## Nullifier Uniqueness

Each payment ID (provider_transfer_id) can only be used once. Resubmission produces NullifierAlreadyUsed (0xcad2ae02). The solver saves provider_transfer_id after fiat transfer to prevent duplicate sends.

## Trust Model

- Solver: UNTRUSTED. Cannot forge proofs. Any address can be a solver (permissionless).
- Attestation service: TRUSTED. FreeFlo controls witness key. Only signs after on-chain validation.
- On-chain: TRUSTLESS. Contract verifies signatures and enforces rules.

## Intent Expiry

Quotes expire after 5 minutes. QuoteWindowClosed (0x88366b0a) means the intent timed out.

## Notary Key Pinning (MUST — 2026-06 audit)

The attestation service MUST pin the TLSNotary key. `verification.rs` captures
`presentation.verifying_key()` BEFORE `verify()` consumes it, and rejects (`UntrustedNotary`)
unless it matches `NOTARY_PUBLIC_KEYS` (SEC1; compressed and uncompressed both normalize). The
prover signs with `NOTARY_PRIVATE_KEY` (FreeFlo-held; in-process until the standalone-notary
milestone). Without this, any solver self-notarizes a forged proof and drains USDC.
`NOTARY_PUBLIC_KEYS` is REQUIRED — the service refuses to start without it.

## IBAN Must Bind to On-Chain Recipient (MUST — 2026-06 audit)

The attestation MUST NOT trust any solver-supplied beneficiary IBAN. It decodes `receivingInfo`
from the on-chain intent (`getIntent`, dynamic string at field index 9) and requires
`normalize_iban(proven_iban) == normalize_iban(receivingInfo)`. Order in `api.rs` is
verify → bind → sign. Also enforced: settlement gate (status ∈ {settled, completed}), no
empty-expected bypass, and fail-closed when chain config is missing (unless
`ALLOW_NO_CHAIN_VALIDATION=true`).

> These hold on branch `audit-fixes` — NOT yet on `main` or the live mainnet contracts. See
> `docs/agent/SESSION-HANDOFF.md`.
