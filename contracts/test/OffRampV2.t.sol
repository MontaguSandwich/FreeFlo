// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console } from "forge-std/Test.sol";
import { OffRampV2 } from "../src/OffRampV2.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mock USDC token for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract OffRampV2Test is Test {
    OffRampV2 public offRamp;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");
    address public solver = makeAddr("solver");

    uint256 constant USDC_AMOUNT = 100 * 1e6; // 100 USDC

    event IntentCreated(
        bytes32 indexed intentId,
        address indexed depositor,
        uint256 usdcAmount,
        OffRampV2.Currency currency
    );

    event QuoteSubmitted(
        bytes32 indexed intentId,
        address indexed solver,
        OffRampV2.RTPN rtpn,
        uint256 fiatAmount,
        uint256 fee,
        uint64 estimatedTime,
        uint64 expiresAt
    );

    event QuoteSelected(
        bytes32 indexed intentId,
        address indexed solver,
        OffRampV2.RTPN rtpn,
        uint256 fiatAmount,
        string receivingInfo,
        string recipientName
    );

    event IntentFulfilled(
        bytes32 indexed intentId, address indexed solver, bytes32 transferId, uint256 fiatSent
    );

    function setUp() public {
        vm.startPrank(owner);

        // Deploy mock USDC
        usdc = new MockUSDC();

        // Deploy off-ramp contract
        offRamp = new OffRampV2(address(usdc));

        // Register and authorize solver
        offRamp.registerSolver(solver, "TestSolver");
        offRamp.setSolverRtpn(solver, OffRampV2.RTPN.SEPA_INSTANT, true);
        offRamp.setSolverRtpn(solver, OffRampV2.RTPN.SEPA_STANDARD, true);

        vm.stopPrank();

        // Give user some USDC
        usdc.mint(user, USDC_AMOUNT * 10);

        // Approve off-ramp to spend user's USDC
        vm.prank(user);
        usdc.approve(address(offRamp), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(address(offRamp.usdc()), address(usdc));
        assertEq(offRamp.owner(), owner);
    }

    // ============ createIntent Tests ============

    function test_createIntent_success() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        OffRampV2.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(intent.depositor, user);
        assertEq(intent.usdcAmount, USDC_AMOUNT);
        assertEq(uint8(intent.currency), uint8(OffRampV2.Currency.EUR));
        assertEq(uint8(intent.status), uint8(OffRampV2.IntentStatus.PENDING_QUOTE));

        // USDC should NOT be transferred yet
        assertEq(usdc.balanceOf(address(offRamp)), 0);
    }

    function test_createIntent_revert_invalidAmount() public {
        vm.prank(user);
        vm.expectRevert(OffRampV2.InvalidAmount.selector);
        offRamp.createIntent(0, OffRampV2.Currency.EUR);
    }

    function test_createIntent_revert_whenPaused() public {
        vm.prank(owner);
        offRamp.pause();

        vm.prank(user);
        vm.expectRevert();
        offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);
    }

    // ============ submitQuote Tests ============

    function test_submitQuote_success() public {
        // Create intent
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Submit quote
        vm.prank(solver);
        offRamp.submitQuote(
            intentId,
            OffRampV2.RTPN.SEPA_INSTANT,
            9200, // €92.00
            500000, // 0.5 USDC fee
            10 // 10 seconds
        );

        OffRampV2.Quote memory quote =
            offRamp.getQuote(intentId, solver, OffRampV2.RTPN.SEPA_INSTANT);
        assertEq(quote.solver, solver);
        assertEq(quote.fiatAmount, 9200);
        assertEq(quote.fee, 500000);
        assertFalse(quote.selected);
    }

    function test_submitQuote_revert_notAuthorized() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        address randomSolver = makeAddr("random");
        vm.prank(randomSolver);
        vm.expectRevert(OffRampV2.NotAuthorizedSolver.selector);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);
    }

    function test_submitQuote_revert_wrongCurrency() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Try to submit FPS quote for EUR intent
        vm.prank(owner);
        offRamp.setSolverRtpn(solver, OffRampV2.RTPN.FPS, true);

        vm.prank(solver);
        vm.expectRevert(OffRampV2.RtpnDoesNotSupportCurrency.selector);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.FPS, 7900, 500000, 10);
    }

    // ============ selectQuoteAndCommit Tests ============

    function test_selectQuoteAndCommit_success() public {
        // Create intent
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Submit quote
        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        // Select quote
        vm.prank(user);
        offRamp.selectQuoteAndCommit(
            intentId, solver, OffRampV2.RTPN.SEPA_INSTANT, "FR7630006000011234567890189", "John Doe"
        );

        OffRampV2.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(uint8(intent.status), uint8(OffRampV2.IntentStatus.COMMITTED));
        assertEq(intent.selectedSolver, solver);

        // USDC should now be in contract
        assertEq(usdc.balanceOf(address(offRamp)), USDC_AMOUNT);
    }

    function test_selectQuoteAndCommit_revert_notDepositor() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        vm.prank(solver); // Wrong person
        vm.expectRevert(OffRampV2.NotDepositor.selector);
        offRamp.selectQuoteAndCommit(
            intentId,
            solver,
            OffRampV2.RTPN.SEPA_INSTANT,
            "FR7630006000011234567890189",
            "John Doe"
        );
    }

    // ============ fulfillIntent Tests ============

    function test_fulfillIntent_success() public {
        // Create intent
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Submit quote
        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        // Select quote
        vm.prank(user);
        offRamp.selectQuoteAndCommit(
            intentId,
            solver,
            OffRampV2.RTPN.SEPA_INSTANT,
            "FR7630006000011234567890189",
            "John Doe"
        );

        // Fulfill
        bytes32 transferId = keccak256("transfer-123");
        uint256 solverBalanceBefore = usdc.balanceOf(solver);

        vm.prank(solver);
        offRamp.fulfillIntent(intentId, transferId, 9200);

        OffRampV2.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(uint8(intent.status), uint8(OffRampV2.IntentStatus.FULFILLED));
        assertEq(usdc.balanceOf(solver), solverBalanceBefore + USDC_AMOUNT);
    }

    function test_fulfillIntent_revert_wrongSolver() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        vm.prank(user);
        offRamp.selectQuoteAndCommit(
            intentId,
            solver,
            OffRampV2.RTPN.SEPA_INSTANT,
            "FR7630006000011234567890189",
            "John Doe"
        );

        // Try to fulfill as different solver
        address otherSolver = makeAddr("other");
        vm.prank(owner);
        offRamp.registerSolver(otherSolver, "OtherSolver");

        vm.prank(otherSolver);
        vm.expectRevert(OffRampV2.NotAuthorizedSolver.selector);
        offRamp.fulfillIntent(intentId, keccak256("transfer"), 9200);
    }

    // ============ cancelIntent Tests ============

    function test_cancelIntent_pendingQuote() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Warp past quote + selection window
        vm.warp(block.timestamp + 16 minutes);

        vm.prank(user);
        offRamp.cancelIntent(intentId);

        OffRampV2.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(uint8(intent.status), uint8(OffRampV2.IntentStatus.EXPIRED));
    }

    function test_cancelIntent_committed() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        vm.prank(user);
        offRamp.selectQuoteAndCommit(
            intentId,
            solver,
            OffRampV2.RTPN.SEPA_INSTANT,
            "FR7630006000011234567890189",
            "John Doe"
        );

        // Warp past fulfillment window
        vm.warp(block.timestamp + 31 minutes);

        uint256 userBalanceBefore = usdc.balanceOf(user);

        vm.prank(user);
        offRamp.cancelIntent(intentId);

        OffRampV2.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(uint8(intent.status), uint8(OffRampV2.IntentStatus.CANCELLED));
        assertEq(usdc.balanceOf(user), userBalanceBefore + USDC_AMOUNT);
    }

    // ============ Admin Tests ============

    function test_registerSolver() public {
        address newSolver = makeAddr("newSolver");

        vm.prank(owner);
        offRamp.registerSolver(newSolver, "NewSolver");

        assertTrue(offRamp.authorizedSolvers(newSolver));
    }

    function test_removeSolver() public {
        vm.prank(owner);
        offRamp.removeSolver(solver);

        assertFalse(offRamp.authorizedSolvers(solver));
    }

    function test_pause_unpause() public {
        vm.startPrank(owner);

        offRamp.pause();
        assertTrue(offRamp.paused());

        offRamp.unpause();
        assertFalse(offRamp.paused());

        vm.stopPrank();
    }

    // ============ View Function Tests ============

    function test_canFulfill() public {
        vm.prank(user);
        bytes32 intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV2.Currency.EUR);

        // Not fulfillable before commitment
        assertFalse(offRamp.canFulfill(intentId));

        vm.prank(solver);
        offRamp.submitQuote(intentId, OffRampV2.RTPN.SEPA_INSTANT, 9200, 500000, 10);

        vm.prank(user);
        offRamp.selectQuoteAndCommit(
            intentId,
            solver,
            OffRampV2.RTPN.SEPA_INSTANT,
            "FR7630006000011234567890189",
            "John Doe"
        );

        // Now fulfillable
        assertTrue(offRamp.canFulfill(intentId));

        // Warp past window
        vm.warp(block.timestamp + 31 minutes);
        assertFalse(offRamp.canFulfill(intentId));
    }

    function test_rtpnSupportsCurrency() public view {
        // EUR
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.SEPA_INSTANT, OffRampV2.Currency.EUR));
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.SEPA_STANDARD, OffRampV2.Currency.EUR));
        assertFalse(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.FPS, OffRampV2.Currency.EUR));

        // GBP
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.FPS, OffRampV2.Currency.GBP));
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.BACS, OffRampV2.Currency.GBP));

        // USD
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.FEDNOW, OffRampV2.Currency.USD));
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.ACH, OffRampV2.Currency.USD));

        // BRL
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.PIX, OffRampV2.Currency.BRL));
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.TED, OffRampV2.Currency.BRL));

        // INR
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.UPI, OffRampV2.Currency.INR));
        assertTrue(offRamp.rtpnSupportsCurrency(OffRampV2.RTPN.IMPS, OffRampV2.Currency.INR));
    }
}




