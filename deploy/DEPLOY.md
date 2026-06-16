# FreeFlo backend deploy — solver + attestation on one VPS (Docker Compose)

The frontend is already on Vercel; this brings up the two backend services. Vercel reaches the
solver **server-side** over plain HTTP, so no TLS/domain is required. The attestation service holds
the witness key and is **not** exposed to the internet — only the solver reaches it on the internal
compose network.

## 0. Provision the VPS
- Small Linux VPS (2 vCPU / 4 GB is plenty), Ubuntu 22.04/24.04, public IPv4.
- Firewall: open inbound TCP **8081** (quote + compact-fill API — Vercel hits this); optionally 8080
  (health). Keep **4001 closed**. e.g. `ufw allow 22/tcp && ufw allow 8081/tcp && ufw enable`.
- Install Docker + Compose plugin: `curl -fsSL https://get.docker.com | sh`

## 1. Get the code
```bash
git clone <repo-url> freeflo && cd freeflo
git checkout feat/sign-once-commitfor    # until it's merged to main (step 5)
```

## 2. Fill the env files (secrets stay here; gitignored)
```bash
cp deploy/attestation.env.example deploy/attestation.env
cp deploy/solver.env.example      deploy/solver.env
```
- **deploy/attestation.env** — paste values from your working local attestation env. `NOTARY_PUBLIC_KEYS`
  is REQUIRED (service won't boot without it).
- **deploy/solver.env** — paste your local `solver/.env.production` values, KEEP the "DOCKER OVERRIDES"
  block as-is, and set a fresh `COMPACT_FILL_API_KEY` (`openssl rand -hex 24`).
- Shared secrets must line up: solver `ATTESTATION_API_KEY` ∈ attestation `SOLVER_API_KEYS`; the
  solver `NOTARY_PRIVATE_KEY`'s pubkey ∈ attestation `NOTARY_PUBLIC_KEYS`.

## 3. Build + run
```bash
docker compose up -d --build       # first build compiles tlsn (Rust) twice — ~10-20 min
docker compose ps
docker compose logs -f solver
```
Verify (on the host):
```bash
curl "http://localhost:8081/api/quote?amount=100&currency=EUR"   # quotes
curl http://localhost:4001/api/v1/health                          # attestation
```
From your laptop: `curl "http://<VPS_IP>:8081/api/quote?amount=100&currency=EUR"`.
Fund the solver address (`SOLVER_PRIVATE_KEY`) with a little Base ETH for fill gas.

## 4. Point Vercel at the backend (frontend env vars, Production scope)
- `SOLVER_API_URL=http://<VPS_IP>:8081`
- `COMPACT_FILL_API_KEY=<same value as deploy/solver.env>`
- `NEXT_PUBLIC_ENABLE_SIGN_ONCE=true`
- `NEXT_PUBLIC_ENABLE_FIAT_TO_FIAT=true`
- (keep existing `NEXT_PUBLIC_ZKP2P_API_KEY` / `ZKP2P_API_KEY`, `NEXT_PUBLIC_NETWORK=mainnet`)

## 5. Merge to main → Vercel deploys
Once the backend responds and Vercel env is set, merge `feat/sign-once-commitfor` → `main`
(your go-ahead). Vercel auto-deploys the production frontend, now fully wired.

## Ops
- Update:  `git pull && docker compose up -d --build`
- Logs:    `docker compose logs -f solver` (or `attestation-service`)
- Restart: `docker compose restart solver`
- State: rotating Qonto tokens persist to the bind-mounted `deploy/solver.env`; the SQLite DB +
  proofs live on the `solver-data` volume.
- Toolchain: images use Rust stable + Node 20. If the tlsn build fails on a Rust version, pin
  `FROM rust:<known-good>-bookworm` in `attestation/Dockerfile` and `solver/Dockerfile`.
- Security: only 8081 is public, gated by `COMPACT_FILL_API_KEY` on the fill route. The witness-key
  attestation service is never exposed. Consider restricting 8081 to Vercel egress if you lock down further.
```
