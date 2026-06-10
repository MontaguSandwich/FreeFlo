# Debugging Reference

## Error Signatures

0x41110897 - NotAuthorizedWitness
  Fix: EIP-712 domain mismatch. cast call <verifier> DOMAIN_SEPARATOR() --rpc-url <rpc>

0x8baa579f - InvalidSignature
  Fix: Check witness key and signing logic.

0xcad2ae02 - NullifierAlreadyUsed
  Fix: Payment ID already claimed. Check solver duplicate prevention.

0x69388023 - PaymentVerificationFailed
  Fix: Attestation data format wrong. Check encoding.

0x88366b0a - QuoteWindowClosed
  Fix: Intent expired (>5 min). Create new intent.

## Quick Debug Commands

Check witness: cast call 0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905 authorizedWitnesses(address) $WITNESS --rpc-url https://mainnet.base.org
Check domain: cast call 0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905 DOMAIN_SEPARATOR() --rpc-url https://mainnet.base.org
Check intent: cast call 0x5072175059DF310F9D5A3F97d2Fb36B87CD2083D getIntent(bytes32) $INTENT_ID --rpc-url https://mainnet.base.org
Clear solver state: rm -rf solver/data/ solver/*.db solver/proofs/ && pm2 restart zkp2p-solver
Solver logs: pm2 logs zkp2p-solver --lines 100

## Common Gotchas

- IPv6: Use 127.0.0.1 not localhost for ATTESTATION_SERVICE_URL
- Prover timeout: PROVER_TIMEOUT=300000 (5 min), first run compiles Rust
- Qonto tokens: Expire in 1 hour, auto-refresh on 401
- Quote API 404: Check SOLVER_API_URL in Vercel env vars
- Env contamination: Use ENV_FILE= not shell sourcing for solver

## ZKP2P Integration Errors

Missing gatingServiceSignature/signatureExpiration:
  - ZKP2P SDK requires gating signatures from quote response
  - Check if API key is valid (401 = expired key)
  - Production API indexes production escrow deposits only

InvalidSignature() on signalIntent:
  - CRITICAL: Using wrong gating API endpoint for orchestrator version
  - V1 Orchestrator → use /v2/verify/intent (referrer, referrerFee fields)
  - V2 Orchestrator → use /v3/intent (callerAddress, referralFees array)
  - Signature is generated with specific parameter format; mismatch = invalid
  - Check escrow's gating service: cast call <escrow> "getDepositGatingService(uint256,bytes32)(address)" <depositId> <paymentMethod> --rpc-url https://mainnet.base.org

ZKP2P API 401 "Invalid or expired token":
  - Staging uses Bearer token: Authorization: Bearer <key>
  - Production uses x-api-key header
  - Get fresh API key from ZKP2P team

PostIntentHookNotWhitelisted(address hook):
  - This error is ONLY thrown by Orchestrator V1 (0x88888883Ed048FF0a415271B28b2F52d431810D0)
  - V1 uses PostIntentHookRegistry (0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9) for whitelisting
  - Solution: Use deposits on EscrowV2 which uses OrchestratorV2 (permissionless)
  - If V1 deposits needed: Contact ZKP2P team to whitelist hook in PostIntentHookRegistry

InvalidPostIntentHook:
  - This error is from OrchestratorV2 (0x888888359E981B5225CA48fbCdCeff702FC3b888)
  - OrchestratorV2 is PERMISSIONLESS for PostIntentHooks (no whitelist registry)
  - Error means hook contract is invalid (zero address, not a contract, etc.)

ZKP2P Quote API "No quotes returned":
  - API response wraps data in `responseObject` - unwrap before extracting quotes
  - Check escrowAddresses param in request - must match where deposits exist
  - EscrowV2: 0x777777779d229cdF3110e9de47943791c26300Ef (permissionless hooks)
  - Escrow V1: 0x2f121CDDCA6d652f35e8B3E560f9760898888888 (requires hook whitelisting)

Peer Extension "Too much memory allocated" / "Panic: Too much memory allocated":
  - Browser-side WASM memory exhaustion during TLSNotary proof generation
  - NOT the same as Solidity Panic(0x41) - this is JavaScript/WASM error
  - Workarounds: close other tabs, restart browser, try incognito window, disable other extensions
  - Revolut pages are heavier than Venmo - more likely to hit memory limits
  - If persistent: contact ZKP2P support at peer.xyz

ProtocolViewerV2 Panic(0x41) - EVM memory overflow:
  - Caused by ABI mismatch: old viewer expects (referrer, referrerFee), new orchestrator uses referralFees[]
  - Old address (broken): 0x19E4AA00083...
  - New address (fixed): 0xC8A622e1614BB58141E72e1D6023B16f08677d6c
  - See PR #147: github.com/zkp2p/zkp2p-contracts/pull/147

409 Conflict on gating signature request:
  - Error: "You already have an active order waiting to complete"
  - User has an existing intent that must be cancelled or completed first
  - Cancel via frontend button or CLI (see commands below)

Intent hash vs Transaction hash:
  - These are DIFFERENT values - don't confuse them
  - Intent hash: found in IntentSignaled event logs, topics[1]
  - Transaction hash: the tx that called signalIntent
  - cancelIntent() requires the intent hash, not the tx hash

## ZKP2P V1 vs V2 Architecture

V1 Stack (requires hook whitelisting):
  - Escrow: 0x2f121CDDCA6d652f35e8B3E560f9760898888888 (3100+ deposits)
  - Orchestrator: 0x88888883Ed048FF0a415271B28b2F52d431810D0
  - PostIntentHookRegistry: 0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9
  - Whitelisted hooks: AcrossBridgeHook, AcrossBridgeHookV2 only

V2 Stack (permissionless hooks):
  - EscrowV2: 0x777777779d229cdF3110e9de47943791c26300Ef (473+ deposits)
  - OrchestratorV2: 0x888888359E981B5225CA48fbCdCeff702FC3b888
  - OrchestratorRegistry: 0xBe9fED15ED7A4B915C03EFcEcb9662739C3382A9
  - No PostIntentHookRegistry - any valid contract can be a hook

VenmoToSepaRouter (0x8558D9701C80A5805E6ea940AfD05e36cfE27B23):
  - Configured for OrchestratorV2
  - Works with EscrowV2 deposits without whitelisting
  - Does NOT work with V1 Escrow deposits (would need whitelisting)

Debug commands:
  Check if hook whitelisted (V1 only):
    cast call 0x9B128EBAD4d874199A2Dc57E93186796c5EcAdE9 "isWhitelistedHook(address)(bool)" <hook> --rpc-url https://mainnet.base.org

  Check OrchestratorV2 registered:
    cast call 0xBe9fED15ED7A4B915C03EFcEcb9662739C3382A9 "isOrchestrator(address)(bool)" 0x888888359E981B5225CA48fbCdCeff702FC3b888 --rpc-url https://mainnet.base.org

  Cancel ZKP2P intent (V2 Orchestrator):
    cast send 0x888888359E981B5225CA48fbCdCeff702FC3b888 "cancelIntent(bytes32)" <INTENT_HASH> --rpc-url https://mainnet.base.org --private-key <KEY>

  Find intent hash from signalIntent tx:
    - Go to Basescan, find the signalIntent transaction
    - Look at Logs tab, find IntentSignaled event
    - Intent hash is topics[1] (first indexed parameter)
