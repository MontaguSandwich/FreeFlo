// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { OffRampV3 } from "../src/OffRampV3.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Direct coverage of OffRampV3 fulfillment — in particular the tightened
/// underpayment floor (rounding epsilon, not 1%). The live custody contract had no
/// direct fulfillment test before this.
contract OffRampV3Test is Test {
    MockUSDC usdc;
    PaymentVerifier verifier;
    OffRampV3 offRamp;

    address constant USER = address(0x1111);
    address constant SOLVER = address(0x2222);
    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address witness;

    uint256 constant USDC_AMOUNT = 100_000_000; // 100 USDC
    uint256 constant FIAT_CENTS = 9200; // 92.00 EUR committed

    function setUp() public {
        witness = vm.addr(WITNESS_PK);
        usdc = new MockUSDC();
        verifier = new PaymentVerifier(witness);
        offRamp = new OffRampV3(address(usdc), address(verifier));
    }

    // Drive an intent to COMMITTED with FIAT_CENTS; returns intentId.
    function _committedIntent() internal returns (bytes32 intentId) {
        usdc.mint(USER, USDC_AMOUNT);
        vm.startPrank(USER);
        usdc.approve(address(offRamp), USDC_AMOUNT);
        intentId = offRamp.createIntent(USDC_AMOUNT, OffRampV3.Currency.EUR);
        vm.stopPrank();

        vm.prank(SOLVER);
        offRamp.submitQuote(intentId, OffRampV3.RTPN.SEPA_INSTANT, FIAT_CENTS, 100_000, 15);

        vm.prank(USER);
        offRamp.selectQuoteAndCommit(
            intentId, SOLVER, OffRampV3.RTPN.SEPA_INSTANT, "DE89370400440532013000", "John Doe"
        );
    }

    // Build a witness-signed attestation for a given proven amount.
    function _signed(bytes32 intentId, uint256 amountCents, string memory paymentId)
        internal
        returns (PaymentVerifier.PaymentAttestation memory att, bytes memory sig)
    {
        att = PaymentVerifier.PaymentAttestation({
            intentHash: intentId,
            amount: amountCents,
            timestamp: block.timestamp,
            paymentId: paymentId,
            dataHash: keccak256("proof")
        });
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PaymentAttestation(bytes32 intentHash,uint256 amount,uint256 timestamp,string paymentId,bytes32 dataHash)"
                ),
                att.intentHash,
                att.amount,
                att.timestamp,
                keccak256(bytes(att.paymentId)),
                att.dataHash
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", verifier.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WITNESS_PK, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_Fulfill_ExactAmount() public {
        bytes32 intentId = _committedIntent();
        (PaymentVerifier.PaymentAttestation memory att, bytes memory sig) =
            _signed(intentId, FIAT_CENTS, "tx-exact");

        vm.prank(SOLVER);
        offRamp.fulfillIntentWithProof(intentId, att, sig);

        assertEq(uint256(offRamp.getIntent(intentId).status), uint256(OffRampV3.IntentStatus.FULFILLED));
        assertEq(usdc.balanceOf(SOLVER), USDC_AMOUNT);
    }

    function test_Fulfill_AllowsOneCentRounding() public {
        bytes32 intentId = _committedIntent();
        // 1 cent under the committed amount is tolerated (rounding epsilon).
        (PaymentVerifier.PaymentAttestation memory att, bytes memory sig) =
            _signed(intentId, FIAT_CENTS - 1, "tx-eps");

        vm.prank(SOLVER);
        offRamp.fulfillIntentWithProof(intentId, att, sig);

        assertEq(uint256(offRamp.getIntent(intentId).status), uint256(OffRampV3.IntentStatus.FULFILLED));
    }

    function test_Fulfill_RevertsTwoCentUnderpayment() public {
        bytes32 intentId = _committedIntent();
        // 2 cents under MUST revert. Under the old `* 99 / 100` floor (9108) this
        // would have passed, letting the solver short the recipient.
        (PaymentVerifier.PaymentAttestation memory att, bytes memory sig) =
            _signed(intentId, FIAT_CENTS - 2, "tx-under");

        vm.prank(SOLVER);
        vm.expectRevert(OffRampV3.AmountMismatch.selector);
        offRamp.fulfillIntentWithProof(intentId, att, sig);
    }

    function test_Fulfill_RevertsWrongSolver() public {
        bytes32 intentId = _committedIntent();
        (PaymentVerifier.PaymentAttestation memory att, bytes memory sig) =
            _signed(intentId, FIAT_CENTS, "tx-wrong-solver");

        vm.prank(address(0xBAD));
        vm.expectRevert(OffRampV3.NotSelectedSolver.selector);
        offRamp.fulfillIntentWithProof(intentId, att, sig);
    }
}
