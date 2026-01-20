use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AttestationError {
    #[error("Invalid presentation: {0}")]
    InvalidPresentation(String),

    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    #[error("Invalid payment data: {0}")]
    InvalidPaymentData(String),

    #[error("Server not found in presentation")]
    ServerNotFound,

    #[error("Transcript not found in presentation")]
    TranscriptNotFound,

    #[error("Unexpected server: expected {expected}, got {actual}")]
    UnexpectedServer { expected: String, actual: String },

    #[error("Missing required field: {0}")]
    MissingField(String),

    #[error("Signing error: {0}")]
    SigningError(String),

    #[error("Deserialization error: {0}")]
    DeserializationError(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AttestationError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AttestationError::InvalidPresentation(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::VerificationFailed(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::InvalidPaymentData(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::ServerNotFound => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::TranscriptNotFound => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::UnexpectedServer { .. } => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::MissingField(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::SigningError(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            AttestationError::DeserializationError(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AttestationError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({
            "error": message,
            "code": status.as_u16()
        }));

        (status, body).into_response()
    }
}

