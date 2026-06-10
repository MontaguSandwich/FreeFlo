use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::eip712::{sign_attestation, AttestationData, AttestationDomain};
use crate::error::AttestationError;
use crate::verification::{verify_presentation, VerifiedPayment};

/// Request to create an attestation.
#[derive(Debug, Clone, Deserialize)]
pub struct AttestationRequest {
    /// Base64-encoded TLSNotary presentation
    pub presentation: String,

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
    // Decode the base64 presentation.
    let presentation_bytes = base64::engine::general_purpose::STANDARD
        .decode(&request.presentation)
        .map_err(|e| AttestationError::DeserializationError(format!("Invalid base64: {}", e)))?;

    // Verify the presentation and pin the notary key.
    let verified = verify_presentation(
        &presentation_bytes,
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

    Ok(verified)
}

/// Qonto terminal-success transfer statuses.
fn is_settled_status(status: &str) -> bool {
    matches!(status.to_ascii_lowercase().as_str(), "settled" | "completed")
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
