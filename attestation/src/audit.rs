//! Audit logging for attestation requests

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::info;

/// Audit log entry
#[derive(Debug, Clone, Serialize)]
pub struct AuditLogEntry {
    pub timestamp: u64,
    pub solver_address: String,
    pub intent_hash: String,
    pub payment_id: Option<String>,
    pub amount_cents: i64,
    pub result: AuditResult,
    pub request_ip: Option<String>,
    pub duration_ms: u64,
}

/// Result of attestation request
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditResult {
    Success,
    Rejected { reason: String },
    Error { message: String },
}

/// Audit logger
pub struct AuditLogger {
    log_file: Option<Mutex<std::fs::File>>,
}

impl AuditLogger {
    /// Create a new audit logger
    pub fn new() -> Self {
        let log_path = std::env::var("AUDIT_LOG_PATH").ok().map(PathBuf::from);

        let log_file = log_path.and_then(|path| {
            // Create parent directories if needed
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).ok()?;
            }

            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok()
                .map(Mutex::new)
        });

        Self { log_file }
    }

    /// Log an attestation request
    pub fn log(&self, entry: &AuditLogEntry) {
        // Always log to tracing
        match &entry.result {
            AuditResult::Success => {
                info!(
                    solver = %entry.solver_address,
                    intent_hash = %entry.intent_hash,
                    payment_id = ?entry.payment_id,
                    amount = %entry.amount_cents,
                    duration_ms = %entry.duration_ms,
                    "Attestation succeeded"
                );
            }
            AuditResult::Rejected { reason } => {
                info!(
                    solver = %entry.solver_address,
                    intent_hash = %entry.intent_hash,
                    reason = %reason,
                    duration_ms = %entry.duration_ms,
                    "Attestation rejected"
                );
            }
            AuditResult::Error { message } => {
                info!(
                    solver = %entry.solver_address,
                    intent_hash = %entry.intent_hash,
                    error = %message,
                    duration_ms = %entry.duration_ms,
                    "Attestation error"
                );
            }
        }

        // Write to file if configured
        if let Some(ref file_mutex) = self.log_file {
            if let Ok(mut file) = file_mutex.lock() {
                if let Ok(json) = serde_json::to_string(entry) {
                    let _ = writeln!(file, "{}", json);
                }
            }
        }
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::new()
    }
}

/// Get current timestamp in seconds
pub fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
