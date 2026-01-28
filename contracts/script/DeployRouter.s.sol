// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { VenmoToSepaRouter } from "../src/VenmoToSepaRouter.sol";

contract DeployRouterScript is Script {
    // Base Sepolia addresses
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant OFFRAMP_V3_BASE_SEPOLIA = 0x34249F4AB741F0661A38651A08213DDe1469b60f;

    // ZKP2P Orchestrator address on Base Mainnet (placeholder - update before mainnet deploy)
    // TODO: Get actual address from ZKP2P team
    address constant ZKP2P_ORCHESTRATOR_BASE_SEPOLIA = address(0); // UPDATE THIS

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Allow override via env vars
        address zkp2pOrchestrator = vm.envOr("ZKP2P_ORCHESTRATOR", ZKP2P_ORCHESTRATOR_BASE_SEPOLIA);
        address offRampV3 = vm.envOr("OFFRAMP_V3_ADDRESS", OFFRAMP_V3_BASE_SEPOLIA);
        address usdc = vm.envOr("USDC_ADDRESS", USDC_BASE_SEPOLIA);

        require(zkp2pOrchestrator != address(0), "ZKP2P_ORCHESTRATOR not set");

        vm.startBroadcast(deployerPrivateKey);

        VenmoToSepaRouter router = new VenmoToSepaRouter(
            usdc,
            offRampV3,
            zkp2pOrchestrator
        );

        console.log("VenmoToSepaRouter deployed at:", address(router));
        console.log("  USDC:", usdc);
        console.log("  OffRampV3:", offRampV3);
        console.log("  ZKP2P Orchestrator:", zkp2pOrchestrator);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Chain ID:", block.chainid);
        console.log("VenmoToSepaRouter:", address(router));
        console.log("");
        console.log("Next steps:");
        console.log("1. Register router in ZKP2P PostIntentHookRegistry");
        console.log("2. Update frontend with router address");
        console.log("3. Test the full flow");
        console.log("");
        console.log("Add to .env:");
        console.log("  VENMO_TO_SEPA_ROUTER=", address(router));
    }
}
