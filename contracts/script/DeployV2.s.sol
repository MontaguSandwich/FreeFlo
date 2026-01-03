// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { OffRampV2 } from "../src/OffRampV2.sol";

contract DeployV2Script is Script {
    // Base Sepolia USDC address
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Base Mainnet USDC address
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Determine USDC address based on chain
        address usdc;
        if (block.chainid == 84532) {
            usdc = USDC_BASE_SEPOLIA;
            console.log("Deploying to Base Sepolia");
        } else if (block.chainid == 8453) {
            usdc = USDC_BASE_MAINNET;
            console.log("Deploying to Base Mainnet");
        } else {
            revert("Unsupported chain");
        }

        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy OffRampV2
        OffRampV2 offRamp = new OffRampV2(usdc);

        console.log("OffRampV2 deployed at:", address(offRamp));

        vm.stopBroadcast();

        // Log deployment info
        console.log("\n=== Deployment Complete ===");
        console.log("Contract: OffRampV2");
        console.log("Address:", address(offRamp));
        console.log("Owner:", deployer);
        console.log("USDC:", usdc);
        console.log("\nNext steps:");
        console.log("1. Register solver: registerSolver(solverAddress, 'SolverName')");
        console.log("2. Set solver RTPNs: setSolverRtpn(solverAddress, rtpn, true)");
    }
}

