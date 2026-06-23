# FreeFlo Sentinel

Error detection + alerting + (non-refund) self-healing keeper for FreeFlo. It watches the
chain (stuck router slots / OffRampV3 intents past their windows) and the solver (health,
stuck backlog), classifies each incident, alerts via Telegram, and — only for non-refund
infra issues, when enabled — self-heals (restart the solver).

## Autonomy boundary (the rule it enforces)

| Tier | What | Who acts |
|------|------|----------|
| **Auto** | non-refund infra self-heal (restart solver, token refresh) | the Keeper, if `SENTINEL_AUTOHEAL=true` (default **off**) |
| **Detect + alert** | refund/rescue (stuck slots → USDC back to a user) | the user clicks the in-UI reclaim button; Keeper alerts |
| **AI fix-builder** | novel/unknown problems | a separate Claude routine builds a fix → you approve |

Every incident carries `autonomous: boolean` — `true` only for the first tier.

## Run locally (read-only, safe)

```bash
cd sentinel
npm install
cp .env.example .env          # fill TELEGRAM_BOT_TOKEN (secrets stay local — .env is gitignored)
node scripts/resolve-chatid.mjs   # after messaging @freefreeflobot → writes TELEGRAM_CHAT_ID
npm run sweep                 # one read-only sweep
npm start                     # continuous loop (SENTINEL_INTERVAL_MS, default 120s)
```

Off-box, the solver's `:8080` health port is unreachable, so the solver detector correctly
reports `solver-down`. Set `SOLVER_HEALTH_URL=` (empty) to skip it when testing locally.

## Deploy on EC2 (beside solver + attestation)

```bash
docker compose -f sentinel/docker-compose.sentinel.yml up -d --build
```

- Reaches the solver at `http://solver:8080` over the compose network.
- Incident dedupe state persists in `sentinel/state/` (mounted volume, gitignored).
- **Enabling self-heal:** set `SENTINEL_AUTOHEAL=true` and uncomment the docker-socket +
  compose-file mounts in the compose file — but only after watching it run clean, so a
  transient blip can't trigger a needless solver restart.

## Layout

- `src/detectors/onchain.ts` — stuck router slots / OffRampV3 intents (viem, read-only).
- `src/detectors/solver.ts` — solver `/health` + `/intents/stuck` backlog.
- `src/alert.ts` — Telegram transport. `src/store.ts` — incident dedupe + the durable log the AI routine reads.
- `src/heal.ts` — gated non-refund self-heal. `src/index.ts` — sweep + loop.
- `scripts/resolve-chatid.mjs` — one-shot Telegram chat-id resolver.
