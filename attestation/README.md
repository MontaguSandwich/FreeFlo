# Attestation Service

A Rust-based service that verifies TLSNotary presentations and signs EIP-712 attestations for on-chain verification.

## Architecture

```
┌─────────────┐    TLSNotary     ┌─────────────────┐    EIP-712      ┌─────────────────┐
│   Solver    │  Presentation    │   Attestation   │   Signature    │  Smart Contract │
│  (Prover)   │ ───────────────► │    Service      │ ─────────────► │   (Verifier)    │
└─────────────┘                  └─────────────────┘                 └─────────────────┘
       │                                │
       │                                ├── 1. Deserialize presentation
       │                                ├── 2. Verify TLS authenticity  
       │                                ├── 3. Extract payment data
       │                                ├── 4. Validate against intent
       │                                └── 5. Sign EIP-712 attestation
       │
       └── Generate proof via TLSNotary + Notary server
```

## API Endpoints

### Health Check
```
GET /api/v1/health
```

Response:
```json
{
  "status": "ok",
  "witness_address": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "chain_id": 84532
}
```

### Create Attestation
```
POST /api/v1/attest
Content-Type: application/json
```

Request:
```json
{
  "presentation": "<base64-encoded TLSNotary presentation>",
  "intent_hash": "0x...",
  "expected_amount_cents": 10000,
  "expected_beneficiary_iban": "DE89370400440532013000"
}
```

Response:
```json
{
  "success": true,
  "signature": "0x...",
  "digest": "0x...",
  "data_hash": "0x...",
  "payment": {
    "transaction_id": "transfer-123",
    "amount_cents": 10000,
    "beneficiary_iban": "DE89370400440532013000",
    "timestamp": 1703500000,
    "server": "thirdparty.qonto.com"
  }
}
```

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `WITNESS_PRIVATE_KEY` | ECDSA secp256k1 private key for signing | Required |
| `CHAIN_ID` | Chain ID for EIP-712 domain | 84532 (Base Sepolia) |
| `VERIFIER_CONTRACT` | Verifier contract address | 0x0...0 |
| `ALLOWED_SERVERS` | Comma-separated allowed domains | thirdparty.qonto.com |
| `RUST_LOG` | Logging level | info |

## Running

```bash
# Start the service
cd attestation-service
RUST_LOG=info cargo run

# Build for production
cargo build --release
./target/release/attestation-service
```

## EIP-712 Signature Format

The service signs attestations using EIP-712 with the following type structure:

```solidity
struct PaymentAttestation {
    bytes32 intentHash;
    uint256 amount;
    uint256 timestamp;
    string paymentId;
    bytes32 dataHash;
}
```

Domain:
```solidity
EIP712Domain({
    name: "WisePaymentVerifier",
    version: "1",
    chainId: <CHAIN_ID>,
    verifyingContract: <VERIFIER_CONTRACT>
})
```

## Security Considerations

1. **Witness Key**: The `WITNESS_PRIVATE_KEY` must be kept secure. This key signs attestations that authorize USDC releases.

2. **Allowed Servers**: Only presentations from whitelisted servers are accepted. This prevents proofs from unauthorized APIs.

3. **Payment Validation**: The service validates that the payment in the TLSNotary proof matches the expected intent parameters.

4. **Replay Protection**: Each attestation should be used only once. The on-chain verifier should implement nullifier checking.

## Integration with Solver

The solver should:

1. Execute SEPA transfer via Qonto
2. Query transaction status via Qonto API
3. Generate TLSNotary proof (prove.rs → present.rs flow)
4. Submit presentation to attestation service
5. Include EIP-712 signature in on-chain settlement transaction

## Next Steps

- [ ] Deploy verifier contract with EIP-712 verification
- [ ] Integrate attestation service call into solver fulfillment flow
- [ ] Add transaction-specific Qonto prover (query specific transfer)
- [ ] Implement nullifier checking in verifier contract
- [ ] Add attestation service rate limiting
- [ ] Add monitoring and alerting

