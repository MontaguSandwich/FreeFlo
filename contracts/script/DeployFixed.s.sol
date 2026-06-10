// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";

/// @notice Deploys the audited PaymentVerifier + OffRampV3 against an existing USDC
/// (real USDC on mainnet/testnet) with a witness we control. No MockUSDC, no router.
/// Env: DEPLOYER_PRIVATE_KEY, WITNESS_ADDRESS, USDC_ADDRESS.
contract DeployFixedScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address witness = vm.envAddress("WITNESS_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        PaymentVerifier verifier = new PaymentVerifier(witness);
        OffRampV3 offRamp = new OffRampV3(usdc, address(verifier));
        vm.stopBroadcast();

        console.log("USDC           ", usdc);
        console.log("PaymentVerifier", address(verifier));
        console.log("OffRampV3      ", address(offRamp));
        console.log("Witness        ", witness);
        console.log("ChainId        ", block.chainid);
    }
}
