// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { PaymentVerifier } from "./PaymentVerifier.sol";

/// @title OffRampV3
/// @notice Permissionless off-ramp contract with zkTLS payment verification
/// @dev V3 removes authorized solver requirement - anyone can fulfill with valid proof
contract OffRampV3 is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    /// @notice Supported fiat currencies
    enum Currency {
        EUR, // Euro
        GBP, // British Pound
        USD, // US Dollar
        BRL, // Brazilian Real
        INR // Indian Rupee
    }

    /// @notice Supported Real-Time Payment Networks
    enum RTPN {
        SEPA_INSTANT, // EUR - Europe (~10 seconds)
        SEPA_STANDARD, // EUR - Europe (~1 day)
        FPS, // GBP - UK Faster Payments (~seconds)
        BACS, // GBP - UK (~3 days)
        PIX, // BRL - Brazil (~seconds)
        TED, // BRL - Brazil (~same day)
        UPI, // INR - India (~seconds)
        IMPS, // INR - India (~seconds)
        FEDNOW, // USD - US (~seconds)
        ACH // USD - US (~1-3 days)
    }

    /// @notice Intent lifecycle states
    enum IntentStatus {
        NONE, // Default/non-existent
        PENDING_QUOTE, // User requested quotes, awaiting selection
        COMMITTED, // User committed funds to a specific quote
        FULFILLED, // Solver completed the transfer (verified via zkTLS)
        CANCELLED, // User cancelled (after timeout)
        EXPIRED // Quote/commitment expired
    }

    // ============ Constants ============

    /// @notice Time window for solvers to submit quotes (5 minutes)
    uint64 public constant QUOTE_WINDOW = 5 minutes;

    /// @notice Time window for user to select a quote (10 minutes after quotes)
    uint64 public constant SELECTION_WINDOW = 10 minutes;

    /// @notice Time window for solver to fulfill after commitment (30 minutes)
    uint64 public constant FULFILLMENT_WINDOW = 30 minutes;

    // ============ Immutables ============

    IERC20 public immutable usdc;
    PaymentVerifier public immutable verifier;

    // ============ Structs ============

    /// @notice A quote from a solver
    struct Quote {
        address solver;
        RTPN rtpn; // Which payment network
        uint256 fiatAmount; // Amount user will receive (2 decimals)
        uint256 fee; // Solver's fee in USDC (6 decimals)
        uint64 estimatedTime; // Estimated delivery time in seconds
        uint64 expiresAt; // When this quote expires
        bool selected; // Whether user selected this quote
    }

    /// @notice An off-ramp intent
    struct Intent {
        address depositor;
        uint256 usdcAmount; // USDC to off-ramp (6 decimals)
        Currency currency; // Target fiat currency
        IntentStatus status;
        uint64 createdAt;
        uint64 committedAt; // When user committed to a quote
        // Filled after quote selection:
        address selectedSolver;
        RTPN selectedRtpn;
        uint256 selectedFiatAmount;
        string receivingInfo; // IBAN, sort code, PIX key, etc.
        string recipientName; // Required by most networks
        bytes32 transferId; // Fiat transfer ID (for verification)
    }

    /// @notice Solver info struct
    struct SolverInfo {
        string name;
        uint256 totalFulfilled; // Number of successful fulfillments
        uint256 totalVolume; // Total USDC volume processed
        uint64 avgFulfillmentTime; // Average time to fulfill (seconds)
        bool active;
    }

    // ============ State ============

    /// @notice Intent storage
    mapping(bytes32 => Intent) public intents;

    /// @notice Quotes per intent: intentId => solver => rtpn => Quote
    mapping(bytes32 => mapping(address => mapping(RTPN => Quote))) public quotes;

    /// @notice List of (solver, rtpn) pairs who quoted per intent
    mapping(bytes32 => QuoteKey[]) public intentQuotes;

    /// @notice Solver metadata (optional registration for reputation)
    mapping(address => SolverInfo) public solverInfo;

    /// @notice Which RTPNs each solver supports (optional)
    mapping(address => mapping(RTPN => bool)) public solverSupportsRtpn;

    /// @notice Used transfer IDs (replay protection)
    mapping(bytes32 => bool) public usedTransferIds;

    /// @notice Intent counter
    uint256 public intentCount;

    /// @notice Helper struct for tracking quotes
    struct QuoteKey {
        address solver;
        RTPN rtpn;
    }

    // ============ Events ============

    event IntentCreated(
        bytes32 indexed intentId, address indexed depositor, uint256 usdcAmount, Currency currency
    );

    event QuoteSubmitted(
        bytes32 indexed intentId,
        address indexed solver,
        RTPN rtpn,
        uint256 fiatAmount,
        uint256 fee,
        uint64 estimatedTime,
        uint64 expiresAt
    );

    event QuoteSelected(
        bytes32 indexed intentId,
        address indexed solver,
        RTPN rtpn,
        uint256 fiatAmount,
        string receivingInfo,
        string recipientName
    );

    event IntentFulfilled(
        bytes32 indexed intentId,
        address indexed solver,
        bytes32 transferId,
        uint256 fiatSent,
        bool verifiedByZkTLS
    );

    event IntentCancelled(bytes32 indexed intentId);

    event SolverRegistered(address indexed solver, string name);
    event SolverRtpnUpdated(address indexed solver, RTPN rtpn, bool supported);

    // ============ Errors ============

    error InvalidAmount();
    error InvalidReceivingInfo();
    error InvalidRecipientName();
    error IntentNotFound();
    error InvalidIntentStatus();
    error NotDepositor();
    error NotSelectedSolver();
    error SolverDoesNotSupportRtpn();
    error RtpnDoesNotSupportCurrency();
    error QuoteExpired();
    error QuoteNotFound();
    error QuoteWindowClosed();
    error SelectionWindowClosed();
    error FulfillmentWindowExpired();
    error TransferIdAlreadyUsed();
    error CannotCancelYet();
    error AlreadyQuoted();
    error PaymentVerificationFailed();
    error AmountMismatch();

    // ============ Constructor ============

    constructor(address _usdc, address _verifier) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        verifier = PaymentVerifier(_verifier);
    }

    // ============ User Functions ============

    /// @notice Creates a new off-ramp intent
    /// @param usdcAmount Amount of USDC to off-ramp
    /// @param currency Target fiat currency
    /// @return intentId Unique identifier for this intent
    function createIntent(uint256 usdcAmount, Currency currency)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 intentId)
    {
        if (usdcAmount == 0) revert InvalidAmount();

        intentId = keccak256(
            abi.encodePacked(msg.sender, usdcAmount, currency, block.timestamp, intentCount++)
        );

        intents[intentId] = Intent({
            depositor: msg.sender,
            usdcAmount: usdcAmount,
            currency: currency,
            status: IntentStatus.PENDING_QUOTE,
            createdAt: uint64(block.timestamp),
            committedAt: 0,
            selectedSolver: address(0),
            selectedRtpn: RTPN.SEPA_INSTANT, // default, will be set on selection
            selectedFiatAmount: 0,
            receivingInfo: "",
            recipientName: "",
            transferId: bytes32(0)
        });

        emit IntentCreated(intentId, msg.sender, usdcAmount, currency);
    }

    /// @notice Selects a quote and commits USDC
    /// @param intentId The intent to commit
    /// @param solver The solver whose quote to accept
    /// @param rtpn The RTPN route to use
    /// @param receivingInfo Network-specific receiving info (IBAN, etc.)
    /// @param recipientName Recipient name
    function selectQuoteAndCommit(
        bytes32 intentId,
        address solver,
        RTPN rtpn,
        string calldata receivingInfo,
        string calldata recipientName
    ) external nonReentrant whenNotPaused {
        Intent storage intent = intents[intentId];

        if (intent.depositor == address(0)) revert IntentNotFound();
        if (intent.depositor != msg.sender) revert NotDepositor();
        if (intent.status != IntentStatus.PENDING_QUOTE) revert InvalidIntentStatus();

        // Validate receiving info
        if (bytes(receivingInfo).length == 0 || bytes(receivingInfo).length > 256) {
            revert InvalidReceivingInfo();
        }
        if (bytes(recipientName).length == 0 || bytes(recipientName).length > 70) {
            revert InvalidRecipientName();
        }

        // Check selection window
        if (block.timestamp > intent.createdAt + QUOTE_WINDOW + SELECTION_WINDOW) {
            revert SelectionWindowClosed();
        }

        Quote storage quote = quotes[intentId][solver][rtpn];
        if (quote.solver == address(0)) revert QuoteNotFound();
        if (block.timestamp > quote.expiresAt) revert QuoteExpired();

        // Mark quote as selected
        quote.selected = true;

        // Update intent
        intent.status = IntentStatus.COMMITTED;
        intent.committedAt = uint64(block.timestamp);
        intent.selectedSolver = solver;
        intent.selectedRtpn = rtpn;
        intent.selectedFiatAmount = quote.fiatAmount;
        intent.receivingInfo = receivingInfo;
        intent.recipientName = recipientName;

        // NOW transfer USDC from user to contract
        usdc.safeTransferFrom(msg.sender, address(this), intent.usdcAmount);

        emit QuoteSelected(intentId, solver, rtpn, quote.fiatAmount, receivingInfo, recipientName);
    }

    /// @notice Cancels an intent and returns USDC (if committed)
    /// @param intentId The intent to cancel
    function cancelIntent(bytes32 intentId) external nonReentrant {
        Intent storage intent = intents[intentId];

        if (intent.depositor != msg.sender) revert NotDepositor();

        if (intent.status == IntentStatus.PENDING_QUOTE) {
            if (block.timestamp <= intent.createdAt + QUOTE_WINDOW + SELECTION_WINDOW) {
                revert CannotCancelYet();
            }
            intent.status = IntentStatus.EXPIRED;
        } else if (intent.status == IntentStatus.COMMITTED) {
            if (block.timestamp <= intent.committedAt + FULFILLMENT_WINDOW) {
                revert CannotCancelYet();
            }
            intent.status = IntentStatus.CANCELLED;
            usdc.safeTransfer(msg.sender, intent.usdcAmount);
        } else {
            revert InvalidIntentStatus();
        }

        emit IntentCancelled(intentId);
    }

    // ============ Solver Functions ============

    /// @notice Submits a quote for an intent (permissionless)
    /// @param intentId The intent to quote
    /// @param rtpn The RTPN route being quoted
    /// @param fiatAmount Amount of fiat user will receive
    /// @param fee Solver's fee in USDC
    /// @param estimatedTime Estimated delivery time in seconds
    function submitQuote(
        bytes32 intentId,
        RTPN rtpn,
        uint256 fiatAmount,
        uint256 fee,
        uint64 estimatedTime
    ) external whenNotPaused {
        Intent storage intent = intents[intentId];
        if (intent.depositor == address(0)) revert IntentNotFound();
        if (intent.status != IntentStatus.PENDING_QUOTE) revert InvalidIntentStatus();

        // Validate RTPN supports the requested currency
        if (!_rtpnSupportsCurrency(rtpn, intent.currency)) revert RtpnDoesNotSupportCurrency();

        // Check quote window
        if (block.timestamp > intent.createdAt + QUOTE_WINDOW) revert QuoteWindowClosed();

        // Check if already quoted this RTPN
        if (quotes[intentId][msg.sender][rtpn].solver != address(0)) revert AlreadyQuoted();

        uint64 expiresAt = uint64(block.timestamp) + QUOTE_WINDOW + SELECTION_WINDOW;

        quotes[intentId][msg.sender][rtpn] = Quote({
            solver: msg.sender,
            rtpn: rtpn,
            fiatAmount: fiatAmount,
            fee: fee,
            estimatedTime: estimatedTime,
            expiresAt: expiresAt,
            selected: false
        });

        intentQuotes[intentId].push(QuoteKey({ solver: msg.sender, rtpn: rtpn }));

        emit QuoteSubmitted(intentId, msg.sender, rtpn, fiatAmount, fee, estimatedTime, expiresAt);
    }

    /// @notice Fulfills an intent with zkTLS payment proof
    /// @param intentId The intent to fulfill
    /// @param attestation The payment attestation from zkTLS verification
    /// @param signature The EIP-712 signature from the attestation service
    function fulfillIntentWithProof(
        bytes32 intentId,
        PaymentVerifier.PaymentAttestation calldata attestation,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        Intent storage intent = intents[intentId];

        if (intent.depositor == address(0)) revert IntentNotFound();
        if (intent.status != IntentStatus.COMMITTED) revert InvalidIntentStatus();
        if (intent.selectedSolver != msg.sender) revert NotSelectedSolver();
        if (block.timestamp > intent.committedAt + FULFILLMENT_WINDOW) {
            revert FulfillmentWindowExpired();
        }

        // Verify the attestation matches this intent
        if (attestation.intentHash != intentId) revert PaymentVerificationFailed();

        // Verify the amount matches (allow small tolerance for rounding)
        // attestation.amount is in cents, selectedFiatAmount is in cents (2 decimals)
        if (attestation.amount < intent.selectedFiatAmount * 99 / 100) revert AmountMismatch();

        // Verify the payment proof via the verifier contract
        (bool valid,) = verifier.verifyPayment(attestation, signature);
        if (!valid) revert PaymentVerificationFailed();

        // Convert paymentId to transferId
        bytes32 transferId = keccak256(bytes(attestation.paymentId));
        if (usedTransferIds[transferId]) revert TransferIdAlreadyUsed();

        intent.status = IntentStatus.FULFILLED;
        intent.transferId = transferId;
        usedTransferIds[transferId] = true;

        // Transfer USDC to the solver
        usdc.safeTransfer(msg.sender, intent.usdcAmount);

        // Update solver stats
        SolverInfo storage info = solverInfo[msg.sender];
        info.totalFulfilled++;
        info.totalVolume += intent.usdcAmount;

        emit IntentFulfilled(intentId, msg.sender, transferId, attestation.amount, true);
    }

    // ============ View Functions ============

    /// @notice Gets all quote keys for an intent
    function getIntentQuotes(bytes32 intentId) external view returns (QuoteKey[] memory) {
        return intentQuotes[intentId];
    }

    /// @notice Gets a specific quote
    function getQuote(bytes32 intentId, address solver, RTPN rtpn)
        external
        view
        returns (Quote memory)
    {
        return quotes[intentId][solver][rtpn];
    }

    /// @notice Gets full intent data
    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }

    /// @notice Checks if an intent can be fulfilled
    function canFulfill(bytes32 intentId) external view returns (bool) {
        Intent storage intent = intents[intentId];
        return intent.status == IntentStatus.COMMITTED
            && block.timestamp <= intent.committedAt + FULFILLMENT_WINDOW;
    }

    /// @notice Gets the current status and time remaining
    function getIntentTiming(bytes32 intentId)
        external
        view
        returns (IntentStatus status, uint256 timeRemaining)
    {
        Intent storage intent = intents[intentId];
        status = intent.status;

        if (status == IntentStatus.PENDING_QUOTE) {
            uint64 deadline = intent.createdAt + QUOTE_WINDOW + SELECTION_WINDOW;
            timeRemaining = block.timestamp < deadline ? deadline - block.timestamp : 0;
        } else if (status == IntentStatus.COMMITTED) {
            uint64 deadline = intent.committedAt + FULFILLMENT_WINDOW;
            timeRemaining = block.timestamp < deadline ? deadline - block.timestamp : 0;
        }
    }

    /// @notice Check if RTPN supports currency
    function rtpnSupportsCurrency(RTPN rtpn, Currency currency) external pure returns (bool) {
        return _rtpnSupportsCurrency(rtpn, currency);
    }

    // ============ Internal Functions ============

    function _rtpnSupportsCurrency(RTPN rtpn, Currency currency) internal pure returns (bool) {
        if (currency == Currency.EUR) {
            return rtpn == RTPN.SEPA_INSTANT || rtpn == RTPN.SEPA_STANDARD;
        } else if (currency == Currency.GBP) {
            return rtpn == RTPN.FPS || rtpn == RTPN.BACS;
        } else if (currency == Currency.USD) {
            return rtpn == RTPN.FEDNOW || rtpn == RTPN.ACH;
        } else if (currency == Currency.BRL) {
            return rtpn == RTPN.PIX || rtpn == RTPN.TED;
        } else if (currency == Currency.INR) {
            return rtpn == RTPN.UPI || rtpn == RTPN.IMPS;
        }
        return false;
    }

    // ============ Admin Functions ============

    /// @notice Registers solver info (optional, for reputation)
    function registerSolver(string calldata name) external {
        solverInfo[msg.sender] = SolverInfo({
            name: name, totalFulfilled: 0, totalVolume: 0, avgFulfillmentTime: 0, active: true
        });
        emit SolverRegistered(msg.sender, name);
    }

    /// @notice Sets which RTPNs a solver supports (optional, for filtering)
    function setSolverRtpn(RTPN rtpn, bool supported) external {
        solverSupportsRtpn[msg.sender][rtpn] = supported;
        emit SolverRtpnUpdated(msg.sender, rtpn, supported);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}

