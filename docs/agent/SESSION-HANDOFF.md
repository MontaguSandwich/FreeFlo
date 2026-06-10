# FreeFlo — Audit Remediation + Mainnet E2E — SESSION HANDOFF

> Resume note for the audit + 4-phase remediation + live E2E work. Read this first.
> Branch: **`audit-fixes`** (off `claude/venmo-sepa-integration-gVIwz`). Date: 2026-06-09/10.

## TL;DR — where things stand
- A full Opus-4.8 security audit found the **core trust model was collapsed** (a solver could forge a payment proof and drain USDC without paying). Report: `docs/agent/AUDIT-2026-06-09.md` (+ `.findings.json`). 3 Critical, 7 High, 6 Med, 33 Low, 13 Nit.
- All fixes are implemented + tested on branch `audit-fixes` across 4 phases (commits below). Every component builds + tests green.
- A **local anvil E2E** (frontend + solver + attestation + Qonto **sandbox**) was stood up and works.
- We then **pivoted to deploying the fixed stack to Base mainnet** (sandbox Qonto). **BLOCKED** on the user funding their wallet + the solver key. The mainnet runbook is below.

## LIVE MAINNET E2E STATE (2026-06-10) — ✅ COMPLETE
**The full trustless offramp ran end-to-end on Base mainnet.** Fulfill tx
`0xac56cc215ce75735bcc1affaac56a74574a65a38a9ef5e036f9cd7f78fd625b4` — intent FULFILLED,
1.0 USDC → solver `0x25ac46…`, all audit-hardened checks active.
**SEPA proof = TWO TLSNotary proofs ("Approach T"):** Qonto serves transfer status+amount
(`/v2/sepa/transfers/{id}`) and recipient IBAN (`/v2/beneficiaries/{id}`) on separate
endpoints and closes the connection after one response (and `/v2/transactions` is empty in
sandbox) — so the solver proves each separately and the attestation verifies both and
cross-checks `transfer.beneficiary_id == beneficiary.id` before binding the IBAN. Sandbox SCA
clears via `POST /v2/mocked_sca_sessions/{token}/allow`. Solver RPC = publicnode (base.org
429s the sync). **All code changes UNCOMMITTED on `audit-fixes` — review + commit.**
Funding cleared; the fixed stack is **deployed to Base mainnet** and all services run locally.
- **Deployed (Base 8453, audited code, OUR witness — test stack, NOT production):**
  - PaymentVerifier `0x929F9536B5E91F5d7E5877A861E3bBFad4B3f06c`
  - OffRampV3 `0xB017CEB882FCA97c357191a39A7450bcC7E2Ce9b`
  - Deploy tx via `contracts/_deploy-mainnet-e2e.sh` (user-run; ~0.00002 ETH). Witness authorized ✓.
- **Fresh test keys** (solver/witness/notary) live in gitignored `solver/.env.mainnet` + `attestation/.env.mainnet`. Solver `0x25ac46C084620d0F129399111cDf0aD2C9Ff196D` (seeded 0.0002 ETH, registered via `setSolverRtpn(0,true)`). Witness `0x1b0b2332…`. Notary SEC1 pinned in attestation env.
- **Run state:** `solver/.env.mainnet` sets `DB_PATH=./solver-mainnet.db` (the local-anvil `solver.db` had lastBlock=3 → would grind block 4→47M; fresh DB fixes it). `frontend/.env.local` repointed off the dead VPS `95.217.235.164:8081` to `127.0.0.1:8081`.
- **Restart commands:** attestation `cd attestation && set -a && source .env.mainnet && set +a && ./target/release/attestation-service`; solver `cd solver && ENV_FILE=.env.mainnet npx tsx src/index-v3.ts`; frontend `cd frontend && NEXT_PUBLIC_NETWORK=mainnet npm run dev`. Prover binary prebuilt at `providers/prover/target/release/qonto_prove_transfer`.
- **First offramp (1.5 USDC → EUR):** intent→quote→commit all succeeded on-chain; the SEPA leg hit Qonto sandbox **SCA (428 `sca_required`)**. Root cause + fix: the solver polled the device endpoint `GET /v2/sca/sessions/{token}` (404s in sandbox). Fixed `solver/src/providers/qonto-client.ts` to approve the **mocked** session (`POST /v2/mocked_sca_sessions/{token}/allow`) when `stagingToken` is set, then retry with `X-Qonto-Sca-Session-Token` (production device-approval path untouched, gated on `stagingToken`). tsc + the 4 qonto-client unit tests green. Re-running fulfillment.

## Commits on `audit-fixes`
| Commit | Phase |
|---|---|
| `1ab8f0f` | P1 attestation: pin notary key, bind IBAN on-chain, settlement gate, remove bypass, fail-closed |
| `6ad330a` | P2 contracts: 1%→1¢ epsilon floor, slippage binds real quote, `rescueCommitted`, dup/bounds guards |
| `e6b817e` | P3 frontend: hook payload flat→tuple, `TransferInitiated` event sig, `outputAmount`→`fiatAmount` NaN guard, `commit(solver)` |
| `fa5b7a9` | P4 cleanup: delete V2 clusters, dead deps, dead scaffolding (net −2,200 lines) |
| `3c4b6c3` | local-e2e wiring: prover sandbox support + frontend `local` (31337) network |

## The 3 Criticals (all fixed on this branch, NOT on mainnet/main)
1. **Notary trust-collapse** — prover self-notarized with `[1u8;32]` dummy key + attestation never pinned the notary key. Fixed: `attestation/src/verification.rs` pins `NOTARY_PUBLIC_KEYS`; prover loads `NOTARY_PRIVATE_KEY`.
2. **IBAN not bound to chain** — attestation trusted a solver-supplied `expected_beneficiary_iban`. Fixed: `chain.rs` decodes `receivingInfo` from `getIntent` (field index 9, dynamic string) and `validate_intent` requires proven IBAN == on-chain recipient.
3. **Hook payload encoding** — frontend encoded flat, contract decodes a tuple → `execute()` reverts. Fixed: `encodeHookPayload` now encodes a single tuple (verified byte-identical to the contract's `encodePayload` via `cast`).

## Local anvil E2E (works — for reference / fallback)
- `anvil --chain-id 31337` (deterministic accounts). Deploy via `contracts/script/DeployLocal.s.sol` (mock USDC + PaymentVerifier + OffRampV3 + router). Deterministic addresses: USDC `0x5FbD…0aa3`, PaymentVerifier `0xe7f1…0512`, OffRampV3 `0x9fE4…a6e0`, Router `0xCf7E…0Fc9`.
- Anvil **acct0** (`0xf39Fd6…2266`, key `0xac09…ff80`) = deployer + witness + holds 1M MockUSDC. **acct1** (`0x7099…79C8`, key `0x59c6…690d`) = solver. **acct2 key** `0x5de4…365a` = local notary.
- Services: attestation `:4001`, solver health `:8080` / quotes `:8081`, frontend `:3000` (`NEXT_PUBLIC_NETWORK=local`). Gitignored `.env`s: `attestation/.env`, `solver/.env`, `providers/prover/adapters/qonto/.env`.
- **`solver/.env` (gitignored) holds working Qonto sandbox OAuth creds** (client id/secret, staging token, refresh token, `QONTO_BANK_ACCOUNT_ID=01924a48-c07e-7387-9fa4-74fac75f4256`, slug `vueling-3296-bank-account-1`). REUSE these (refresh the access token via the refresh_token if expired — it's one-time-use/rotating).

## Mainnet E2E — exact resume steps (decisions already made: deploy the FIXED stack + fresh funded solver key)
**User wallet** = `0x18d2…68d3` → address **`0x4045511196D50517b511973230b6359BDDe64F98`** (browser wallet = intent creator + deployer/owner). ⚠️ **User must rotate this key** (it's in the prior transcript). At last check it had only 0.00038 ETH + 0.001 USDC — **needs funding**.

1. **Funding gate** (resume here): user funds **only `0x4045…`** with **~0.005 ETH + ~3 USDC**. The extra ETH covers the deploy, the create/commit gas, AND seeding the freshly-generated solver (step 2 sends it ETH from `0x4045…`). No separate solver pre-funding — keys regenerate next session. USDC isn't lost — it transfers to the solver account we control, so it's recoverable.
2. **Generate fresh keys** (the prior session's generated keys were NEVER used on-chain — just regenerate): `cast wallet new` ×3 → solver, witness, notary. Notary pubkey for pinning: `cast wallet public-key --private-key <notary>` → **prepend `04`** → SEC1 uncompressed key for `NOTARY_PUBLIC_KEYS`. Then seed the solver for gas: `cast send <solver addr> --value 0.002ether --private-key <user 0x18d2…> --rpc-url https://mainnet.base.org`.
3. **Deploy** (`contracts/script/DeployFixed.s.sol` — already written; deploys PaymentVerifier + OffRampV3 against real USDC, no MockUSDC/router):
   `DEPLOYER_PRIVATE_KEY=<user 0x18d2…> WITNESS_ADDRESS=<witness> USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 forge script <abs path>/DeployFixed.s.sol:DeployFixedScript --root <abs>/contracts --rpc-url https://mainnet.base.org --broadcast`
4. **attestation/.env**: `CHAIN_ID=8453`, `VERIFIER_CONTRACT=<new verifier>`, `OFFRAMP_CONTRACT=<new offramp>`, `RPC_URL=https://mainnet.base.org`, `WITNESS_PRIVATE_KEY=<witness>`, `NOTARY_PUBLIC_KEYS=<notary sec1>`, `SOLVER_API_KEYS=devkey:<solver addr>`, `ALLOWED_SERVERS=thirdparty.qonto.com,thirdparty-sandbox.staging.qonto.co`.
5. **solver/.env**: `CHAIN_ID=8453`, `RPC_URL=https://mainnet.base.org`, `OFFRAMP_V3_ADDRESS=<new>`, `PAYMENT_VERIFIER_ADDRESS=<new>`, `SOLVER_PRIVATE_KEY=<solver>`, `NOTARY_PRIVATE_KEY=<notary>`, `ATTESTATION_API_KEY=devkey`; **keep the Qonto sandbox block + `QONTO_HOST=thirdparty-sandbox.staging.qonto.co`**.
6. **frontend/lib/network.ts**: point the `mainnet` entry at the NEW test contracts (OFFRAMP_V3 = new, USDC = real `0x8335…`, PAYMENT_VERIFIER = new).
7. **Register the solver** (else it throws at boot — see cross-2-4 gotcha): `cast send <new OffRampV3> "setSolverRtpn(uint8,bool)" 0 true --private-key <solver> --rpc-url https://mainnet.base.org`.
8. **Run**: restart attestation (mainnet env) + solver (`cd solver && npx tsx src/index-v3.ts`); frontend `NEXT_PUBLIC_NETWORK=mainnet npm run dev`. User offramps ≥1 USDC, recipient IBAN that clears the sandbox (e.g. `ES7868880001615398593372`). Watch solver + attestation logs; the live TLSNotary leg (sandbox SCA on the transfer, the proof, the strict attestation checks) is where issues surface.

> ⚠️ The **live mainnet contracts** `OffRampV3 0x5072…`/`PaymentVerifier 0x5eFc…` are the **pre-audit code** and authorize the **production witness `0x3438…1a27`** (key we don't have). That's why we deploy a fresh fixed stack with our own witness — do NOT point this test at the live contracts.

## Gotchas (also see solver/CLAUDE.md, security-invariants.md)
- **cross-2-4 — solver self-registration**: `isAuthorizedSolver()` checks `solverSupportsRtpn[solver][SEPA_INSTANT(0)]`; a fresh solver throws *"Solver is not authorized on the contract!"* + fatal at boot until it calls `setSolverRtpn(0,true)`. (The real fix — removing the gate — is a deferred product decision.)
- **Qonto sandbox**: `X-Qonto-Staging-Token` must be on **every** request, **including OAuth endpoints**. Browser OAuth `…/oauth2/auth` **404s unless you're logged into the Sandbox web-app first** (developers.qonto.com → Toolkit → Sandbox web app). Token URL: `https://oauth-sandbox.staging.qonto.co/oauth2/token`. The repo's `qonto-oauth.mjs` is now sandbox-aware (`QONTO_USE_SANDBOX=true` + staging headers); redirect URI `http://localhost:3456/callback` must be registered on the app. Refresh tokens are one-time-use/rotating.
- **Prover env inheritance**: the solver spawns the prover with `env: {...process.env, ...}`, so one `solver/.env` drives both. `prove_transfer.rs` now reads `QONTO_HOST`/`QONTO_STAGING_TOKEN`/`QONTO_ACCESS_TOKEN` (bearer-or-api-key) — sandbox-capable.
- **WIP entanglement**: this branch inherited uncommitted venmo-sepa WIP. A few touched files (`VenmoToSepaRouter.sol`, `VenmoToSepaFlow.tsx`, `router-contracts.ts`, frontend `package.json`) carry that WIP folded into the audit-fix commits — review before merging.
- **IPv6 trap**: use `127.0.0.1`, not `localhost`, for `ATTESTATION_SERVICE_URL`.

## Deferred (not done — flag to user)
markComplete()+COMPLETED status removal (tests+ABI ripple); prover stdout pretty-print + present_transfer redaction lines (cascade with serde_json); duplicate decode_bytes32; eip712 sol! block; the cross-2-4 gate removal; stray `MIGRATION_PLAN.md`/`x-post.md` (untracked); VoP `NOT_POSSIBLE`/`CLOSE_MATCH` policy; standalone networked notary (true permissionless — the tracked milestone before cloud).
