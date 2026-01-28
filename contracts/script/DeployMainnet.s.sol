// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";
import { VenmoToSepaRouter } from "../src/VenmoToSepaRouter.sol";

contract DeployMainnetScript is Script {
    // Base Mainnet addresses
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ZKP2P Orchestrator on Base Mainnet
    address constant ZKP2P_ORCHESTRATOR = 0x88888883Ed048FF0a415271B28b2F52d431810D0;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address witnessAddress = vm.envAddress("WITNESS_ADDRESS");

        require(witnessAddress != address(0), "WITNESS_ADDRESS not set");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PaymentVerifier
        PaymentVerifier verifier = new PaymentVerifier(witnessAddress);
        console.log("PaymentVerifier deployed at:", address(verifier));
        console.log("  Witness:", witnessAddress);

        // 2. Deploy OffRampV3
        OffRampV3 offRamp = new OffRampV3(USDC_BASE_MAINNET, address(verifier));
        console.log("OffRampV3 deployed at:", address(offRamp));
        console.log("  USDC:", USDC_BASE_MAINNET);
        console.log("  Verifier:", address(verifier));

        // 3. Deploy VenmoToSepaRouter
        VenmoToSepaRouter router = new VenmoToSepaRouter(
            USDC_BASE_MAINNET,
            address(offRamp),
            ZKP2P_ORCHESTRATOR
        );
        console.log("VenmoToSepaRouter deployed at:", address(router));
        console.log("  ZKP2P Orchestrator:", ZKP2P_ORCHESTRATOR);

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("  BASE MAINNET DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("");
        console.log("Chain ID:", block.chainid);
        console.log("");
        console.log("Contracts:");
        console.log("  PaymentVerifier:    ", address(verifier));
        console.log("  OffRampV3:          ", address(offRamp));
        console.log("  VenmoToSepaRouter:  ", address(router));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update attestation service with new VERIFIER_CONTRACT and OFFRAMP_CONTRACT");
        console.log("2. Register VenmoToSepaRouter in ZKP2P PostIntentHookRegistry");
        console.log("3. Update frontend with new contract addresses");
        console.log("4. Update solver with new OFFRAMP_V3_ADDRESS");
        console.log("");
        console.log("Environment variables to update:");
        console.log("  PAYMENT_VERIFIER_ADDRESS=", address(verifier));
        console.log("  OFFRAMP_V3_ADDRESS=", address(offRamp));
        console.log("  VENMO_TO_SEPA_ROUTER=", address(router));
    }
}
