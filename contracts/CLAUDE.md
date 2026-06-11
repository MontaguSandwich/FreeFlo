# Contracts (Solidity / Foundry)

## Key Contracts

- src/OffRampV3.sol - Intent creation, quote commitment, fulfillment (permissionless)
- src/PaymentVerifier.sol - EIP-712 attestation verification
- src/FiatToFiatRouter.sol - PostIntentHook bridging ZKP2P onramp to FreeFlo offramp

## Build and Test

forge build
forge test
forge test -vvv (verbose for debugging)

## Error Signatures

0x41110897 - NotAuthorizedWitness: EIP-712 domain mismatch or witness not authorized
0x8baa579f - InvalidSignature: signature verification failed
0xcad2ae02 - NullifierAlreadyUsed: payment ID already claimed
0x69388023 - PaymentVerificationFailed: check attestation data format
0x88366b0a - QuoteWindowClosed: intent expired (>5 min)

## Debug Commands

Check witness: cast call 0x5602D796052ABDaD862FEf8011CA2cedB5132A9b authorizedWitnesses(address) $WITNESS --rpc-url https://mainnet.base.org
Check domain: cast call 0x5602D796052ABDaD862FEf8011CA2cedB5132A9b DOMAIN_SEPARATOR() --rpc-url https://mainnet.base.org
Check intent: cast call 0x57c621994616110a50bD820388e4E8a41F00b4D7 getIntent(bytes32) $INTENT_ID --rpc-url https://mainnet.base.org

## When Modifying Contracts

1. Always forge build first
2. Run full test suite with forge test
3. If changing EIP-712 types, update attestation service AND PaymentVerifier simultaneously
4. FiatToFiatRouter interacts with ZKP2P Orchestrator (0x888888359E981B5225CA48fbCdCeff702FC3b888)
