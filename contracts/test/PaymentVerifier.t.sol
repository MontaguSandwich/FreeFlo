// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";

contract PaymentVerifierTest is Test {
    PaymentVerifier public verifier;

    // Test witness (corresponds to private key in attestation service)
    uint256 constant WITNESS_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address witness;

    function setUp() public {
        witness = vm.addr(WITNESS_PRIVATE_KEY);
        verifier = new PaymentVerifier(witness);
    }

    function test_InitialState() public view {
        assertTrue(verifier.authorizedWitnesses(witness));
        assertEq(verifier.minWitnesses(), 1);
    }

    function test_VerifyValidPayment() public {
        // Create attestation
        PaymentVerifier.PaymentAttestation memory attestation = PaymentVerifier.PaymentAttestation({
            intentHash: bytes32(uint256(1)),
            amount: 10000, // €100.00
            timestamp: block.timestamp,
            paymentId: "tx-123-abc",
            dataHash: keccak256("test data")
        });

        // Sign it
        bytes32 structHash = _hashAttestation(attestation);
        bytes32 digest = _hashTypedData(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WITNESS_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Verify
        (bool valid, address signer) = verifier.verifyPayment(attestation, signature);

        assertTrue(valid);
        assertEq(signer, witness);
    }

    function test_RejectsReplay() public {
        PaymentVerifier.PaymentAttestation memory attestation = PaymentVerifier.PaymentAttestation({
            intentHash: bytes32(uint256(1)),
            amount: 10000,
            timestamp: block.timestamp,
            paymentId: "tx-replay-test",
            dataHash: keccak256("test data")
        });

        bytes32 digest = _hashTypedData(_hashAttestation(attestation));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WITNESS_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // First verification succeeds
        (bool valid,) = verifier.verifyPayment(attestation, signature);
        assertTrue(valid);

        // Second attempt fails
        vm.expectRevert(PaymentVerifier.NullifierAlreadyUsed.selector);
        verifier.verifyPayment(attestation, signature);
    }

    function test_RejectsUnauthorizedWitness() public {
        uint256 fakeWitnessKey = 0x1234567890123456789012345678901234567890123456789012345678901234;

        PaymentVerifier.PaymentAttestation memory attestation = PaymentVerifier.PaymentAttestation({
            intentHash: bytes32(uint256(1)),
            amount: 10000,
            timestamp: block.timestamp,
            paymentId: "tx-unauthorized",
            dataHash: keccak256("test data")
        });

        bytes32 digest = _hashTypedData(_hashAttestation(attestation));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeWitnessKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(PaymentVerifier.NotAuthorizedWitness.selector);
        verifier.verifyPayment(attestation, signature);
    }

    function test_ViewVerification() public {
        PaymentVerifier.PaymentAttestation memory attestation = PaymentVerifier.PaymentAttestation({
            intentHash: bytes32(uint256(1)),
            amount: 10000,
            timestamp: block.timestamp,
            paymentId: "tx-view-test",
            dataHash: keccak256("test data")
        });

        bytes32 digest = _hashTypedData(_hashAttestation(attestation));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WITNESS_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // View verification doesn't consume nullifier
        (bool valid1,) = verifier.verifyPaymentView(attestation, signature);
        assertTrue(valid1);

        (bool valid2,) = verifier.verifyPaymentView(attestation, signature);
        assertTrue(valid2);

        // Can still use nullifier after view calls
        (bool valid3,) = verifier.verifyPayment(attestation, signature);
        assertTrue(valid3);
    }

    function test_AddRemoveWitness() public {
        address newWitness = address(0x1234);

        assertFalse(verifier.authorizedWitnesses(newWitness));

        verifier.addWitness(newWitness);
        assertTrue(verifier.authorizedWitnesses(newWitness));

        verifier.removeWitness(newWitness);
        assertFalse(verifier.authorizedWitnesses(newWitness));
    }

    // ============ Helper Functions ============

    function _hashAttestation(PaymentVerifier.PaymentAttestation memory attestation)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
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
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", verifier.DOMAIN_SEPARATOR(), structHash));
    }
}

