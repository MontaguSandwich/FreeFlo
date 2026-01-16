# Attestation Separation - Implementation TODO

## Overview

Separate the attestation service from solvers so that only FreeFlo can sign payment attestations.

**Key principle:** Solvers generate TLS proofs, FreeFlo verifies and signs them.

---

## Phase 1: FreeFlo Attestation Infrastructure

### 1.1 Server Setup
- [ ] Provision FreeFlo server for attestation service
- [ ] Configure firewall (allow 443, block 4001 externally)
- [ ] Set up domain: `attestation.free-flo.xyz`
- [ ] Configure TLS certificate (Let's Encrypt or similar)
- [ ] Set up reverse proxy (nginx/caddy) for HTTPS termination

### 1.2 Key Management
- [ ] Generate new witness private key for production
- [ ] Store key in secure secrets manager
- [ ] Document key backup and recovery procedure
- [ ] **On-chain:** Authorize new witness address in `PaymentVerifier.authorizedWitnesses`

### 1.3 Deploy Attestation Service
- [ ] Deploy `attestation-service/` to FreeFlo server
- [ ] Configure environment variables:
  - `WITNESS_PRIVATE_KEY` (from secrets manager)
  - `CHAIN_ID=84532`
  - `VERIFIER_CONTRACT=0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe`
  - `ALLOWED_SERVERS=thirdparty.qonto.com`
- [ ] Set up systemd service or container orchestration
- [ ] Configure logging (structured JSON to file/stdout)
- [ ] Set up monitoring (health endpoint polling)

### 1.4 Verify Deployment
- [ ] Test health endpoint: `curl https://attestation.free-flo.xyz/api/v1/health`
- [ ] Verify witness address matches on-chain authorization
- [ ] Test attest endpoint with valid proof

---

## Phase 2: Add Solver Authentication

### 2.1 API Key System (Attestation Service)

**File:** `attestation-service/src/`

- [ ] Add `auth.rs` module:
  ```rust
  // Parse SOLVER_API_KEYS env var
  // Format: "key1:0xSolverAddr1,key2:0xSolverAddr2"
  // Validate X-Solver-API-Key header
  // Return solver address on success
  ```

- [ ] Update `config.rs`:
  - [ ] Add `solver_api_keys: HashMap<String, Address>` field
  - [ ] Add `rate_limit_per_minute: u32` field (default 100)

- [ ] Update `api.rs`:
  - [ ] Extract and validate `X-Solver-API-Key` header in `attest()` handler
  - [ ] Return 401 Unauthorized if missing or invalid
  - [ ] Log solver address with each request

- [ ] Add rate limiting:
  - [ ] Per-solver request counter (in-memory or Redis)
  - [ ] Return 429 Too Many Requests when exceeded
  - [ ] Include `Retry-After` header

### 2.2 On-Chain Intent Validation (Required)

**File:** `attestation-service/src/`

- [ ] Add `chain.rs` module for RPC calls:
  - [ ] Add `ethers` or `alloy` crate dependency
  - [ ] Implement `get_intent(intent_hash)` → Intent struct
  - [ ] Implement `is_solver_authorized(solver_address)` → bool

- [ ] Update `config.rs`:
  - [ ] Add `rpc_url: String` field (e.g., `https://base-sepolia-rpc.publicnode.com`)
  - [ ] Add `offramp_contract: Address` field (`0x34249F4AB741F0661A38651A08213DDe1469b60f`)

- [ ] Update `attestation.rs` to validate before signing:
  - [ ] Query intent exists on-chain
  - [ ] Verify intent status is ACTIVE (not FULFILLED/CANCELLED)
  - [ ] Verify payment amount matches intent amount
  - [ ] Verify requesting solver is authorized for this intent
  - [ ] Reject with 400 if any check fails

- [ ] Add timestamp validation:
  - [ ] Reject TLS proofs older than 1 hour
  - [ ] Prevent replay of old proofs

### 2.3 Audit Logging

**File:** `attestation-service/src/`

- [ ] Create `audit.rs` module:
  ```rust
  struct AuditLog {
      timestamp: u64,
      solver_address: String,
      intent_hash: String,
      payment_id: Option<String>,
      amount_cents: u64,
      result: String,  // "success" | "rejected:<reason>"
      request_ip: String,
  }
  ```
- [ ] Log to structured JSON file
- [ ] Include request IP (from X-Forwarded-For or direct)

---

## Phase 3: Update Solver Attestation Client

### 3.1 Configuration Changes

**File:** `solver/src/config.ts`

- [ ] Add new config field:
  ```typescript
  attestation: {
    serviceUrl: string,      // https://attestation.free-flo.xyz
    apiKey: string,          // FREEFLO_SOLVER_API_KEY env var
    timeout: number,
  }
  ```
- [ ] Remove any reference to `WITNESS_PRIVATE_KEY` in solver docs

### 3.2 Client Updates

**File:** `solver/src/attestation/client.ts`

- [ ] Add API key to request headers:
  ```typescript
  headers: {
    'Content-Type': 'application/json',
    'X-Solver-API-Key': this.apiKey,
  }
  ```

- [ ] Handle new error responses:
  - [ ] 401: Log "Invalid API key" and fail
  - [ ] 429: Extract `Retry-After`, wait, retry once

- [ ] Update `healthCheck()` to not require API key (public endpoint)

### 3.3 Update Orchestrator

**File:** `solver/src/orchestrator-v3.ts`

- [ ] Update startup check (lines 87-104):
  - [ ] Health check should verify FreeFlo's witness is authorized (not solver's)
  - [ ] Log FreeFlo attestation service URL on startup

---

## Phase 4: Documentation Updates

### 4.1 Update CLAUDE.md

- [ ] Update directory structure (remove attestation from solver section)
- [ ] Update "Run & Test" section:
  - [ ] Remove attestation service commands from solver section
  - [ ] Add note that attestation is hosted by FreeFlo
- [ ] Update environment variables:
  - [ ] Solver section: Remove `WITNESS_PRIVATE_KEY`, add `FREEFLO_SOLVER_API_KEY`
  - [ ] Add new "FreeFlo Attestation" section (internal only)
- [ ] Update Quick Debug section

### 4.2 Create Solver Deployment Guide

**File:** `docs/SOLVER_DEPLOYMENT.md`

- [ ] Prerequisites (Qonto account, server requirements)
- [ ] Step-by-step deployment:
  1. Clone repo
  2. Configure environment (no attestation service!)
  3. Request API key from FreeFlo
  4. Run solver
- [ ] Configuration reference
- [ ] Troubleshooting common issues
- [ ] How to get authorized as a solver on-chain

### 4.3 Update Architecture Docs

**File:** `docs/ARCHITECTURE.md`

- [ ] Update flow diagrams to show trust boundaries
- [ ] Add section on "Trust Model"
- [ ] Clarify what solvers run vs what FreeFlo runs

### 4.4 Create Internal Ops Guide

**File:** `docs/internal/ATTESTATION_OPS.md` (don't commit to public repo)

- [ ] Deployment procedures
- [ ] Key rotation process
- [ ] Monitoring and alerting setup
- [ ] Incident response playbook
- [ ] Solver API key issuance process

---

## Phase 5: Testing and Migration

### 5.1 Testing

- [ ] Unit tests for API key validation
- [ ] Integration test: solver → FreeFlo attestation → on-chain
- [ ] Load test: multiple concurrent attestation requests
- [ ] Security test: verify rejected without valid API key

### 5.2 Migration Steps

- [ ] Deploy FreeFlo attestation service (Phase 1)
- [ ] Authorize new witness address on-chain
- [ ] Update internal solver to use FreeFlo attestation
- [ ] Test full flow end-to-end
- [ ] Deauthorize old solver-controlled witness addresses
- [ ] Update public documentation
- [ ] Announce to any external solvers

### 5.3 Rollback Plan

- [ ] Keep old solver-hosted attestation code (don't delete)
- [ ] Document how to revert if needed
- [ ] Keep old witness authorized for 1 week after migration

---

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `attestation-service/src/auth.rs` | **NEW** | API key validation |
| `attestation-service/src/chain.rs` | **NEW** | On-chain intent validation (RPC calls) |
| `attestation-service/src/audit.rs` | **NEW** | Audit logging |
| `attestation-service/src/config.rs` | MODIFY | Add API keys, RPC URL, contract address |
| `attestation-service/src/api.rs` | MODIFY | Add auth middleware, rate limiting |
| `attestation-service/src/attestation.rs` | MODIFY | Add intent validation before signing |
| `attestation-service/src/main.rs` | MODIFY | Wire up new modules |
| `solver/src/config.ts` | MODIFY | Add `apiKey` field |
| `solver/src/attestation/client.ts` | MODIFY | Add API key header, handle 401/429 |
| `solver/src/orchestrator-v3.ts` | MODIFY | Update startup checks |
| `CLAUDE.md` | MODIFY | Update deployment instructions |
| `docs/SOLVER_DEPLOYMENT.md` | **NEW** | Third-party solver guide |
| `docs/ARCHITECTURE.md` | MODIFY | Update diagrams, trust model |

---

## Estimated Effort

| Phase | Complexity | Notes |
|-------|------------|-------|
| Phase 1 | Medium | Mostly infra/ops work |
| Phase 2 | Medium | Core Rust changes |
| Phase 3 | Low | Simple TypeScript changes |
| Phase 4 | Low | Documentation only |
| Phase 5 | Medium | Testing and careful migration |

---

## Dependencies

- FreeFlo server/infrastructure for hosting
- Domain and TLS certificate
- Secrets management solution
- On-chain transaction to authorize new witness

---

## Design Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain | `attestation.free-flo.xyz` | Subdomain of existing domain, no new purchase needed |
| Solver registration | Manual approval | FreeFlo team vets solvers, issues API keys directly |
| Intent validation | Required | Query chain before signing (~100-500ms latency acceptable for security) |

## Open Decisions

1. **Rate limits:** 100/min per solver? Higher/lower?
2. **API key format:** UUID? JWT? Simple random string?
