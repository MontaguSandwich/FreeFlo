// Qonto TLSNotary Prover - Transfer Verification
// Proves a specific SEPA transfer was completed by querying the transactions endpoint.
// This generates an attestation that can be verified by the attestation service.

use std::env;

use http_body_util::Empty;
use hyper::{body::Bytes, Request, StatusCode};
use hyper_util::rt::TokioIo;
use spansy::Spanned;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    sync::oneshot::{self, Receiver, Sender},
};
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tracing::info;

use tlsn::{
    attestation::{
        request::{Request as AttestationRequest, RequestConfig},
        signing::Secp256k1Signer,
        Attestation, AttestationConfig, CryptoProvider, Secrets,
    },
    config::{ProtocolConfig, ProtocolConfigValidator},
    connection::{ConnectionInfo, HandshakeData, ServerName, TranscriptLength},
    prover::{state::Committed, ProveConfig, Prover, ProverConfig, ProverOutput, TlsConfig},
    transcript::{ContentType, TranscriptCommitConfig},
    verifier::{Verifier, VerifierConfig, VerifierOutput, VerifyConfig},
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};

// Qonto API configuration
const QONTO_HOST: &str = "thirdparty.qonto.com";
const QONTO_PORT: u16 = 443;

// TLSNotary limits - adjust based on expected request/response sizes
const MAX_SENT_DATA: usize = 1024; // 1KB for request
const MAX_RECV_DATA: usize = 32 * 1024; // 32KB for response (transaction list can be larger)

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load .env file if present (doesn't fail if missing)
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt::init();

    // Get Qonto credentials from environment
    let api_key_login =
        env::var("QONTO_API_KEY_LOGIN").expect("QONTO_API_KEY_LOGIN environment variable required");
    let api_key_secret = env::var("QONTO_API_KEY_SECRET")
        .expect("QONTO_API_KEY_SECRET environment variable required");
    let bank_account_slug = env::var("QONTO_BANK_ACCOUNT_SLUG")
        .expect("QONTO_BANK_ACCOUNT_SLUG environment variable required");

    // Optional: filter by reference (our intent reference)
    let reference_filter = env::var("QONTO_REFERENCE").ok();

    // Build the API path
    let api_path = if let Some(ref reference) = reference_filter {
        format!(
            "/v2/transactions?slug={}&per_page=1&reference={}",
            bank_account_slug,
            urlencoding::encode(reference)
        )
    } else {
        format!(
            "/v2/transactions?slug={}&per_page=1&side=debit&status=completed",
            bank_account_slug
        )
    };

    println!("🏦 Qonto TLSNotary Transfer Prover");
    println!("===================================");
    println!("API Endpoint: {}{}", QONTO_HOST, api_path);
    if let Some(ref_filter) = &reference_filter {
        println!("Reference Filter: {}", ref_filter);
    }
    println!();

    // Create prover-notary channel (in-memory for this example)
    let (notary_socket, prover_socket) = tokio::io::duplex(1 << 23);
    let (request_tx, request_rx) = oneshot::channel();
    let (attestation_tx, attestation_rx) = oneshot::channel();

    // Spawn notary task
    tokio::spawn(async move {
        notary(notary_socket, request_rx, attestation_tx)
            .await
            .unwrap()
    });

    // Run prover
    prover(
        prover_socket,
        request_tx,
        attestation_rx,
        &api_path,
        &api_key_login,
        &api_key_secret,
    )
    .await?;

    Ok(())
}

async fn prover<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(
    socket: S,
    req_tx: Sender<AttestationRequest>,
    resp_rx: Receiver<Attestation>,
    api_path: &str,
    api_key_login: &str,
    api_key_secret: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Use default TLS config with system root certificates
    let tls_config = TlsConfig::builder().build().unwrap();

    // Set up protocol configuration for prover
    let prover_config = ProverConfig::builder()
        .server_name(ServerName::Dns(QONTO_HOST.try_into().unwrap()))
        .tls_config(tls_config)
        .protocol_config(
            ProtocolConfig::builder()
                .max_sent_data(MAX_SENT_DATA)
                .max_recv_data(MAX_RECV_DATA)
                .build()?,
        )
        .build()?;

    // Create a new prover and perform necessary setup
    let prover = Prover::new(prover_config).setup(socket.compat()).await?;

    // Connect to Qonto API
    info!("Connecting to {}:{}", QONTO_HOST, QONTO_PORT);
    let client_socket = TcpStream::connect((QONTO_HOST, QONTO_PORT)).await?;

    // Bind the prover to the server connection
    let (mpc_tls_connection, prover_fut) = prover.connect(client_socket.compat()).await?;
    let mpc_tls_connection = TokioIo::new(mpc_tls_connection.compat());

    // Spawn the prover task
    let prover_task = tokio::spawn(prover_fut);

    // Attach hyper HTTP client
    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(mpc_tls_connection).await?;

    tokio::spawn(connection);

    // Build Qonto API request with authentication
    let auth_header = format!("{}:{}", api_key_login, api_key_secret);

    let request = Request::builder()
        .uri(api_path)
        .header("Host", QONTO_HOST)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity") // No compression
        .header("Connection", "close")
        .header("Authorization", &auth_header)
        .body(Empty::<Bytes>::new())?;

    info!("Sending MPC-TLS request to Qonto API");

    // Send request and get response
    let response = request_sender.send_request(request).await?;
    let status = response.status();

    info!("Got response from Qonto: {}", status);

    if status != StatusCode::OK {
        return Err(format!("Qonto API returned error: {}", status).into());
    }

    // Wait for prover task to complete
    let prover = prover_task.await??;

    // Parse the HTTP transcript
    let transcript = HttpTranscript::parse(prover.transcript())?;

    // Parse and display transaction info
    if let Some(body) = &transcript.responses[0].body {
        let body_str = String::from_utf8_lossy(body.content.span().as_bytes());

        // Parse JSON to show transaction details
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_str) {
            if let Some(transactions) = json.get("transactions").and_then(|t| t.as_array()) {
                if let Some(tx) = transactions.first() {
                    println!("\n📋 Transaction Found:");
                    println!(
                        "   ID: {}",
                        tx.get("id").and_then(|v| v.as_str()).unwrap_or("N/A")
                    );
                    println!(
                        "   Amount: €{:.2}",
                        tx.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0)
                    );
                    println!(
                        "   Amount (cents): {}",
                        tx.get("amount_cents").and_then(|v| v.as_i64()).unwrap_or(0)
                    );
                    println!(
                        "   Status: {}",
                        tx.get("status").and_then(|v| v.as_str()).unwrap_or("N/A")
                    );
                    println!(
                        "   Reference: {}",
                        tx.get("reference")
                            .and_then(|v| v.as_str())
                            .unwrap_or("N/A")
                    );
                    if let Some(transfer) = tx.get("transfer") {
                        println!(
                            "   Beneficiary IBAN: {}",
                            transfer
                                .get("counterparty_account_number")
                                .and_then(|v| v.as_str())
                                .unwrap_or("N/A")
                        );
                    }
                } else {
                    println!("\n⚠ No transactions found matching criteria");
                }
            }
        }
    }

    // Commit to the transcript
    let mut builder = TranscriptCommitConfig::builder(prover.transcript());
    DefaultHttpCommitter::default().commit_transcript(&mut builder, &transcript)?;
    let transcript_commit = builder.build()?;

    // Build attestation request
    let mut request_config_builder = RequestConfig::builder();
    request_config_builder.transcript_commit(transcript_commit);
    let request_config = request_config_builder.build()?;

    let (attestation, secrets) = notarize(prover, &request_config, req_tx, resp_rx).await?;

    // Save attestation and secrets
    let attestation_path = "qonto_transfer.attestation.tlsn";
    let secrets_path = "qonto_transfer.secrets.tlsn";

    tokio::fs::write(&attestation_path, bincode::serialize(&attestation)?).await?;
    tokio::fs::write(&secrets_path, bincode::serialize(&secrets)?).await?;

    println!("");
    println!("✅ Notarization completed successfully!");
    println!("   Attestation: {}", attestation_path);
    println!("   Secrets: {}", secrets_path);
    println!("");
    println!("Next steps:");
    println!("  1. Run the presentation step: cargo run --release --bin qonto_present_transfer");
    println!("  2. Submit presentation to attestation service");

    Ok(())
}

async fn notarize(
    mut prover: Prover<Committed>,
    config: &RequestConfig,
    request_tx: Sender<AttestationRequest>,
    attestation_rx: Receiver<Attestation>,
) -> Result<(Attestation, Secrets), Box<dyn std::error::Error>> {
    let mut builder = ProveConfig::builder(prover.transcript());

    if let Some(config) = config.transcript_commit() {
        builder.transcript_commit(config.clone());
    }

    let disclosure_config = builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    // Build attestation request
    let mut builder = AttestationRequest::builder(config);

    builder
        .server_name(ServerName::Dns(QONTO_HOST.try_into().unwrap()))
        .handshake_data(HandshakeData {
            certs: tls_transcript
                .server_cert_chain()
                .expect("server cert chain is present")
                .to_vec(),
            sig: tls_transcript
                .server_signature()
                .expect("server signature is present")
                .clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = builder.build(&CryptoProvider::default())?;

    // Send to notary
    request_tx
        .send(request.clone())
        .map_err(|_| "notary is not receiving attestation request")?;

    // Receive attestation
    let attestation = attestation_rx
        .await
        .map_err(|err| format!("notary did not respond with attestation: {err}"))?;

    // Validate
    request.validate(&attestation)?;

    Ok((attestation, secrets))
}

async fn notary<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(
    socket: S,
    request_rx: Receiver<AttestationRequest>,
    attestation_tx: Sender<Attestation>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Set up Verifier
    let config_validator = ProtocolConfigValidator::builder()
        .max_sent_data(MAX_SENT_DATA)
        .max_recv_data(MAX_RECV_DATA)
        .build()
        .unwrap();

    let verifier_config = VerifierConfig::builder()
        .protocol_config_validator(config_validator)
        .build()
        .unwrap();

    let mut verifier = Verifier::new(verifier_config)
        .setup(socket.compat())
        .await?
        .run()
        .await?;

    let VerifierOutput {
        transcript_commitments,
        encoder_secret,
        ..
    } = verifier.verify(&VerifyConfig::default()).await?;

    let tls_transcript = verifier.tls_transcript().clone();

    verifier.close().await?;

    let sent_len = tls_transcript
        .sent()
        .iter()
        .filter_map(|record| {
            if let ContentType::ApplicationData = record.typ {
                Some(record.ciphertext.len())
            } else {
                None
            }
        })
        .sum::<usize>();

    let recv_len = tls_transcript
        .recv()
        .iter()
        .filter_map(|record| {
            if let ContentType::ApplicationData = record.typ {
                Some(record.ciphertext.len())
            } else {
                None
            }
        })
        .sum::<usize>();

    // Receive attestation request
    let request = request_rx.await?;

    // Load signing key (dummy for local testing)
    let signing_key = k256::ecdsa::SigningKey::from_bytes(&[1u8; 32].into())?;
    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    // Build attestation
    let att_config = AttestationConfig::builder()
        .supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()))
        .build()?;

    let mut builder = Attestation::builder(&att_config).accept_request(request)?;
    builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: (*tls_transcript.version()),
            transcript_length: TranscriptLength {
                sent: sent_len as u32,
                received: recv_len as u32,
            },
        })
        .server_ephemeral_key(tls_transcript.server_ephemeral_key().clone())
        .transcript_commitments(transcript_commitments);

    if let Some(encoder_secret) = encoder_secret {
        builder.encoder_secret(encoder_secret);
    }

    let attestation = builder.build(&provider)?;

    // Send attestation
    attestation_tx
        .send(attestation)
        .map_err(|_| "prover is not receiving attestation")?;

    Ok(())
}
