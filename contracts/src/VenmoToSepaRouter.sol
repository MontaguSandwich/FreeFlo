// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OffRampV3 } from "./OffRampV3.sol";

/**
 * @title VenmoToSepaRouter
 * @notice Routes USDC from ZKP2P onramp to FreeFlo offramp for Venmo→SEPA transfers
 * @dev Implements ZKP2P's IPostIntentHook interface to receive USDC after onramp
 *
 * Flow:
 * 1. User completes ZKP2P onramp (Venmo USD → USDC) with this contract as postIntentHook
 * 2. ZKP2P calls execute() with USDC approval
 * 3. Router pulls USDC, creates FreeFlo intent, stores pending transfer
 * 4. User calls commit() to select solver quote and commit to SEPA transfer
 * 5. FreeFlo solver fulfills, EUR arrives in user's bank
 */
contract VenmoToSepaRouter is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    /**
     * @notice ZKP2P Intent struct (must match ZKP2P's Orchestrator.Intent layout)
     * @dev Only fields we access are listed; extra fields at end are ignored by ABI decoder
     */
    struct ZKP2PIntent {
        bytes32 intentHash;
        address onRamper;
        uint256 deposit;
        uint256 amount;
        uint256 timestamp;
        address to;              // The recipient - this is our user
        address postIntentHook;  // This contract
        // Additional fields exist in ZKP2P but we don't need them
    }

    /**
     * @notice Status of a pending transfer
     */
    enum TransferStatus {
        NONE,       // No transfer exists
        PENDING,    // Awaiting user commit
        COMMITTED,  // User committed, awaiting solver fulfillment
        COMPLETED,  // Solver fulfilled, EUR sent
        CANCELLED,  // User cancelled, USDC returned
        EXPIRED     // Timed out, USDC returned
    }

    /**
     * @notice A pending Venmo→SEPA transfer
     */
    struct PendingTransfer {
        address user;           // User who initiated via ZKP2P
        bytes32 intentId;       // FreeFlo intent ID
        uint256 usdcAmount;     // USDC amount deposited
        string iban;            // Destination IBAN
        string recipientName;   // Recipient name for SEPA
        uint256 minEurAmount;   // Minimum acceptable EUR (slippage protection)
        uint256 createdAt;      // Block timestamp when created
        TransferStatus status;  // Current status
    }

    /**
     * @notice Payload encoded by user when calling ZKP2P fulfillIntent
     */
    struct HookPayload {
        string iban;
        string recipientName;
        uint256 minEurAmount;
    }

    // ============ Constants ============

    /// @notice Timeout for user to commit (30 minutes)
    uint256 public constant COMMIT_TIMEOUT = 30 minutes;

    // ============ Immutables ============

    IERC20 public immutable usdc;
    OffRampV3 public immutable offRamp;
    address public immutable zkp2pOrchestrator;

    // ============ State ============

    /// @notice Pending transfers by user (one per user)
    mapping(address => PendingTransfer) public pendingTransfers;

    // ============ Events ============

    event TransferInitiated(
        address indexed user,
        bytes32 indexed intentId,
        uint256 usdcAmount,
        string iban,
        string recipientName,
        uint256 minEurAmount
    );

    event TransferCommitted(
        address indexed user,
        bytes32 indexed intentId,
        address solver,
        uint256 eurAmount
    );

    event TransferCompleted(
        address indexed user,
        bytes32 indexed intentId
    );

    event TransferCancelled(
        address indexed user,
        bytes32 indexed intentId,
        uint256 usdcAmount
    );

    event TransferExpired(
        address indexed user,
        bytes32 indexed intentId,
        uint256 usdcAmount
    );

    // ============ Errors ============

    error OnlyZKP2POrchestrator();
    error UserAlreadyHasPendingTransfer();
    error NoPendingTransfer();
    error TransferNotPending();
    error TransferNotCommitted();
    error SlippageExceeded(uint256 quoted, uint256 minimum);
    error NotTimedOutYet();
    error InvalidPayload();

    // ============ Constructor ============

    constructor(
        address _usdc,
        address _offRamp,
        address _zkp2pOrchestrator
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        offRamp = OffRampV3(_offRamp);
        zkp2pOrchestrator = _zkp2pOrchestrator;
    }

    // ============ ZKP2P Hook (Entry Point) ============

    /**
     * @notice Called by ZKP2P Orchestrator after user completes onramp
     * @dev Implements IPostIntentHook.execute
     * @param _intent The ZKP2P intent data
     * @param _amountNetFees USDC amount after ZKP2P fees
     * @param _fulfillIntentData Encoded HookPayload (iban, recipientName, minEurAmount)
     */
    function execute(
        ZKP2PIntent calldata _intent,
        uint256 _amountNetFees,
        bytes calldata _fulfillIntentData
    ) external nonReentrant {
        // Only ZKP2P Orchestrator can call this
        if (msg.sender != zkp2pOrchestrator) revert OnlyZKP2POrchestrator();

        // Get user address from intent
        address user = _intent.to;

        // Check user doesn't have existing pending transfer
        if (pendingTransfers[user].status == TransferStatus.PENDING) {
            revert UserAlreadyHasPendingTransfer();
        }

        // Decode payload
        HookPayload memory payload = _decodePayload(_fulfillIntentData);

        // Validate payload
        if (bytes(payload.iban).length == 0 || bytes(payload.recipientName).length == 0) {
            revert InvalidPayload();
        }

        // Pull USDC from Orchestrator (we have approval)
        usdc.safeTransferFrom(msg.sender, address(this), _amountNetFees);

        // Create FreeFlo intent (Router is depositor)
        bytes32 freefloIntentId = offRamp.createIntent(
            _amountNetFees,
            OffRampV3.Currency.EUR
        );

        // Store pending transfer
        pendingTransfers[user] = PendingTransfer({
            user: user,
            intentId: freefloIntentId,
            usdcAmount: _amountNetFees,
            iban: payload.iban,
            recipientName: payload.recipientName,
            minEurAmount: payload.minEurAmount,
            createdAt: block.timestamp,
            status: TransferStatus.PENDING
        });

        emit TransferInitiated(
            user,
            freefloIntentId,
            _amountNetFees,
            payload.iban,
            payload.recipientName,
            payload.minEurAmount
        );
    }

    // ============ User Functions ============

    /**
     * @notice Commit to a solver's quote and initiate SEPA transfer
     * @param solver The solver address from the quote
     * @param quotedEurAmount EUR amount from solver's quote (for slippage check)
     */
    function commit(
        address solver,
        uint256 quotedEurAmount
    ) external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[msg.sender];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.PENDING) revert TransferNotPending();

        // Check slippage
        if (quotedEurAmount < transfer.minEurAmount) {
            revert SlippageExceeded(quotedEurAmount, transfer.minEurAmount);
        }

        // Approve OffRampV3 to pull USDC
        usdc.forceApprove(address(offRamp), transfer.usdcAmount);

        // Select quote and commit (Router is depositor, so we can call this)
        offRamp.selectQuoteAndCommit(
            transfer.intentId,
            solver,
            OffRampV3.RTPN.SEPA_INSTANT,
            transfer.iban,
            transfer.recipientName
        );

        // Reset approval
        usdc.forceApprove(address(offRamp), 0);

        // Update status
        transfer.status = TransferStatus.COMMITTED;

        emit TransferCommitted(
            msg.sender,
            transfer.intentId,
            solver,
            quotedEurAmount
        );
    }

    /**
     * @notice Cancel pending transfer and reclaim USDC
     * @dev Can only cancel if still in PENDING status and within FreeFlo's window
     */
    function cancel() external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[msg.sender];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.PENDING) revert TransferNotPending();

        // Note: We need to wait for FreeFlo's quote+selection window to expire
        // before we can cancel the intent. For now, we'll just return the USDC
        // directly since we haven't committed yet (USDC is still in Router).

        uint256 amount = transfer.usdcAmount;
        bytes32 intentId = transfer.intentId;

        // Update status
        transfer.status = TransferStatus.CANCELLED;

        // Return USDC to user
        usdc.safeTransfer(msg.sender, amount);

        emit TransferCancelled(msg.sender, intentId, amount);
    }

    /**
     * @notice Rescue timed-out transfer (permissionless)
     * @param user The user whose transfer timed out
     */
    function rescueTimedOut(address user) external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[user];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.PENDING) revert TransferNotPending();

        // Check timeout
        if (block.timestamp <= transfer.createdAt + COMMIT_TIMEOUT) {
            revert NotTimedOutYet();
        }

        uint256 amount = transfer.usdcAmount;
        bytes32 intentId = transfer.intentId;

        // Update status
        transfer.status = TransferStatus.EXPIRED;

        // Return USDC to user
        usdc.safeTransfer(user, amount);

        emit TransferExpired(user, intentId, amount);
    }

    /**
     * @notice Mark transfer as complete (call after solver fulfills)
     * @param user The user whose transfer completed
     */
    function markComplete(address user) external {
        PendingTransfer storage transfer = pendingTransfers[user];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.COMMITTED) revert TransferNotCommitted();

        // Verify intent is fulfilled on OffRampV3
        OffRampV3.Intent memory intent = offRamp.getIntent(transfer.intentId);
        if (intent.status != OffRampV3.IntentStatus.FULFILLED) {
            revert TransferNotCommitted(); // Reusing error - intent not fulfilled
        }

        // Update status
        transfer.status = TransferStatus.COMPLETED;

        emit TransferCompleted(user, transfer.intentId);
    }

    // ============ View Functions ============

    /**
     * @notice Get pending transfer for a user
     */
    function getPendingTransfer(address user) external view returns (PendingTransfer memory) {
        return pendingTransfers[user];
    }

    /**
     * @notice Check if user can commit (has pending transfer and quotes available)
     */
    function canCommit(address user) external view returns (bool) {
        PendingTransfer storage transfer = pendingTransfers[user];
        if (transfer.status != TransferStatus.PENDING) return false;
        if (block.timestamp > transfer.createdAt + COMMIT_TIMEOUT) return false;
        return true;
    }

    /**
     * @notice Encode payload for ZKP2P fulfillIntent call
     * @dev Helper for frontend to encode the hook data
     */
    function encodePayload(
        string calldata iban,
        string calldata recipientName,
        uint256 minEurAmount
    ) external pure returns (bytes memory) {
        return abi.encode(HookPayload({
            iban: iban,
            recipientName: recipientName,
            minEurAmount: minEurAmount
        }));
    }

    // ============ Internal Functions ============

    function _decodePayload(bytes calldata data) internal pure returns (HookPayload memory) {
        return abi.decode(data, (HookPayload));
    }

    // ============ Admin Functions ============

    /**
     * @notice Emergency withdraw stuck tokens
     */
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
