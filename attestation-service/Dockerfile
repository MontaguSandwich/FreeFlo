# Attestation Service Dockerfile
# Multi-stage build for optimized image size

# Stage 1: Build using Rust nightly (required for edition2024)
FROM rustlang/rust:nightly-bookworm AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy TLSNotary crates first (for dependency caching)
COPY tlsn/Cargo.toml ./tlsn/
COPY tlsn/crates ./tlsn/crates

# Copy attestation service
COPY attestation-service/Cargo.toml attestation-service/Cargo.lock* ./attestation-service/
COPY attestation-service/src ./attestation-service/src

# Build the attestation service
WORKDIR /build/attestation-service
RUN cargo +nightly build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the built binary
COPY --from=builder /build/attestation-service/target/release/attestation-service /app/attestation-service

# Create a non-root user for security
RUN useradd -m -u 1000 appuser
USER appuser

# Expose the service port
EXPOSE 4001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:4001/api/v1/health || exit 1

# Run the service
CMD ["/app/attestation-service"]
