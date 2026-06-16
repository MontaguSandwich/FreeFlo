// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Lifetime of a resource lock's forced-withdrawal timelock (Uniswap The Compact).
/// @dev Verbatim from the-compact `src/types/ResetPeriod.sol`. The sponsor's escape hatch
///      (`enableForcedWithdrawal` -> wait `resetPeriod` -> `forcedWithdrawal`) is bounded by this.
enum ResetPeriod {
    OneSecond,
    FifteenSeconds,
    OneMinute,
    TenMinutes,
    OneHourAndFiveMinutes,
    OneDay,
    SevenDaysAndOneHour,
    ThirtyDays
}

/// @notice Whether a lock is claimable cross-chain or only on its own chain.
/// @dev Verbatim from the-compact `src/types/Scope.sol`. FreeFlo locks USDC for a single-chain
///      (Base) offramp, so deposits MUST use `ChainSpecific` — a `Multichain` lock would be
///      claimable via exogenous (other-chain) compacts the FreeFlo arbiter does not gate.
enum Scope {
    Multichain, // 0
    ChainSpecific // 1
}

/// @notice One recipient of a claim: a packed (lockTag + recipient) and an amount.
/// @dev Verbatim from the-compact `src/types/Components.sol`. The `claimant` packs a
///      `bytes12 lockTag` in the upper 96 bits and the recipient `address` in the lower 160 bits:
///      `claimant = (uint256(bytes32(lockTag)) ) | uint256(uint160(recipient))`.
///      A ZERO lockTag (upper 96 bits clear) means "withdraw the underlying ERC20 to `recipient`"
///      — which is exactly what the FreeFlo arbiter wants (pay USDC out to the filler). A non-zero
///      lockTag instead transfers/*converts* the ERC-6909 lock position rather than withdrawing.
struct Component {
    uint256 claimant; // The lockTag + recipient of the transfer or withdrawal.
    uint256 amount; // The amount of tokens to transfer or withdraw.
}

/// @notice Single-chain claim payload for The Compact v1.
/// @dev Verbatim field-for-field from the-compact `src/types/Claims.sol` (`struct Claim`). The
///      sponsor's EIP-712 signature commits to the *claim hash*, which incorporates `witness`
///      (the arbiter-defined Mandate hash) — so the mandate is cryptographically bound to the lock.
///      The Compact does NOT interpret the mandate; verifying it is the arbiter's job.
///
///      `witnessTypestring` is the INNER fields of the Mandate ONLY (e.g.
///      "string receivingInfo,...,uint256 expiry"). The Compact hardcodes the wrapper
///      "...,uint256 amount,Mandate mandate)Mandate(" and appends the closing ")" itself — see
///      FreeFloCompactArbiter.MANDATE_WITNESS_TYPESTRING.
struct Claim {
    bytes allocatorData; // Authorization from the allocator (IAllocator.authorizeClaim).
    bytes sponsorSignature; // Authorization from the sponsor (empty if the compact was registered on deposit).
    address sponsor; // The account to source the tokens from.
    uint256 nonce; // Replay protection for the compact, scoped to the allocator.
    uint256 expires; // The time at which the claim expires.
    bytes32 witness; // EIP-712 hash of the Mandate (the off-chain condition).
    string witnessTypestring; // The Mandate's INNER fields (see note above).
    uint256 id; // ERC-6909 resource-lock id (upper 96 bits = lockTag, lower 160 = token).
    uint256 allocatedAmount; // The original allocated amount of ERC-6909 tokens.
    Component[] claimants; // The claim recipients and amounts; specified by the arbiter.
}

/// @notice Reconciled slice of Uniswap's The Compact (Base mainnet:
///         0x00000000000000171ede64904551eeDF3C6C9788, name "The Compact", DOMAIN_SEPARATOR
///         0xf789cd452b2f29c8246379d5e071e2ac39d194045691ef1f9dddfa1f276d905a).
///
/// @dev Reconciled 2026-06-15 against Uniswap/the-compact `main`:
///        - `Claim` / `Component`: field-for-field verbatim from `src/types/{Claims,Components}.sol`.
///        - `claim(Claim) returns (bytes32)`: verbatim from `src/interfaces/ITheCompactClaims.sol`
///          ("can only be called by the arbiter indicated on the associated compact").
///        - registration / deposit / forced-withdrawal: verbatim signatures from
///          `src/interfaces/ITheCompact.sol` (return types included — the PoC omitted them).
///      This is still a PARTIAL slice (only what the FreeFlo arbiter, the deploy/allocator scripts,
///      and the forced-withdrawal escape need). The Permit2 gasless deposit+register path used by
///      the frontend is NOT a Solidity dependency here (it would drag in Permit2's ISignatureTransfer
///      types); its canonical signature is documented below and built client-side via an ABI fragment:
///
///        depositERC20AndRegisterViaPermit2(
///          ISignatureTransfer.PermitTransferFrom permit, address depositor, bytes12 lockTag,
///          bytes32 claimHash, CompactCategory compactCategory, string witness, bytes signature
///        ) returns (uint256 id)
///
///      and the plain gasless deposit (no register):
///        depositERC20ViaPermit2(
///          ISignatureTransfer.PermitTransferFrom permit, address depositor, bytes12 lockTag,
///          address recipient, bytes signature
///        ) returns (uint256 id)
interface ITheCompact {
    /// @notice Process a standard single-chain claim. Callable ONLY by the arbiter named in the
    ///         compact (msg.sender must equal that arbiter). Verifies sponsor + allocator
    ///         authorization over the claim hash (which incorporates `witness`) and distributes the
    ///         lock to `claimants`.
    /// @return claimHash The EIP-712 struct hash of the processed Compact (NOT domain-separated).
    function claim(Claim calldata claimPayload) external returns (bytes32 claimHash);

    // ============ Allocator registration (deploy/ops) ============

    /// @notice Register an allocator. Permissionless if `proof` attests to one of the accepted
    ///         registration conditions (e.g. msg.sender == allocator, or CREATE2-derivable).
    /// @return allocatorId The 92-bit id packed into every lockTag that uses this allocator.
    function __registerAllocator(address allocator, bytes calldata proof)
        external
        returns (uint96 allocatorId);

    // ============ Deposits (deploy/test/scripts; frontend uses the Permit2 variants above) ============

    /// @notice Deposit ERC-20 into a resource lock (non-gasless; caller must have approved The Compact).
    /// @return id The ERC-6909 resource-lock id (lockTag<<160 | token).
    function depositERC20(address token, bytes12 lockTag, uint256 amount, address recipient)
        external
        returns (uint256 id);

    // ============ Sponsor escape hatch (censorship / allocator-liveness protection) ============

    /// @notice Arm a forced withdrawal of a resource lock.
    /// @return withdrawableAt The timestamp after which `forcedWithdrawal` becomes callable.
    function enableForcedWithdrawal(uint256 id) external returns (uint256 withdrawableAt);

    /// @notice Cancel an armed forced withdrawal.
    function disableForcedWithdrawal(uint256 id) external returns (bool);

    /// @notice After `resetPeriod` elapses, withdraw the locked funds WITHOUT allocator consent.
    function forcedWithdrawal(uint256 id, address recipient, uint256 amount) external returns (bool);

    // ============ Views ============

    /// @notice Decode a resource-lock id into its parameters.
    function getLockDetails(uint256 id)
        external
        view
        returns (
            address token,
            address allocator,
            ResetPeriod resetPeriod,
            Scope scope,
            bytes12 lockTag
        );
}
