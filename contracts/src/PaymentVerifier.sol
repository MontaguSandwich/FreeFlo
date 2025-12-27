// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PaymentVerifier
/// @notice Verifies payment attestations from the zkTLS attestation service
/// @dev Uses EIP-712 structured data signing for attestation verification
contract PaymentVerifier is Ownable {
    using ECDSA for bytes32;

    // ============ EIP-712 Constants ============

    bytes32 public constant PAYMENT_ATTESTATION_TYPEHASH = keccak256(
        "PaymentAttestation(bytes32 intentHash,uint256 amount,uint256 timestamp,string paymentId,bytes32 dataHash)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ State ============

    /// @notice Authorized witness addresses (attestation service signers)
    mapping(address => bool) public authorizedWitnesses;

    /// @notice Used nullifiers (payment IDs) to prevent replay
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Minimum required witnesses for a valid attestation
    uint256 public minWitnesses = 1;

    // ============ Structs ============

    /// @notice Payment attestation data
    struct PaymentAttestation {
        bytes32 intentHash;     // Hash of the intent this payment is for
        uint256 amount;         // Amount in smallest currency unit (cents)
        uint256 timestamp;      // TLS session timestamp
        string paymentId;       // Unique payment/transfer ID (nullifier)
        bytes32 dataHash;       // Hash of the raw response data
    }

    // ============ Events ============

    event WitnessAdded(address indexed witness);
    event WitnessRemoved(address indexed witness);
    event MinWitnessesUpdated(uint256 oldMin, uint256 newMin);
    event PaymentVerified(
        bytes32 indexed intentHash,
        bytes32 indexed nullifier,
        uint256 amount,
        address verifiedBy
    );

    // ============ Errors ============

    error InvalidSignature();
    error NullifierAlreadyUsed();
    error InsufficientWitnesses();
    error NotAuthorizedWitness();
    error InvalidAttestation();
    error TimestampTooOld();

    // ============ Constructor ============

    constructor(address initialWitness) Ownable(msg.sender) {
        // Compute EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("WisePaymentVerifier"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );

        if (initialWitness != address(0)) {
            authorizedWitnesses[initialWitness] = true;
            emit WitnessAdded(initialWitness);
        }
    }

    // ============ Verification Functions ============

    /// @notice Verifies a payment attestation
    /// @param attestation The payment attestation data
    /// @param signature The EIP-712 signature from the attestation service
    /// @return valid Whether the attestation is valid
    /// @return signer The address that signed the attestation
    function verifyPayment(
        PaymentAttestation calldata attestation,
        bytes calldata signature
    ) external returns (bool valid, address signer) {
        // Check nullifier hasn't been used
        bytes32 nullifier = keccak256(bytes(attestation.paymentId));
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed();

        // Verify the signature
        bytes32 structHash = _hashAttestation(attestation);
        bytes32 digest = _hashTypedData(structHash);
        
        signer = digest.recover(signature);
        
        if (!authorizedWitnesses[signer]) revert NotAuthorizedWitness();

        // Mark nullifier as used
        usedNullifiers[nullifier] = true;

        emit PaymentVerified(
            attestation.intentHash,
            nullifier,
            attestation.amount,
            signer
        );

        return (true, signer);
    }

    /// @notice Verifies an attestation without consuming the nullifier (view only)
    /// @param attestation The payment attestation data
    /// @param signature The EIP-712 signature
    /// @return valid Whether the signature is valid
    /// @return signer The address that signed
    function verifyPaymentView(
        PaymentAttestation calldata attestation,
        bytes calldata signature
    ) external view returns (bool valid, address signer) {
        bytes32 structHash = _hashAttestation(attestation);
        bytes32 digest = _hashTypedData(structHash);
        
        signer = digest.recover(signature);
        valid = authorizedWitnesses[signer];
        
        // Also check nullifier status
        bytes32 nullifier = keccak256(bytes(attestation.paymentId));
        if (usedNullifiers[nullifier]) {
            return (false, signer);
        }

        return (valid, signer);
    }

    /// @notice Check if a nullifier has been used
    /// @param paymentId The payment ID to check
    /// @return used Whether the nullifier has been used
    function isNullifierUsed(string calldata paymentId) external view returns (bool) {
        return usedNullifiers[keccak256(bytes(paymentId))];
    }

    /// @notice Computes the digest that would be signed for an attestation
    /// @param attestation The payment attestation
    /// @return digest The EIP-712 typed data hash
    function getDigest(PaymentAttestation calldata attestation) external view returns (bytes32) {
        bytes32 structHash = _hashAttestation(attestation);
        return _hashTypedData(structHash);
    }

    // ============ Internal Functions ============

    function _hashAttestation(PaymentAttestation calldata attestation) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_ATTESTATION_TYPEHASH,
                attestation.intentHash,
                attestation.amount,
                attestation.timestamp,
                keccak256(bytes(attestation.paymentId)),
                attestation.dataHash
            )
        );
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );
    }

    // ============ Admin Functions ============

    /// @notice Adds an authorized witness
    /// @param witness The witness address to add
    function addWitness(address witness) external onlyOwner {
        authorizedWitnesses[witness] = true;
        emit WitnessAdded(witness);
    }

    /// @notice Removes an authorized witness
    /// @param witness The witness address to remove
    function removeWitness(address witness) external onlyOwner {
        authorizedWitnesses[witness] = false;
        emit WitnessRemoved(witness);
    }

    /// @notice Updates the minimum required witnesses
    /// @param newMin The new minimum
    function setMinWitnesses(uint256 newMin) external onlyOwner {
        emit MinWitnessesUpdated(minWitnesses, newMin);
        minWitnesses = newMin;
    }
}

