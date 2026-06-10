# Qonto sandbox → production migration

The mainnet E2E ran against **Qonto sandbox** (mock SCA, fake EUR). This is what it takes to
run against **production Qonto** (real EUR). The switch is **entirely env-driven — no
solver/attestation code changes** (verified). The two-proof prover/attestation ("Approach T",
transfer + beneficiary) works in prod unchanged: `QONTO_HOST=thirdparty.qonto.com` and the
attestation's `ALLOWED_SERVERS` already accepts it.

> ⚠️ **Read "The SCA blocker" below first.** For *arbitrary* recipient IBANs it is the real gate,
> and it is a Qonto-account/relationship problem, not a code change.

Templates: `solver/.env.production` + `attestation/.env.production` (gitignored placeholders).

## 1. Env diff (sandbox → production)

| Var | Sandbox | Production | Notes |
|---|---|---|---|
| `QONTO_USE_SANDBOX` | `true` | `false` | Selects prod base/OAuth URLs (`qonto-client.ts:67-69`, `config.ts:64`) |
| `QONTO_STAGING_TOKEN` | set | **unset/absent** | Its presence flips the client into sandbox + **mock SCA** (`qonto-client.ts:199-210`). Remove it. |
| `QONTO_HOST` | `thirdparty-sandbox.staging.qonto.co` | `thirdparty.qonto.com` | Prover host (`prove_transfer.rs:34,58`) |
| `QONTO_CLIENT_ID/SECRET` | sandbox app | **prod app** | Separate app in Qonto's production partner portal |
| `QONTO_ACCESS_TOKEN/REFRESH_TOKEN` | sandbox | **prod** | Mint via `QONTO_USE_SANDBOX=false node scripts/qonto-oauth.mjs` |
| `QONTO_BANK_ACCOUNT_ID` | sandbox UUID | **prod UUID** | From `GET /v2/organization` (UUID, **not** the slug) |
| `QONTO_API_KEY_LOGIN/SECRET` | sandbox | **prod** | Prover read-auth; Settings → Integrations → API Keys |
| `RPC_URL` | publicnode | Alchemy | `https://base-mainnet.g.alchemy.com/v2/<key>` |
| contracts/witness | test stack | **audited prod stack** | See "Dependencies" below |

## 2. External Qonto setup (one-time)
1. **Production OAuth app** in Qonto's prod partner portal — scopes `offline_access organization.read
   payment.write`; redirect URI `http://localhost:3456/callback` (or your HTTPS callback). Note
   `client_id`/`client_secret`.
2. **Mint prod tokens:** `QONTO_USE_SANDBOX=false QONTO_CLIENT_ID=… QONTO_CLIENT_SECRET=… node
   scripts/qonto-oauth.mjs` → captures `QONTO_ACCESS_TOKEN`/`QONTO_REFRESH_TOKEN` (refresh token
   rotates one-time; the solver persists rotations to `ENV_FILE` via `qonto.ts:570-619`).
3. **Prod API keys** (Settings → Integrations → API Keys) for the prover.
4. **Bank account UUID:** `curl -H "Authorization: Bearer $TOKEN" https://thirdparty.qonto.com/v2/organization`
   → use `bank_accounts[].id` (UUID). Using the slug → `bank_account_not_found`.
5. **Fund** the prod account with EUR ≥ expected transfer volume.
6. **NTP/clock sync** on the host (`timedatectl set-ntp true`) — VoP proof tokens are time-bounded;
   drift → `vop_proof_token_invalid`.

## 3. ⚠️ The SCA blocker (the real gate)
Mock SCA is **sandbox-only** (`X-Qonto-2fa-Preference: mock` + `/v2/mocked_sca_sessions/{token}/allow`,
gated on `stagingToken`). In **production**, `transfer.single.create` to an **untrusted** beneficiary
returns **428 `sca_required`** → the client falls to `waitForScaApproval` polling `/v2/sca/sessions`
for ~5 min then fails (`qonto-client.ts:460-493,555-557`). **An unattended solver cannot tap a phone**,
so such a transfer will hang then error.

- **Trusted beneficiaries** (`qonto.ts:1-19`, `findTrustedBeneficiary` ~`qonto-client.ts:405-420`) are
  the intended escape — Qonto does not require SCA for them. But they are marked **manually** in the
  Qonto dashboard, and **FreeFlo accepts arbitrary recipient IBANs**, so pre-trusting every recipient
  does not scale.
- **Resolution is Qonto-side**, pick one before permissionless prod:
  1. **SCA exemption / partner arrangement** with Qonto for the offramp use case (best).
  2. **Human-in-the-loop**: a person approves the first transfer to each new IBAN (then it can be
     trusted) — workable for low volume, not for permissionless scale.
  3. Restrict prod to a **pre-trusted beneficiary set** initially.
- VoP behaviour in prod (`qonto.ts:485-510`): `MATCH`/`CLOSE_MATCH`/`NOT_POSSIBLE` → proceed,
  `NO_MATCH` → abort. Real recipients mean real name↔IBAN matching; expect more `NO_MATCH` aborts than
  in sandbox.

## 4. Dependencies (not solved by env alone)
- **Audited prod contracts + secure witness.** The live prod contracts (`0x5072…`/`0x5eFc…`) are
  pre-audit and authorize a witness key we don't hold. Production must deploy the **audited**
  PaymentVerifier + OffRampV3 to mainnet with a **securely-managed** prod witness (the E2E test keys
  were exposed in transcripts — do not reuse). Then fill the contract/witness placeholders in the
  `.env.production` files.

## 5. Go-live test (after the above)
1. Create the prod app, mint tokens, fund the account, **mark one test beneficiary trusted**.
2. `cd solver && ENV_FILE=.env.production npx tsx src/index-v3.ts` (+ attestation on `.env.production`).
3. A small (€1–5) offramp to the **trusted** beneficiary → confirm **no 428** and full
   settle → two-proof → attest → `fulfillIntentWithProof`. This validates the trusted path before any
   arbitrary-recipient decision.
