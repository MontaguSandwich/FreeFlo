// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { FiatToFiatRouter } from "../src/FiatToFiatRouter.sol";
import { IPostIntentHookV2 } from "../src/interfaces/IPostIntentHookV2.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";

// Mock USDC for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FiatToFiatRouterTest is Test {
    MockUSDC public usdc;
    PaymentVerifier public verifier;
    OffRampV3 public offRamp;
    FiatToFiatRouter public router;

    address constant ORCHESTRATOR = address(0xBEEF);
    address constant USER = address(0x1111);
    address constant SOLVER = address(0x2222);
    address constant DEPOSIT_OWNER = address(0x3333);

    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address witness;

    // Events from Router (updated for V2)
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
    event TransferCancelled(
        address indexed user, bytes32 indexed intentId, uint256 usdcAmount
    );
    event TransferExpired(
        address indexed user, bytes32 indexed intentId, uint256 usdcAmount
    );

    function setUp() public {
        witness = vm.addr(WITNESS_PK);

        usdc = new MockUSDC();
        verifier = new PaymentVerifier(witness);
        offRamp = new OffRampV3(address(usdc), address(verifier));
        router = new FiatToFiatRouter(
            address(usdc), address(offRamp), ORCHESTRATOR
        );
    }

    // ============ Helpers ============

    function _buildExecutionContext(
        address user,
        uint256 amount,
        bytes memory signalHookData
    ) internal view returns (IPostIntentHookV2.HookExecutionContext memory) {
        bytes32 intentHash = keccak256(abi.encodePacked(user, amount, block.timestamp));

        IPostIntentHookV2.HookIntentContext memory intentCtx = IPostIntentHookV2.HookIntentContext({
            owner: DEPOSIT_OWNER,
            to: user,
            escrow: address(0x5555),
            depositId: 1,
            amount: amount,
            timestamp: block.timestamp,
            paymentMethod: keccak256("venmo"),
            fiatCurrency: keccak256("USD"),
            conversionRate: 1e18,
            payeeId: keccak256("payee123"),
            signalHookData: signalHookData
        });

        return IPostIntentHookV2.HookExecutionContext({
            intentHash: intentHash,
            token: address(usdc),
            executableAmount: amount,
            intent: intentCtx
        });
    }

    function _encodePayload(
        string memory iban,
        string memory name,
        uint256 minEur
    ) internal pure returns (bytes memory) {
        return abi.encode(
            FiatToFiatRouter.HookPayload({
                iban: iban,
                recipientName: name,
                minEurAmount: minEur
            })
        );
    }

    function _executeHook(address user, uint256 amount)
        internal
        returns (bytes32 intentId)
    {
        // Mint USDC to orchestrator and approve router
        usdc.mint(ORCHESTRATOR, amount);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), amount);

        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(user, amount, payload);

        router.execute(ctx, "");
        vm.stopPrank();

        // Read the pending transfer to get the intentId
        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(user);
        return transfer.intentId;
    }

    function _submitSolverQuote(bytes32 intentId) internal {
        vm.prank(SOLVER);
        offRamp.submitQuote(
            intentId,
            OffRampV3.RTPN.SEPA_INSTANT,
            9200, // 92.00 EUR
            100_000, // 0.10 USDC fee
            15 // 15 seconds
        );
    }

    // ============ execute() tests ============

    function test_Execute_CreatesIntent() public {
        uint256 amount = 100_000_000; // 100 USDC

        bytes32 intentId = _executeHook(USER, amount);

        // Verify router state
        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(transfer.user, USER);
        assertEq(transfer.usdcAmount, amount);
        assertEq(transfer.iban, "DE89370400440532013000");
        assertEq(transfer.recipientName, "John Doe");
        assertEq(transfer.minEurAmount, 8500);
        assertEq(
            uint256(transfer.status),
            uint256(FiatToFiatRouter.TransferStatus.PENDING)
        );

        // Verify OffRampV3 intent was created
        OffRampV3.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(intent.depositor, address(router));
        assertEq(intent.usdcAmount, amount);
        assertEq(
            uint256(intent.status),
            uint256(OffRampV3.IntentStatus.PENDING_QUOTE)
        );

        // USDC should be in router (not OffRamp yet - that happens at commit)
        assertEq(usdc.balanceOf(address(router)), amount);
    }

    function test_Execute_EmitsEvent() public {
        uint256 amount = 100_000_000;

        usdc.mint(ORCHESTRATOR, amount);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), amount);

        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, amount, payload);

        // Note: We can't easily predict the exact intentId since it's created inside execute()
        // So we just check the event is emitted with correct user and amount
        vm.expectEmit(true, false, true, false);
        emit TransferInitiated(
            USER, bytes32(0), ctx.intentHash, amount, "DE89370400440532013000", "John Doe", 8500
        );

        router.execute(ctx, "");
        vm.stopPrank();
    }

    function test_Execute_RevertsNonOrchestrator() public {
        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);

        vm.prank(USER);
        vm.expectRevert(FiatToFiatRouter.OnlyZKP2POrchestrator.selector);
        router.execute(ctx, "");
    }

    function test_Execute_RevertsDuplicateUser() public {
        _executeHook(USER, 100_000_000);

        // Second call for same user should revert
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);

        bytes memory payload =
            _encodePayload("FR7630006000011234567890189", "Jane Doe", 9000);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);

        vm.expectRevert(
            FiatToFiatRouter.UserAlreadyHasPendingTransfer.selector
        );
        router.execute(ctx, "");
        vm.stopPrank();
    }

    function test_Execute_RevertsEmptyIban() public {
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);

        bytes memory payload = _encodePayload("", "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);

        vm.expectRevert(FiatToFiatRouter.InvalidPayload.selector);
        router.execute(ctx, "");
        vm.stopPrank();
    }

    function test_Execute_RevertsTokenMismatch() public {
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);

        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);

        // Change token to a different address
        ctx.token = address(0xDEAD);

        vm.expectRevert(FiatToFiatRouter.TokenMismatch.selector);
        router.execute(ctx, "");
        vm.stopPrank();
    }

    // ============ commit() tests ============

    function test_Commit_SelectsQuoteAndTransfersUSDC() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);

        // Solver submits on-chain quote within quote window
        _submitSolverQuote(intentId);

        // User commits via router
        vm.prank(USER);
        router.commit(SOLVER);

        // Verify router state
        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(FiatToFiatRouter.TransferStatus.COMMITTED)
        );

        // Verify OffRampV3 state
        OffRampV3.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(
            uint256(intent.status),
            uint256(OffRampV3.IntentStatus.COMMITTED)
        );
        assertEq(intent.selectedSolver, SOLVER);
        assertEq(intent.receivingInfo, "DE89370400440532013000");
        assertEq(intent.recipientName, "John Doe");

        // USDC moved from router to OffRamp
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(address(offRamp)), amount);
    }

    function test_Commit_RevertsSlippage() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount); // minEurAmount = 8500

        // Solver submits an on-chain quote BELOW the user's minimum. Slippage is now
        // enforced against this real quote, not a number the caller passes in.
        vm.prank(SOLVER);
        offRamp.submitQuote(intentId, OffRampV3.RTPN.SEPA_INSTANT, 8000, 100_000, 15);

        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                FiatToFiatRouter.SlippageExceeded.selector, 8000, 8500
            )
        );
        router.commit(SOLVER);
    }

    function test_Commit_RevertsWhenNotPending() public {
        vm.prank(USER);
        vm.expectRevert(FiatToFiatRouter.NoPendingTransfer.selector);
        router.commit(SOLVER);
    }

    function test_Commit_EmitsEvent() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        vm.expectEmit(true, true, false, true);
        emit TransferCommitted(USER, intentId, SOLVER, 9200);
        router.commit(SOLVER);
    }

    // ============ cancel() tests ============

    function test_Cancel_ReturnsUSDC() public {
        uint256 amount = 100_000_000;
        _executeHook(USER, amount);

        assertEq(usdc.balanceOf(USER), 0);

        vm.prank(USER);
        router.cancel();

        // USDC returned to user
        assertEq(usdc.balanceOf(USER), amount);
        assertEq(usdc.balanceOf(address(router)), 0);

        // Transfer status is CANCELLED
        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(FiatToFiatRouter.TransferStatus.CANCELLED)
        );
    }

    function test_Cancel_RevertsWhenCommitted() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER);

        vm.prank(USER);
        vm.expectRevert(FiatToFiatRouter.TransferNotPending.selector);
        router.cancel();
    }

    function test_Cancel_EmitsEvent() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);

        vm.prank(USER);
        vm.expectEmit(true, true, false, true);
        emit TransferCancelled(USER, intentId, amount);
        router.cancel();
    }

    // ============ rescueTimedOut() tests ============

    function test_RescueTimedOut_ReturnsUSDC() public {
        uint256 amount = 100_000_000;
        _executeHook(USER, amount);

        // Warp past COMMIT_TIMEOUT (30 minutes)
        vm.warp(block.timestamp + 31 minutes);

        // Anyone can call rescueTimedOut
        router.rescueTimedOut(USER);

        assertEq(usdc.balanceOf(USER), amount);

        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(FiatToFiatRouter.TransferStatus.EXPIRED)
        );
    }

    function test_RescueTimedOut_RevertsBeforeTimeout() public {
        _executeHook(USER, 100_000_000);

        vm.expectRevert(FiatToFiatRouter.NotTimedOutYet.selector);
        router.rescueTimedOut(USER);
    }

    function test_RescueTimedOut_EmitsEvent() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);

        vm.warp(block.timestamp + 31 minutes);

        vm.expectEmit(true, true, false, true);
        emit TransferExpired(USER, intentId, amount);
        router.rescueTimedOut(USER);
    }

    // Regression guard for COMMIT_TIMEOUT = 15m: past OffRampV3's selection window
    // (QUOTE 5m + SELECTION 10m), commit() can no longer succeed AND rescueTimedOut()
    // opens at the SAME boundary — so there is no dead zone where USDC is stuck.
    function test_RescueTimedOut_OpensAtSelectionWindowClose() public {
        uint256 amount = 100_000_000;
        _executeHook(USER, amount);

        // 16 minutes: past both the 15m selection window and the 15m COMMIT_TIMEOUT.
        vm.warp(block.timestamp + 16 minutes);

        router.rescueTimedOut(USER);
        assertEq(usdc.balanceOf(USER), amount);
        assertEq(
            uint256(router.getPendingTransfer(USER).status),
            uint256(FiatToFiatRouter.TransferStatus.EXPIRED)
        );
    }

    // ============ markComplete() tests ============

    function test_MarkComplete_AfterFulfillment() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER);

        // Simulate solver fulfillment via OffRampV3
        PaymentVerifier.PaymentAttestation memory attestation =
        PaymentVerifier.PaymentAttestation({
            intentHash: intentId,
            amount: 9200, // fiat cents
            timestamp: block.timestamp,
            paymentId: "sepa-tx-123",
            dataHash: keccak256("proof data")
        });

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PaymentAttestation(bytes32 intentHash,uint256 amount,uint256 timestamp,string paymentId,bytes32 dataHash)"
                ),
                attestation.intentHash,
                attestation.amount,
                attestation.timestamp,
                keccak256(bytes(attestation.paymentId)),
                attestation.dataHash
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("WisePaymentVerifier"),
                keccak256("1"),
                block.chainid,
                address(verifier)
            )
        );

        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WITNESS_PK, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(SOLVER);
        offRamp.fulfillIntentWithProof(intentId, attestation, signature);

        // Verify intent fulfilled
        OffRampV3.Intent memory intent = offRamp.getIntent(intentId);
        assertEq(
            uint256(intent.status),
            uint256(OffRampV3.IntentStatus.FULFILLED)
        );

        // Mark complete on router
        router.markComplete(USER);

        FiatToFiatRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(FiatToFiatRouter.TransferStatus.COMPLETED)
        );
    }

    function test_MarkComplete_RevertsIfNotFulfilled() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER);

        // Try to mark complete before fulfillment
        vm.expectRevert(FiatToFiatRouter.TransferNotCommitted.selector);
        router.markComplete(USER);
    }

    // ============ canCommit() tests ============

    function test_CanCommit_TrueWhenPending() public {
        _executeHook(USER, 100_000_000);
        assertTrue(router.canCommit(USER));
    }

    function test_CanCommit_FalseAfterTimeout() public {
        _executeHook(USER, 100_000_000);
        vm.warp(block.timestamp + 31 minutes);
        assertFalse(router.canCommit(USER));
    }

    function test_CanCommit_FalseWhenNoPending() public {
        assertFalse(router.canCommit(USER));
    }

    // ============ encodePayload() tests ============

    function test_EncodePayload_MatchesDecode() public view {
        bytes memory encoded =
            router.encodePayload("DE89370400440532013000", "John Doe", 8500);

        // Decode it the same way the contract does
        FiatToFiatRouter.HookPayload memory decoded =
            abi.decode(encoded, (FiatToFiatRouter.HookPayload));

        assertEq(decoded.iban, "DE89370400440532013000");
        assertEq(decoded.recipientName, "John Doe");
        assertEq(decoded.minEurAmount, 8500);
    }

    // ============ Multi-user tests ============

    function test_MultipleUsers_IndependentTransfers() public {
        address user2 = address(0x4444);

        bytes32 intentId1 = _executeHook(USER, 100_000_000);
        bytes32 intentId2 = _executeHook(user2, 50_000_000);

        // Different intent IDs
        assertTrue(intentId1 != intentId2);

        // Each user has their own pending transfer
        assertEq(router.getPendingTransfer(USER).usdcAmount, 100_000_000);
        assertEq(router.getPendingTransfer(user2).usdcAmount, 50_000_000);

        // User1 cancels, user2 unaffected
        vm.prank(USER);
        router.cancel();

        assertEq(
            uint256(router.getPendingTransfer(USER).status),
            uint256(FiatToFiatRouter.TransferStatus.CANCELLED)
        );
        assertEq(
            uint256(router.getPendingTransfer(user2).status),
            uint256(FiatToFiatRouter.TransferStatus.PENDING)
        );
    }

    // ============ Timing constraint integration test ============

    function test_Commit_RevertsAfterOffRampSelectionWindow() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        // Warp past OffRampV3's QUOTE_WINDOW + SELECTION_WINDOW (15 min)
        vm.warp(block.timestamp + 16 minutes);

        // Router.commit should fail because OffRampV3.selectQuoteAndCommit
        // will revert with SelectionWindowClosed
        vm.prank(USER);
        vm.expectRevert(OffRampV3.SelectionWindowClosed.selector);
        router.commit(SOLVER);
    }

    // ============ emergencyWithdraw test ============

    function test_EmergencyWithdraw_OnlyOwner() public {
        _executeHook(USER, 100_000_000);

        // Non-owner can't withdraw
        vm.prank(USER);
        vm.expectRevert();
        router.emergencyWithdraw(address(usdc), USER, 100_000_000);

        // Owner can
        router.emergencyWithdraw(address(usdc), address(this), 100_000_000);
        assertEq(usdc.balanceOf(address(this)), 100_000_000);
    }

    // ============ rescueCommitted() tests ============

    function test_RescueCommitted_ReturnsUSDC() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);
        vm.prank(USER);
        router.commit(SOLVER);

        // USDC now sits in OffRampV3.
        assertEq(usdc.balanceOf(address(offRamp)), amount);

        // Solver never fulfills; warp past OffRampV3's FULFILLMENT_WINDOW (30 min).
        vm.warp(block.timestamp + 31 minutes);

        // Permissionless rescue reclaims from OffRampV3 and forwards to the user.
        router.rescueCommitted(USER);

        assertEq(usdc.balanceOf(USER), amount);
        assertEq(
            uint256(router.getPendingTransfer(USER).status),
            uint256(FiatToFiatRouter.TransferStatus.EXPIRED)
        );
        assertEq(
            uint256(offRamp.getIntent(intentId).status),
            uint256(OffRampV3.IntentStatus.CANCELLED)
        );
    }

    function test_RescueCommitted_RevertsBeforeWindow() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);
        vm.prank(USER);
        router.commit(SOLVER);

        // Before the window, OffRampV3.cancelIntent reverts CannotCancelYet.
        vm.expectRevert(OffRampV3.CannotCancelYet.selector);
        router.rescueCommitted(USER);
    }

    function test_RescueCommitted_RevertsWhenNotCommitted() public {
        _executeHook(USER, 100_000_000); // PENDING, not COMMITTED
        vm.expectRevert(FiatToFiatRouter.TransferNotCommitted.selector);
        router.rescueCommitted(USER);
    }

    // ============ duplicate-while-committed guard ============

    function test_Execute_RevertsDuplicateWhenCommitted() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);
        vm.prank(USER);
        router.commit(SOLVER);

        // A second onramp for the same user must be blocked while COMMITTED.
        usdc.mint(ORCHESTRATOR, amount);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), amount);
        bytes memory payload =
            _encodePayload("FR7630006000011234567890189", "Jane Doe", 9000);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, amount, payload);
        vm.expectRevert(FiatToFiatRouter.UserAlreadyHasPendingTransfer.selector);
        router.execute(ctx, "");
        vm.stopPrank();
    }

    // ============ execute() length-bound tests ============

    function test_Execute_RevertsOversizedIban() public {
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);
        bytes memory payload = _encodePayload(_repeat("A", 257), "John Doe", 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);
        vm.expectRevert(FiatToFiatRouter.InvalidPayload.selector);
        router.execute(ctx, "");
        vm.stopPrank();
    }

    function test_Execute_RevertsOversizedName() public {
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);
        bytes memory payload =
            _encodePayload("DE89370400440532013000", _repeat("B", 71), 8500);
        IPostIntentHookV2.HookExecutionContext memory ctx =
            _buildExecutionContext(USER, 100_000_000, payload);
        vm.expectRevert(FiatToFiatRouter.InvalidPayload.selector);
        router.execute(ctx, "");
        vm.stopPrank();
    }

    function _repeat(string memory ch, uint256 n) internal pure returns (string memory) {
        bytes memory out = new bytes(n);
        bytes1 c = bytes(ch)[0];
        for (uint256 i = 0; i < n; i++) {
            out[i] = c;
        }
        return string(out);
    }
}
