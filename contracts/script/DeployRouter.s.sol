// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { FiatToFiatRouter } from "../src/FiatToFiatRouter.sol";

contract DeployRouterScript is Script {
    // Base Mainnet addresses
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant OFFRAMP_V3_BASE_MAINNET = 0x57c621994616110a50bD820388e4E8a41F00b4D7;

    // ZKP2P V3 OrchestratorV2 address on Base (permissionless PostIntentHook)
    address constant ZKP2P_V3_ORCHESTRATOR = 0x888888359E981B5225CA48fbCdCeff702FC3b888;

    // Base Sepolia addresses (for testing)
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant OFFRAMP_V3_BASE_SEPOLIA = 0x34249F4AB741F0661A38651A08213DDe1469b60f;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Default to mainnet addresses, allow override via env vars
        address zkp2pOrchestrator = vm.envOr("ZKP2P_ORCHESTRATOR", ZKP2P_V3_ORCHESTRATOR);
        address offRampV3 = vm.envOr("OFFRAMP_V3_ADDRESS", OFFRAMP_V3_BASE_MAINNET);
        address usdc = vm.envOr("USDC_ADDRESS", USDC_BASE_MAINNET);

        require(zkp2pOrchestrator != address(0), "ZKP2P_ORCHESTRATOR not set");

        vm.startBroadcast(deployerPrivateKey);

        FiatToFiatRouter router = new FiatToFiatRouter(usdc, offRampV3, zkp2pOrchestrator);

        console.log("FiatToFiatRouter deployed at:", address(router));
        console.log("  USDC:", usdc);
        console.log("  OffRampV3:", offRampV3);
        console.log("  ZKP2P Orchestrator:", zkp2pOrchestrator);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Chain ID:", block.chainid);
        console.log("FiatToFiatRouter V3:", address(router));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update frontend/lib/router-contracts.ts with router address");
        console.log("2. Test the full flow (V3 is permissionless - no registration needed!)");
        console.log("");
        console.log("Add to frontend/lib/router-contracts.ts:");
        console.log(
            "  export const FIAT_TO_FIAT_ROUTER_ADDRESS = \"", address(router), "\" as const;"
        );
    }
}
