# Attestation Service Separation Spec

## Problem Statement

Currently, the documentation and default setup have solvers running **all components**:
- TLSNotary prover (proof generation)
- Attestation service (proof verification + EIP-712 signing)
- Witness private key

This breaks the trustless guarantee. A malicious solver could:
1. Accept a user's USDC deposit
2. NOT send fiat payment
3. Generate a fake TLSNotary proof OR sign attestation without valid proof
4. Claim the USDC using their own witness key

**Root cause:** The solver controls the witness key that signs attestations.

## Solution Architecture

Separate responsibilities between **Solvers** (untrusted) and **FreeFlo Protocol** (trusted):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SOLVER (Untrusted)                            │
│                                                                         │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────────┐ │
│  │ Qonto SEPA   │───▶│ TLSNotary Prover │───▶│ Proof (presentation)  │ │
│  │ Payment      │    │ (Rust binary)    │    │ Base64 encoded        │ │
│  └──────────────┘    └──────────────────┘    └───────────┬───────────┘ │
│                                                          │             │
└──────────────────────────────────────────────────────────┼─────────────┘
                                                           │
                                                           ▼
                         HTTPS POST /api/v1/attest
                         { presentation, intentHash, ... }
                                                           │
┌──────────────────────────────────────────────────────────┼─────────────┐
│                      FREEFLO PROTOCOL (Trusted)          │             │
│                                                          ▼             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Attestation Service                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │   │
│  │  │ Verify TLS   │─▶│ Validate     │─▶│ Sign with Protocol    │  │   │
│  │  │ Proof        │  │ Payment Data │  │ Witness Key (EIP-712) │  │   │
│  │  └──────────────┘  └──────────────┘  └───────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                          │                             │
│  ┌───────────────────────────────────────┼───────────────────────────┐ │
│  │ WITNESS_PRIVATE_KEY                   │                           │ │
│  │ (Never leaves FreeFlo infrastructure) │                           │ │
│  └───────────────────────────────────────┼───────────────────────────┘ │
│                                          │                             │
└──────────────────────────────────────────┼─────────────────────────────┘
                                           │
                                           ▼
                              { signature, digest, ... }
                                           │
┌──────────────────────────────────────────┼─────────────────────────────┐
│                           SOLVER (Untrusted)                           │
│                                          │                             │
│                                          ▼                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Submit to OffRampV3.fulfillIntentWithProof(attestation, sig)    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BASE SEPOLIA (On-Chain)                          │
│                                                                         │
│  PaymentVerifier.verifyPayment():                                       │
│  1. Recover signer from EIP-712 signature                               │
│  2. Check authorizedWitnesses[signer] == true  ◀── Only FreeFlo's key   │
│  3. Verify domain separator matches                                     │
│  4. Check nullifier not used (prevent double-spend)                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Ownership

| Component | Owner | Location | Notes |
|-----------|-------|----------|-------|
| TLSNotary Prover | Solver | Solver's VPS | Generates cryptographic proofs |
| Attestation Service | FreeFlo | FreeFlo's infrastructure | Public endpoint, verifies proofs |
| Witness Private Key | FreeFlo | FreeFlo's infrastructure | NEVER shared with solvers |
| Solver API | Solver | Solver's VPS | Quote API, order management |
| Smart Contracts | FreeFlo | Base Sepolia | Immutable, deployed |

## Changes Required

### 1. Attestation Service (FreeFlo-Hosted)

**Current state:** Runs on solver VPS at `127.0.0.1:4001`

**Target state:** Runs on FreeFlo infrastructure at `https://attestation.free-flo.xyz`

#### 1.1 Infrastructure Changes
- Deploy attestation service to FreeFlo-controlled server
- Add HTTPS termination (TLS certificate)
- Configure domain DNS
- Set up monitoring and alerting

#### 1.2 Authentication & Rate Limiting
Add solver authentication to prevent abuse:

```rust
// New: Solver API key authentication
POST /api/v1/attest
Headers:
  X-Solver-API-Key: <solver_api_key>
  Content-Type: application/json
```

**New fields in config:**
```rust
SOLVER_API_KEYS=key1:solver_addr1,key2:solver_addr2,...
RATE_LIMIT_PER_SOLVER=100/minute
```

#### 1.3 On-Chain Intent Validation (Required)
Query the blockchain before signing any attestation:

1. **Intent exists on-chain:** Query OffRampV3 to verify intent exists and is ACTIVE
2. **Solver is authorized:** Check solver address against OffRampV3.authorizedSolvers
3. **Amount matches intent:** Verify payment amount matches intent amount
4. **Not already fulfilled:** Check intent status != FULFILLED

**New config fields:**
```rust
RPC_URL=https://base-sepolia-rpc.publicnode.com
OFFRAMP_CONTRACT=0x34249F4AB741F0661A38651A08213DDe1469b60f
```

This adds ~100-500ms latency but prevents attestation of invalid/non-existent intents.

#### 1.4 Audit Logging
Log all attestation requests for security audit:
```rust
struct AttestationLog {
    timestamp: u64,
    solver_address: String,
    intent_hash: String,
    payment_id: String,
    amount_cents: u64,
    result: AttestationResult,  // Success | Rejected(reason)
    ip_address: String,
}
```

### 2. Solver Changes

**Current state:** Runs attestation service locally, owns witness key

**Target state:** Calls FreeFlo's attestation service, no witness key

#### 2.1 Configuration Changes

Remove from solver config:
```diff
- WITNESS_PRIVATE_KEY=0x...  # Solvers should NOT have this
```

Update solver config:
```diff
- ATTESTATION_SERVICE_URL=http://127.0.0.1:4001
+ ATTESTATION_SERVICE_URL=https://attestation.free-flo.xyz
+ FREEFLO_SOLVER_API_KEY=<issued_by_freeflo>
```

#### 2.2 Attestation Client Updates

Update `solver/src/attestation/client.ts`:
- Add API key header to requests
- Update error handling for auth failures
- Add retry logic for transient failures

```typescript
// Add to attest() method
headers: {
  'Content-Type': 'application/json',
  'X-Solver-API-Key': config.solverApiKey,  // NEW
}
```

#### 2.3 Remove Attestation Service from Solver Deployment

Solvers should NOT deploy:
- `attestation-service/` directory
- `WITNESS_PRIVATE_KEY` environment variable

### 3. On-Chain Changes (None Required)

The smart contracts already support this model:
- `PaymentVerifier.authorizedWitnesses` controls which addresses can sign
- FreeFlo simply needs to only authorize their own witness address
- No code changes needed

### 4. Documentation Updates

#### 4.1 Update CLAUDE.md
- Remove attestation service from solver deployment instructions
- Add FreeFlo attestation endpoint URL
- Update environment variable documentation

#### 4.2 Create New Docs

**`docs/SOLVER_DEPLOYMENT.md`** - Guide for third-party solvers:
- What to deploy (solver only)
- How to get API key from FreeFlo
- Configuration reference
- Troubleshooting

**`docs/ATTESTATION_OPS.md`** - Internal FreeFlo ops guide:
- Attestation service deployment
- Key management procedures
- Monitoring and alerting
- Incident response

#### 4.3 Update Architecture Diagram
Update `docs/ARCHITECTURE.md` to reflect trust boundaries

### 5. Security Considerations

#### 5.1 Witness Key Management
- Store in secure secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault)
- Rotate periodically with on-chain authorization update
- Never log or expose in error messages

#### 5.2 API Key Issuance
- Issue unique API keys per solver
- Tie API keys to solver's Ethereum address
- Revoke keys for misbehaving solvers

#### 5.3 Proof Validation Hardening
The attestation service must strictly validate TLSNotary proofs:
- Verify server certificate chain (already done)
- Check server is in allowlist (already done)
- Validate timestamp is recent (add: within 1 hour)
- Validate payment ID format

#### 5.4 Rate Limiting
- Per-solver rate limits
- Global rate limits
- Backoff for repeated failures

## Migration Plan

### Phase 1: Deploy FreeFlo Attestation Service
1. Set up FreeFlo infrastructure (server, domain, TLS)
2. Deploy attestation service
3. Generate and secure witness private key
4. Authorize witness address in PaymentVerifier contract
5. Test with internal solver

### Phase 2: Update Solver Code
1. Add API key authentication to attestation client
2. Update configuration schema
3. Test against FreeFlo attestation service
4. Update deployment documentation

### Phase 3: Deprecate Solver-Hosted Attestation
1. Remove attestation service from solver deployment guide
2. Deauthorize any solver-owned witness addresses from contract
3. Update all documentation

### Phase 4: Third-Party Solver Onboarding
1. Create solver registration process
2. Issue API keys to approved solvers
3. Monitor for abuse

## API Specification

### POST /api/v1/attest

**Request:**
```json
{
  "presentation": "<base64-encoded TLSNotary presentation>",
  "intent_hash": "0x...",
  "expected_amount_cents": 10000,
  "expected_beneficiary_iban": "FR76..."
}
```

**Headers:**
```
Content-Type: application/json
X-Solver-API-Key: <api_key>
```

**Response (200 OK):**
```json
{
  "success": true,
  "signature": "0x...",
  "digest": "0x...",
  "dataHash": "0x...",
  "payment": {
    "transactionId": "uuid",
    "amountCents": 10000,
    "beneficiaryIban": "FR76...",
    "timestamp": 1704672000,
    "server": "thirdparty.qonto.com"
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "success": false,
  "error": "Invalid or missing API key"
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Proof verification failed: <reason>"
}
```

**Response (429 Too Many Requests):**
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

### GET /api/v1/health

**Response:**
```json
{
  "status": "healthy",
  "witnessAddress": "0x...",
  "chainId": 84532,
  "version": "1.0.0"
}
```

## Success Criteria

1. **Security:** Only FreeFlo-controlled witness key can sign valid attestations
2. **Reliability:** 99.9% uptime for attestation service
3. **Performance:** < 500ms attestation latency (excluding proof verification)
4. **Auditability:** All attestation requests logged with full context
5. **Scalability:** Support 10+ concurrent solvers

## Design Decisions

1. **Domain:** `attestation.free-flo.xyz` (subdomain of existing domain)
2. **Solver registration:** Manual approval process - solvers contact FreeFlo team, get vetted, receive API key
3. **Intent validation:** Yes - attestation service queries chain before signing (more secure, ~100-500ms latency acceptable)

## Open Questions

1. **API key rotation:** How often? Automatic or manual?
2. **Geographic distribution:** Single region or multi-region deployment?
3. **Backup witness key:** Hot standby or cold backup?
