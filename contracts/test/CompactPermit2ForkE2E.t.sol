// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PaymentVerifier } from "../src/PaymentVerifier.sol";
import { FreeFloCompactArbiter } from "../src/FreeFloCompactArbiter.sol";
import { FreeFloAllocator } from "../src/FreeFloAllocator.sol";
import {
    ITheCompact,
    Claim,
    Component,
    Scope,
    ResetPeriod
} from "../src/interfaces/ITheCompact.sol";

interface IPermit2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice The Compact's gasless deposit+register entrypoint (Permit2 Activation witness).
interface ICompactPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    function depositERC20AndRegisterViaPermit2(
        PermitTransferFrom calldata permit,
        address depositor,
        bytes12 lockTag,
        bytes32 claimHash,
        uint8 compactCategory, // CompactCategory.Compact == 0
        string calldata witness, // the Mandate's INNER fields
        bytes calldata signature
    ) external returns (uint256 id);

    function balanceOf(address owner, uint256 id) external view returns (uint256);
}

/// @notice END-TO-END verification of the GASLESS sign-once path against the REAL Compact on Base:
///         the user signs ONE Permit2 Activation witness; a relayer (the solver) submits
///         depositERC20AndRegisterViaPermit2 (pulls USDC + registers the compact), then fill() runs
///         with an EMPTY sponsorSignature (authorized by the registration). Proves the user needs
///         exactly one signature and pays no gas.
///
/// @dev Auto-skips unless forked. Run:
///        FOUNDRY_PROFILE=fork forge test --match-contract CompactPermit2ForkE2E \
///          --fork-url https://mainnet.base.org -vvv
contract CompactPermit2ForkE2ETest is Test {
    address constant THE_COMPACT = 0x00000000000000171ede64904551eeDF3C6C9788;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Verified via `cast keccak` against canonical the-compact constants (2026-06-15).
    bytes32 constant FREEFLO_ACTIVATION_TYPEHASH =
        0xfc02f8b74e6d5f6e3ccd2e6742c99386dfd376eb3a7e776522e43f3ceaeec87c;
    bytes32 constant PERMIT_WITNESS_TYPEHASH =
        0x72326c723ecdc16619c4a3e5cc35ea8753e06585368108edea2298bacce281f8;
    bytes32 constant TOKEN_PERMISSIONS_TYPEHASH =
        0x618358ac3db8dc274f0cd8829da7e234bd48cd73c4a740aede1adec9846d06a1;

    PaymentVerifier verifier;
    FreeFloCompactArbiter arbiter;
    FreeFloAllocator allocator;
    bool skipped;

    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ALLOCATOR_PK =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    // High-entropy key whose address has no code on Base (anvil keys collide with live contracts,
    // which would route Permit2 to EIP-1271 instead of ECDSA).
    uint256 constant SPONSOR_PK =
        0x9c2d8f3a17b64e05c1f8a9d6b3e07c42f50198ad7e6b3c2d1f0a9b8c7d6e5f40;
    // The relayer/solver: it submits the deposit (the Activation `activator`) AND fills.
    address constant SOLVER = address(0x5050);

    uint256 constant AMOUNT = 100_000_000; // 100 USDC

    function setUp() public {
        if (THE_COMPACT.code.length == 0) {
            skipped = true;
            return;
        }
        verifier = new PaymentVerifier(vm.addr(WITNESS_PK));
        arbiter = new FreeFloCompactArbiter(address(verifier), THE_COMPACT);
        allocator = new FreeFloAllocator(vm.addr(ALLOCATOR_PK), address(arbiter));
    }

    function _sign65(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mandate() internal view returns (FreeFloCompactArbiter.Mandate memory) {
        return FreeFloCompactArbiter.Mandate({
            receivingInfo: "DE89370400440532013000",
            recipientName: "Anna Muller",
            minEurAmount: 9000,
            currency: 0,
            expiry: block.timestamp + 1 hours
        });
    }

    function _lockTag(uint96 allocatorId) internal pure returns (bytes12) {
        uint256 t = (uint256(uint8(Scope.ChainSpecific)) << 255)
            | (uint256(uint8(ResetPeriod.OneDay)) << 252) | (uint256(allocatorId) << 160);
        return bytes12(bytes32(t));
    }

    /// The user's single Permit2 Activation-witness signature (gasless deposit + register).
    function _permit2Sig(uint256 id, bytes32 claimHash, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, USDC, AMOUNT));
        // Activation(address activator, uint256 id, Compact compact) — compact field == claimHash.
        bytes32 witnessHash =
            keccak256(abi.encode(FREEFLO_ACTIVATION_TYPEHASH, SOLVER, id, claimHash));
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_WITNESS_TYPEHASH,
                tokenPermissions,
                THE_COMPACT, // spender = the contract pulling the tokens
                uint256(0), // permit nonce
                deadline,
                witnessHash
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IPermit2(PERMIT2).DOMAIN_SEPARATOR(), structHash)
        );
        return _sign65(SPONSOR_PK, digest);
    }

    function _attestation(bytes32 claimHash)
        internal
        view
        returns (PaymentVerifier.PaymentAttestation memory)
    {
        return PaymentVerifier.PaymentAttestation({
            intentHash: keccak256(abi.encode(claimHash, SOLVER)),
            amount: 9200,
            timestamp: block.timestamp,
            paymentId: "permit2-fork-tx-1",
            dataHash: keccak256("proof-data")
        });
    }

    /// Pre-computes the typestring + Permit2 signature BEFORE vm.prank (an external call in the
    /// arg list would consume the prank, making caller() != SOLVER), then the relayer submits.
    function _gaslessDepositAndRegister(
        address sponsor,
        bytes12 lockTag,
        uint256 id,
        bytes32 claimHash,
        uint256 deadline
    ) internal {
        string memory wts = arbiter.MANDATE_WITNESS_TYPESTRING();
        bytes memory permitSig = _permit2Sig(id, claimHash, deadline);
        ICompactPermit2.PermitTransferFrom memory permit = ICompactPermit2.PermitTransferFrom({
            permitted: ICompactPermit2.TokenPermissions({ token: USDC, amount: AMOUNT }),
            nonce: 0,
            deadline: deadline
        });
        vm.prank(SOLVER); // SOLVER is the activator baked into the witness
        assertEq(
            ICompactPermit2(THE_COMPACT)
                .depositERC20AndRegisterViaPermit2(
                    permit, sponsor, lockTag, claimHash, 0, wts, permitSig
                ),
            id,
            "permit2 deposit minted a different lock id"
        );
        // The user's USDC now sits in the resource lock (ERC-6909 balance for the sponsor).
        assertEq(
            ICompactPermit2(THE_COMPACT).balanceOf(sponsor, id),
            AMOUNT,
            "lock not funded for sponsor"
        );
    }

    function _buildClaim(
        address sponsor,
        uint256 id,
        uint256 deadline,
        FreeFloCompactArbiter.Mandate memory m
    ) internal view returns (Claim memory c) {
        // Field-by-field (not a struct literal) to keep the via-ir stack shallow.
        // allocatorData / sponsorSignature / claimants default to empty — registered path, no
        // sponsor signature at fill.
        c.sponsor = sponsor;
        c.nonce = uint256(keccak256("permit2-fork-nonce-1"));
        c.expires = deadline;
        c.witness = arbiter.hashMandate(m);
        c.witnessTypestring = arbiter.MANDATE_WITNESS_TYPESTRING();
        c.id = id;
        c.allocatedAmount = AMOUNT;
    }

    function test_ForkE2E_Permit2GaslessSignOnce() public {
        if (skipped) return;
        address sponsor = vm.addr(SPONSOR_PK);
        require(sponsor.code.length == 0, "sponsor must be an EOA on the fork (no code)");
        uint256 deadline = block.timestamp + 1 hours;

        // 1. Register the FreeFlo allocator; derive the lock tag + id.
        bytes12 lockTag =
            _lockTag(ITheCompact(THE_COMPACT).__registerAllocator(address(allocator), ""));
        uint256 id = uint256(bytes32(lockTag)) | uint256(uint160(USDC));

        // 2. The user does the ONE-TIME Permit2 approval (USDC -> Permit2). After this, every
        //    sign-once order is a single gasless signature.
        deal(USDC, sponsor, AMOUNT);
        vm.prank(sponsor);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);

        // 3. Build the compact + mandate and the claim hash the user authorizes.
        FreeFloCompactArbiter.Mandate memory m = _mandate();
        Claim memory c = _buildClaim(sponsor, id, deadline, m);
        bytes32 claimHash = arbiter.computeClaimHash(c, m);

        // 4. GASLESS: the SOLVER (relayer) submits the user's single Permit2 signature — pulls the
        //    USDC into the lock AND registers the compact. The user pays no gas. (Helper keeps the
        //    test's stack shallow under via-ir.)
        _gaslessDepositAndRegister(sponsor, lockTag, id, claimHash, deadline);

        // 5. Solver proves the SEPA payment + claims — fill() with an EMPTY sponsorSignature works
        //    because the compact is registered on-chain. (Helper keeps the stack shallow.)
        _fillCompactAndAssert(c, m, claimHash);
    }

    function _fillCompactAndAssert(
        Claim memory c,
        FreeFloCompactArbiter.Mandate memory m,
        bytes32 claimHash
    ) internal {
        c.allocatorData = _sign65(ALLOCATOR_PK, allocator.authorizationDigest(claimHash));
        PaymentVerifier.PaymentAttestation memory att = _attestation(claimHash);
        bytes memory witnessSig = _sign65(WITNESS_PK, verifier.getDigest(att));
        vm.prank(SOLVER);
        bytes32 returned = arbiter.fill(c, m, att, witnessSig);
        assertEq(returned, claimHash, "claim hash mismatch");
        assertEq(IERC20(USDC).balanceOf(SOLVER), AMOUNT, "solver did not receive the USDC");
    }
}
