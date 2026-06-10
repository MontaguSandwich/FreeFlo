// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IPostIntentHookV2 } from "./interfaces/IPostIntentHookV2.sol";
import { OffRampV3 } from "./OffRampV3.sol";

/**
 * @title VenmoToSepaRouter
 * @notice Routes USDC from ZKP2P V3 onramp to FreeFlo offramp for Venmo->SEPA transfers
 * @dev Implements ZKP2P's IPostIntentHookV2 interface (permissionless in V3)
 *
 * Flow:
 * 1. User calls ZKP2P signalIntent with this contract as postIntentHook and SEPA details in data
 * 2. User completes Venmo payment and proves via ZKP2P
 * 3. ZKP2P fulfillIntent triggers execute() on this contract
 * 4. Router pulls USDC, creates FreeFlo intent, stores pending transfer
 * 5. User calls commit() to select solver quote and commit to SEPA transfer
 * 6. FreeFlo solver fulfills, EUR arrives in user's bank
 */
contract VenmoToSepaRouter is IPostIntentHookV2, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

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
     * @notice A pending Venmo->SEPA transfer
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
     * @notice Payload encoded by user in signalIntent data field
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
        bytes32 indexed zkp2pIntentHash,
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
    error TokenMismatch();

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

    // ============ ZKP2P V3 Hook (Entry Point) ============

    /**
     * @notice Called by ZKP2P OrchestratorV2 after intent fulfillment
     * @dev Implements IPostIntentHookV2.execute
     * @param _ctx Execution context containing intent details and token amount
     * @param _fulfillHookData Additional data from fulfillIntent (unused, payload is in signalHookData)
     */
    function execute(
        HookExecutionContext calldata _ctx,
        bytes calldata _fulfillHookData
    ) external override nonReentrant {
        // Silence unused parameter warning
        _fulfillHookData;

        // Only ZKP2P Orchestrator can call this
        if (msg.sender != zkp2pOrchestrator) revert OnlyZKP2POrchestrator();

        // Verify token is USDC
        if (_ctx.token != address(usdc)) revert TokenMismatch();

        // Get user address from intent context
        address user = _ctx.intent.to;

        // Block a new transfer while the user has an active one. Allowing a second
        // onramp during PENDING *or* COMMITTED would overwrite the single slot and
        // orphan the first intent, stranding its USDC.
        TransferStatus existing = pendingTransfers[user].status;
        if (existing == TransferStatus.PENDING || existing == TransferStatus.COMMITTED) {
            revert UserAlreadyHasPendingTransfer();
        }

        // Decode payload from signalHookData (passed during signalIntent)
        HookPayload memory payload = _decodePayload(_ctx.intent.signalHookData);

        // Validate payload, including the same length bounds OffRampV3 enforces
        // (receivingInfo <= 256, recipientName <= 70). Checking here fails fast
        // instead of trapping USDC until commit() later reverts.
        if (bytes(payload.iban).length == 0 || bytes(payload.iban).length > 256) {
            revert InvalidPayload();
        }
        if (bytes(payload.recipientName).length == 0 || bytes(payload.recipientName).length > 70) {
            revert InvalidPayload();
        }

        // Pull USDC from Orchestrator (we have approval)
        uint256 amount = _ctx.executableAmount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Approve OffRampV3 to pull USDC for intent creation
        usdc.forceApprove(address(offRamp), amount);

        // Create FreeFlo intent (Router is depositor)
        bytes32 freefloIntentId = offRamp.createIntent(
            amount,
            OffRampV3.Currency.EUR
        );

        // Reset approval
        usdc.forceApprove(address(offRamp), 0);

        // Store pending transfer
        pendingTransfers[user] = PendingTransfer({
            user: user,
            intentId: freefloIntentId,
            usdcAmount: amount,
            iban: payload.iban,
            recipientName: payload.recipientName,
            minEurAmount: payload.minEurAmount,
            createdAt: block.timestamp,
            status: TransferStatus.PENDING
        });

        emit TransferInitiated(
            user,
            freefloIntentId,
            _ctx.intentHash,
            amount,
            payload.iban,
            payload.recipientName,
            payload.minEurAmount
        );
    }

    // ============ User Functions ============

    /**
     * @notice Commit to a solver's quote and initiate the SEPA transfer.
     * @param solver The solver whose on-chain quote to accept.
     * @dev Slippage is enforced against the REAL on-chain quote, not a
     *      caller-supplied number — a solver cannot quote a low figure on-chain
     *      while the user "commits" to a fabricated higher one.
     */
    function commit(address solver) external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[msg.sender];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.PENDING) revert TransferNotPending();

        // Read the real on-chain quote and enforce slippage against it.
        uint256 realEurAmount =
            offRamp.getQuote(transfer.intentId, solver, OffRampV3.RTPN.SEPA_INSTANT).fiatAmount;
        if (realEurAmount < transfer.minEurAmount) {
            revert SlippageExceeded(realEurAmount, transfer.minEurAmount);
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

        emit TransferCommitted(msg.sender, transfer.intentId, solver, realEurAmount);
    }

    /**
     * @notice Cancel pending transfer and reclaim USDC
     * @dev Can only cancel if still in PENDING status
     */
    function cancel() external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[msg.sender];

        // Validate state
        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.PENDING) revert TransferNotPending();

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
     * @notice Rescue a committed transfer whose solver never fulfilled (permissionless).
     * @dev After OffRampV3's fulfillment window, cancels the intent (returning USDC
     *      to this router as depositor) and forwards it to the user. cancelIntent's
     *      own CannotCancelYet enforces the timeout.
     * @param user The user whose committed transfer to rescue
     */
    function rescueCommitted(address user) external nonReentrant {
        PendingTransfer storage transfer = pendingTransfers[user];

        if (transfer.user == address(0)) revert NoPendingTransfer();
        if (transfer.status != TransferStatus.COMMITTED) revert TransferNotCommitted();

        uint256 amount = transfer.usdcAmount;
        bytes32 intentId = transfer.intentId;

        // Mark expired before external calls (reentrancy hygiene).
        transfer.status = TransferStatus.EXPIRED;

        // Reclaim USDC from OffRampV3 (reverts CannotCancelYet until the window passes).
        offRamp.cancelIntent(intentId);

        // Forward the reclaimed USDC to the user.
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
     * @notice Check if user can commit (has pending transfer and within timeout)
     */
    function canCommit(address user) external view returns (bool) {
        PendingTransfer storage transfer = pendingTransfers[user];
        if (transfer.status != TransferStatus.PENDING) return false;
        if (block.timestamp > transfer.createdAt + COMMIT_TIMEOUT) return false;
        return true;
    }

    /**
     * @notice Encode payload for signalIntent data field
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
