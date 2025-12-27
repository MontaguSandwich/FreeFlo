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
- Attestation service
- Frontend security issues
- Infrastructure misconfigurations

### Out of Scope

- Third-party dependencies (report to upstream)
- Social engineering attacks
- Denial of service (without significant impact)
- Issues in testnet/sandbox environments
- Known issues listed below

## Known Limitations

### 1. Single Attestation Witness

**Status**: Known limitation

The current implementation uses a single attestation witness. This is a centralization point. Future versions will implement threshold signatures (e.g., 2-of-3).

### 2. TLSNotary Trust Model

**Status**: Inherent to TLSNotary

TLSNotary requires a semi-trusted notary during proof generation. The notary cannot forge proofs but could refuse to notarize. Future versions may use a decentralized notary network.

### 3. Exchange Rate Oracle

**Status**: Known limitation

Exchange rates are fetched from CoinGecko API, not a decentralized oracle. This is acceptable for testnet but should be replaced with Chainlink for production.

### 4. Solver Centralization

**Status**: By design (for MVP)

While the protocol is permissionless (any solver can fulfill), practical operation requires Qonto API access. Future versions may support more payment providers.

## Security Measures

### Smart Contracts

- **Reentrancy Guard**: All external calls protected
- **Pausable**: Emergency circuit breaker
- **Nullifier Registry**: Prevents proof replay
- **Amount Validation**: 1% tolerance on payments
- **Access Control**: Owner-only admin functions

### Solver

- **Rate Limiting**: API endpoints rate limited
- **Input Validation**: All inputs sanitized
- **Secrets Management**: Private keys in environment
- **Logging**: Sensitive data redacted

### Attestation Service

- **EIP-712**: Typed data signatures
- **Domain Separation**: Chain-specific domain
- **Witness Authorization**: On-chain whitelist

## Bug Bounty

We do not currently have a formal bug bounty program. However, we may offer rewards for critical vulnerabilities at our discretion.

## Audit Status

| Component | Audited | Auditor | Report |
|-----------|---------|---------|--------|
| OffRampV3.sol | ❌ No | - | - |
| PaymentVerifier.sol | ❌ No | - | - |
| Solver | ❌ No | - | - |

**Note**: This is unaudited software. Use at your own risk.

## Contact

- Security: security@example.com
- General: hello@example.com
- Discord: TBD

