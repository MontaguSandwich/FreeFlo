// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPostIntentHook
 * @notice Interface for ZKP2P post-intent hooks
 * @dev Hooks receive USDC approval from ZKP2P Orchestrator and must pull exact amount
 */
interface IPostIntentHook {
    /**
     * @notice Called by ZKP2P Orchestrator after intent fulfillment
     * @param _intent The ZKP2P intent data (we only need `to` field for user address)
     * @param _amountNetFees USDC amount after ZKP2P fees (must pull exactly this amount)
     * @param _fulfillIntentData Custom data encoded by user (IBAN, recipientName, minEurAmount)
     */
    function execute(
        Intent calldata _intent,
        uint256 _amountNetFees,
        bytes calldata _fulfillIntentData
    ) external;

    /**
     * @notice ZKP2P Intent struct (simplified - only fields we need)
     */
    struct Intent {
        bytes32 intentHash;
        address onRamper;
        uint256 deposit;
        uint256 amount;
        uint256 timestamp;
        address to;  // The recipient - this is our user
        // Note: Full ZKP2P Intent has more fields, but we only need these
        // The Orchestrator passes the full struct, Solidity will ignore extra fields
    }
}
