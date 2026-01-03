// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { OffRampV2 } from "../src/OffRampV2.sol";

contract SetupSolverV2Script is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address offRampAddress = vm.envAddress("OFFRAMP_V2_ADDRESS");
        address solverAddress = vm.envAddress("SOLVER_ADDRESS");

        console.log("OffRampV2:", offRampAddress);
        console.log("Solver to register:", solverAddress);

        OffRampV2 offRamp = OffRampV2(offRampAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Register solver
        offRamp.registerSolver(solverAddress, "MainSolver");
        console.log("Solver registered");

        // Enable SEPA_INSTANT (0) and SEPA_STANDARD (1) for EUR
        offRamp.setSolverRtpn(solverAddress, OffRampV2.RTPN.SEPA_INSTANT, true);
        console.log("SEPA_INSTANT enabled");

        offRamp.setSolverRtpn(solverAddress, OffRampV2.RTPN.SEPA_STANDARD, true);
        console.log("SEPA_STANDARD enabled");

        vm.stopBroadcast();

        // Verify
        bool authorized = offRamp.authorizedSolvers(solverAddress);
        console.log("\n=== Setup Complete ===");
        console.log("Solver authorized:", authorized);
    }
}

