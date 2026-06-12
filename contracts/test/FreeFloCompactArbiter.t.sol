// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MockUSDC } from "./FiatToFiatRouter.t.sol"; // reuse — avoids a duplicate mock
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { FreeFloCompactArbiter } from "../src/FreeFloCompactArbiter.sol";
import { ITheCompact, Claim, Component } from "../src/interfaces/ITheCompact.sol";

/// @dev Stand-in for The Compact: holds the "locked" USDC and, on claim(), pays the
///      arbiter-specified claimants. It DELIBERATELY skips sponsor/allocator signature
///      checks — those are The Compact's internals, not the arbiter logic under test.
///      The arbiter's own guards (witness binding, attestation verification, floor) are
///      exercised in full against the real PaymentVerifier.
contract MockTheCompact is ITheCompact {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public lastClaimHash;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function claim(Claim calldata c) external returns (bytes32 claimHash) {
        claimHash = keccak256(abi.encode(c.sponsor, c.nonce, c.witness, c.id, c.allocatedAmount));
        lastClaimHash = claimHash;
        for (uint256 i; i < c.claimants.length; i++) {
            token.safeTransfer(address(uint160(c.claimants[i].claimant)), c.claimants[i].amount);
        }
    }

    function enableForcedWithdrawal(uint256) external { }

    function forcedWithdrawal(uint256, address recipient, uint256 amount) external {
        token.safeTransfer(recipient, amount);
    }
}

contract FreeFloCompactArbiterTest is Test {
    MockUSDC usdc;
    PaymentVerifier verifier;
    MockTheCompact compact;
    FreeFloCompactArbiter arbiter;

    // Deterministic anvil key #0 — used as the authorized witness.
    uint256 constant WITNESS_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    // A different key (anvil #1) — an UNauthorized signer.
    uint256 constant BAD_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address witness;
    string private wts; // cached arbiter.MANDATE_WITNESS_TYPESTRING() — see setUp

    address constant FILLER = address(0x5050);
    address constant SPONSOR = address(0x1111);

    uint256 constant LOCKED = 100_000_000; // 100 USDC locked in the compact

    event CompactFilled(
        bytes32 indexed claimHash, address indexed filler, bytes32 nullifier, uint256 eurAmount
    );

    function setUp() public {
        witness = vm.addr(WITNESS_PK);
        usdc = new MockUSDC();
        verifier = new PaymentVerifier(witness);
        compact = new MockTheCompact(address(usdc));
        arbiter = new FreeFloCompactArbiter(address(verifier), address(compact));
        // Cache the typestring so _claim() makes no external call (which would otherwise
        // consume vm.prank / vm.expectRevert during fill()'s argument evaluation).
        wts = arbiter.MANDATE_WITNESS_TYPESTRING();
        // Simulate the user's USDC sitting in a resource lock.
        usdc.mint(address(compact), LOCKED);
    }

    // ============ Helpers ============

    function _mandate(uint256 minEur, uint256 expiry)
        internal
        pure
        returns (FreeFloCompactArbiter.Mandate memory)
    {
        return FreeFloCompactArbiter.Mandate({
            receivingInfo: "DE89370400440532013000",
            recipientName: "Anna Muller",
            minEurAmount: minEur,
            currency: 0, // EUR
            expiry: expiry
        });
    }

    function _attestation(bytes32 intentHash, uint256 amount, string memory paymentId)
        internal
        view
        returns (PaymentVerifier.PaymentAttestation memory)
    {
        return PaymentVerifier.PaymentAttestation({
            intentHash: intentHash,
            amount: amount,
            timestamp: block.timestamp,
            paymentId: paymentId,
            dataHash: keccak256("proof-data")
        });
    }

    function _sign(uint256 pk, PaymentVerifier.PaymentAttestation memory att)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = verifier.getDigest(att);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claim(bytes32 witnessHash) internal view returns (Claim memory) {
        return Claim({
            allocatorData: "",
            sponsorSignature: "",
            sponsor: SPONSOR,
            nonce: 1,
            expires: block.timestamp + 1 hours,
            witness: witnessHash,
            witnessTypestring: wts,
            id: 1,
            allocatedAmount: LOCKED,
            claimants: new Component[](0) // arbiter overrides this
        });
    }

    // ============ Happy path ============

    function test_Fill_ReleasesLockToFiller() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-1");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        arbiter.fill(_claim(wh), m, att, sig);

        // The locked USDC was released to the filler.
        assertEq(usdc.balanceOf(FILLER), LOCKED);
        assertEq(usdc.balanceOf(address(compact)), 0);
        // Nullifier consumed in the reused PaymentVerifier.
        assertTrue(verifier.isNullifierUsed("sepa-tx-1"));
    }

    function test_Fill_EmitsEvent() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-evt");
        bytes memory sig = _sign(WITNESS_PK, att);

        // Don't assert the claimHash topic (computed inside the mock); check the rest.
        vm.expectEmit(false, true, false, true);
        emit CompactFilled(bytes32(0), FILLER, keccak256(bytes("sepa-tx-evt")), 9200);
        vm.prank(FILLER);
        arbiter.fill(_claim(wh), m, att, sig);
    }

    // ============ Reverts ============

    function test_Fill_RevertsWitnessMismatch() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-2");
        bytes memory sig = _sign(WITNESS_PK, att);

        // Compact was signed against a DIFFERENT witness than this mandate hashes to.
        Claim memory c = _claim(keccak256("some-other-witness"));

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.WitnessMismatch.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsExpiredMandate() public {
        vm.warp(1_000_000);
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp - 1); // already expired
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-3");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.MandateExpired.selector);
        arbiter.fill(_claim(wh), m, att, sig);
    }

    function test_Fill_RevertsAttestationNotForMandate() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        // Attestation is signed but bound to a DIFFERENT intent/mandate.
        PaymentVerifier.PaymentAttestation memory att =
            _attestation(keccak256("different-mandate"), 9200, "sepa-tx-4");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.AttestationNotForMandate.selector);
        arbiter.fill(_claim(wh), m, att, sig);
    }

    function test_Fill_RevertsBelowFloor() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9500, block.timestamp + 1 hours); // floor 95.00
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-5"); // only 92.00
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(
            abi.encodeWithSelector(FreeFloCompactArbiter.AmountBelowFloor.selector, 9200, 9500)
        );
        arbiter.fill(_claim(wh), m, att, sig);
    }

    function test_Fill_RevertsUnauthorizedWitness() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-6");
        bytes memory sig = _sign(BAD_PK, att); // signed by a non-witness key

        vm.prank(FILLER);
        vm.expectRevert(PaymentVerifier.NotAuthorizedWitness.selector);
        arbiter.fill(_claim(wh), m, att, sig);
    }

    function test_Fill_RevertsReplayedNullifier() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        PaymentVerifier.PaymentAttestation memory att = _attestation(wh, 9200, "sepa-tx-dup");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        arbiter.fill(_claim(wh), m, att, sig); // first claim succeeds

        // Re-presenting the same payment id is rejected by the reused verifier.
        vm.prank(FILLER);
        vm.expectRevert(PaymentVerifier.NullifierAlreadyUsed.selector);
        arbiter.fill(_claim(wh), m, att, sig);
    }

    // The sponsor's escape hatch exists independently of the arbiter/allocator.
    function test_ForcedWithdrawal_ReturnsToSponsor() public {
        vm.prank(SPONSOR);
        compact.forcedWithdrawal(1, SPONSOR, LOCKED);
        assertEq(usdc.balanceOf(SPONSOR), LOCKED);
    }
}
