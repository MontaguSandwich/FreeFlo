// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { FreeFloCompactArbiter } from "../src/FreeFloCompactArbiter.sol";
import { FreeFloAllocator } from "../src/FreeFloAllocator.sol";
import { ITheCompact, Scope, ResetPeriod } from "../src/interfaces/ITheCompact.sol";

/**
 * @title DeployCompactArbiter
 * @notice Deploys the TIER-1 sign-once offramp stack and registers the FreeFlo allocator with
 *         Uniswap's The Compact, then derives the exact resource-lock parameters the frontend
 *         deposits into.
 *
 * Deploy order (single broadcast):
 *   1. FreeFloCompactArbiter(verifier, theCompact)         — reuses the audited PaymentVerifier.
 *   2. FreeFloAllocator(allocatorSigner, arbiter)          — backs only this arbiter.
 *   3. theCompact.__registerAllocator(allocator, "")       — permitted because allocator.code>0.
 *   4. Compute lockTag = (scope<<255 | resetPeriod<<252 | allocatorId<<160) and the ERC-6909
 *      resource-lock id = (lockTag | uint160(usdc)) — the frontend's deposit target.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY (req)   PAYMENT_VERIFIER (req)   ALLOCATOR_SIGNER (req)
 *   THE_COMPACT  (default 0x...9788 — same address on Base mainnet + Sepolia; VERIFY on Sepolia)
 *   USDC         (default Base mainnet USDC)
 *   RESET_PERIOD (default 5 = OneDay)        SCOPE (default 1 = ChainSpecific)
 *
 * Usage (testnet first):
 *   THE_COMPACT=0x00000000000000171ede64904551eeDF3C6C9788 \
 *   PAYMENT_VERIFIER=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe \
 *   USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
 *   ALLOCATOR_SIGNER=<addr of the FreeFlo allocator key> \
 *   forge script script/DeployCompactArbiter.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
 */
contract DeployCompactArbiterScript is Script {
    // The Compact — deterministic deploy, same address across chains. VERIFY on Base Sepolia.
    address constant THE_COMPACT_DEFAULT = 0x00000000000000171ede64904551eeDF3C6C9788;
    // PaymentVerifier — audited prod (Base mainnet). Testnet is 0xd72ddbFA... (pass via env).
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address theCompact = vm.envOr("THE_COMPACT", THE_COMPACT_DEFAULT);
        address verifier = vm.envAddress("PAYMENT_VERIFIER");
        address allocatorSigner = vm.envAddress("ALLOCATOR_SIGNER");
        address usdc = vm.envOr("USDC", USDC_BASE_MAINNET);
        uint8 resetPeriod = uint8(vm.envOr("RESET_PERIOD", uint256(uint8(ResetPeriod.OneDay))));
        uint8 scope = uint8(vm.envOr("SCOPE", uint256(uint8(Scope.ChainSpecific))));

        require(verifier != address(0), "PAYMENT_VERIFIER required");
        require(allocatorSigner != address(0), "ALLOCATOR_SIGNER required");
        require(theCompact.code.length > 0, "THE_COMPACT has no code on this chain");

        vm.startBroadcast(deployerPk);

        FreeFloCompactArbiter arbiter = new FreeFloCompactArbiter(verifier, theCompact);
        FreeFloAllocator allocator = new FreeFloAllocator(allocatorSigner, address(arbiter));

        // Register the allocator (allocator.code.length > 0 => permissionless, empty proof).
        uint96 allocatorId = ITheCompact(theCompact).__registerAllocator(address(allocator), "");

        vm.stopBroadcast();

        // Derive the lock parameters the frontend deposits into (IdLib layout).
        uint256 lockTagUint =
            (uint256(scope) << 255) | (uint256(resetPeriod) << 252) | (uint256(allocatorId) << 160);
        bytes12 lockTag = bytes12(bytes32(lockTagUint));
        uint256 id = lockTagUint | uint256(uint160(usdc));

        console.log("=== TIER-1 Sign-Once Offramp Deployment ===");
        console.log("Chain ID:           ", block.chainid);
        console.log("FreeFloCompactArbiter:", address(arbiter));
        console.log("FreeFloAllocator:     ", address(allocator));
        console.log("  reuses PaymentVerifier:", verifier);
        console.log("  settles against The Compact:", theCompact);
        console.log("  allocator signer:   ", allocatorSigner);
        console.log("Allocator ID:         ", uint256(allocatorId));
        console.log("Scope (1=ChainSpecific):", scope);
        console.log("ResetPeriod (5=OneDay): ", resetPeriod);
        console.log("USDC:                 ", usdc);
        console.log("lockTag (bytes12):");
        console.logBytes12(lockTag);
        console.log("Resource-lock id (uint256):", id);
        console.log("Resource-lock id (hex):");
        console.logBytes32(bytes32(id));
        console.log("");
        console.log("Next:");
        console.log(" - Set ALLOCATOR_SIGNER's key in the FreeFlo allocator signer service.");
        console.log(
            " - frontend/lib/compact-contracts.ts: arbiter, allocator, lockTag, id, theCompact."
        );
        console.log(" - Attestation service: enable the Compact-flow intentHash binding.");
        console.log(" - Solver: pre-fill check that forcedWithdrawal is NOT armed on the lock.");
    }
}
