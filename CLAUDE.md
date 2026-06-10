# FreeFlo

Trustless USDC-to-fiat offramp on Base. User deposits USDC, solver sends fiat (SEPA Instant), proves payment via TLSNotary, claims USDC. Built on ZKP2P V3 protocol.

## Architecture

frontend/       Next.js (Vercel) - user-facing offramp wizard
solver/         TypeScript - intent watcher, fiat executor, proof generator
contracts/      Solidity (Foundry) - OffRampV3, PaymentVerifier, VenmoToSepaRouter
attestation/    Rust - TLSNotary proof verification + EIP-712 signing
providers/      Rust - TLSNotary prover adapters (Qonto)

## How to Work on This Project

1. Before changing code: read the relevant subdirectory CLAUDE.md for component-specific context.
2. Before changing contracts: run `cd contracts && forge build` to verify compilation.
3. Before committing: run tests for the affected component. Never commit broken builds.
4. For ZKP2P protocol questions: see .claude/rules/zkp2p-protocol.md
5. For debugging errors: see docs/agent/debugging.md for error signatures and cast commands.
6. For deployment/ops: see docs/agent/operations.md for VPS commands and PM2 config.
7. Always work on a feature branch. Never push directly to main.

## Key Commands

Frontend:     cd frontend && npm run dev
Contracts:    cd contracts && forge build && forge test
Solver:       cd solver && npm run build && npm run start:v3
Attestation:  cd attestation && cargo build --release

## Contracts (Base Mainnet)

OffRampV3: 0x5072175059DF310F9D5A3F97d2Fb36B87CD2083D
PaymentVerifier: 0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905
VenmoToSepaRouter V3: 0x8558D9701C80A5805E6ea940AfD05e36cfE27B23
USDC (Base): 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

## ZKP2P V2 Contracts (Base Mainnet) - Use These

OrchestratorV2: 0x888888359E981B5225CA48fbCdCeff702FC3b888 (permissionless PostIntentHooks)
EscrowV2: 0x777777779d229cdF3110e9de47943791c26300Ef
OrchestratorRegistry: 0xBe9fED15ED7A4B915C03EFcEcb9662739C3382A9
ProtocolViewerV2: 0xC8A622e1614BB58141E72e1D6023B16f08677d6c

## ZKP2P V1 Contracts (Base Mainnet) - Requires Hook Whitelisting

Orchestrator: 0x88888883Ed048FF0a415271B28b2F52d431810D0
Escrow: 0x2f121CDDCA6d652f35e8B3E560f9760898888888
PostIntentHookRegistry: 0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9

## Contracts (Base Sepolia)

OffRampV3: 0x34249F4AB741F0661A38651A08213DDe1469b60f
PaymentVerifier: 0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe
USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e

## Critical Rules

- IPv6 trap: use 127.0.0.1 not localhost for ATTESTATION_SERVICE_URL
- tlsn version lock: both attestation and prover MUST use tlsnotary/tlsn v0.1.0-alpha.13
- Env isolation: solver uses ENV_FILE= for dotenv (never set -a). Attestation (Rust) uses set -a && source.
- EIP-712 domain MUST match between attestation service and PaymentVerifier contract. See .claude/rules/security-invariants.md

## Repository

GitHub: https://github.com/MontaguSandwich/FreeFlo
