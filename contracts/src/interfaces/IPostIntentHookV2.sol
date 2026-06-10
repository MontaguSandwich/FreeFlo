// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPostIntentHookV2
 * @notice Interface for ZKP2P V3 post-intent hooks (permissionless)
 * @dev Hooks receive USDC after ZKP2P intent fulfillment via the new V2 execution context
 */
interface IPostIntentHookV2 {
    /**
     * @notice Context about the original intent
     */
    struct HookIntentContext {
        address owner;           // Deposit owner
        address to;              // Recipient address (the user)
        address escrow;          // Escrow contract address
        uint256 depositId;       // Deposit ID used
        uint256 amount;          // Original intent amount
        uint256 timestamp;       // Intent creation timestamp
        bytes32 paymentMethod;   // Payment method hash
        bytes32 fiatCurrency;    // Fiat currency hash
        uint256 conversionRate;  // Conversion rate (18 decimals)
        bytes32 payeeId;         // Payee details hash
        bytes signalHookData;    // Data passed during signalIntent (our payload!)
    }

    /**
     * @notice Full execution context passed to the hook
     */
    struct HookExecutionContext {
        bytes32 intentHash;              // Intent identifier
        address token;                   // Token address (USDC)
        uint256 executableAmount;        // Amount after fees
        HookIntentContext intent;        // Intent context
    }

    /**
     * @notice Called by ZKP2P OrchestratorV2 after intent fulfillment
     * @param _ctx Execution context with intent details and amounts
     * @param _fulfillHookData Additional data passed during fulfillIntent (optional)
     */
    function execute(
        HookExecutionContext calldata _ctx,
        bytes calldata _fulfillHookData
    ) external;
}
