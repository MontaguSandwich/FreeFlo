// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice One recipient of a claim: a packed (lockTag + recipient) and an amount.
/// @dev `claimant` packs the resource-lock tag in the upper bits and the recipient
///      address in the lower 160 bits. For a plain underlying-token withdrawal the
///      recipient is recovered as `address(uint160(claimant))`.
struct Component {
    uint256 claimant;
    uint256 amount;
}

/// @notice Single-chain claim payload for The Compact v1.
/// @dev Mirrors Uniswap's the-compact `Claim` (src/types/Claims.sol). `witness` is the
///      EIP-712 hash of an arbiter-defined Mandate; `witnessTypestring` declares the
///      Mandate's fields. The Compact does NOT interpret the mandate — verifying it is
///      the arbiter's job. The sponsor's signature commits to the claim hash, which
///      incorporates `witness`, so the mandate is cryptographically bound to the lock.
struct Claim {
    bytes allocatorData; // allocator authorization (IAllocator.authorizeClaim)
    bytes sponsorSignature; // sponsor's EIP-712 signature over the compact (incl. witness)
    address sponsor; // the user who locked the funds
    uint256 nonce; // replay protection for the compact
    uint256 expires; // compact expiry
    bytes32 witness; // EIP-712 hash of the Mandate (the off-chain condition)
    string witnessTypestring; // declares the Mandate's fields to The Compact
    uint256 id; // ERC-6909 resource-lock id (encodes lockTag + token)
    uint256 allocatedAmount; // amount locked / claimable
    Component[] claimants; // recipients (set by the arbiter)
}

/// @notice Minimal slice of The Compact (Base mainnet:
///         0x00000000000000171ede64904551eeDF3C6C9788) that the FreeFlo arbiter
///         depends on. This is NOT the full ABI — reconcile against Uniswap's
///         canonical `ITheCompactClaims` / `ITheCompact` before any mainnet use.
interface ITheCompact {
    /// @notice Process a single-chain claim. Callable by the compact's named arbiter
    ///         (i.e. msg.sender must equal the arbiter the sponsor committed to).
    ///         Verifies sponsor + allocator authorization over the claim hash (which
    ///         incorporates `witness`) and distributes the lock to `claimants`.
    function claim(Claim calldata claimPayload) external returns (bytes32 claimHash);

    /// @notice Sponsor escape hatch — arm a forced withdrawal of a resource lock.
    function enableForcedWithdrawal(uint256 id) external;

    /// @notice Sponsor escape hatch — after `resetPeriod` elapses, withdraw the locked
    ///         funds WITHOUT allocator consent (censorship / liveness protection).
    function forcedWithdrawal(uint256 id, address recipient, uint256 amount) external;
}
