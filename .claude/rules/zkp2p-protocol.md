# ZKP2P V3 Protocol Knowledge

FreeFlo is built on ZKP2P V3 by Peer (formerly ZKP2P). This context is essential for all components.

## Protocol Architecture

ZKP2P V3 has two core contracts:
- Escrow: deposit config, token custody, lock/unlock funds
- Orchestrator: intent lifecycle (signal, cancel, fulfill), fee routing, post-intent hooks

FreeFlo OffRampV3 is a custom implementation tailored for the offramp flow.

## Intent Lifecycle (ZKP2P Trade)

1. Maker deposits USDC into escrow via createDeposit()
2. Taker signals intent via Orchestrator.signalIntent() which locks funds
3. Taker makes fiat payment off-chain
4. Taker generates proof (TLSNotary/Reclaim) of payment
5. Attestation service validates proof off-chain, returns EIP-712 PaymentAttestation
6. Taker submits attestation on-chain via Orchestrator.fulfillIntent()
7. UnifiedPaymentVerifier checks attestation signature + nullifier
8. Escrow releases USDC to recipient (or PostIntentHook)

## FreeFlo Flow (Offramp - Roles Inverted)

- User = depositor (deposits USDC to convert to fiat)
- Solver = sends fiat, claims USDC

User createIntent() -> Solver commits quote -> Solver sends SEPA -> Solver generates TLSNotary proof -> Attestation service signs -> Solver fulfills on-chain -> USDC to solver

## Key Interfaces

Orchestrator (ZKP2P):
- signalIntent(escrow, depositId, amount, recipient, paymentMethod, payeeDetails, data)
- fulfillIntent(intentHash, paymentProof, data)
- cancelIntent(intentHash)

FreeFlo OffRampV3:
- createIntent(amount, currency, payeeDetails)
- commitQuote(intentId, quote)
- fulfillIntent(intentId, attestation)

## Verification Pattern

Both ZKP2P and FreeFlo use EIP-712 PaymentAttestation signed by authorized witnesses. The verifier checks signature validity and nullifiers to prevent double-claims. Vendor-agnostic: supports TLSNotary, Reclaim, Primus.

## PostIntentHooks

FiatToFiatRouter IS a PostIntentHook: receives USDC from ZKP2P Venmo onramp, then creates a FreeFlo intent to offramp to SEPA EUR.

### V1 vs V2 PostIntentHook Policy

V2 (OrchestratorV2): PERMISSIONLESS
- Any valid contract implementing IPostIntentHookV2 can be used
- No registration required
- Error if invalid: InvalidPostIntentHook

V1 (Orchestrator): WHITELISTED ONLY
- Hooks must be registered in PostIntentHookRegistry (0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9)
- Currently only AcrossBridgeHook and AcrossBridgeHookV2 are whitelisted
- Error if not whitelisted: PostIntentHookNotWhitelisted

FiatToFiatRouter uses OrchestratorV2 (permissionless) and targets EscrowV2 deposits only.

## Key Packages

- @zkp2p/contracts-v2: ABIs, addresses, constants for ZKP2P V3 contracts
- @zkp2p/providers: JSON templates for payment provider configs

## ZKP2P Contracts (Base Mainnet)

V2 Stack (use for FiatToFiatRouter):
- OrchestratorV2: 0x888888359E981B5225CA48fbCdCeff702FC3b888
- EscrowV2: 0x777777779d229cdF3110e9de47943791c26300Ef
- OrchestratorRegistry: 0xBe9fED15ED7A4B915C03EFcEcb9662739C3382A9

V1 Stack (requires hook whitelisting):
- Orchestrator: 0x88888883Ed048FF0a415271B28b2F52d431810D0
- Escrow: 0x2f121CDDCA6d652f35e8B3E560f9760898888888
- PostIntentHookRegistry: 0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9
