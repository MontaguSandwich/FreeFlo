// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PaymentVerifier } from "./PaymentVerifier.sol";
import { ITheCompact, Claim, Component } from "./interfaces/ITheCompact.sol";

/**
 * @title FreeFloCompactArbiter (TIER-1 spike — sign-once offramp PoC)
 * @notice A thin arbiter for Uniswap's The Compact that turns the USDC->SEPA offramp
 *         into ONE gasless user signature, by REUSING FreeFlo's existing
 *         witness-signed PaymentVerifier as the release condition.
 *
 * Sign-once offramp flow:
 *   1. User (sponsor) deposits USDC into a resource lock (gasless via Permit2) and
 *      signs ONE EIP-712 Compact naming THIS contract as arbiter, with `witness` =
 *      hashMandate(Mandate{IBAN, recipientName, minEUR, currency, expiry}). No
 *      createIntent tx, no commit tx — a single off-chain signature.
 *   2. A solver/filler sends the SEPA EUR and obtains the SAME witness-signed
 *      EIP-712 PaymentAttestation FreeFlo already produces today.
 *   3. The filler calls fill(): the arbiter (a) binds the proof to the signed
 *      mandate, (b) verifies it via the existing PaymentVerifier (EIP-712 + nullifier
 *      + floor), then (c) calls The Compact's claim() to release the locked USDC to
 *      the filler. The Compact verifies the sponsor + allocator signatures over the
 *      claim hash (which incorporates the witness) and transfers the funds.
 *
 * Trust delta vs OffRampV3 is small and aligned: FreeFlo already runs the trusted
 * witness (the arbiter IS that existing attestation); the only genuinely new party is
 * the allocator, which FreeFlo self-runs and which can only DELAY, never steal — the
 * sponsor force-withdraws after `resetPeriod` (ITheCompact.forcedWithdrawal), a
 * strictly stronger escape than OffRampV3's rescueTimedOut.
 *
 * @dev SPIKE STATUS — known production gaps (see docs/design/COMPACT-ARBITER.md):
 *   - Binds attestation.intentHash to the MANDATE hash. Production should bind to the
 *     full Compact claim hash (incl. nonce/id) so one mandate can't be reused across
 *     locks; the per-payment nullifier already prevents double-claim of a payment.
 *   - The filler is msg.sender. A copycat could front-run a filler's tx with the same
 *     (bearer) attestation. Production must bind the filler into the signed attestation
 *     (or use a private mempool / commit-reveal).
 *   - ITheCompact is a minimal modeled slice; reconcile with the canonical ABI.
 */
contract FreeFloCompactArbiter is ReentrancyGuard {
    // ============ Immutables ============

    /// @notice The EXISTING FreeFlo attestation verifier — reused verbatim, no fork.
    PaymentVerifier public immutable verifier;

    /// @notice The Compact (resource locks) this arbiter settles against.
    ITheCompact public immutable theCompact;

    // ============ Mandate (the off-chain condition carried in the compact witness) ============

    /// @notice The release condition the sponsor commits to. Mirrors OffRampV3's
    ///         on-chain binding (receivingInfo / recipientName / minEUR / currency).
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

    /// @notice The witness typestring the sponsor's Compact must declare so The Compact
    ///         reconstructs the same claim hash this arbiter binds against.
    string public constant MANDATE_WITNESS_TYPESTRING =
        "Mandate mandate)Mandate(string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)";

    // ============ Events ============

    event CompactFilled(
        bytes32 indexed claimHash, address indexed filler, bytes32 nullifier, uint256 eurAmount
    );

    // ============ Errors ============

    error WitnessMismatch();
    error MandateExpired();
    error AttestationNotForMandate();
    error AmountBelowFloor(uint256 proven, uint256 minimum);
    error PaymentVerificationFailed();

    // ============ Constructor ============

    constructor(address _verifier, address _theCompact) {
        verifier = PaymentVerifier(_verifier);
        theCompact = ITheCompact(_theCompact);
    }

    // ============ Mandate hashing ============

    /// @notice EIP-712 hashStruct of a Mandate — equals the Compact's `witness`.
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

    // ============ Filler entrypoint ============

    /**
     * @notice Prove the SEPA payment and claim the locked USDC to the filler (msg.sender).
     * @param claimInput The sponsor-signed Compact (its `claimants` are ignored and
     *        replaced — the arbiter, not the caller, controls the recipient).
     * @param mandate The off-chain condition; must hash to the compact's `witness`.
     * @param attestation FreeFlo's witness-signed payment attestation.
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

        // 2. The mandate must still be live.
        if (block.timestamp > mandate.expiry) revert MandateExpired();

        // 3. The proof must be FOR this mandate (the witness binds proof <-> compact).
        if (attestation.intentHash != mandateHash) revert AttestationNotForMandate();

        // 4. The proven EUR must clear the user's signed floor.
        if (attestation.amount < mandate.minEurAmount) {
            revert AmountBelowFloor(attestation.amount, mandate.minEurAmount);
        }

        // 5. Verify the witness-signed attestation. REUSES the audited PaymentVerifier
        //    verbatim — EIP-712 domain, witness authorization, and nullifier consume
        //    (so a payment id can only release one lock). Effects-before-interaction:
        //    the nullifier is burned here, before the external claim() call below.
        (bool ok,) = verifier.verifyPayment(attestation, signature);
        if (!ok) revert PaymentVerificationFailed();

        // 6. Direct the full locked amount to the filler. The arbiter sets the
        //    recipient; a caller cannot redirect the funds elsewhere.
        Component[] memory claimants = new Component[](1);
        claimants[0] =
            Component({ claimant: uint256(uint160(msg.sender)), amount: claimInput.allocatedAmount });

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

        // 7. Submit to The Compact. As the named arbiter (msg.sender), this releases
        //    the lock to the filler once The Compact validates sponsor + allocator sigs.
        claimHash = theCompact.claim(finalClaim);

        emit CompactFilled(
            claimHash, msg.sender, keccak256(bytes(attestation.paymentId)), attestation.amount
        );
    }
}
