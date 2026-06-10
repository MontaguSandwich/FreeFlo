// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";
import { VenmoToSepaRouter } from "../src/VenmoToSepaRouter.sol";

/// @dev Minimal 6-decimal USDC stand-in for local/anvil deployments only.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Local-only deployment for the FreeFlo stack against anvil (chainId 31337).
/// Deploys a mock USDC + PaymentVerifier(witness) + OffRampV3 + VenmoToSepaRouter.
/// The witness defaults to the deployer so the attestation service's
/// WITNESS_PRIVATE_KEY can equal DEPLOYER_PRIVATE_KEY locally.
contract DeployLocalScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address witness = vm.envOr("WITNESS_ADDRESS", deployer);
        address orchestrator = vm.envOr("ZKP2P_ORCHESTRATOR", address(0xBEEF));

        vm.startBroadcast(deployerPrivateKey);

        MockUSDC usdc = new MockUSDC();
        PaymentVerifier verifier = new PaymentVerifier(witness);
        OffRampV3 offRamp = new OffRampV3(address(usdc), address(verifier));
        VenmoToSepaRouter router =
            new VenmoToSepaRouter(address(usdc), address(offRamp), orchestrator);

        // Seed the deployer with USDC for local testing.
        usdc.mint(deployer, 1_000_000e6);

        vm.stopBroadcast();

        console.log("USDC           ", address(usdc));
        console.log("PaymentVerifier", address(verifier));
        console.log("OffRampV3      ", address(offRamp));
        console.log("Router         ", address(router));
        console.log("Witness        ", witness);
        console.log("ChainId        ", block.chainid);
    }
}
