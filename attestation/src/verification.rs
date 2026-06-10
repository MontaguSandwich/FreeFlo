use k256::ecdsa::VerifyingKey;
use tlsn::attestation::{
    presentation::{Presentation, PresentationOutput},
    signing::{KeyAlgId, VerifyingKey as NotaryVerifyingKey},
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

    /// Beneficiary linkage id: `transfer.beneficiary_id` from a transfer proof, or
    /// `beneficiary.id` from a beneficiary proof. The two proofs must agree.
    pub beneficiary_id: Option<String>,
}

/// Verify a TLSNotary presentation and extract payment information
pub fn verify_presentation(
    presentation_bytes: &[u8],
    allowed_servers: &[String],
    notary_keys: &[VerifyingKey],
) -> Result<VerifiedPayment, AttestationError> {
    // Deserialize the presentation
    let presentation: Presentation = bincode::deserialize(presentation_bytes)
        .map_err(|e| AttestationError::DeserializationError(format!("Failed to deserialize presentation: {}", e)))?;
    
    // Use default crypto provider (trusts standard root CAs)
    // Capture the notary key the presentation claims, before verify() consumes it.
    let notary_key = presentation.verifying_key().clone();

    let crypto_provider = CryptoProvider::default();
    
    // Verify the presentation
    let PresentationOutput {
        server_name,
        connection_info,
        transcript,
        ..
    } = presentation.verify(&crypto_provider)
        .map_err(|e| AttestationError::VerificationFailed(format!("Presentation verification failed: {:?}", e)))?;

    // PIN THE NOTARY KEY. verify() only proves the attestation is internally
    // consistent with *some* key embedded in it; it does NOT prove that key is
    // trusted. Without this, a solver can run its own notary and forge any
    // transcript. Require the notary to be one FreeFlo controls.
    if !notary_is_trusted(&notary_key, notary_keys) {
        return Err(AttestationError::UntrustedNotary);
    }
    
    // Extract server name
    let server_name = server_name
        .ok_or(AttestationError::ServerNotFound)?
        .to_string();
    
    // Check the server is explicitly allow-listed (exact host match — a substring
    // check would accept e.g. "thirdparty.qonto.com.evil.tld").
    if !allowed_servers.iter().any(|s| s == &server_name) {
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
    
    // A single proof is one of two shapes (Qonto won't serve both on one connection):
    //   transfer:    {"transfer":{ id, status, amount_cents, beneficiary_id }}
    //   beneficiary: {"beneficiary":{ id, bank_account:{ iban } }}
    // verify_payment_presentation() verifies BOTH proofs and binds them via the
    // beneficiary_id (transfer.beneficiary_id must equal beneficiary.id).
    let received = String::from_utf8_lossy(partial_transcript.received_unsafe());

    let mut status: Option<String> = None;
    let mut amount_cents: Option<i64> = None;
    let mut transaction_id: Option<String> = None;
    let mut beneficiary_iban: Option<String> = None;
    let mut beneficiary_id: Option<String> = None;

    for obj in extract_json_objects(&received) {
        let value: serde_json::Value = match serde_json::from_str(&obj) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(t) = value.get("transfer") {
            status = t.get("status").and_then(|v| v.as_str()).map(String::from);
            amount_cents = t.get("amount_cents").and_then(|v| v.as_i64());
            transaction_id = t.get("id").and_then(|v| v.as_str()).map(String::from);
            beneficiary_id =
                t.get("beneficiary_id").and_then(|v| v.as_str()).map(String::from);
        }
        if let Some(b) = value.get("beneficiary") {
            beneficiary_iban = b
                .get("bank_account")
                .and_then(|ba| ba.get("iban"))
                .and_then(|v| v.as_str())
                .map(String::from);
            beneficiary_id = b.get("id").and_then(|v| v.as_str()).map(String::from);
        }
    }

    Ok(VerifiedPayment {
        server_name,
        timestamp: connection_info.time,
        response_body: received.into_owned(),
        transaction_id,
        amount_cents,
        beneficiary_iban,
        status,
        beneficiary_id,
    })
}

/// Returns true iff the presentation's notary key is one of the trusted (pinned)
/// secp256k1 keys. Compares as canonical k256 keys so SEC1 compressed/uncompressed
/// encodings can't cause a false mismatch.
fn notary_is_trusted(notary_key: &NotaryVerifyingKey, trusted: &[VerifyingKey]) -> bool {
    if notary_key.alg != KeyAlgId::K256 {
        return false;
    }
    match VerifyingKey::from_sec1_bytes(&notary_key.data) {
        Ok(presented) => trusted.iter().any(|t| t == &presented),
        Err(_) => false,
    }
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

/// Extract every balanced top-level JSON object from a transcript that may contain
/// multiple concatenated HTTP responses. String-aware brace matching so braces inside
/// JSON string values don't throw off the depth count.
fn extract_json_objects(s: &str) -> Vec<String> {
    let bytes = s.as_bytes();
    let mut objects = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }
        let start = i;
        let mut depth = 0i32;
        let mut in_str = false;
        let mut esc = false;
        let mut j = i;
        while j < bytes.len() {
            let c = bytes[j];
            if in_str {
                if esc {
                    esc = false;
                } else if c == b'\\' {
                    esc = true;
                } else if c == b'"' {
                    in_str = false;
                }
            } else {
                match c {
                    b'"' => in_str = true,
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            j += 1;
        }
        if depth == 0 && j < bytes.len() {
            // start is at '{', j is at the matching '}', both ASCII => char boundaries.
            objects.push(s[start..=j].to_string());
            i = j + 1;
        } else {
            break; // unbalanced (truncated/redacted) — stop
        }
    }
    objects
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
    fn test_notary_pinning() {
        use k256::ecdsa::SigningKey;
        let trusted_sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let trusted = [trusted_sk.verifying_key().clone()];
        let trusted_sec1 = trusted[0].to_sec1_bytes().to_vec();

        // Same key the legitimate notary used → trusted.
        let good = NotaryVerifyingKey { alg: KeyAlgId::K256, data: trusted_sec1.clone() };
        assert!(notary_is_trusted(&good, &trusted));

        // A solver's self-notarized key → rejected (the core forgery defense).
        let attacker_sk = SigningKey::from_slice(&[1u8; 32]).unwrap();
        let attacker_sec1 = attacker_sk.verifying_key().to_sec1_bytes().to_vec();
        let forged = NotaryVerifyingKey { alg: KeyAlgId::K256, data: attacker_sec1 };
        assert!(!notary_is_trusted(&forged, &trusted));

        // Wrong key algorithm → rejected.
        let wrong_alg = NotaryVerifyingKey { alg: KeyAlgId::P256, data: trusted_sec1.clone() };
        assert!(!notary_is_trusted(&wrong_alg, &trusted));

        // Malformed key bytes → rejected, not a panic.
        let malformed = NotaryVerifyingKey { alg: KeyAlgId::K256, data: vec![0u8; 5] };
        assert!(!notary_is_trusted(&malformed, &trusted));
    }
    
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

    #[test]
    fn extract_json_objects_splits_two_responses() {
        // Mimics the received transcript: two HTTP responses (transfer + beneficiary)
        // concatenated on one keep-alive connection.
        let received = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"transfer\":{\"id\":\"t1\",\"status\":\"settled\",\"amount_cents\":86,\"beneficiary_id\":\"b1\"}}HTTP/1.1 200 OK\r\nx: y\r\n\r\n{\"beneficiary\":{\"id\":\"b1\",\"bank_account\":{\"iban\":\"DE89370400440532013000\"}}}";
        let objs = extract_json_objects(received);
        assert_eq!(objs.len(), 2, "should split two concatenated responses");
        let t: serde_json::Value = serde_json::from_str(&objs[0]).unwrap();
        assert_eq!(t["transfer"]["status"], "settled");
        assert_eq!(t["transfer"]["amount_cents"], 86);
        assert_eq!(t["transfer"]["beneficiary_id"], "b1");
        let b: serde_json::Value = serde_json::from_str(&objs[1]).unwrap();
        assert_eq!(b["beneficiary"]["id"], "b1");
        assert_eq!(
            b["beneficiary"]["bank_account"]["iban"],
            "DE89370400440532013000"
        );
    }

    #[test]
    fn extract_json_objects_ignores_braces_in_strings() {
        let s = r#"{"note":"off-ramp {0xabc} intent","k":1}"#;
        let objs = extract_json_objects(s);
        assert_eq!(objs.len(), 1);
        let v: serde_json::Value = serde_json::from_str(&objs[0]).unwrap();
        assert_eq!(v["k"], 1);
        assert_eq!(v["note"], "off-ramp {0xabc} intent");
    }
}

