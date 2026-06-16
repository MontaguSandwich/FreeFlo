# FreeFlo Solver (Node) + Qonto TLSNotary prover (Rust).
# Build context: the REPO ROOT (see docker-compose.yml) — the image needs both ./solver and
# ./providers/prover. Build it on the target host so the prover binaries match the host arch.
#
# Stages:
#   prover-builder — compile qonto_prove_transfer / qonto_present_transfer (Rust, tlsn alpha.13)
#   node-builder   — install deps (incl. native better-sqlite3) + compile TS -> dist
#   runtime        — slim Node image: dist + prod node_modules + the prover binaries

# ---- Stage 1: Rust prover binaries ----
FROM rust:1-bookworm AS prover-builder
WORKDIR /prover
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev build-essential clang cmake git \
    && rm -rf /var/lib/apt/lists/*
COPY providers/prover/ ./
RUN cargo build --release   # -> /prover/target/release/qonto_{prove,present}_transfer

# ---- Stage 2: Node build ----
FROM node:20-bookworm AS node-builder
WORKDIR /app
# Toolchain for node-gyp in case better-sqlite3 has no prebuilt for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY solver/package*.json ./
RUN npm ci
COPY solver/tsconfig.json ./
COPY solver/src ./src
RUN npm run build
# Drop dev deps but keep the compiled native modules (better-sqlite3).
RUN npm prune --omit=dev

# ---- Stage 3: runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# App: prod node_modules + compiled JS.
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/dist ./dist
COPY solver/package.json ./package.json

# Prover: built binaries + the Qonto adapter dir. Layout mirrors the repo so the solver's
# prebuilt-binary lookup (target/release relative to TLSN_EXAMPLES_PATH) resolves.
COPY --from=prover-builder /prover/target/release/qonto_prove_transfer   /app/providers/prover/target/release/qonto_prove_transfer
COPY --from=prover-builder /prover/target/release/qonto_present_transfer /app/providers/prover/target/release/qonto_present_transfer
COPY providers/prover/adapters/qonto /app/providers/prover/adapters/qonto

ENV TLSN_EXAMPLES_PATH=/app/providers/prover/adapters/qonto

EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

# ENV_FILE (set by docker-compose) points dotenv at the mounted /app/solver.env.
CMD ["node", "dist/index-v3.js"]
