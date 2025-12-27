# Intent Lifecycle

This document describes the complete lifecycle of an off-ramp intent from creation to fulfillment.

## State Machine

```
                         ┌─────────────────┐
                         │                 │
              ┌─────────▶│  PENDING_QUOTE  │◀─────────┐
              │          │    (status=1)   │          │
              │          └────────┬────────┘          │
              │                   │                   │
              │           Solver submits              │
              │              quote(s)                 │
              │                   │                   │
              │                   ▼                   │
              │          ┌─────────────────┐          │
              │          │                 │          │
     User cancels        │    COMMITTED    │     Quote expires
     (after timeout)     │    (status=2)   │    (no fulfillment)
              │          └────────┬────────┘          │
              │                   │                   │
              │          Solver fulfills              │
              │           with zkTLS proof            │
              │                   │                   │
              │                   ▼                   │
              │          ┌─────────────────┐          │
              │          │                 │          │
              └──────────│    FULFILLED    │──────────┘
                         │    (status=3)   │
                         └─────────────────┘
                                  │
                               or │ (timeout/cancel)
                                  ▼
                         ┌─────────────────┐
                         │                 │
                         │    CANCELLED    │
                         │    (status=4)   │
                         └─────────────────┘
```

## States

### NONE (status = 0)
- Intent does not exist
- Default state for non-existent intent IDs

### PENDING_QUOTE (status = 1)
- Intent created by user
- USDC deposited and held in contract
- Waiting for solver(s) to submit quotes
- User can cancel if no quotes received

**Transitions:**
- → COMMITTED: User selects a quote
- → CANCELLED: User cancels (after timeout)

### COMMITTED (status = 2)
- User has selected a solver's quote
- Solver is committed to fulfill within time window
- Banking details (IBAN, recipient) are locked
- USDC still held in contract

**Transitions:**
- → FULFILLED: Solver submits valid zkTLS proof
- → CANCELLED: Fulfillment timeout expires

### FULFILLED (status = 3)
- Solver successfully fulfilled the intent
- Payment proof verified on-chain
- USDC released to solver
- **Terminal state**

### CANCELLED (status = 4)
- Intent was cancelled or expired
- USDC returned to depositor
- **Terminal state**

### EXPIRED (status = 5)
- Alternative to CANCELLED
- Automatic expiration without explicit cancel
- USDC claimable by depositor

---

## Timeouts & Windows

| Phase | Duration | Description |
|-------|----------|-------------|
| Quote Window | 1 hour | Time for solvers to submit quotes |
| Fulfillment Window | 30 minutes | Time for solver to complete after commit |
| Cancel Grace Period | 5 minutes | Buffer before user can cancel |

### Timeline Example

```
Time ──────────────────────────────────────────────────────────────────────▶

T+0          T+5min       T+15min      T+30min      T+1hr
│            │            │            │            │
│ Intent     │ Quote      │ User       │ Fulfillment│ Quote
│ Created    │ Submitted  │ Commits    │ Complete   │ Expires
│            │            │            │            │
└────────────┴────────────┴────────────┴────────────┴────────────
   PENDING_QUOTE          │  COMMITTED │  FULFILLED
                          │◀──────────▶│
                          Fulfillment Window (30 min)
```

---

## Events

### IntentCreated

Emitted when a user creates a new intent.

```solidity
event IntentCreated(
    bytes32 indexed intentId,
    address indexed depositor,
    uint256 amount,
    Currency currency,
    uint64 createdAt
);
```

### QuoteSubmitted

Emitted when a solver submits a quote.

```solidity
event QuoteSubmitted(
    bytes32 indexed intentId,
    address indexed solver,
    RTPN rtpn,
    uint256 fiatAmount,
    uint256 fee,
    uint64 expiresAt
);
```

### QuoteSelected

Emitted when a user commits to a quote.

```solidity
event QuoteSelected(
    bytes32 indexed intentId,
    address indexed solver,
    RTPN rtpn,
    uint256 fiatAmount,
    string receivingInfo,
    string recipientName
);
```

### IntentFulfilled

Emitted when a solver successfully fulfills an intent.

```solidity
event IntentFulfilled(
    bytes32 indexed intentId,
    address indexed solver,
    bytes32 transferId,
    uint256 fiatSent
);
```

### IntentCancelled

Emitted when an intent is cancelled.

```solidity
event IntentCancelled(
    bytes32 indexed intentId,
    address indexed depositor,
    uint256 refundAmount
);
```

---

## Error Conditions

| Error | Cause | Resolution |
|-------|-------|------------|
| `IntentNotFound` | Invalid intentId | Check intent exists |
| `InvalidStatus` | Wrong state for operation | Wait for correct state |
| `NotDepositor` | Caller is not the depositor | Use correct wallet |
| `NotSelectedSolver` | Solver not selected for this intent | Only selected solver can fulfill |
| `FulfillmentWindowExpired` | Too late to fulfill | Intent must be cancelled |
| `PaymentVerificationFailed` | Invalid zkTLS proof | Check proof generation |
| `AmountMismatch` | Payment amount too low | Must be within 1% of expected |
| `NullifierAlreadyUsed` | Proof replay attempt | Each proof can only be used once |

---

## Solver Workflow

### 1. Monitor for New Intents

```typescript
// Watch for IntentCreated events
chain.watchIntentCreated((intent) => {
  if (canFulfill(intent)) {
    generateAndSubmitQuote(intent);
  }
});
```

### 2. Submit Quote

```typescript
await contract.submitQuote(
  intentId,
  fiatAmountCents,  // e.g., 9250 for €92.50
  feeUsdc,          // e.g., 50000 for 0.05 USDC
  estimatedTime,    // e.g., 10 seconds
  expiresAt,        // Unix timestamp
  RTPN.SEPA_INSTANT
);
```

### 3. Monitor for Selection

```typescript
chain.watchQuoteSelected((event) => {
  if (event.solver === myAddress) {
    startFulfillment(event.intentId);
  }
});
```

### 4. Execute Fiat Transfer

```typescript
const result = await qonto.executeTransfer({
  amount: fiatAmount,
  iban: receivingInfo,
  recipientName: recipientName,
});
```

### 5. Generate Proof & Get Attestation

```typescript
// Generate TLSNotary proof
const proof = await prover.generateProof(result.transferId);

// Get attestation from service
const attestation = await attestationService.attest(proof);
```

### 6. Fulfill On-Chain

```typescript
await contract.fulfillIntentWithProof(
  intentId,
  attestation,
  signature
);
```

---

## User Workflow

### 1. Create Intent

1. Enter USDC amount
2. Select target currency (EUR)
3. Approve USDC (if first time)
4. Sign transaction to create intent

### 2. Select Quote

1. Wait for solver quotes (~5-10 seconds)
2. Review quotes (amount, fee, time)
3. Enter banking details (IBAN, name)
4. Sign transaction to commit

### 3. Wait for Fulfillment

1. Solver executes bank transfer
2. Proof generated and verified
3. Intent fulfilled on-chain
4. Fiat arrives in bank account (~10 seconds for SEPA Instant)

