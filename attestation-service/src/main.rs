mod api;
mod attestation;
mod config;
mod eip712;
mod error;
mod verification;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{routing::post, Router};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

pub use config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Load configuration
    dotenvy::dotenv().ok();
    let config = Config::from_env()?;

    info!("Starting Attestation Service");
    info!("  Witness address: {:?}", config.witness_address());

    // Create app state
    let state = Arc::new(api::AppState::new(config)?);

    // Build routes
    let app = Router::new()
        .route("/api/v1/attest", post(api::attest))
        .route("/api/v1/health", axum::routing::get(api::health))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 4001));
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
