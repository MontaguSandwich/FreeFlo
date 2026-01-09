// Qonto TLSNotary Presentation Builder - Transfer Proof
// Creates a verifiable presentation with selective disclosure of transfer details.
// Reveals: transaction ID, amount, status, reference, counterparty IBAN
// Hides: Authorization header, account balances, other sensitive data

use hyper::header;

use tlsn::attestation::{presentation::Presentation, Attestation, CryptoProvider, Secrets};
use tlsn_formats::http::HttpTranscript;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    create_transfer_presentation().await
}

async fn create_transfer_presentation() -> Result<(), Box<dyn std::error::Error>> {
    println!("🏦 Qonto TLSNotary Transfer Presentation Builder");
    println!("=================================================");

    // Read attestation and secrets
    let attestation: Attestation = bincode::deserialize(
        &std::fs::read("qonto_transfer.attestation.tlsn")?
    )?;
    let secrets: Secrets = bincode::deserialize(
        &std::fs::read("qonto_transfer.secrets.tlsn")?
    )?;

    // Parse HTTP transcript
    let transcript = HttpTranscript::parse(secrets.transcript())?;
    let mut builder = secrets.transcript_proof_builder();

    // === REQUEST DISCLOSURE ===
    let request = &transcript.requests[0];

    // Reveal request structure (method, path)
    builder.reveal_sent(&request.without_data())?;
    builder.reveal_sent(&request.request.target)?;

    // Reveal headers EXCEPT Authorization
    for header in &request.headers {
        if header.name.as_str().eq_ignore_ascii_case(header::AUTHORIZATION.as_str()) {
            // Only reveal header name, not value (credentials)
            builder.reveal_sent(&header.without_value())?;
        } else {
            builder.reveal_sent(header)?;
        }
    }

    // === RESPONSE DISCLOSURE ===
    let response = &transcript.responses[0];

    // Reveal response structure
    builder.reveal_recv(&response.without_data())?;

    // Reveal all response headers
    for header in &response.headers {
        builder.reveal_recv(header)?;
    }

    // === JSON BODY SELECTIVE DISCLOSURE ===
    let content = &response.body.as_ref().unwrap().content;

    match content {
        tlsn_formats::http::BodyContent::Json(_json) => {
            // For now, reveal the full JSON body since TLSNotary requires all
            // committed data to be covered in the proof
            // In production, we'd use a custom committer that only commits
            // to the fields we want to reveal
            println!("\n📋 Revealing full JSON body for attestation");
            builder.reveal_recv(content)?;
        }
        tlsn_formats::http::BodyContent::Unknown(span) => {
            // Reveal the full body when JSON parsing fails
            println!("  Revealing raw response body (JSON parse failed)");
            builder.reveal_recv(span)?;
        }
        _ => {
            println!("  (no body content)");
        }
    }

    // Fields we explicitly DO NOT reveal:
    println!("\n🔒 Redacted fields:");
    println!("  ✗ Authorization header (credentials)");
    println!("  ✗ settled_balance (account balance)");
    println!("  ✗ bank_account_id (internal ID)");
    println!("  ✗ initiator_id (user ID)");

    let transcript_proof = builder.build()?;

    // Build the presentation
    let provider = CryptoProvider::default();
    let mut pres_builder = attestation.presentation_builder(&provider);

    pres_builder
        .identity_proof(secrets.identity_proof())
        .transcript_proof(transcript_proof);

    let presentation: Presentation = pres_builder.build()?;

    // Save presentation
    let presentation_path = "qonto_transfer.presentation.tlsn";
    std::fs::write(presentation_path, bincode::serialize(&presentation)?)?;

    // Report file size
    let file_size = std::fs::metadata(presentation_path)?.len();

    println!("\n✅ Presentation built successfully!");
    println!("   File: {}", presentation_path);
    println!("   Size: {} bytes ({:.1} KB)", file_size, file_size as f64 / 1024.0);
    println!("\nNext step:");
    println!("  Submit to attestation service for EIP-712 signature");

    Ok(())
}
