use alloy_primitives::{Address, U256};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::chain::normalize_iban;
use crate::config::Config;
use crate::eip712::{
    compact_claim_hash, compact_intent_hash, mandate_hash, sign_attestation, AttestationData,
    AttestationDomain,
};
use crate::error::AttestationError;
use crate::verification::{verify_presentation, VerifiedPayment};

/// Request to create an attestation.
#[derive(Debug, Clone, Deserialize)]
pub struct AttestationRequest {
    /// Base64-encoded TLSNotary presentation of the transfer (status + amount).
    pub presentation: String,

    /// Base64-encoded TLSNotary presentation of the beneficiary record (recipient
    /// IBAN). Qonto serves status+amount (transfer) and the IBAN (beneficiary) on
    /// separate endpoints and won't keep one notarized connection open for both, so
    /// the IBAN is proven separately and bound here via beneficiary_id.
    #[serde(default)]
    pub beneficiary_presentation: Option<String>,

    /// Intent hash this payment is for
    pub intent_hash: String,

    /// Advisory only (ignored for authorization). The authoritative amount and
    /// beneficiary are taken from the proven transcript and the on-chain intent,
    /// never from these solver-supplied hints.
    #[serde(default)]
    pub expected_amount_cents: i64,

    /// Advisory only (ignored for authorization). See above.
    #[serde(default)]
    pub expected_beneficiary_iban: String,

    /// TIER-1 sign-once offramp binding. When present, the service binds the proven IBAN to the
    /// user's signed Mandate (not an OffRampV3 intent) and signs `intentHash = keccak(claimHash,
    /// filler)`. `intent_hash` above is ignored for this flow.
    #[serde(default)]
    pub compact: Option<CompactBinding>,
}

/// The FreeFlo Mandate the user committed to inside their Compact (mirrors
/// FreeFloCompactArbiter.Mandate). All fields feed the on-chain claim hash, so they must match the
/// compact the user signed exactly.
#[derive(Debug, Clone, Deserialize)]
pub struct MandateInput {
    pub receiving_info: String, // destination IBAN
    pub recipient_name: String, // SEPA recipient name
    pub min_eur_amount: u64,    // floor in cents
    pub currency: u8,           // 0 = EUR
    pub expiry: u64,            // mandate validity deadline (unix seconds)
}

/// Binding data for the sign-once Compact flow. The arbiter address is taken from CONFIG
/// (COMPACT_ARBITER), never from the solver, so a solver cannot point the binding at a rogue
/// arbiter. `nonce`/`id`/`allocated_amount` are uint256 as decimal or 0x-hex strings.
#[derive(Debug, Clone, Deserialize)]
pub struct CompactBinding {
    pub sponsor: String,          // the user who locked the USDC
    pub nonce: String,            // compact nonce (uint256)
    pub expires: u64,             // compact expiry
    pub id: String,               // ERC-6909 resource-lock id (uint256)
    pub allocated_amount: String, // locked USDC amount (uint256, 6dp)
    pub filler: String,           // the solver that will call fill() (front-run binding)
    pub mandate: MandateInput,
}

/// Response containing the signed attestation.
#[derive(Debug, Clone, Serialize)]
pub struct AttestationResponse {
    /// Whether the attestation was successful
    pub success: bool,

    /// The signed attestation (EIP-712 signature)
    pub signature: String,

    /// The digest that was signed
    pub digest: String,

    /// Hash of the attestation data
    pub data_hash: String,

    /// Verified payment details
    pub payment: PaymentDetails,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaymentDetails {
    pub transaction_id: Option<String>,
    pub amount_cents: i64,
    pub beneficiary_iban: String,
    pub timestamp: u64,
    pub server: String,
}

/// Verify a TLSNotary presentation and extract the proven payment.
///
/// Enforces the notary-key pin (inside `verify_presentation`) and a terminal
/// settlement status. The proven values are NOT yet bound to any intent — that
/// happens on-chain in `chain::validate_intent`, against the chain's recorded
/// recipient, never solver-supplied data.
pub fn verify_payment_presentation(
    request: &AttestationRequest,
    config: &Config,
) -> Result<VerifiedPayment, AttestationError> {
    // --- Proof 1: the transfer (status + amount + transfer.beneficiary_id) ---
    let transfer_bytes = base64::engine::general_purpose::STANDARD
        .decode(&request.presentation)
        .map_err(|e| AttestationError::DeserializationError(format!("Invalid base64: {}", e)))?;
    let mut verified = verify_presentation(
        &transfer_bytes,
        &config.allowed_servers,
        config.notary_keys(),
    )?;

    // Settlement gate: only attest payments the provider reports as terminally
    // settled. A pending / declined / canceled transfer must never yield USDC.
    match verified.status.as_deref() {
        Some(s) if is_settled_status(s) => {}
        other => {
            return Err(AttestationError::PaymentNotSettled(
                other.unwrap_or("<missing>").to_string(),
            ))
        }
    }

    // --- Proof 2: the beneficiary (recipient IBAN) ---
    // Qonto splits the IBAN onto the beneficiary record, proven on a separate
    // connection. Required: without it we cannot bind the recipient to the intent.
    let beneficiary_b64 = request
        .beneficiary_presentation
        .as_deref()
        .ok_or_else(|| AttestationError::MissingField("beneficiary_presentation".to_string()))?;
    let beneficiary_bytes = base64::engine::general_purpose::STANDARD
        .decode(beneficiary_b64)
        .map_err(|e| AttestationError::DeserializationError(format!("Invalid base64: {}", e)))?;
    let beneficiary = verify_presentation(
        &beneficiary_bytes,
        &config.allowed_servers,
        config.notary_keys(),
    )?;

    // Bind the two proofs: the proven beneficiary MUST be the transfer's beneficiary,
    // else a solver could staple on a beneficiary proof for an unrelated IBAN.
    match (
        verified.beneficiary_id.as_deref(),
        beneficiary.beneficiary_id.as_deref(),
    ) {
        (Some(t), Some(b)) if t == b => {}
        _ => {
            return Err(AttestationError::InvalidPaymentData(
                "transfer.beneficiary_id does not match the proven beneficiary.id".to_string(),
            ))
        }
    }

    // Carry the proven IBAN onto the transfer's verified payment for on-chain binding.
    verified.beneficiary_iban = beneficiary.beneficiary_iban;
    if verified.beneficiary_iban.is_none() {
        return Err(AttestationError::MissingField(
            "beneficiary_iban".to_string(),
        ));
    }

    Ok(verified)
}

/// Qonto terminal-success transfer statuses.
fn is_settled_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "settled" | "completed"
    )
}

/// Sign an EIP-712 attestation for an already-verified, on-chain-bound payment.
pub fn sign_verified_payment(
    verified: &VerifiedPayment,
    intent_hash_str: &str,
    config: &Config,
) -> Result<AttestationResponse, AttestationError> {
    let intent_hash = decode_bytes32(intent_hash_str)?;

    // Reject non-positive amounts rather than casting a negative i64 to a huge u64.
    let amount: u64 = verified
        .amount_cents
        .filter(|&c| c > 0)
        .ok_or_else(|| AttestationError::MissingField("amount_cents".to_string()))?
        as u64;

    let attestation_data = AttestationData {
        intent_hash,
        amount,
        timestamp: verified.timestamp,
        payment_id: verified.transaction_id.clone().unwrap_or_default(),
        data: verified.response_body.as_bytes().to_vec(),
    };

    let domain = AttestationDomain::new(config.chain_id, config.verifier_contract);
    let (signature, digest) = sign_attestation(&domain, &attestation_data, config.signing_key())?;

    Ok(AttestationResponse {
        success: true,
        signature: format!("0x{}", hex::encode(signature)),
        digest: format!("0x{}", hex::encode(digest)),
        data_hash: format!("0x{}", hex::encode(attestation_data.data_hash())),
        payment: PaymentDetails {
            transaction_id: verified.transaction_id.clone(),
            amount_cents: amount as i64,
            beneficiary_iban: verified.beneficiary_iban.clone().unwrap_or_default(),
            timestamp: verified.timestamp,
            server: verified.server_name.clone(),
        },
    })
}

fn decode_bytes32(hex_str: &str) -> Result<[u8; 32], AttestationError> {
    let hex_str = hex_str.trim_start_matches("0x");
    let bytes = hex::decode(hex_str)
        .map_err(|e| AttestationError::DeserializationError(format!("Invalid hex: {}", e)))?;

    if bytes.len() != 32 {
        return Err(AttestationError::DeserializationError(format!(
            "Expected 32 bytes, got {}",
            bytes.len()
        )));
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Bind a verified payment to a sign-once Compact and return the attestation `intentHash`
/// (`keccak(claimHash, filler)`) as a 0x-hex string. Enforces, OFF-CHAIN: IBAN ==
/// mandate.receivingInfo and the EUR floor. The on-chain arbiter additionally enforces
/// `compact.witness == hashMandate(mandate)` + the floor, so this attestation can ONLY ever release
/// a lock whose user signed THIS exact mandate — the arbiter (from config), not the solver, anchors
/// the claim hash. Order matches the legacy flow: verify (already done) -> bind -> sign.
pub fn resolve_compact_intent_hash(
    verified: &VerifiedPayment,
    compact: &CompactBinding,
    config: &Config,
) -> Result<String, AttestationError> {
    let arbiter = config.compact_arbiter.ok_or_else(|| {
        AttestationError::InvalidPaymentData(
            "Compact flow not enabled (COMPACT_ARBITER unset)".to_string(),
        )
    })?;

    // 1. Bind the PROVEN beneficiary IBAN to the user's mandate (same normalization as the
    //    OffRampV3 path). The solver does not get to assert the payee; the user's mandate does.
    let proven_iban = verified
        .beneficiary_iban
        .as_deref()
        .ok_or_else(|| AttestationError::MissingField("beneficiary_iban".to_string()))?;
    if normalize_iban(proven_iban) != normalize_iban(&compact.mandate.receiving_info) {
        return Err(AttestationError::InvalidPaymentData(format!(
            "Beneficiary mismatch: proof paid IBAN '{}', mandate recipient is '{}'",
            proven_iban, compact.mandate.receiving_info
        )));
    }

    // 2. Enforce the user's signed EUR floor (the arbiter re-checks this on-chain).
    let amount = verified
        .amount_cents
        .filter(|&c| c > 0)
        .ok_or_else(|| AttestationError::MissingField("amount_cents".to_string()))?;
    if (amount as u64) < compact.mandate.min_eur_amount {
        return Err(AttestationError::InvalidPaymentData(format!(
            "Amount below floor: proven {} cents < mandate minimum {} cents",
            amount, compact.mandate.min_eur_amount
        )));
    }

    // 3. Recompute the Compact claim hash and the filler-bound intentHash.
    let sponsor: Address = compact.sponsor.parse().map_err(|e| {
        AttestationError::DeserializationError(format!("Invalid sponsor address: {}", e))
    })?;
    let filler: Address = compact.filler.parse().map_err(|e| {
        AttestationError::DeserializationError(format!("Invalid filler address: {}", e))
    })?;
    let nonce = parse_u256(&compact.nonce, "nonce")?;
    let id = parse_u256(&compact.id, "id")?;
    let allocated = parse_u256(&compact.allocated_amount, "allocated_amount")?;

    let witness = mandate_hash(
        &compact.mandate.receiving_info,
        &compact.mandate.recipient_name,
        compact.mandate.min_eur_amount,
        compact.mandate.currency,
        compact.mandate.expiry,
    );
    let claim_hash = compact_claim_hash(
        Address::from(arbiter),
        sponsor,
        nonce,
        U256::from(compact.expires),
        id,
        allocated,
        witness,
    );
    let intent = compact_intent_hash(claim_hash, filler);
    Ok(format!("0x{}", hex::encode(intent)))
}

fn parse_u256(s: &str, field: &str) -> Result<U256, AttestationError> {
    let t = s.trim();
    let parsed = if let Some(hex_part) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        U256::from_str_radix(hex_part, 16)
    } else {
        U256::from_str_radix(t, 10)
    };
    parsed.map_err(|e| AttestationError::DeserializationError(format!("Invalid {}: {}", field, e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settlement_gate() {
        assert!(is_settled_status("settled"));
        assert!(is_settled_status("completed"));
        assert!(is_settled_status("COMPLETED"));
        assert!(!is_settled_status("pending"));
        assert!(!is_settled_status("declined"));
        assert!(!is_settled_status("processing"));
        assert!(!is_settled_status(""));
    }
}
