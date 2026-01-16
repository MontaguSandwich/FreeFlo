# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

### How to Report

1. **Email**: security@example.com (replace with your email)
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **24 hours**: Initial acknowledgment
- **72 hours**: Preliminary assessment
- **7 days**: Detailed response with remediation plan
- **90 days**: Public disclosure (coordinated)

## Scope

### In Scope

- Smart contracts (`contracts/src/`)
- Solver service (`solver/src/`)
- Attestation service (`attestation-service/src/`)
- Frontend security issues
- Infrastructure misconfigurations

### Out of Scope

- Third-party dependencies (report to upstream)
- Social engineering attacks
- Denial of service (without significant impact)
- Issues in testnet/sandbox environments
- Known issues listed below

## Security Architecture

### Trust Model

FreeFlo implements a **separated trust model** where:

1. **Solvers (Untrusted)**: Third-party operators who process fiat transfers
2. **FreeFlo Protocol (Trusted)**: Controls attestation service and witness key
3. **Smart Contracts (Trustless)**: On-chain verification

```
Solver (Untrusted)          FreeFlo (Trusted)           On-Chain (Trustless)
─────────────────           ─────────────────           ────────────────────
Send fiat payment
Generate TLSNotary proof
POST /attest ──────────────► Validate intent on-chain
(with API key)                Verify solver is authorized
                              Verify proof cryptographically
                              Sign attestation
                       ◄───── Return signature
Submit to contract ─────────────────────────────────────► Verify signature
                                                          Check witness authorized
                                                          Release USDC
```

### Why Solvers Can't Cheat

1. **No witness key access**: Only FreeFlo can sign valid attestations
2. **On-chain validation**: Attestation service verifies intent exists and solver matches before signing
3. **TLSNotary cryptographic guarantee**: Proofs can't be forged without accessing the bank's TLS private key
4. **Replay protection**: Nullifiers prevent reusing proofs

## Known Limitations

### 1. Single Attestation Witness (Mitigated)

**Status**: Implemented with FreeFlo-controlled key

The attestation service uses a single witness key controlled by FreeFlo. This is a centralization point, but:
- Solvers cannot access the key
- On-chain intent validation prevents attestation of invalid requests
- Future versions may implement threshold signatures (e.g., 2-of-3)

### 2. TLSNotary Trust Model

**Status**: Inherent to TLSNotary

TLSNotary requires a semi-trusted notary during proof generation. The notary cannot forge proofs but could refuse to notarize. FreeFlo uses the TLSNotary public notary network.

### 3. Exchange Rate Oracle

**Status**: Known limitation

Exchange rates are fetched from CoinGecko API, not a decentralized oracle. This is acceptable for testnet but should be replaced with Chainlink for production.

### 4. Solver Centralization

**Status**: By design (for MVP)

While the protocol is permissionless (any solver can fulfill after getting an API key), practical operation requires:
- Qonto API access (EU business account)
- FreeFlo API key registration

Future versions may support more payment providers and automated solver registration.

## Security Measures

### Smart Contracts

- **Reentrancy Guard**: All external calls protected
- **Pausable**: Emergency circuit breaker
- **Nullifier Registry**: Prevents proof replay
- **Amount Validation**: 1% tolerance on payments
- **Access Control**: Owner-only admin functions
- **Intent Status Checks**: Verifies COMMITTED status before fulfillment

### Attestation Service

- **API Key Authentication**: Each solver has unique key tied to their address
- **On-Chain Validation**: Queries blockchain before signing
  - Verifies intent exists and is COMMITTED
  - Verifies requesting solver matches `selectedSolver`
- **Audit Logging**: All requests logged with timestamps, solver, intent, result
- **Rate Limiting**: Per-solver request limits (configurable)
- **EIP-712 Domain Separation**: Chain-specific signatures
- **Witness Authorization**: On-chain whitelist in PaymentVerifier

### Solver

- **Rate Limiting**: API endpoints rate limited
- **Input Validation**: All inputs sanitized
- **Secrets Management**: Private keys in environment
- **Logging**: Sensitive data redacted
- **Duplicate Prevention**: Tracks `provider_transfer_id` to prevent double fiat transfers

### Infrastructure

- **Attestation Service Separation**: FreeFlo controls witness key
- **HTTPS**: Required for attestation service in production
- **Firewall**: Minimal port exposure (8080, 8081 for solver; 4001 for attestation)
- **Process Isolation**: Attestation service runs on separate infrastructure from solvers

## Attack Vectors and Mitigations

### 1. Malicious Solver: Fake Proof

**Attack**: Solver tries to submit fake TLSNotary proof without sending fiat.

**Mitigation**:
- TLSNotary proofs are cryptographically bound to the TLS session
- Can't forge without bank's private key
- Attestation service verifies proof before signing

### 2. Malicious Solver: Stolen API Key

**Attack**: Attacker obtains solver's API key.

**Mitigation**:
- API key is tied to solver's Ethereum address
- On-chain validation ensures only `selectedSolver` can get attestation
- Attestation only valid for intents assigned to that solver

### 3. Replay Attack

**Attack**: Re-submit same proof for multiple intents.

**Mitigation**:
- Nullifier (payment ID hash) stored on-chain
- Contract rejects duplicate nullifiers
- Each proof contains unique payment ID from bank

### 4. Front-Running

**Attack**: Attacker front-runs fulfillment transaction.

**Mitigation**:
- Intent has `selectedSolver` - only that address can fulfill
- Attestation tied to specific intent hash

### 5. Witness Key Compromise

**Attack**: FreeFlo's witness key is compromised.

**Mitigation**:
- Key stored securely (secrets manager recommended)
- Can rotate key: deploy new PaymentVerifier, migrate contracts
- On-chain validation limits damage (can only attest valid intents)

## Bug Bounty

We do not currently have a formal bug bounty program. However, we may offer rewards for critical vulnerabilities at our discretion.

## Audit Status

| Component | Audited | Auditor | Report |
|-----------|---------|---------|--------|
| OffRampV3.sol | ❌ No | - | - |
| PaymentVerifier.sol | ❌ No | - | - |
| Attestation Service | ❌ No | - | - |
| Solver | ❌ No | - | - |

**Note**: This is unaudited software. Use at your own risk.

## Contact

- Security: security@example.com
- General: hello@example.com
- Discord: TBD
