# zkTLS Verification

This document explains how ZKP2P Off-Ramp uses TLSNotary to cryptographically verify bank transfers without trusting the solver.

## Overview

Traditional off-ramps require trusting the solver to actually send fiat. ZKP2P eliminates this trust by using **TLSNotary** to generate cryptographic proofs of HTTPS responses from the bank's API.

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│ Solver  │────▶│ Qonto   │────▶│TLSNotary│────▶│Attestation────▶│OffRampV3 │
│         │     │  API    │     │ Prover  │     │ Service  │     │ Contract │
└─────────┘     └─────────┘     └─────────┘     └──────────┘     └──────────┘
     │               │               │               │               │
     │  1. Execute   │               │               │               │
     │     Transfer  │               │               │               │
     │──────────────▶│               │               │               │
     │               │               │               │               │
     │  2. Query     │               │               │               │
     │     Status    │               │               │               │
     │──────────────▶│               │               │               │
     │               │               │               │               │
     │  3. TLS       │               │               │               │
     │     Session   │◀─────────────▶│               │               │
     │               │   MPC-TLS     │               │               │
     │               │               │               │               │
     │  4. Presentation              │               │               │
     │     (Selective Disclosure)    │               │               │
     │◀──────────────────────────────│               │               │
     │               │               │               │               │
     │  5. Submit    │               │               │               │
     │     Proof     │               │               │               │
     │───────────────────────────────────────────────▶               │
     │               │               │               │               │
     │  6. Attestation               │               │               │
     │     (EIP-712 Signature)       │               │               │
     │◀──────────────────────────────────────────────│               │
     │               │               │               │               │
     │  7. Fulfill   │               │               │               │
     │     On-Chain  │               │               │               │
     │───────────────────────────────────────────────────────────────▶
```

## What is TLSNotary?

[TLSNotary](https://tlsnotary.org) is a protocol that allows a **Prover** to prove to a **Verifier** that certain data was received from a specific server over TLS, without revealing the entire session.

### Key Concepts

| Term | Description |
|------|-------------|
| **Prover** | The party that wants to prove data (our solver) |
| **Notary** | A semi-trusted party that participates in MPC-TLS |
| **Presentation** | A selectively disclosed subset of the TLS session |
| **Attestation** | A cryptographic signature over verified data |

### How MPC-TLS Works

1. **Joint Handshake**: Prover and Notary jointly perform the TLS handshake
2. **Data Transfer**: Server sends encrypted data (only Prover can read full content)
3. **Commitment**: Prover commits to certain data without revealing it
4. **Selective Disclosure**: Prover reveals only necessary fields
5. **Verification**: Verifier confirms data came from the claimed server

## Our Implementation

### 1. Proof Generation (Rust)

The solver spawns a Rust subprocess to generate TLSNotary proofs:

```rust
// Query Qonto API for transaction
let response = client
    .get(&format!("{}/v2/transactions/{}", QONTO_HOST, transfer_id))
    .send()
    .await?;

// Generate TLSNotary proof
let proof = prover.finalize().await?;

// Create presentation with selective disclosure
let presentation = proof
    .reveal("transactions.0.id")
    .reveal("transactions.0.amount_cents")
    .reveal("transactions.0.status")
    .reveal("transactions.0.transfer.counterparty_account_number")
    .build()?;
```

### 2. Attestation Service (Rust)

The attestation service verifies proofs and signs attestations:

```rust
pub async fn attest(presentation: Presentation) -> Result<Attestation> {
    // 1. Verify TLSNotary presentation
    let verified = presentation.verify()?;
    
    // 2. Check server identity (must be Qonto)
    if verified.server_name != "thirdparty.qonto.com" {
        return Err(Error::InvalidServer);
    }
    
    // 3. Extract payment data
    let payment = parse_payment_details(&verified.transcript)?;
    
    // 4. Validate payment status
    if payment.status != "completed" {
        return Err(Error::PaymentNotCompleted);
    }
    
    // 5. Create EIP-712 attestation
    let attestation = PaymentAttestation {
        intent_hash: payment.intent_id,
        amount: payment.amount_cents,
        timestamp: now(),
        payment_id: payment.transaction_id,
        data_hash: keccak256(&verified.transcript),
    };
    
    // 6. Sign with witness key
    let signature = sign_typed_data(attestation)?;
    
    Ok(Attestation { attestation, signature })
}
```

### 3. On-Chain Verification (Solidity)

The PaymentVerifier contract validates attestations:

```solidity
function verifyPayment(
    PaymentAttestation calldata attestation,
    bytes calldata signature
) external returns (bool valid, address signer) {
    // 1. Check nullifier (prevent replay)
    bytes32 nullifier = keccak256(bytes(attestation.paymentId));
    if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed();
    
    // 2. Compute EIP-712 digest
    bytes32 structHash = _hashAttestation(attestation);
    bytes32 digest = _hashTypedData(structHash);
    
    // 3. Recover signer
    signer = digest.recover(signature);
    
    // 4. Verify signer is authorized witness
    if (!authorizedWitnesses[signer]) revert NotAuthorizedWitness();
    
    // 5. Mark nullifier as used
    usedNullifiers[nullifier] = true;
    
    emit PaymentVerified(
        attestation.intentHash,
        nullifier,
        attestation.amount,
        signer
    );
    
    return (true, signer);
}
```

## EIP-712 Typed Data

We use EIP-712 for structured, domain-separated signatures:

### Domain

```solidity
EIP712Domain {
    name: "ZKP2P PaymentVerifier",
    version: "1",
    chainId: 84532,  // Base Sepolia
    verifyingContract: 0xd54e8219d30c2d04a8faec64657f06f440889d70
}
```

### PaymentAttestation Type

```solidity
PaymentAttestation {
    bytes32 intentHash;    // The intent this payment fulfills
    uint256 amount;        // Payment amount in cents
    uint256 timestamp;     // When payment was verified
    string paymentId;      // Bank's transaction ID (nullifier)
    bytes32 dataHash;      // Hash of full transcript data
}
```

### Type Hash

```solidity
bytes32 constant PAYMENT_ATTESTATION_TYPEHASH = keccak256(
    "PaymentAttestation(bytes32 intentHash,uint256 amount,uint256 timestamp,string paymentId,bytes32 dataHash)"
);
```

## Selective Disclosure

TLSNotary allows revealing only specific fields while proving authenticity:

### What We Reveal

| Field | Revealed | Purpose |
|-------|----------|---------|
| `transactions.0.id` | ✅ Yes | Nullifier (prevent replay) |
| `transactions.0.amount_cents` | ✅ Yes | Verify payment amount |
| `transactions.0.status` | ✅ Yes | Confirm completion |
| `transactions.0.transfer.counterparty_account_number` | ✅ Yes | Verify recipient IBAN |
| Authorization header | ❌ No | Sensitive credential |
| Other transactions | ❌ No | Privacy |

### Example Revealed Data

```json
{
  "transactions": [{
    "id": "f8c3a1b2-...",
    "amount_cents": 9250,
    "status": "completed",
    "transfer": {
      "counterparty_account_number": "FR7630004028420000984528570"
    }
  }]
}
```

## Security Properties

### What TLSNotary Guarantees

| Property | Guarantee |
|----------|-----------|
| **Authenticity** | Data provably came from `thirdparty.qonto.com` |
| **Integrity** | Data hasn't been modified after receipt |
| **Selective Privacy** | Only revealed fields are disclosed |
| **Non-repudiation** | Prover cannot deny receiving this data |

### What TLSNotary Does NOT Guarantee

| Limitation | Mitigation |
|------------|------------|
| Notary liveness | Use reliable notary infrastructure |
| Notary collusion | Can be mitigated with threshold notaries |
| Server honesty | Out of scope (bank API is trusted) |

## Performance

| Operation | Time |
|-----------|------|
| TLS Handshake (MPC) | ~2-5 seconds |
| Data Transfer | ~1 second |
| Proof Generation | ~10-30 seconds |
| Attestation | ~100ms |
| On-chain Verification | ~50ms (gas only) |
| **Total** | **~15-40 seconds** |

## Future Improvements

### 1. Decentralized Notary Network

Replace single notary with a network:
- Multiple independent notaries
- Threshold signatures (2-of-3)
- Economic incentives for honest behavior

### 2. ZK Proof Compression

Generate a ZK proof of the TLSNotary verification:
- Constant-size proof (~256 bytes)
- Cheaper on-chain verification
- Better privacy (no revealed data on-chain)

### 3. TEE Attestation

Combine with Trusted Execution Environments:
- Intel SGX or AWS Nitro
- Additional trust layer
- Faster proof generation

