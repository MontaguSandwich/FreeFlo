use tlsn::attestation::{
    presentation::{Presentation, PresentationOutput},
    CryptoProvider,
};

use crate::error::AttestationError;

/// Verified payment information extracted from a TLSNotary presentation
#[derive(Debug, Clone)]
pub struct VerifiedPayment {
    /// Server name (e.g., "thirdparty.qonto.com")
    pub server_name: String,
    
    /// Timestamp of the TLS connection
    pub timestamp: u64,
    
    /// The disclosed response body (JSON)
    pub response_body: String,
    
    /// Transaction ID from the API response
    pub transaction_id: Option<String>,
    
    /// Amount in the smallest currency unit (cents for EUR)
    pub amount_cents: Option<i64>,
    
    /// Beneficiary IBAN
    pub beneficiary_iban: Option<String>,
    
    /// Transaction status
    pub status: Option<String>,
}

/// Verify a TLSNotary presentation and extract payment information
pub fn verify_presentation(
    presentation_bytes: &[u8],
    allowed_servers: &[String],
) -> Result<VerifiedPayment, AttestationError> {
    // Deserialize the presentation
    let presentation: Presentation = bincode::deserialize(presentation_bytes)
        .map_err(|e| AttestationError::DeserializationError(format!("Failed to deserialize presentation: {}", e)))?;
    
    // Use default crypto provider (trusts standard root CAs)
    let crypto_provider = CryptoProvider::default();
    
    // Verify the presentation
    let PresentationOutput {
        server_name,
        connection_info,
        transcript,
        ..
    } = presentation.verify(&crypto_provider)
        .map_err(|e| AttestationError::VerificationFailed(format!("Presentation verification failed: {:?}", e)))?;
    
    // Extract server name
    let server_name = server_name
        .ok_or(AttestationError::ServerNotFound)?
        .to_string();
    
    // Check if server is in allowed list
    if !allowed_servers.iter().any(|s| server_name.contains(s)) {
        return Err(AttestationError::UnexpectedServer {
            expected: allowed_servers.join(", "),
            actual: server_name,
        });
    }
    
    // Extract transcript
    let mut partial_transcript = transcript
        .ok_or(AttestationError::TranscriptNotFound)?;
    
    // Mark unauthenticated bytes
    partial_transcript.set_unauthed(b'X');
    
    // Extract the response body from the received data
    let received = String::from_utf8_lossy(partial_transcript.received_unsafe());
    
    // Parse HTTP response to extract JSON body
    let response_body = extract_json_body(&received)?;
    
    // Extract payment details from JSON
    let (transaction_id, amount_cents, beneficiary_iban, status) = parse_payment_details(&response_body)?;
    
    Ok(VerifiedPayment {
        server_name,
        timestamp: connection_info.time,
        response_body,
        transaction_id,
        amount_cents,
        beneficiary_iban,
        status,
    })
}

/// Extract JSON body from HTTP response (with selective disclosure handling)
fn extract_json_body(response: &str) -> Result<String, AttestationError> {
    // Find the start of body (after headers)
    // Look for double CRLF or double LF that separates headers from body
    let body_start = response
        .find("\r\n\r\n")
        .map(|i| i + 4)
        .or_else(|| response.find("\n\n").map(|i| i + 2))
        .ok_or_else(|| AttestationError::InvalidPaymentData("Could not find response body".to_string()))?;
    
    let body = &response[body_start..];
    
    // For selectively disclosed responses, the body contains revealed values
    // interspersed with 'X' for redacted content. We need to extract visible fields.
    //
    // Example with selective disclosure:
    // XXXXXXX019b2249-50b2-7778-8b9eXXXXXXEI - MALYEN MalekXXXXX
    //
    // We extract the visible (non-X) runs of text
    
    // First try to find a proper JSON structure
    if let Some(json_start) = body.find('{') {
        let json_body = &body[json_start..];
        if let Some(json_end) = json_body.rfind('}') {
            return Ok(json_body[..=json_end].to_string());
        }
    }
    
    // If no JSON structure, extract visible content for manual parsing
    // This is for selectively disclosed content
    let visible_content = extract_visible_content(body);
    
    if visible_content.is_empty() {
        return Err(AttestationError::InvalidPaymentData("No visible content in response body".to_string()));
    }
    
    // Try to reconstruct a minimal JSON from visible content
    // For now, return the raw visible content for debugging
    Ok(format!("{{\"_visible_content\": {:?}}}", visible_content))
}

/// Extract visible (non-redacted) content from a selectively disclosed transcript
fn extract_visible_content(body: &str) -> Vec<String> {
    let mut visible_parts = Vec::new();
    let mut current_part = String::new();
    
    for c in body.chars() {
        if c == 'X' {
            if !current_part.is_empty() {
                visible_parts.push(current_part.clone());
                current_part.clear();
            }
        } else {
            current_part.push(c);
        }
    }
    
    if !current_part.is_empty() {
        visible_parts.push(current_part);
    }
    
    // Filter out very short noise strings (less than 3 chars)
    visible_parts.into_iter()
        .filter(|s| s.len() >= 3 && s.chars().any(|c| c.is_alphanumeric()))
        .collect()
}

/// Parse payment details from Qonto transaction JSON or selectively disclosed content
fn parse_payment_details(json: &str) -> Result<(Option<String>, Option<i64>, Option<String>, Option<String>), AttestationError> {
    // First try standard JSON parsing
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
        // Check for _visible_content (selective disclosure fallback)
        if let Some(visible) = value.get("_visible_content") {
            // This is extracted visible content, not proper JSON
            // For now, return None values - in production, we'd parse this more intelligently
            return Ok((None, None, None, None));
        }
        
        // Try to extract from Qonto transaction format
        // Format: { "transaction": { ... } } or { "transactions": [...] }
        let tx = value.get("transaction")
            .or_else(|| value.get("transactions").and_then(|t| t.get(0)))
            .or_else(|| value.get("transfer")); // Also try transfer format
        
        let transaction_id = tx
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        
        // Amount is in the transaction, could be "amount" or "local_amount"
        let amount_cents: Option<i64> = tx
            .and_then(|t| t.get("amount_cents"))
            .or_else(|| tx.and_then(|t| t.get("local_amount_cents")))
            .and_then(|v| v.as_i64())
            .or_else(|| {
                // Also try to get amount in decimal format and convert
                tx.and_then(|t| t.get("amount"))
                    .and_then(|v| v.as_f64())
                    .map(|a| (a * 100.0) as i64)
            })
            .and_then(|v| if v == 0 { None } else { Some(v) });
        
        // For SEPA transfers, beneficiary IBAN can be in different locations:
        // - Qonto transactions: transfer.counterparty_account_number
        // - Other formats: counterparty.iban, beneficiary.iban, beneficiary_iban
        let beneficiary_iban = tx
            .and_then(|t| t.get("transfer"))
            .and_then(|t| t.get("counterparty_account_number"))
            .or_else(|| tx.and_then(|t| t.get("counterparty")).and_then(|c| c.get("iban")))
            .or_else(|| tx.and_then(|t| t.get("counterparty")).and_then(|c| c.get("account_number")))
            .or_else(|| tx.and_then(|t| t.get("beneficiary")).and_then(|b| b.get("iban")))
            .or_else(|| tx.and_then(|t| t.get("beneficiary_iban")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        
        let status = tx
            .and_then(|t| t.get("status"))
            .or_else(|| tx.and_then(|t| t.get("operation_type")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        
        return Ok((transaction_id, amount_cents, beneficiary_iban, status));
    }
    
    // If JSON parsing fails, try to extract from raw content (selective disclosure)
    // Look for UUID patterns (transfer IDs), amounts, and IBAN patterns
    let transaction_id = extract_uuid(json);
    let beneficiary_iban = extract_iban(json);
    let amount_cents = extract_amount(json);
    
    Ok((transaction_id, amount_cents, beneficiary_iban, None))
}

/// Extract UUID pattern from string (for transaction IDs)
fn extract_uuid(s: &str) -> Option<String> {
    let uuid_regex = regex::Regex::new(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    ).ok()?;
    
    uuid_regex.find(s).map(|m| m.as_str().to_string())
}

/// Extract IBAN pattern from string
fn extract_iban(s: &str) -> Option<String> {
    // IBAN format: 2 letters, 2 digits, then alphanumeric (12-30 chars total)
    let iban_regex = regex::Regex::new(
        r"[A-Z]{2}[0-9]{2}[A-Z0-9]{10,28}"
    ).ok()?;
    
    iban_regex.find(s).map(|m| m.as_str().to_string())
}

/// Extract amount from string (looking for decimal or integer amounts)
fn extract_amount(s: &str) -> Option<i64> {
    // Look for amount patterns like "100.00" or "10000"
    let amount_regex = regex::Regex::new(r"(\d+)\.?(\d{0,2})").ok()?;
    
    // This is very basic - in production we'd want more context
    amount_regex.find(s).and_then(|m| {
        let amount_str = m.as_str();
        if amount_str.contains('.') {
            // Parse as decimal, convert to cents
            amount_str.parse::<f64>().ok().map(|a| (a * 100.0) as i64)
        } else {
            // Already in cents
            amount_str.parse::<i64>().ok()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_json_body() {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"test\": \"value\"}";
        let body = extract_json_body(response).unwrap();
        assert_eq!(body, "{\"test\": \"value\"}");
    }
    
    #[test]
    fn test_parse_qonto_transaction() {
        let json = r#"{
            "transaction": {
                "id": "tx-123",
                "amount_cents": 10000,
                "status": "completed",
                "counterparty": {
                    "iban": "DE89370400440532013000"
                }
            }
        }"#;
        
        let (id, amount, iban, status) = parse_payment_details(json).unwrap();
        assert_eq!(id, Some("tx-123".to_string()));
        assert_eq!(amount, Some(10000));
        assert_eq!(iban, Some("DE89370400440532013000".to_string()));
        assert_eq!(status, Some("completed".to_string()));
    }
}

