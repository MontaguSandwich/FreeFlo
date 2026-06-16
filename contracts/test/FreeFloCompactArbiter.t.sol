// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MockUSDC } from "./FiatToFiatRouter.t.sol"; // reuse — avoids a duplicate mock
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { FreeFloCompactArbiter } from "../src/FreeFloCompactArbiter.sol";
import {
    ITheCompact,
    Claim,
    Component,
    ResetPeriod,
    Scope
} from "../src/interfaces/ITheCompact.sol";

/// @dev Stand-in for The Compact: holds the "locked" USDC and, on claim(), pays the arbiter-
///      specified claimants. It DELIBERATELY skips sponsor/allocator signature checks — those are
///      The Compact's internals, not the arbiter logic under test. BUT it reproduces The Compact's
///      claim-hash derivation (independently, from a HARDCODED typehash hex) so the arbiter's
///      fail-closed `realized == claimHash` assert is genuinely exercised — if the arbiter's
///      keccak-string typehash ever diverged from this hex, every happy-path test would revert.
contract MockTheCompact is ITheCompact {
    using SafeERC20 for IERC20;

    // keccak256("Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12
    // lockTag,address token,uint256 amount,Mandate mandate)Mandate(string receivingInfo,string
    // recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)") — see cast keccak.
    bytes32 constant COMPACT_WITNESS_TYPEHASH =
        0x1331dc8984a3ba9642121253c4ae47058b74099838b0e4caa45a756074ff4453;

    IERC20 public immutable token;
    bytes32 public lastClaimHash;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function claim(Claim calldata c) external returns (bytes32 claimHash) {
        bytes12 lockTag = bytes12(bytes32(c.id));
        address tok = address(uint160(c.id));
        claimHash = keccak256(
            abi.encode(
                COMPACT_WITNESS_TYPEHASH,
                msg.sender, // arbiter == the FreeFloCompactArbiter calling us
                c.sponsor,
                c.nonce,
                c.expires,
                lockTag,
                tok,
                c.allocatedAmount,
                c.witness
            )
        );
        lastClaimHash = claimHash;
        for (uint256 i; i < c.claimants.length; i++) {
            token.safeTransfer(address(uint160(c.claimants[i].claimant)), c.claimants[i].amount);
        }
    }

    function __registerAllocator(address, bytes calldata) external pure returns (uint96) {
        return 0;
    }

    function depositERC20(address, bytes12, uint256, address) external pure returns (uint256) {
        return 0;
    }

    function enableForcedWithdrawal(uint256) external pure returns (uint256) {
        return 0;
    }

    function disableForcedWithdrawal(uint256) external pure returns (bool) {
        return true;
    }

    function forcedWithdrawal(uint256, address recipient, uint256 amount) external returns (bool) {
        token.safeTransfer(recipient, amount);
        return true;
    }

    function getLockDetails(uint256)
        external
        pure
        returns (address, address, ResetPeriod, Scope, bytes12)
    {
        return (address(0), address(0), ResetPeriod.OneDay, Scope.ChainSpecific, bytes12(0));
    }
}

contract FreeFloCompactArbiterTest is Test {
    MockUSDC usdc;
    PaymentVerifier verifier;
    MockTheCompact compact;
    FreeFloCompactArbiter arbiter;

    // Deterministic anvil key #0 — used as the authorized witness.
    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    // A different key (anvil #1) — an UNauthorized signer.
    uint256 constant BAD_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address witness;

    address constant FILLER = address(0x5050);
    address constant COPYCAT = address(0x6060);
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

    function _claim(bytes32 witnessHash, uint256 id) internal view returns (Claim memory) {
        return Claim({
            allocatorData: "",
            sponsorSignature: "",
            sponsor: SPONSOR,
            nonce: 1,
            expires: block.timestamp + 1 hours,
            witness: witnessHash,
            witnessTypestring: arbiter.MANDATE_WITNESS_TYPESTRING(),
            id: id,
            allocatedAmount: LOCKED,
            claimants: new Component[](0) // arbiter overrides this
        });
    }

    // ============ Typehash pin (catches typestring drift vs canonical The Compact) ============

    function test_TypehashPins() public view {
        // The witnessed typehash the arbiter binds against.
        assertEq(
            arbiter.COMPACT_WITNESS_TYPEHASH(),
            0x1331dc8984a3ba9642121253c4ae47058b74099838b0e4caa45a756074ff4453
        );
        // Its non-witness prefix must be the canonical The Compact COMPACT_TYPEHASH — i.e. the
        // arbiter's Compact field layout (bytes12 lockTag,address token,uint256 amount) is exact.
        assertEq(
            keccak256(
                "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount)"
            ),
            0x73b631296de001508966ddfc334593ad8f850ccd3be4d2c58a9ed469844eebc7
        );
    }

    // ============ Happy path ============

    function test_Fill_ReleasesLockToFiller() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-1");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        bytes32 returned = arbiter.fill(c, m, att, sig);

        // The locked USDC was withdrawn to the filler.
        assertEq(usdc.balanceOf(FILLER), LOCKED);
        assertEq(usdc.balanceOf(address(compact)), 0);
        // The arbiter's bound claim hash equals what The Compact realized (fail-closed assert held).
        assertEq(returned, arbiter.computeClaimHash(c, m));
        assertEq(returned, compact.lastClaimHash());
        // Nullifier consumed in the reused PaymentVerifier.
        assertTrue(verifier.isNullifierUsed("sepa-tx-1"));
    }

    function test_Fill_EmitsEvent() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 claimHash = arbiter.computeClaimHash(c, m);
        bytes32 intent = keccak256(abi.encode(claimHash, FILLER));
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-evt");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.expectEmit(true, true, false, true);
        emit CompactFilled(claimHash, FILLER, keccak256(bytes("sepa-tx-evt")), 9200);
        vm.prank(FILLER);
        arbiter.fill(c, m, att, sig);
    }

    // ============ Binding #1: claim-hash (lock) binding ============

    function test_Fill_RevertsWitnessMismatch() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-2");
        bytes memory sig = _sign(WITNESS_PK, att);

        // Compact was signed against a DIFFERENT witness than this mandate hashes to.
        c.witness = keccak256("some-other-witness");

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.WitnessMismatch.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsWitnessTypestringMismatch() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-ts");
        bytes memory sig = _sign(WITNESS_PK, att);

        // A compact whose declared Mandate typestring isn't the one the arbiter assumes.
        c.witnessTypestring = "string receivingInfo,uint256 minEurAmount";

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.WitnessTypestringMismatch.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsAttestationNotForClaim() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        // Attestation signed but bound to a DIFFERENT claim hash.
        PaymentVerifier.PaymentAttestation memory att =
            _attestation(keccak256("different-claim"), 9200, "sepa-tx-4");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.AttestationNotForClaim.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsReusedMandateOnDifferentLock() public {
        // Same mandate, but the attestation was bound to the claim hash of lock id=1...
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory cOne = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(cOne, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-reuse");
        bytes memory sig = _sign(WITNESS_PK, att);

        // ...and the filler tries to drain a DIFFERENT lock (id=2) with the same mandate + proof.
        Claim memory cTwo = _claim(wh, 2);

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.AttestationNotForClaim.selector);
        arbiter.fill(cTwo, m, att, sig);
    }

    // ============ Binding #2: filler (front-running) binding ============

    function test_Fill_RevertsFrontRunByCopycat() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        // Attestation is bound to FILLER...
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-fr");
        bytes memory sig = _sign(WITNESS_PK, att);

        // ...but a copycat front-runs the bearer attestation from a different address.
        vm.prank(COPYCAT);
        vm.expectRevert(FreeFloCompactArbiter.AttestationNotForClaim.selector);
        arbiter.fill(c, m, att, sig);

        // The legitimate filler still succeeds.
        vm.prank(FILLER);
        arbiter.fill(c, m, att, sig);
        assertEq(usdc.balanceOf(FILLER), LOCKED);
    }

    // ============ Floor + reused remaining guards ============

    function test_Fill_RevertsExpiredMandate() public {
        vm.warp(1_000_000);
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp - 1); // expired
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-3");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(FreeFloCompactArbiter.MandateExpired.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsBelowFloor() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9500, block.timestamp + 1 hours); // floor 95
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-5"); // 92
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        vm.expectRevert(
            abi.encodeWithSelector(FreeFloCompactArbiter.AmountBelowFloor.selector, 9200, 9500)
        );
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsUnauthorizedWitness() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-6");
        bytes memory sig = _sign(BAD_PK, att); // signed by a non-witness key

        vm.prank(FILLER);
        vm.expectRevert(PaymentVerifier.NotAuthorizedWitness.selector);
        arbiter.fill(c, m, att, sig);
    }

    function test_Fill_RevertsReplayedNullifier() public {
        FreeFloCompactArbiter.Mandate memory m = _mandate(9000, block.timestamp + 1 hours);
        bytes32 wh = arbiter.hashMandate(m);
        Claim memory c = _claim(wh, 1);
        bytes32 intent = arbiter.expectedIntentHash(c, m, FILLER);
        PaymentVerifier.PaymentAttestation memory att = _attestation(intent, 9200, "sepa-tx-dup");
        bytes memory sig = _sign(WITNESS_PK, att);

        vm.prank(FILLER);
        arbiter.fill(c, m, att, sig); // first claim succeeds

        // Re-presenting the same payment id is rejected by the reused verifier.
        vm.prank(FILLER);
        vm.expectRevert(PaymentVerifier.NullifierAlreadyUsed.selector);
        arbiter.fill(c, m, att, sig);
    }

    // The sponsor's escape hatch exists independently of the arbiter/allocator.
    function test_ForcedWithdrawal_ReturnsToSponsor() public {
        vm.prank(SPONSOR);
        compact.forcedWithdrawal(1, SPONSOR, LOCKED);
        assertEq(usdc.balanceOf(SPONSOR), LOCKED);
    }
}
