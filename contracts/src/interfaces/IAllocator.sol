// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The allocator role in Uniswap's The Compact.
/// @dev Verbatim from the-compact `src/interfaces/IAllocator.sol` (reconciled 2026-06-15).
///      The allocator authorizes claims/transfers to prevent a sponsor double-spending a lock
///      across compacts and to prevent lock underfunding. It is a (semi-)trusted, liveness-bound
///      party: it can only DELAY a claim, never steal — the sponsor escapes via
///      ITheCompact.enableForcedWithdrawal -> wait resetPeriod -> forcedWithdrawal WITHOUT allocator
///      consent.
///
///      FreeFlo SELF-RUNS an Autocator-style hybrid allocator (off-chain `authorizeClaim` signing,
///      on-chain registration). Same trust class as the witness FreeFlo already operates; the
///      forced-withdrawal escape is strictly stronger than OffRampV3's `rescueTimedOut`. The
///      allocator signs over the claim hash; for the FreeFlo offramp the arbiter
///      (FreeFloCompactArbiter) is the only entity that submits claims for these locks, so the
///      allocator's authorization service can be a thin "sign iff (arbiter == FreeFloCompactArbiter
///      and the lock is unspent)" policy — all real release conditions are enforced by the arbiter.
interface IAllocator {
    /// @notice Called by The Compact on a direct ERC-6909 transfer of a locked balance.
    /// @return The function selector `IAllocator.attest.selector` (0x1a808f91) on success.
    function attest(address operator, address from, address to, uint256 id, uint256 amount)
        external
        returns (bytes4);

    /// @notice Authorize a claim. Called by The Compact during claim processing. The allocator
    ///         validates `allocatorData` (typically its own signature over `claimHash`) and that the
    ///         lock is not over-committed.
    /// @return The function selector `IAllocator.authorizeClaim.selector` (0x7bb023f7) on success.
    function authorizeClaim(
        bytes32 claimHash,
        address arbiter,
        address sponsor,
        uint256 nonce,
        uint256 expires,
        uint256[2][] calldata idsAndAmounts,
        bytes calldata allocatorData
    ) external returns (bytes4);

    /// @notice View form of {authorizeClaim} — lets a filler/relayer pre-check before submitting.
    function isClaimAuthorized(
        bytes32 claimHash,
        address arbiter,
        address sponsor,
        uint256 nonce,
        uint256 expires,
        uint256[2][] calldata idsAndAmounts,
        bytes calldata allocatorData
    ) external view returns (bool);
}
