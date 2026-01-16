# Qonto Provider

[Qonto](https://qonto.com) is a European business banking platform. This provider enables SEPA Instant transfers through Qonto's API.

## Supported RTPNs

| RTPN | Support |
|------|---------|
| SEPA Instant | Full |

## Components

### Executor
**Location:** `solver/src/providers/qonto.ts`

Handles:
- Verification of Payee (VoP) checks via Qonto API
- SEPA Instant transfer creation
- Transfer status polling
- Token refresh (Qonto tokens expire in 1 hour)

### Prover
**Location:** `providers/prover/adapters/qonto/`

Generates TLSNotary proofs by:
1. Fetching transfer details from Qonto API
2. Creating TLSNotary attestation
3. Generating presentation for the attestation service

## Setup

### Prerequisites
- Qonto business account
- API credentials (client_id, client_secret)
- Refresh token (obtained via OAuth flow)

### Environment Variables

```bash
# Qonto API credentials
QONTO_CLIENT_ID=your_client_id
QONTO_CLIENT_SECRET=your_client_secret
QONTO_REFRESH_TOKEN=your_refresh_token
QONTO_BANK_ACCOUNT_ID=your_bank_account_id
QONTO_IBAN=your_iban
```

### Building the Prover

```bash
cd providers/prover
cargo build --release --bin qonto_prove_transfer
cargo build --release --bin qonto_present_transfer
```

## Usage

The solver automatically:
1. Executes transfers via the executor
2. Generates proofs via the prover
3. Submits proofs to the attestation service

## Gotchas

- **VoP tokens**: Always use `beneficiary` object (name + IBAN) in transfers, not `beneficiary_id`. The VoP token is signed for the name/IBAN combination.
- **Token expiry**: Qonto tokens expire in 1 hour. The solver auto-refreshes on 401 errors.
- **SEPA Instant fallback**: If SEPA Instant fails, Qonto may fall back to standard SEPA. The solver detects this and treats it as a failure.
