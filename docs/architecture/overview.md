# System Architecture

This document provides a high-level overview of the ZKP2P Off-Ramp architecture.

## Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ZKP2P Off-Ramp                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────────────────┐  │
│  │   Frontend   │     │   Smart Contracts │     │        Solver          │  │
│  │   (Next.js)  │     │   (Base Sepolia)  │     │     (TypeScript)       │  │
│  │              │     │                   │     │                        │  │
│  │  • Wallet    │────▶│  • OffRampV3      │◀────│  • Orchestrator        │  │
│  │  • Quotes    │     │  • PaymentVerifier│     │  • Quote API           │  │
│  │  • Status    │     │                   │     │  • Qonto Provider      │  │
│  └──────────────┘     └──────────────────┘     └───────────┬─────────────┘  │
│                                                            │                │
│                                                            │                │
│                       ┌────────────────────────────────────┼───────────┐    │
│                       │                                    │           │    │
│                       ▼                                    ▼           │    │
│               ┌──────────────┐                     ┌──────────────┐   │    │
│               │  Qonto API   │                     │ Attestation  │   │    │
│               │  (Banking)   │                     │   Service    │   │    │
│               │              │                     │   (Rust)     │   │    │
│               │  • SEPA      │ ──TLSNotary Proof──▶│              │   │    │
│               │  • Transfers │                     │  • Verify    │   │    │
│               └──────────────┘                     │  • Sign      │   │    │
│                                                    └──────────────┘   │    │
│                                                                       │    │
└───────────────────────────────────────────────────────────────────────┘    │
                                                                              │
                                External Services                             │
```

## Component Responsibilities

### Frontend (Next.js)

| Responsibility | Description |
|----------------|-------------|
| Wallet Connection | RainbowKit + wagmi for Web3 wallet integration |
| Quote Display | Fetches and displays real-time quotes from Solver API |
| Intent Creation | Creates on-chain intents via smart contract |
| Status Tracking | Polls contract state for fulfillment status |

### Smart Contracts (Solidity)

| Contract | Responsibility |
|----------|----------------|
| `OffRampV3` | Intent management, quote selection, USDC custody |
| `PaymentVerifier` | EIP-712 signature verification, nullifier registry |

### Solver (TypeScript)

| Module | Responsibility |
|--------|----------------|
| Orchestrator | Main loop: watch events, submit quotes, fulfill intents |
| Quote API | HTTP endpoint for frontend to fetch real-time quotes |
| Qonto Provider | Execute SEPA Instant transfers via Qonto API |
| Attestation Client | Request attestations from attestation service |
| TLSNotary Prover | Generate cryptographic proofs of bank transfers |

### Attestation Service (Rust)

| Responsibility | Description |
|----------------|-------------|
| Verify Proofs | Validates TLSNotary presentations |
| Extract Data | Parses payment details from verified transcripts |
| Sign Attestations | Creates EIP-712 signatures for on-chain verification |

## Data Flow

### 1. Quote Request Flow

```
User (Frontend)                  Solver                     Provider (Qonto)
      │                            │                              │
      │  GET /api/quote?amount=X   │                              │
      │───────────────────────────▶│                              │
      │                            │  Fetch exchange rate         │
      │                            │─────────────────────────────▶│
      │                            │                              │
      │                            │◀─────────────────────────────│
      │                            │  Calculate quote             │
      │  { quotes: [...] }         │                              │
      │◀───────────────────────────│                              │
```

### 2. Intent Creation Flow

```
User                        OffRampV3 Contract
 │                                 │
 │  createIntent(amount, EUR)      │
 │────────────────────────────────▶│
 │                                 │
 │                                 │  Transfer USDC to contract
 │                                 │  Emit IntentCreated event
 │                                 │
 │  intentId                       │
 │◀────────────────────────────────│
```

### 3. Fulfillment Flow

```
Solver                  Qonto API           Attestation        OffRampV3
   │                        │                  Service             │
   │  Execute Transfer      │                     │                │
   │───────────────────────▶│                     │                │
   │                        │                     │                │
   │  transfer_id           │                     │                │
   │◀───────────────────────│                     │                │
   │                        │                     │                │
   │  Generate TLSNotary Proof                    │                │
   │──────────────────────────────────────────────│                │
   │                        │                     │                │
   │  Request Attestation   │                     │                │
   │─────────────────────────────────────────────▶│                │
   │                        │                     │                │
   │  { attestation, signature }                  │                │
   │◀─────────────────────────────────────────────│                │
   │                        │                     │                │
   │  fulfillIntentWithProof(attestation, sig)    │                │
   │───────────────────────────────────────────────────────────────▶│
   │                        │                     │                │
   │                        │                     │     Verify sig │
   │                        │                     │     Check null │
   │                        │                     │     Release USDC
   │  success               │                     │                │
   │◀───────────────────────────────────────────────────────────────│
```

## Security Model

### Trust Assumptions

| Component | Trust Level | Notes |
|-----------|-------------|-------|
| Smart Contracts | Trustless | Verified on-chain, immutable |
| TLSNotary Proofs | Cryptographic | MPC-TLS guarantees authenticity |
| Attestation Service | Semi-trusted | Single witness (upgradeable to threshold) |
| Solver | Trustless | Anyone can run, economically incentivized |
| Qonto API | Trusted | Traditional banking API (TLS secured) |

### Security Mechanisms

1. **Nullifier Registry** - Prevents replay of payment proofs
2. **EIP-712 Signatures** - Domain-separated typed data signing
3. **Amount Validation** - 1% tolerance on payment verification
4. **Reentrancy Guard** - Protects all external calls
5. **Pausable** - Emergency circuit breaker

## Technology Stack

| Layer | Technology |
|-------|------------|
| Blockchain | Base (Ethereum L2) |
| Smart Contracts | Solidity 0.8.20, Foundry |
| Solver | TypeScript, Node.js 20 |
| Attestation | Rust, TLSNotary |
| Frontend | Next.js 14, React, Tailwind CSS |
| Wallet | RainbowKit, wagmi, viem |
| Database | SQLite (solver state) |
| Banking | Qonto API (SEPA Instant) |

