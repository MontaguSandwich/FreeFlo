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

`PROVER_TIMEOUT=300000` (5 min). **`TLSN_EXAMPLES_PATH` MUST be a real local directory** — the prover
spawns with it as the CWD. A bad/absent path (e.g. the old VPS default `/opt/FreeFlo/...` on a dev box)
fails as a **misleading `spawn cargo ENOENT`** (the missing thing is the cwd, not cargo) — and only
AFTER the fiat is sent, stranding the intent in `pending_retry`. The solver now hardens this:
- validates the path at boot and **fails loudly** if `PROVER_ENABLED` and it isn't a directory;
- prefers the **prebuilt binaries** `providers/prover/target/release/qonto_{prove,present}_transfer`
  over `cargo run` (no cargo-on-PATH, no recompile); falls back to `cargo run` only if absent;
- defaults `TLSN_EXAMPLES_PATH` repo-relative (`providers/prover/adapters/qonto`) when unset.
Build once with `cargo build --release` in `providers/prover/` to skip the first-run compile.

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

## Qonto zkTLS proof — TWO proofs ("Approach T", since 2026-06)

Qonto serves the transfer's **status + amount** (`GET /v2/sepa/transfers/{id}`) and the recipient
**IBAN** (`GET /v2/beneficiaries/{id}`) on SEPARATE endpoints, and closes the connection after one
response — so a single notarized TLS session can't fetch both. The `/v2/transactions` ledger (which
would carry both) is **empty in sandbox**. So the solver generates **two** TLSNotary proofs:
- `generateQontoProof` runs the prover twice with `QONTO_PROVE_PATH` (transfer, then beneficiary —
  the beneficiary id comes from the transfer proof's `BENEFICIARY_ID=` stdout line).
- Both presentations go to the attestation (`presentation` + `beneficiary_presentation`); it verifies
  each, gates settlement on the transfer, and cross-checks `transfer.beneficiary_id == beneficiary.id`
  before binding the IBAN. Do NOT collapse to one proof or trust a solver-supplied link between them.

## Qonto SCA: sandbox = mock, prod = trusted beneficiaries

- **Sandbox**: a 428 `sca_required` is cleared by `POST /v2/mocked_sca_sessions/{token}/allow` (the
  device-poll `GET /v2/sca/sessions/{token}` 404s in sandbox). Gated on `QONTO_STAGING_TOKEN` being
  set (which also sends `X-Qonto-2fa-Preference: mock`).
- **Production**: real SCA — an untrusted/arbitrary IBAN returns 428 → device approval (an unattended
  solver can't). Needs **trusted beneficiaries** or a Qonto SCA exemption — the real gate for
  permissionless prod. See `docs/agent/QONTO-PROD-MIGRATION.md`.
- Recipient IBAN must be **external** — sending to one of the org's own accounts → 400
  `transfer_to_same_organization`.

## Tokens, RPC, DB (mainnet ops)

- Refreshed OAuth tokens are **rotating/one-time**; the solver persists them to `process.env.ENV_FILE`
  (a prior bug wrote a non-existent `.env.testnet` → tokens lost → restart failed with
  `invalid_grant: refresh token was already used`). Re-mint via `scripts/qonto-oauth.mjs` —
  **self-service:** `QONTO_USE_SANDBOX=false QONTO_ENV_FILE=.env.production node scripts/qonto-oauth.mjs`
  reads CLIENT_ID/SECRET from that env file and writes the minted tokens back into it (nothing printed).
  Non-interactive refresh: `POST <oauth>/token grant_type=refresh_token` (works while the token is unused).
- Use a **dedicated RPC** (Alchemy) — public RPCs (mainnet.base.org, publicnode) 429 the
  historical-sync `eth_getLogs` storm (`CHUNK_SIZE=9` over a large gap = hundreds of calls).
- Use a **distinct `DB_PATH` per network** — a stale `lastBlock` from another chain's DB (e.g. an
  anvil run left block 3) makes the mainnet sync grind from block 4 onward.
- The real DB file is `DB_PATH` with a **`-v3` suffix** (`./solver-production.db` →
  `solver-production-v3.db`) — inspect the `-v3` file, not the literal `DB_PATH`.
- **Restart after the fiat is sent is safe**: the solver persists `provider_transfer_id` and uses a
  deterministic Qonto idempotency key `offramp-<intentId>`, so a re-run reuses the existing transfer
  (no double-send). Post-fiat failures go to `pending_retry` with exp. backoff (1/2/4/8/16 min, max 5),
  resumed by the 5s poll loop once `next_retry_at` passes — a restart does NOT lose the queued retry.

## Local / mainnet dev (VPS access lost)

The PM2/VPS instructions above are superseded for current work — see
`docs/agent/SESSION-HANDOFF.md` for the local anvil and Base-mainnet (sandbox Qonto) runbooks.
