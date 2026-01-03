// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";

contract DeployV3Script is Script {
    // Base Sepolia USDC address
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Witness address (attestation service signer)
    // This is the test key from attestation-service/.env
    address constant INITIAL_WITNESS = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PaymentVerifier first
        PaymentVerifier verifier = new PaymentVerifier(INITIAL_WITNESS);
        console.log("PaymentVerifier deployed at:", address(verifier));
        console.log("  Initial witness:", INITIAL_WITNESS);
        console.log("  Domain separator:", vm.toString(verifier.DOMAIN_SEPARATOR()));

        // Deploy OffRampV3 with verifier
        OffRampV3 offRamp = new OffRampV3(USDC_BASE_SEPOLIA, address(verifier));
        console.log("OffRampV3 deployed at:", address(offRamp));
        console.log("  USDC:", USDC_BASE_SEPOLIA);
        console.log("  Verifier:", address(verifier));

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Chain ID:", block.chainid);
        console.log("PaymentVerifier:", address(verifier));
        console.log("OffRampV3:", address(offRamp));
        console.log("");
        console.log("Add to .env:");
        console.log("  PAYMENT_VERIFIER_ADDRESS=", address(verifier));
        console.log("  OFFRAMP_V3_ADDRESS=", address(offRamp));
    }
}

