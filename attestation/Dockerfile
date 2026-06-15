# FreeFlo Attestation Service (Rust) — verifies TLSNotary proofs + signs EIP-712 attestations.
# Build context: ./attestation (see docker-compose.yml). tlsn v0.1.0-alpha.13 is a GIT dependency
# fetched by cargo at build time (it is NOT vendored), so the build needs network + git.

# ---- Stage 1: build ----
FROM rust:1-bookworm AS builder
WORKDIR /build

# System deps for the TLS/crypto crates and fetching the tlsn git dependency.
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev build-essential clang cmake git \
    && rm -rf /var/lib/apt/lists/*

# Manifests first (layer caching), then sources.
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

# ---- Stage 2: runtime ----
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/attestation-service /app/attestation-service

RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 4001
# The service's health route is /api/v1/health (a plain /health 404s).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:4001/api/v1/health || exit 1

CMD ["/app/attestation-service"]
