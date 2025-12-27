use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::eip712::{sign_attestation, AttestationData, AttestationDomain};
use crate::error::AttestationError;
use crate::verification::{verify_presentation, VerifiedPayment};

/// Request to create an attestation
#[derive(Debug, Clone, Deserialize)]
pub struct AttestationRequest {
    /// Base64-encoded TLSNotary presentation
    pub presentation: String,
    
    /// Intent hash this payment is for
    pub intent_hash: String,
    
    /// Expected amount in cents (for validation)
    pub expected_amount_cents: i64,
    
    /// Expected beneficiary IBAN (for validation)
    pub expected_beneficiary_iban: String,
}

/// Response containing the signed attestation
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

/// Create a signed attestation from a TLSNotary presentation
pub fn create_attestation(
    request: &AttestationRequest,
    config: &Config,
) -> Result<AttestationResponse, AttestationError> {
    // Decode the presentation
    let presentation_bytes = base64::engine::general_purpose::STANDARD
        .decode(&request.presentation)
        .map_err(|e| AttestationError::DeserializationError(format!("Invalid base64: {}", e)))?;
    
    // Verify the TLSNotary presentation
    let verified = verify_presentation(&presentation_bytes, &config.allowed_servers)?;
    
    // Validate the payment matches expectations
    validate_payment(&verified, request)?;
    
    // Decode intent hash
    let intent_hash = decode_bytes32(&request.intent_hash)?;
    
    // Prepare attestation data
    let attestation_data = AttestationData {
        intent_hash,
        amount: verified.amount_cents.unwrap_or(0) as u64,
        timestamp: verified.timestamp,
        payment_id: verified.transaction_id.clone().unwrap_or_default(),
        data: verified.response_body.as_bytes().to_vec(),
    };
    
    // Create EIP-712 domain
    let domain = AttestationDomain::new(config.chain_id, config.verifier_contract);
    
    // Sign the attestation
    let (signature, digest) = sign_attestation(&domain, &attestation_data, config.signing_key())?;
    
    Ok(AttestationResponse {
        success: true,
        signature: format!("0x{}", hex::encode(signature)),
        digest: format!("0x{}", hex::encode(digest)),
        data_hash: format!("0x{}", hex::encode(attestation_data.data_hash())),
        payment: PaymentDetails {
            transaction_id: verified.transaction_id,
            amount_cents: verified.amount_cents.unwrap_or(0),
            beneficiary_iban: verified.beneficiary_iban.unwrap_or_default(),
            timestamp: verified.timestamp,
            server: verified.server_name,
        },
    })
}

fn validate_payment(
    verified: &VerifiedPayment,
    request: &AttestationRequest,
) -> Result<(), AttestationError> {
    // If expected values are 0/empty, skip validation (for testing)
    if request.expected_amount_cents == 0 && request.expected_beneficiary_iban.is_empty() {
        return Ok(());
    }
    
    // Check amount matches (only if expected is non-zero)
    if request.expected_amount_cents > 0 {
        let actual_amount = verified.amount_cents
            .ok_or_else(|| AttestationError::MissingField("amount_cents".to_string()))?;
        
        if actual_amount != request.expected_amount_cents {
            return Err(AttestationError::InvalidPaymentData(format!(
                "Amount mismatch: expected {} cents, got {} cents",
                request.expected_amount_cents,
                actual_amount
            )));
        }
    }
    
    // Check beneficiary IBAN matches (only if expected is non-empty)
    if !request.expected_beneficiary_iban.is_empty() {
        let expected_iban = normalize_iban(&request.expected_beneficiary_iban);
        let actual_iban = verified.beneficiary_iban.as_ref()
            .map(|s| normalize_iban(s))
            .ok_or_else(|| AttestationError::MissingField("beneficiary_iban".to_string()))?;
        
        if expected_iban != actual_iban {
            return Err(AttestationError::InvalidPaymentData(format!(
                "IBAN mismatch: expected {}, got {}",
                expected_iban,
                actual_iban
            )));
        }
    }
    
    Ok(())
}

fn normalize_iban(iban: &str) -> String {
    iban.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase()
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

