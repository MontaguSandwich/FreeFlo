// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IAllocator } from "./interfaces/IAllocator.sol";

/**
 * @title FreeFloAllocator
 * @notice FreeFlo's self-run, Autocator-style hybrid allocator for Uniswap's The Compact.
 *         On-chain contract (this) + off-chain signer key: The Compact calls {authorizeClaim}
 *         during a claim; this contract authorizes it iff `allocatorData` carries a valid ECDSA
 *         signature, by the FreeFlo allocator key, over the claim hash The Compact computed.
 *
 * Trust model (see .claude/rules/security-invariants.md + docs/design/COMPACT-ARBITER.md):
 *   - The allocator can only DELAY a claim, never steal. If FreeFlo's signer goes dark or
 *     censors, the sponsor escapes via ITheCompact.enableForcedWithdrawal -> wait resetPeriod ->
 *     forcedWithdrawal WITHOUT allocator consent. That is strictly stronger than OffRampV3's
 *     rescueTimedOut.
 *   - This allocator ONLY backs the FreeFlo offramp arbiter (`arbiter`). All real release
 *     conditions (payment proof, EUR floor, IBAN binding, nullifier) are enforced by the arbiter +
 *     the reused PaymentVerifier; the allocator's job is purely to gate double-spend/over-allocation
 *     of the lock, which for FreeFlo's single-use locks reduces to "sign iff this is a genuine
 *     FreeFlo offramp claim".
 *
 * @dev {attest} REVERTS: FreeFlo-locked positions must exit ONLY via an arbiter claim or the
 *      sponsor's forced-withdrawal — never via a direct ERC-6909 transfer (which would let a sponsor
 *      yank funds out from under a solver mid-fill). Forced withdrawal does not route through
 *      {attest}, so the user's escape hatch is unaffected.
 */
contract FreeFloAllocator is IAllocator {
    using ECDSA for bytes32;

    /// @notice The off-chain key that authorizes claims (the FreeFlo allocator signer).
    address public immutable signer;

    /// @notice The only arbiter this allocator backs — the FreeFlo sign-once offramp arbiter.
    address public immutable arbiter;

    /// @notice EIP-712 domain for allocator authorizations (distinct from the witness/attestation
    ///         domain so an allocator signature can never be replayed as a payment attestation).
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant CLAIM_AUTHORIZATION_TYPEHASH =
        keccak256("ClaimAuthorization(bytes32 claimHash)");

    error WrongArbiter(address provided, address expected);
    error BadAllocatorSignature();
    error TransfersDisabled();

    constructor(address _signer, address _arbiter) {
        signer = _signer;
        arbiter = _arbiter;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("FreeFloAllocator"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice The EIP-712 digest the off-chain signer signs to authorize a claim. Exposed so the
    ///         signer service and tests stay byte-identical to this contract.
    function authorizationDigest(bytes32 claimHash) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(CLAIM_AUTHORIZATION_TYPEHASH, claimHash))
            )
        );
    }

    /// @inheritdoc IAllocator
    /// @dev `allocatorData` is a 65-byte (r,s,v) ECDSA signature by `signer` over
    ///      authorizationDigest(claimHash).
    function authorizeClaim(
        bytes32 claimHash,
        address _arbiter,
        address, /* sponsor */
        uint256, /* nonce */
        uint256, /* expires */
        uint256[2][] calldata, /* idsAndAmounts */
        bytes calldata allocatorData
    ) external view returns (bytes4) {
        _check(claimHash, _arbiter, allocatorData);
        return IAllocator.authorizeClaim.selector;
    }

    /// @inheritdoc IAllocator
    function isClaimAuthorized(
        bytes32 claimHash,
        address _arbiter,
        address, /* sponsor */
        uint256, /* nonce */
        uint256, /* expires */
        uint256[2][] calldata, /* idsAndAmounts */
        bytes calldata allocatorData
    ) external view returns (bool) {
        if (_arbiter != arbiter) return false;
        return authorizationDigest(claimHash).recover(allocatorData) == signer;
    }

    /// @inheritdoc IAllocator
    /// @dev FreeFlo locks are claim-or-forced-withdrawal only; direct transfers are disabled.
    function attest(address, address, address, uint256, uint256) external pure returns (bytes4) {
        revert TransfersDisabled();
    }

    function _check(bytes32 claimHash, address _arbiter, bytes calldata allocatorData)
        internal
        view
    {
        if (_arbiter != arbiter) revert WrongArbiter(_arbiter, arbiter);
        if (authorizationDigest(claimHash).recover(allocatorData) != signer) {
            revert BadAllocatorSignature();
        }
    }
}
