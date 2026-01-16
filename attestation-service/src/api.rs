use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use tracing::{info, warn};

use crate::attestation::{create_attestation, AttestationRequest, AttestationResponse};
use crate::audit::{current_timestamp, AuditLogEntry, AuditLogger, AuditResult};
use crate::auth::SolverAuth;
use crate::chain::ChainClient;
use crate::config::Config;
use crate::error::AttestationError;

/// Application state shared across handlers
pub struct AppState {
    pub config: Config,
    pub auth: SolverAuth,
    pub chain: Option<ChainClient>,
    pub audit: AuditLogger,
}

impl AppState {
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let auth = SolverAuth::from_env();
        let chain = ChainClient::from_env();
        let audit = AuditLogger::new();

        if auth.is_enabled() {
            info!("Solver authentication enabled ({} solvers)", auth.solver_count());
        } else {
            warn!("Solver authentication DISABLED - set SOLVER_API_KEYS to enable");
        }

        if let Some(ref c) = chain {
            info!("On-chain intent validation enabled");
            info!("  RPC URL: {}", std::env::var("RPC_URL").unwrap_or_default());
            info!("  Contract: {}", std::env::var("OFFRAMP_CONTRACT").unwrap_or_default());
        } else {
            warn!("On-chain validation DISABLED - set RPC_URL and OFFRAMP_CONTRACT to enable");
        }

        Ok(Self {
            config,
            auth,
            chain,
            audit,
        })
    }
}

/// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub witness_address: String,
    pub chain_id: u64,
    pub auth_enabled: bool,
    pub chain_validation_enabled: bool,
}

/// Health check endpoint
pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let witness_address = format!("0x{}", hex::encode(state.config.witness_address()));

    Json(HealthResponse {
        status: "ok".to_string(),
        witness_address,
        chain_id: state.config.chain_id,
        auth_enabled: state.auth.is_enabled(),
        chain_validation_enabled: state.chain.is_some(),
    })
}

/// Rate limit error response
#[derive(Serialize)]
pub struct RateLimitResponse {
    pub success: bool,
    pub error: String,
    pub retry_after: u64,
}

/// Auth error response
#[derive(Serialize)]
pub struct AuthErrorResponse {
    pub success: bool,
    pub error: String,
}

/// Create attestation endpoint with authentication
pub async fn attest(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<AttestationRequest>,
) -> Result<Json<AttestationResponse>, impl IntoResponse> {
    let start_time = Instant::now();
    let intent_hash = request.intent_hash.clone();

    // Extract API key from header
    let api_key = headers
        .get("x-solver-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Authenticate solver (if auth is enabled)
    let solver_address = if state.auth.is_enabled() {
        let key = match api_key {
            Some(k) => k,
            None => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(AuthErrorResponse {
                        success: false,
                        error: "Missing X-Solver-API-Key header".to_string(),
                    }),
                )
                    .into_response());
            }
        };

        match state.auth.validate_api_key(&key) {
            Some(addr) => addr,
            None => {
                warn!(api_key = %key, "Invalid API key");
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(AuthErrorResponse {
                        success: false,
                        error: "Invalid API key".to_string(),
                    }),
                )
                    .into_response());
            }
        }
    } else {
        // Auth disabled, use placeholder
        "0x0000000000000000000000000000000000000000".to_string()
    };

    // Check rate limit
    if let Err(retry_after) = state.auth.check_rate_limit(&solver_address) {
        warn!(
            solver = %solver_address,
            retry_after = %retry_after,
            "Rate limit exceeded"
        );
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(RateLimitResponse {
                success: false,
                error: "Rate limit exceeded".to_string(),
                retry_after,
            }),
        )
            .into_response());
    }

    info!(
        intent_hash = %request.intent_hash,
        solver = %solver_address,
        expected_amount = %request.expected_amount_cents,
        "Processing attestation request"
    );

    // Validate intent on-chain (if enabled)
    if let Some(ref chain) = state.chain {
        let intent_bytes = match decode_bytes32(&request.intent_hash) {
            Ok(b) => b,
            Err(e) => {
                let duration_ms = start_time.elapsed().as_millis() as u64;
                state.audit.log(&AuditLogEntry {
                    timestamp: current_timestamp(),
                    solver_address: solver_address.clone(),
                    intent_hash: intent_hash.clone(),
                    payment_id: None,
                    amount_cents: request.expected_amount_cents,
                    result: AuditResult::Rejected {
                        reason: format!("Invalid intent hash: {}", e),
                    },
                    request_ip: None,
                    duration_ms,
                });

                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(AuthErrorResponse {
                        success: false,
                        error: format!("Invalid intent hash: {}", e),
                    }),
                )
                    .into_response());
            }
        };

        if let Err(e) = crate::chain::validate_intent(
            chain,
            intent_bytes,
            &solver_address,
            request.expected_amount_cents,
        )
        .await
        {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            state.audit.log(&AuditLogEntry {
                timestamp: current_timestamp(),
                solver_address: solver_address.clone(),
                intent_hash: intent_hash.clone(),
                payment_id: None,
                amount_cents: request.expected_amount_cents,
                result: AuditResult::Rejected {
                    reason: e.clone(),
                },
                request_ip: None,
                duration_ms,
            });

            warn!(
                intent_hash = %request.intent_hash,
                solver = %solver_address,
                error = %e,
                "Intent validation failed"
            );
            return Err((
                StatusCode::BAD_REQUEST,
                Json(AuthErrorResponse {
                    success: false,
                    error: e,
                }),
            )
                .into_response());
        }
    }

    // Create attestation
    match create_attestation(&request, &state.config) {
        Ok(response) => {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            state.audit.log(&AuditLogEntry {
                timestamp: current_timestamp(),
                solver_address: solver_address.clone(),
                intent_hash: intent_hash.clone(),
                payment_id: response.payment.transaction_id.clone(),
                amount_cents: response.payment.amount_cents,
                result: AuditResult::Success,
                request_ip: None,
                duration_ms,
            });

            info!(
                intent_hash = %request.intent_hash,
                transaction_id = ?response.payment.transaction_id,
                duration_ms = %duration_ms,
                "Attestation created successfully"
            );
            Ok(Json(response))
        }
        Err(e) => {
            let duration_ms = start_time.elapsed().as_millis() as u64;
            state.audit.log(&AuditLogEntry {
                timestamp: current_timestamp(),
                solver_address: solver_address.clone(),
                intent_hash: intent_hash.clone(),
                payment_id: None,
                amount_cents: request.expected_amount_cents,
                result: AuditResult::Error {
                    message: e.to_string(),
                },
                request_ip: None,
                duration_ms,
            });

            warn!(
                intent_hash = %request.intent_hash,
                error = %e,
                "Attestation request failed"
            );
            Err(e.into_response())
        }
    }
}

fn decode_bytes32(hex_str: &str) -> Result<[u8; 32], String> {
    let hex_str = hex_str.trim_start_matches("0x");
    let bytes =
        hex::decode(hex_str).map_err(|e| format!("Invalid hex: {}", e))?;

    if bytes.len() != 32 {
        return Err(format!("Expected 32 bytes, got {}", bytes.len()));
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}
