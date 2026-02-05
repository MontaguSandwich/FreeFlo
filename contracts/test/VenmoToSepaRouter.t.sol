// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { VenmoToSepaRouter } from "../src/VenmoToSepaRouter.sol";
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

contract VenmoToSepaRouterTest is Test {
    MockUSDC public usdc;
    PaymentVerifier public verifier;
    OffRampV3 public offRamp;
    VenmoToSepaRouter public router;

    address constant ORCHESTRATOR = address(0xBEEF);
    address constant USER = address(0x1111);
    address constant SOLVER = address(0x2222);
    address constant ON_RAMPER = address(0x3333);

    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address witness;

    // Events from Router
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
        router = new VenmoToSepaRouter(
            address(usdc), address(offRamp), ORCHESTRATOR
        );
    }

    // ============ Helpers ============

    function _buildIntent(address user, uint256 amount)
        internal
        pure
        returns (VenmoToSepaRouter.ZKP2PIntent memory)
    {
        return VenmoToSepaRouter.ZKP2PIntent({
            intentHash: keccak256(abi.encodePacked(user, amount)),
            onRamper: ON_RAMPER,
            deposit: 0,
            amount: amount,
            timestamp: 0,
            to: user,
            postIntentHook: address(0) // filled by orchestrator
        });
    }

    function _encodePayload(
        string memory iban,
        string memory name,
        uint256 minEur
    ) internal pure returns (bytes memory) {
        return abi.encode(
            VenmoToSepaRouter.HookPayload({
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

        VenmoToSepaRouter.ZKP2PIntent memory intent = _buildIntent(user, amount);
        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);

        router.execute(intent, amount, payload);
        vm.stopPrank();

        // Read the pending transfer to get the intentId
        VenmoToSepaRouter.PendingTransfer memory transfer =
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
        VenmoToSepaRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(transfer.user, USER);
        assertEq(transfer.usdcAmount, amount);
        assertEq(transfer.iban, "DE89370400440532013000");
        assertEq(transfer.recipientName, "John Doe");
        assertEq(transfer.minEurAmount, 8500);
        assertEq(
            uint256(transfer.status),
            uint256(VenmoToSepaRouter.TransferStatus.PENDING)
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

        VenmoToSepaRouter.ZKP2PIntent memory intent =
            _buildIntent(USER, amount);
        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);

        vm.expectEmit(true, false, false, true);
        emit TransferInitiated(
            USER, bytes32(0), amount, "DE89370400440532013000", "John Doe", 8500
        );

        router.execute(intent, amount, payload);
        vm.stopPrank();
    }

    function test_Execute_RevertsNonOrchestrator() public {
        VenmoToSepaRouter.ZKP2PIntent memory intent =
            _buildIntent(USER, 100_000_000);
        bytes memory payload =
            _encodePayload("DE89370400440532013000", "John Doe", 8500);

        vm.prank(USER);
        vm.expectRevert(VenmoToSepaRouter.OnlyZKP2POrchestrator.selector);
        router.execute(intent, 100_000_000, payload);
    }

    function test_Execute_RevertsDuplicateUser() public {
        _executeHook(USER, 100_000_000);

        // Second call for same user should revert
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);

        VenmoToSepaRouter.ZKP2PIntent memory intent =
            _buildIntent(USER, 100_000_000);
        bytes memory payload =
            _encodePayload("FR7630006000011234567890189", "Jane Doe", 9000);

        vm.expectRevert(
            VenmoToSepaRouter.UserAlreadyHasPendingTransfer.selector
        );
        router.execute(intent, 100_000_000, payload);
        vm.stopPrank();
    }

    function test_Execute_RevertsEmptyIban() public {
        usdc.mint(ORCHESTRATOR, 100_000_000);
        vm.startPrank(ORCHESTRATOR);
        usdc.approve(address(router), 100_000_000);

        VenmoToSepaRouter.ZKP2PIntent memory intent =
            _buildIntent(USER, 100_000_000);
        bytes memory payload = _encodePayload("", "John Doe", 8500);

        vm.expectRevert(VenmoToSepaRouter.InvalidPayload.selector);
        router.execute(intent, 100_000_000, payload);
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
        router.commit(SOLVER, 9200);

        // Verify router state
        VenmoToSepaRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(VenmoToSepaRouter.TransferStatus.COMMITTED)
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
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        // minEurAmount is 8500, try committing with 8000 (below min)
        vm.prank(USER);
        vm.expectRevert(
            abi.encodeWithSelector(
                VenmoToSepaRouter.SlippageExceeded.selector, 8000, 8500
            )
        );
        router.commit(SOLVER, 8000);
    }

    function test_Commit_RevertsWhenNotPending() public {
        vm.prank(USER);
        vm.expectRevert(VenmoToSepaRouter.NoPendingTransfer.selector);
        router.commit(SOLVER, 9200);
    }

    function test_Commit_EmitsEvent() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        vm.expectEmit(true, true, false, true);
        emit TransferCommitted(USER, intentId, SOLVER, 9200);
        router.commit(SOLVER, 9200);
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
        VenmoToSepaRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(VenmoToSepaRouter.TransferStatus.CANCELLED)
        );
    }

    function test_Cancel_RevertsWhenCommitted() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER, 9200);

        vm.prank(USER);
        vm.expectRevert(VenmoToSepaRouter.TransferNotPending.selector);
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

        VenmoToSepaRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(VenmoToSepaRouter.TransferStatus.EXPIRED)
        );
    }

    function test_RescueTimedOut_RevertsBeforeTimeout() public {
        _executeHook(USER, 100_000_000);

        vm.expectRevert(VenmoToSepaRouter.NotTimedOutYet.selector);
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

    // ============ markComplete() tests ============

    function test_MarkComplete_AfterFulfillment() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER, 9200);

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

        VenmoToSepaRouter.PendingTransfer memory transfer =
            router.getPendingTransfer(USER);
        assertEq(
            uint256(transfer.status),
            uint256(VenmoToSepaRouter.TransferStatus.COMPLETED)
        );
    }

    function test_MarkComplete_RevertsIfNotFulfilled() public {
        uint256 amount = 100_000_000;
        bytes32 intentId = _executeHook(USER, amount);
        _submitSolverQuote(intentId);

        vm.prank(USER);
        router.commit(SOLVER, 9200);

        // Try to mark complete before fulfillment
        vm.expectRevert(VenmoToSepaRouter.TransferNotCommitted.selector);
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
        VenmoToSepaRouter.HookPayload memory decoded =
            abi.decode(encoded, (VenmoToSepaRouter.HookPayload));

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
            uint256(VenmoToSepaRouter.TransferStatus.CANCELLED)
        );
        assertEq(
            uint256(router.getPendingTransfer(user2).status),
            uint256(VenmoToSepaRouter.TransferStatus.PENDING)
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
        router.commit(SOLVER, 9200);
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
}
