use std::sync::Arc;

use axum::{
    extract::State,
    Json,
};
use serde::Serialize;
use tracing::{info, warn};

use crate::attestation::{create_attestation, AttestationRequest, AttestationResponse};
use crate::config::Config;
use crate::error::AttestationError;

/// Application state shared across handlers
pub struct AppState {
    pub config: Config,
}

impl AppState {
    pub fn new(config: Config) -> anyhow::Result<Self> {
        Ok(Self { config })
    }
}

/// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub witness_address: String,
    pub chain_id: u64,
}

/// Health check endpoint
pub async fn health(
    State(state): State<Arc<AppState>>,
) -> Json<HealthResponse> {
    let witness_address = format!("0x{}", hex::encode(state.config.witness_address()));
    
    Json(HealthResponse {
        status: "ok".to_string(),
        witness_address,
        chain_id: state.config.chain_id,
    })
}

/// Create attestation endpoint
pub async fn attest(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AttestationRequest>,
) -> Result<Json<AttestationResponse>, AttestationError> {
    info!(
        intent_hash = %request.intent_hash,
        expected_amount = %request.expected_amount_cents,
        "Processing attestation request"
    );
    
    match create_attestation(&request, &state.config) {
        Ok(response) => {
            info!(
                intent_hash = %request.intent_hash,
                transaction_id = ?response.payment.transaction_id,
                "Attestation created successfully"
            );
            Ok(Json(response))
        }
        Err(e) => {
            warn!(
                intent_hash = %request.intent_hash,
                error = %e,
                "Attestation request failed"
            );
            Err(e)
        }
    }
}

