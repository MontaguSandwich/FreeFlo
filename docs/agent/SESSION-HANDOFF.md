# FreeFlo — Audit Remediation + Mainnet E2E — SESSION HANDOFF

> Resume note for the audit + 4-phase remediation + live E2E work. Read this first.
> Branch: **`audit-fixes`** (off `claude/venmo-sepa-integration-gVIwz`). Date: 2026-06-09/10.

## Mainnet OffRampV3 deployments — contracts are PROVIDER-AGNOSTIC
One OffRampV3 + PaymentVerifier pair handles ALL providers/currencies/rails — it only verifies a
witness-signed EIP-712 attestation + a nullifier. "Qonto sandbox vs prod" is purely a SOLVER (off-chain)
config — the contracts don't know. Multiple mainnet deploys exist for **code version + witness key**, NOT providers:

| Stack | OffRampV3 | PaymentVerifier | Witness | Code |
|---|---|---|---|---|
| Pre-audit live | `0x5072…2083D` | `0x5eFc…8905` | `0x3438…1a27` (not held) | pre-audit ⚠️ unusable |
| E2E test (06-10) | `0xB017…2Ce9b` | `0x929F…3f06c` | `0x1b0b2332…` (exposed) | audited · SANDBOX Qonto |
| Production (06-11) | `0x57c6…0b4D7` | `0x5602…2A9b` | `0xf68E2A4f…` (secure) | audited · PROD Qonto |

Testnet (Base Sepolia): OffRampV3 `0x34249F4AB741F0661A38651A08213DDe1469b60f`, PaymentVerifier
`0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe`. Each PaymentVerifier bakes in ONE witness at deploy →
changing the witness means a fresh pair. The frontend `lib/network.ts` scans the active + `legacyOffRamps`
for history/reclaim.

## PRODUCTION GO-LIVE (2026-06-11) — ✅ COMPLETE: first real-EUR trustless offramp settled
**Fulfill tx `0xbb4df085326d349a2929bf0b4a5092a54b139e9c91c9dd677f927f7c119eaaa5`** (Base 8453, status 1):
user deposited 0.1 USDC → solver sent **€0.08 real SEPA** (received) → two TLSNotary proofs (transfer +
beneficiary, prod Qonto) → attestation verified both + bound IBAN + signed → `fulfillIntentWithProof`
→ 0.1 USDC released to solver `0x2f92…` (`verifiedByZkTLS: true`). Recipient `FR76…8570` (trusted, no SCA 428).
- **Prover gotcha (cost us a stuck fulfillment):** `TLSN_EXAMPLES_PATH` must be the **LOCAL absolute path**
  (`providers/prover/adapters/qonto`). The template's VPS default `/opt/FreeFlo/…` doesn't exist locally →
  `spawn("cargo",…,{cwd})` fails as a misleading **`spawn cargo ENOENT`** → proof gen fails *after* the EUR is
  already sent. The SEPA is idempotent (deterministic `offramp-<intentId>` key) + transferId persisted, so the
  solver retried (exp. backoff, max 5) and completed once the path was fixed — no double-send.
- TODO: rotate transcript-exposed Qonto client-secret + API-secret; sweep 0.1 USDC from solver key.

## PRODUCTION GO-LIVE (2026-06-11) — audited stack DEPLOYED + verified; awaiting EUR funding + tokens
Switched sandbox→**production Qonto** and deployed the **audited** stack to Base mainnet with a
**securely-generated witness** (every private key lives only in gitignored env files — never in transcript).

**Deployed (Base 8453, audited code, prod witness):**
- PaymentVerifier `0x5602D796052ABDaD862FEf8011CA2cedB5132A9b` (deploy tx `0xe83cd832…`)
- OffRampV3       `0x57c621994616110a50bD820388e4E8a41F00b4D7` (deploy tx `0x7841fd59…`)
- Witness  `0xf68E2A4f1A1124e872239Da4e0A2BdB371332DdD` — authorized on PaymentVerifier ✓
- Notary   `0x9650604C31cB83e37a27De7DB6eb804BCAfA280B` (SEC1 `0x048795e6…` pinned in attestation `NOTARY_PUBLIC_KEYS`)
- Solver   `0x2f92Dce3a6eA32d95Eaa166958EfDea441a640E3` — seeded 0.0002 ETH (tx `0x134d4192…`),
  registered setSolverRtpn(0,true) (tx `0x26ad4af7…`), `solverSupportsRtpn[solver][0]=true` ✓
- Deployer/owner `0x6b8D7Bdf49Fa5c52E466043d9787452fdF529c10`
- Keys in gitignored `solver/.env.production` + `attestation/.env.production` + `contracts/.env.deploy`.
- Deploy helper `contracts/_deploy-prod.sh` (parameterized, no hardcoded keys).

**Verified preflight:** EIP-712 domain separator computed == on-chain `DOMAIN_SEPARATOR()`
`0x137b974a8e7699ebcea74c2066023f78511a1626db8b452ce6743f74e171e533`
(name WisePaymentVerifier / version 1 / chain 8453 / verifier 0x5602…). Bytecode present on both;
`OffRampV3.paymentVerifier()==0x5602…`.

**Qonto prod:** creds validated against `thirdparty.qonto.com` (HTTP 200). Bank UUID
`019b224e-3c54-78cc-a6cb-b29a798874b0` (slug `ei-malyen-malek-4902-bank-account-1`). Trusted
beneficiary marked. `scripts/qonto-oauth.mjs` patched: `QONTO_ENV_FILE=.env.production` writes the
minted tokens straight into the env (self-service, no print). `MIN_USDC_AMOUNT=100000` (0.1 USDC) in solver env.

**BLOCKING the go-live test (both user-side):**
1. EUR balance still **€0.00** — the €1 send hasn't landed; the SEPA leg needs funds.
2. OAuth tokens not yet minted —
   `cd solver && QONTO_USE_SANDBOX=false QONTO_ENV_FILE=.env.production node scripts/qonto-oauth.mjs`
   → fills the last 2 placeholders (`QONTO_ACCESS_TOKEN` / `QONTO_REFRESH_TOKEN`).
Then boot attestation (`.env.production`) + solver (`ENV_FILE=.env.production`) + frontend; user offramps
0.1 USDC (~€0.09 — watch Qonto min-transfer + VoP `NO_MATCH`). **TODO after test:** rotate the
transcript-exposed Qonto client-secret + API-secret.

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

## FiatToFiat router (formerly VenmoToSepa): full audit + redeploy runbook (2026-06-11)
Generic **fiat→fiat via USDC**: ZKP2P/Peer on-ramp + a PostIntentHook (`FiatToFiatRouter`,
renamed from `VenmoToSepaRouter`) → FreeFlo off-ramp. Route is now `/fiat-to-fiat`. The off-ramp
leg is already proven (audited stack); the on-ramp→hook→off-ramp full flow had never run E2E.

**Audit verdict:** contract logic is SOUND, deployment was STALE, on-ramp fulfill seam was brittle.
- Validated correct vs canonical source: hook PULL model matches `AcrossBridgeHookV2.execute`
  (`safeTransferFrom(orchestrator,…)`); `intent.to`=user; signal `data`=hook `signalHookData`;
  gating uses `/v3/intent` (callerAddress+referralFees[]); tuple payload encoding matches `abi.decode`.
- **Root blocker (CONFIRMED on-chain):** live router `0x8558…` `offRamp` (immutable) = pre-audit
  OffRampV3 `0x5072…`; its verifier `0x5eFc…` does NOT authorize our witness `0xf68E…` (cast → false),
  so every fulfillment reverts `NotAuthorizedWitness (0x41110897)`. Audited verifier `0x5602…` DOES
  authorize `0xf68E…` (true). ⇒ **redeploy mandatory. ✅ DONE 2026-06-11:** redeployed `FiatToFiatRouter`
  to **`0xaA11AFe4bDF080a9604a8B47b17D5AD66d13e967`** (tx `0xb4732534…`); cast-verified offRamp=`0x57c6`,
  verifier→witness=true, `COMMIT_TIMEOUT`=900; `FIAT_TO_FIAT_ROUTER_ADDRESS` set in the frontend.

**✅ FIRST FULL E2E SUCCEEDED 2026-06-11 (real EUR):** Revolut €0.10 → USDC (Peer TEE onramp) → router
hook `execute()` (TransferInitiated tx `0x2eb3f294…`) → FreeFlo offramp intent `0x192ba075…` → solver
quoted €0.09, user committed → **€0.09 real SEPA Instant settled** (Qonto, `transferId 019eb734…`, VoP
MATCH) → two TLSNotary proofs → attestation → `fulfillIntentWithProof` tx `0xbf8f82fb…` (block 47200408,
verifiedByZkTLS, intent FULFILLED). Two issues fixed live: (a) `/v3/intent` injects a mandatory ~0.95%
referralFee and signs it — must submit `intentData.referralFees` to signalIntent (else InvalidSignature);
(b) the TEE PeerAuth extension doesn't inject `window.peer` on localhost (SDK 0.1.1 can't detect it) — user
proved on peer.xyz, hook fired anyway; a resume-on-load path now lets a reloaded UI still reach commit. The
0.5.0 SDK (redirect-onramp) is needed for our frontend to own the proof step.

**Done this session (branch `audit-fixes`; 41 forge tests + frontend tsc green):**
- Renamed VenmoToSepa→FiatToFiat across contract/test/scripts/frontend/route/docs (dated AUDIT-*.snapshots left as-is).
- `DeployRouter.s.sol` default offRamp `0x5072`→**`0x57c6…`**; removed obsolete `DeployMainnet.s.sol` (it used V1 orchestrator + the unheld witness `0x3438…`).
- Path B: `handleVerifyPayment` no longer fire-and-forget — guards extension readiness, observes `onIntentFulfilled` for the exact `intentHash`, adds a stuck-state escape (was: silent infinite poll if no extension).
- `COMMIT_TIMEOUT` 30m→15m to match OffRampV3's selection window (closes the rescue dead-zone) + regression test.

**Router redeploy runbook (USER runs — needs a funded Base key):**
1. `cd contracts && DEPLOYER_PRIVATE_KEY=<funded> forge script script/DeployRouter.s.sol:DeployRouterScript --rpc-url https://mainnet.base.org --broadcast`
   — defaults are now correct: OffRampV3 `0x57c6…`, OrchestratorV2 `0x8888…3b888`, real USDC. No hook registration (V2 is permissionless).
2. Copy the printed address → set `FIAT_TO_FIAT_ROUTER_ADDRESS` in `frontend/lib/router-contracts.ts` (replace the `0x000…` sentinel).
3. Solver + attestation already target audited OffRampV3 `0x57c6…`, so router-created intents show up as normal intents and the prod solver quotes + fulfills them — no solver change.
4. E2E preconditions still external: (a) a live **EscrowV2 deposit** on the chosen platform (quote proxy defaults `revolut`, UI defaults `venmo` — pick one with liquidity); (b) **Peer browser extension** installed; (c) a real source-fiat payment to prove.

**Flagged / deferred:** literal app-side `client.fulfillIntent({proof})` (the TEE redirect-onramp model) needs upgrading `@zkp2p/sdk` 0.1.1→0.5.0 — a broad SDK migration (getQuote/signalIntent/client all changed), NOT done; current Path B uses installed 0.1.1 `onramp()`+`onIntentFulfilled`. `markComplete()`/`COMPLETED` still cosmetic.

## Gotchas (also see solver/CLAUDE.md, security-invariants.md)
- **cross-2-4 — solver self-registration**: `isAuthorizedSolver()` checks `solverSupportsRtpn[solver][SEPA_INSTANT(0)]`; a fresh solver throws *"Solver is not authorized on the contract!"* + fatal at boot until it calls `setSolverRtpn(0,true)`. (The real fix — removing the gate — is a deferred product decision.)
- **Qonto sandbox**: `X-Qonto-Staging-Token` must be on **every** request, **including OAuth endpoints**. Browser OAuth `…/oauth2/auth` **404s unless you're logged into the Sandbox web-app first** (developers.qonto.com → Toolkit → Sandbox web app). Token URL: `https://oauth-sandbox.staging.qonto.co/oauth2/token`. The repo's `qonto-oauth.mjs` is now sandbox-aware (`QONTO_USE_SANDBOX=true` + staging headers); redirect URI `http://localhost:3456/callback` must be registered on the app. Refresh tokens are one-time-use/rotating.
- **Prover env inheritance**: the solver spawns the prover with `env: {...process.env, ...}`, so one `solver/.env` drives both. `prove_transfer.rs` now reads `QONTO_HOST`/`QONTO_STAGING_TOKEN`/`QONTO_ACCESS_TOKEN` (bearer-or-api-key) — sandbox-capable.
- **WIP entanglement (RESOLVED 2026-06-11)**: the venmo-sepa WIP was audited + finished — router renamed `FiatToFiatRouter`, redeploy target fixed, Path B fulfill reworked, timeout aligned (see the "FiatToFiat router" section above). The redeploy broadcast is the only remaining gate.
- **IPv6 trap**: use `127.0.0.1`, not `localhost`, for `ATTESTATION_SERVICE_URL`.

## Deferred (not done — flag to user)
markComplete()+COMPLETED status removal (tests+ABI ripple); prover stdout pretty-print + present_transfer redaction lines (cascade with serde_json); duplicate decode_bytes32; eip712 sol! block; the cross-2-4 gate removal; stray `MIGRATION_PLAN.md`/`x-post.md` (untracked); VoP `NOT_POSSIBLE`/`CLOSE_MATCH` policy; standalone networked notary (true permissionless — the tracked milestone before cloud).
