// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { FreeFloAllocator } from "../src/FreeFloAllocator.sol";
import { IAllocator } from "../src/interfaces/IAllocator.sol";

contract FreeFloAllocatorTest is Test {
    FreeFloAllocator allocator;

    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil #0
    uint256 constant BAD_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // anvil #1
    address signer;

    address constant ARBITER = address(0xA9B17E);
    address constant OTHER_ARBITER = address(0xBAD);

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        allocator = new FreeFloAllocator(signer, ARBITER);
    }

    function _sig(uint256 pk, bytes32 claimHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, allocator.authorizationDigest(claimHash));
        return abi.encodePacked(r, s, v);
    }

    function _empty() internal pure returns (uint256[2][] memory) {
        return new uint256[2][](0);
    }

    function test_AuthorizeClaim_ValidSignature() public view {
        bytes32 claimHash = keccak256("claim-1");
        bytes4 ret = allocator.authorizeClaim(
            claimHash, ARBITER, address(0x1), 1, 2, _empty(), _sig(SIGNER_PK, claimHash)
        );
        assertEq(ret, IAllocator.authorizeClaim.selector);
    }

    function test_AuthorizeClaim_RevertsBadSignature() public {
        bytes32 claimHash = keccak256("claim-2");
        // Pre-compute the sig: _sig() makes an external call (authorizationDigest) that would
        // otherwise consume the vm.expectRevert during argument evaluation.
        bytes memory sig = _sig(BAD_PK, claimHash);
        uint256[2][] memory ids = _empty();
        vm.expectRevert(FreeFloAllocator.BadAllocatorSignature.selector);
        allocator.authorizeClaim(claimHash, ARBITER, address(0x1), 1, 2, ids, sig);
    }

    function test_AuthorizeClaim_RevertsWrongArbiter() public {
        bytes32 claimHash = keccak256("claim-3");
        bytes memory sig = _sig(SIGNER_PK, claimHash);
        uint256[2][] memory ids = _empty();
        vm.expectRevert(
            abi.encodeWithSelector(FreeFloAllocator.WrongArbiter.selector, OTHER_ARBITER, ARBITER)
        );
        allocator.authorizeClaim(claimHash, OTHER_ARBITER, address(0x1), 1, 2, ids, sig);
    }

    function test_AuthorizeClaim_RevertsSignatureForDifferentClaim() public {
        // Signature is valid but over a DIFFERENT claim hash.
        bytes memory sig = _sig(SIGNER_PK, keccak256("claim-A"));
        vm.expectRevert(FreeFloAllocator.BadAllocatorSignature.selector);
        allocator.authorizeClaim(keccak256("claim-B"), ARBITER, address(0x1), 1, 2, _empty(), sig);
    }

    function test_IsClaimAuthorized() public view {
        bytes32 claimHash = keccak256("claim-view");
        assertTrue(
            allocator.isClaimAuthorized(
                claimHash, ARBITER, address(0x1), 1, 2, _empty(), _sig(SIGNER_PK, claimHash)
            )
        );
        assertFalse(
            allocator.isClaimAuthorized(
                claimHash, ARBITER, address(0x1), 1, 2, _empty(), _sig(BAD_PK, claimHash)
            )
        );
        assertFalse(
            allocator.isClaimAuthorized(
                claimHash, OTHER_ARBITER, address(0x1), 1, 2, _empty(), _sig(SIGNER_PK, claimHash)
            )
        );
    }

    function test_Attest_Reverts() public {
        vm.expectRevert(FreeFloAllocator.TransfersDisabled.selector);
        allocator.attest(address(0x1), address(0x2), address(0x3), 1, 100);
    }

    function test_DomainSeparatorBindsToChainAndContract() public {
        // A redeploy on the same chain yields a different domain (different address) — so an
        // allocator signature can't be replayed against a different allocator instance.
        FreeFloAllocator other = new FreeFloAllocator(signer, ARBITER);
        assertTrue(other.DOMAIN_SEPARATOR() != allocator.DOMAIN_SEPARATOR());
    }
}
