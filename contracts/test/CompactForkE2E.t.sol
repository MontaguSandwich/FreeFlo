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

interface ITheCompactDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice END-TO-END verification of the sign-once offramp against the REAL Compact on Base mainnet.
///         Proves the load-bearing on-chain facts unit tests can't: that the arbiter's replicated
///         claim hash equals what the live Compact computes (so the sponsor signature and the
///         fail-closed assert both hold), that the FreeFloAllocator's `allocatorData` format is
///         accepted, that allocator registration works, and that a claimant with a zero lockTag
///         withdraws the underlying USDC to the filler.
///
/// @dev Auto-skips unless forked (so plain `forge test` stays green). Run with:
///        forge test --match-contract CompactForkE2E --fork-url https://mainnet.base.org -vvv
contract CompactForkE2ETest is Test {
    address constant THE_COMPACT = 0x00000000000000171ede64904551eeDF3C6C9788;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    PaymentVerifier verifier;
    FreeFloCompactArbiter arbiter;
    FreeFloAllocator allocator;
    bool skipped;

    uint256 constant WITNESS_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ALLOCATOR_PK =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant SPONSOR_PK =
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    address constant FILLER = address(0x5050);

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

    function _deposit(uint96 allocatorId) internal returns (uint256 id, bytes12 lockTag) {
        uint256 lockTagUint = (uint256(uint8(Scope.ChainSpecific)) << 255)
            | (uint256(uint8(ResetPeriod.OneDay)) << 252) | (uint256(allocatorId) << 160);
        lockTag = bytes12(bytes32(lockTagUint));
        address sponsor = vm.addr(SPONSOR_PK);
        deal(USDC, sponsor, AMOUNT);
        vm.startPrank(sponsor);
        IERC20(USDC).approve(THE_COMPACT, AMOUNT);
        id = ITheCompact(THE_COMPACT).depositERC20(USDC, lockTag, AMOUNT, sponsor);
        vm.stopPrank();
        assertEq(id, lockTagUint | uint256(uint160(USDC)), "id derivation mismatch");
    }

    function _attestation(bytes32 claimHash)
        internal
        view
        returns (PaymentVerifier.PaymentAttestation memory)
    {
        return PaymentVerifier.PaymentAttestation({
            intentHash: keccak256(abi.encode(claimHash, FILLER)),
            amount: 9200,
            timestamp: block.timestamp,
            paymentId: "fork-sepa-tx-1",
            dataHash: keccak256("proof-data")
        });
    }

    function test_ForkE2E_SignOnceOfframp() public {
        if (skipped) return;

        // 1. Register the FreeFlo allocator with the live Compact (allocator.code > 0 => empty proof).
        uint96 allocatorId = ITheCompact(THE_COMPACT).__registerAllocator(address(allocator), "");

        // 2. Deposit real USDC into a resource lock owned by the sponsor.
        (uint256 id,) = _deposit(allocatorId);

        // 3. Assemble the compact + mandate, then the arbiter's replicated claim hash.
        FreeFloCompactArbiter.Mandate memory m = _mandate();
        Claim memory c = Claim({
            allocatorData: "",
            sponsorSignature: "",
            sponsor: vm.addr(SPONSOR_PK),
            nonce: uint256(keccak256("freeflo-fork-nonce-1")),
            expires: block.timestamp + 1 hours,
            witness: arbiter.hashMandate(m),
            witnessTypestring: arbiter.MANDATE_WITNESS_TYPESTRING(),
            id: id,
            allocatedAmount: AMOUNT,
            claimants: new Component[](0)
        });
        bytes32 claimHash = arbiter.computeClaimHash(c, m);

        // 4. Sponsor authorizes the compact (EIP-712 over the Compact's domain); FreeFlo allocator
        //    authorizes the claim (its own domain over the claim hash).
        c.sponsorSignature = _sign65(
            SPONSOR_PK,
            keccak256(
                abi.encodePacked(
                    "\x19\x01", ITheCompactDomain(THE_COMPACT).DOMAIN_SEPARATOR(), claimHash
                )
            )
        );
        c.allocatorData = _sign65(ALLOCATOR_PK, allocator.authorizationDigest(claimHash));

        // 5. The witness-signed payment attestation, bound to (claimHash, filler).
        PaymentVerifier.PaymentAttestation memory att = _attestation(claimHash);
        bytes memory witnessSig = _sign65(WITNESS_PK, verifier.getDigest(att));

        // 6. Fill: arbiter -> live Compact.claim() -> USDC withdrawn to the filler.
        vm.prank(FILLER);
        bytes32 returned = arbiter.fill(c, m, att, witnessSig);

        assertEq(returned, claimHash, "live Compact claim hash != arbiter's replicated hash");
        assertEq(IERC20(USDC).balanceOf(FILLER), AMOUNT, "filler did not receive the USDC");
        assertTrue(verifier.isNullifierUsed("fork-sepa-tx-1"));
    }
}
