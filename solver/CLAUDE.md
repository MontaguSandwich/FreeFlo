# Solver (TypeScript Service)

Runs on VPS (95.217.235.164). Watches for on-chain intents, executes SEPA payments, generates TLSNotary proofs.

## Key Files

- src/index-v3.ts - Entry point
- src/orchestrator-v3.ts - Intent processing and fulfillment pipeline
- src/providers/qonto.ts - Qonto SEPA payment executor
- src/attestation/ - Prover client + attestation client

## Intent Detection

Uses eth_getLogs polling (NOT eth_newFilter/watchContractEvent) because public RPCs do not support server-side filters. Watchers query with a 3-block safety margin. Wait for V3 Orchestrator started log before creating intents.

## Dual Deployment (PM2)

Mainnet: pm2 name zkp2p-solver, health :8080, quotes :8081, env .env
Testnet: pm2 name zkp2p-solver-testnet, health :8082, quotes :8083, env .env.testnet

IMPORTANT: Use ENV_FILE=.env.testnet for testnet. Never set -a && source for solver. Dotenv override:true prevents env contamination. CHAIN_ID required or solver crashes.

## Qonto Integration

- Tokens expire in 1 hour, auto-refresh on 401
- Testnet uses Qonto sandbox (thirdparty-sandbox.staging.qonto.co)
- Sandbox OAuth requires X-Qonto-Staging-Token header
- Duplicate prevention: saves provider_transfer_id after fiat transfer

## Prover

PROVER_TIMEOUT=300000 (5 min). First run compiles Rust.
TLSN_EXAMPLES_PATH=/opt/FreeFlo/providers/prover/adapters/qonto

## Testing

npm run build && npm run start:v3
curl http://127.0.0.1:8081/api/quote?amount=100&currency=EUR

## Solver Authorization — boot gate (audit cross-2-4)

`isAuthorizedSolver()` checks `solverSupportsRtpn[solver][SEPA_INSTANT=0]` on OffRampV3. A fresh
solver address logs "Solver is not authorized on the contract!" and exits fatally at boot until
it self-registers:
`cast send <OffRampV3> "setSolverRtpn(uint8,bool)" 0 true --private-key <solver> --rpc-url <rpc>`.
Removing this gate for true permissionless solving is a deferred product decision.

## Qonto Sandbox — fuller notes

- `X-Qonto-Staging-Token` must be on EVERY sandbox request, **including the OAuth `/token`
  exchange** — not only the thirdparty API calls.
- Browser OAuth (`oauth-sandbox.staging.qonto.co/oauth2/auth`) 404s unless you are first logged
  into the Sandbox web-app (developers.qonto.com → Toolkit). Register redirect URI
  `http://localhost:3456/callback` on the app. `scripts/qonto-oauth.mjs` is sandbox-aware
  (`QONTO_USE_SANDBOX=true`). Refresh tokens are one-time-use/rotating — persist each new one.
- The spawned Rust prover inherits the solver's full env, so `solver/.env` configures both;
  `QONTO_HOST` defaults to prod — set the sandbox host explicitly for sandbox runs.

## Local / mainnet dev (VPS access lost)

The PM2/VPS instructions above are superseded for current work — see
`docs/agent/SESSION-HANDOFF.md` for the local anvil and Base-mainnet (sandbox Qonto) runbooks.
