// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PaymentVerifier } from "./PaymentVerifier.sol";
import { ITheCompact, Claim, Component } from "./interfaces/ITheCompact.sol";

/**
 * @title FreeFloCompactArbiter (TIER-1 — sign-once offramp)
 * @notice A thin arbiter for Uniswap's The Compact that turns the USDC->SEPA offramp into ONE
 *         gasless user signature, by REUSING FreeFlo's existing witness-signed PaymentVerifier as
 *         the release condition.
 *
 * Sign-once offramp flow:
 *   1. User (sponsor) deposits USDC into a resource lock and registers ONE EIP-712 Compact naming
 *      THIS contract as arbiter, with `witness` = hashMandate(Mandate{IBAN, recipientName, minEUR,
 *      currency, expiry}). Gasless via depositERC20AndRegisterViaPermit2 — a single off-chain
 *      signature; no createIntent tx, no commit tx.
 *   2. A solver/filler sends the SEPA EUR and obtains a witness-signed PaymentAttestation whose
 *      `intentHash` the FreeFlo attestation service binds to (this exact claim hash, this filler).
 *   3. The filler calls fill(): the arbiter (a) recomputes The Compact's claim hash and binds the
 *      proof to it AND to the filler, (b) enforces the user's signed EUR floor, (c) verifies the
 *      attestation via the existing PaymentVerifier (EIP-712 + witness auth + nullifier burn), then
 *      (d) calls The Compact's claim() to withdraw the locked USDC to the filler, and asserts the
 *      realized claim hash matches the one it bound against (fail-closed).
 *
 * Trust delta vs OffRampV3 is small and aligned: FreeFlo already runs the trusted witness (the
 * arbiter IS that existing attestation); the only genuinely new party is the allocator, which
 * FreeFlo self-runs and which can only DELAY, never steal — the sponsor force-withdraws after
 * `resetPeriod` (ITheCompact.forcedWithdrawal), a strictly stronger escape than OffRampV3's
 * rescueTimedOut. See docs/design/COMPACT-ARBITER.md and .claude/rules/security-invariants.md.
 *
 * @dev Production bindings closed vs the spike (docs/design/COMPACT-ARBITER.md gap list):
 *   - #1 Claim-hash binding: the attestation is bound to the FULL Compact claim hash (incl.
 *        nonce/id/amount/sponsor), not just the mandate hash, so one mandate can't be reused across
 *        locks. The arbiter replicates The Compact's EIP-712 claim-hash derivation (COMPACT_WITNESS_
 *        TYPEHASH verified against the canonical non-witness COMPACT_TYPEHASH 0x73b6..eebc7) and,
 *        belt-and-suspenders, asserts theCompact.claim()'s return equals it.
 *   - #2 Filler binding: the witness signs `intentHash = keccak256(abi.encode(claimHash, filler))`,
 *        so a copycat that front-runs the fill tx (different msg.sender) fails the binding. This
 *        reuses the EXISTING PaymentAttestation.intentHash field — no change to the audited
 *        PaymentVerifier struct/typehash/domain.
 */
contract FreeFloCompactArbiter is ReentrancyGuard {
    // ============ Immutables ============

    /// @notice The EXISTING FreeFlo attestation verifier — reused verbatim, no fork.
    PaymentVerifier public immutable verifier;

    /// @notice The Compact (resource locks) this arbiter settles against.
    ITheCompact public immutable theCompact;

    // ============ Mandate (the off-chain condition carried in the compact witness) ============

    /// @notice The release condition the sponsor commits to. Mirrors OffRampV3's on-chain binding
    ///         (receivingInfo / recipientName / minEUR / currency).
    struct Mandate {
        string receivingInfo; // destination IBAN (the proven payment must match)
        string recipientName; // SEPA recipient name
        uint256 minEurAmount; // floor in cents — the proven amount must be >= this
        uint8 currency; // OffRampV3.Currency (0 = EUR)
        uint256 expiry; // mandate validity deadline (unix seconds)
    }

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)"
    );

    /// @notice The witness typestring the sponsor's Compact must declare. The Compact HARDCODES the
    ///         wrapper "...,uint256 amount,Mandate mandate)Mandate(" and appends the closing ")"
    ///         itself, so this is the Mandate's INNER fields ONLY. (Verified against
    ///         the-compact COMPACT_TYPESTRING_FRAGMENT_{FOUR,FIVE}, 2026-06-15.)
    string public constant MANDATE_WITNESS_TYPESTRING =
        "string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry";

    /// @notice keccak256 of the FULL witnessed Compact typestring The Compact hashes for a FreeFlo
    ///         Mandate: "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,
    ///         bytes12 lockTag,address token,uint256 amount,Mandate mandate)Mandate(<inner fields>)".
    ///         Equals 0x1331dc89...; the non-witness prefix is the canonical COMPACT_TYPEHASH
    ///         0x73b631296de001508966ddfc334593ad8f850ccd3be4d2c58a9ed469844eebc7 (pinned in tests).
    bytes32 public constant COMPACT_WITNESS_TYPEHASH = keccak256(
        "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount,Mandate mandate)Mandate(string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)"
    );

    // ============ Events ============

    event CompactFilled(
        bytes32 indexed claimHash, address indexed filler, bytes32 nullifier, uint256 eurAmount
    );

    // ============ Errors ============

    error WitnessMismatch();
    error WitnessTypestringMismatch();
    error MandateExpired();
    error AttestationNotForClaim();
    error AmountBelowFloor(uint256 proven, uint256 minimum);
    error PaymentVerificationFailed();
    error ClaimHashMismatch(bytes32 realized, bytes32 expected);

    // ============ Constructor ============

    constructor(address _verifier, address _theCompact) {
        verifier = PaymentVerifier(_verifier);
        theCompact = ITheCompact(_theCompact);
    }

    // ============ Hashing (mirrors The Compact + the attestation service) ============

    /// @notice EIP-712 hashStruct of a Mandate — equals the Compact's `witness` word.
    function hashMandate(Mandate calldata m) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MANDATE_TYPEHASH,
                keccak256(bytes(m.receivingInfo)),
                keccak256(bytes(m.recipientName)),
                m.minEurAmount,
                m.currency,
                m.expiry
            )
        );
    }

    /// @notice Replicate The Compact's single-chain claim-hash derivation for a witnessed compact.
    /// @dev The Compact hashes `Compact(address arbiter,address sponsor,uint256 nonce,uint256
    ///      expires,bytes12 lockTag,address token,uint256 amount,Mandate mandate)` with `arbiter` =
    ///      the caller of claim() (this contract) and the lock `id` split into its `bytes12 lockTag`
    ///      (upper 96 bits, left-aligned) and `address token` (lower 160 bits). This MUST equal the
    ///      value theCompact.claim() returns; fill() asserts that, so any divergence fails closed.
    function _computeClaimHash(Claim calldata c, bytes32 witness) internal view returns (bytes32) {
        bytes12 lockTag = bytes12(bytes32(c.id)); // upper 96 bits of the id
        address token = address(uint160(c.id)); // lower 160 bits of the id
        return keccak256(
            abi.encode(
                COMPACT_WITNESS_TYPEHASH,
                address(this), // arbiter == msg.sender to The Compact
                c.sponsor,
                c.nonce,
                c.expires,
                lockTag,
                token,
                c.allocatedAmount,
                witness
            )
        );
    }

    /// @notice The Compact claim hash for a given (compact, mandate). Off-chain helpers (attestation
    ///         service, solver, frontend) call this on the deployed arbiter to stay byte-identical.
    function computeClaimHash(Claim calldata claimInput, Mandate calldata mandate)
        external
        view
        returns (bytes32)
    {
        return _computeClaimHash(claimInput, hashMandate(mandate));
    }

    /// @notice The exact `intentHash` the FreeFlo attestation service must sign (and the solver must
    ///         request) for THIS compact filled by THIS filler. Binds the claim hash AND the filler.
    function expectedIntentHash(Claim calldata claimInput, Mandate calldata mandate, address filler)
        external
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(_computeClaimHash(claimInput, hashMandate(mandate)), filler));
    }

    // ============ Filler entrypoint ============

    /**
     * @notice Prove the SEPA payment and withdraw the locked USDC to the filler (msg.sender).
     * @param claimInput The sponsor-registered/signed Compact. Its `claimants` are ignored and
     *        replaced — the arbiter, not the caller, controls the recipient.
     * @param mandate The off-chain condition; must hash to the compact's `witness`.
     * @param attestation FreeFlo's witness-signed payment attestation. Its `intentHash` MUST equal
     *        keccak256(abi.encode(claimHash, msg.sender)).
     * @param signature The attestation service's EIP-712 signature.
     * @return claimHash The Compact's hash of the processed claim.
     */
    function fill(
        Claim calldata claimInput,
        Mandate calldata mandate,
        PaymentVerifier.PaymentAttestation calldata attestation,
        bytes calldata signature
    ) external nonReentrant returns (bytes32 claimHash) {
        // 1. Bind the sponsor-signed compact to THIS mandate.
        bytes32 mandateHash = hashMandate(mandate);
        if (claimInput.witness != mandateHash) revert WitnessMismatch();

        // 1b. The compact must declare the Mandate typestring this arbiter assumes — otherwise The
        //     Compact would hash a different typehash than COMPACT_WITNESS_TYPEHASH. (Defense in
        //     depth: a wrong typestring also trips the realized-claim-hash assert in step 7.)
        if (
            keccak256(bytes(claimInput.witnessTypestring))
                != keccak256(bytes(MANDATE_WITNESS_TYPESTRING))
        ) revert WitnessTypestringMismatch();

        // 2. The mandate must still be live.
        if (block.timestamp > mandate.expiry) revert MandateExpired();

        // 3. Bind the proof to the FULL Compact claim hash (incl. nonce/id/amount/sponsor) AND to
        //    the filler. A reused mandate on a different lock yields a different claimHash; a
        //    front-running copycat has a different msg.sender. Both break this equality.
        claimHash = _computeClaimHash(claimInput, mandateHash);
        if (attestation.intentHash != keccak256(abi.encode(claimHash, msg.sender))) {
            revert AttestationNotForClaim();
        }

        // 4. The proven EUR must clear the user's signed floor.
        if (attestation.amount < mandate.minEurAmount) {
            revert AmountBelowFloor(attestation.amount, mandate.minEurAmount);
        }

        // 5. Verify the witness-signed attestation. REUSES the audited PaymentVerifier verbatim —
        //    EIP-712 domain, witness authorization, and nullifier consume (so a payment id can only
        //    release one lock). Effects-before-interaction: the nullifier is burned here, before the
        //    external claim() call below.
        (bool ok,) = verifier.verifyPayment(attestation, signature);
        if (!ok) revert PaymentVerificationFailed();

        // 6. Direct the full locked amount to the filler as an UNDERLYING-TOKEN withdrawal (zero
        //    lockTag in the claimant => The Compact pays out the USDC itself). The arbiter sets the
        //    recipient; a caller cannot redirect the funds elsewhere.
        Component[] memory claimants = new Component[](1);
        claimants[0] = Component({
            claimant: uint256(uint160(msg.sender)), amount: claimInput.allocatedAmount
        });

        Claim memory finalClaim = Claim({
            allocatorData: claimInput.allocatorData,
            sponsorSignature: claimInput.sponsorSignature,
            sponsor: claimInput.sponsor,
            nonce: claimInput.nonce,
            expires: claimInput.expires,
            witness: claimInput.witness,
            witnessTypestring: claimInput.witnessTypestring,
            id: claimInput.id,
            allocatedAmount: claimInput.allocatedAmount,
            claimants: claimants
        });

        // 7. Submit to The Compact. As the named arbiter (msg.sender), this withdraws the lock to
        //    the filler once The Compact validates sponsor + allocator sigs. Assert the realized
        //    claim hash equals the one we bound against — if our replication ever diverged from The
        //    Compact, the whole tx (incl. the nullifier burn) reverts rather than mis-binding.
        bytes32 realized = theCompact.claim(finalClaim);
        if (realized != claimHash) revert ClaimHashMismatch(realized, claimHash);

        emit CompactFilled(
            claimHash, msg.sender, keccak256(bytes(attestation.paymentId)), attestation.amount
        );
    }
}
