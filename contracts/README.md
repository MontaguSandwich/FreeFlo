# ZKP2P Off-Ramp Contracts

Smart contracts for permissionless USDC → Fiat off-ramp with zkTLS verification.

## Contracts

| Contract | Description |
|----------|-------------|
| `OffRampV3.sol` | Main off-ramp contract with zkTLS payment verification |
| `PaymentVerifier.sol` | EIP-712 signature verification for payment attestations |
| `OffRampV2.sol` | Legacy trusted solver model (deprecated) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OffRampV3                               │
├─────────────────────────────────────────────────────────────────┤
│  - createIntent(amount, currency)                               │
│  - submitQuote(intentId, fiatAmount, ...)                       │
│  - selectQuoteAndCommit(intentId, solver, rtpn, iban, name)     │
│  - fulfillIntentWithProof(intentId, attestation, signature)     │
│  - cancelIntent(intentId)                                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PaymentVerifier                            │
├─────────────────────────────────────────────────────────────────┤
│  - verifyPayment(attestation, signature)                        │
│  - authorizedWitnesses mapping                                  │
│  - usedNullifiers mapping (replay protection)                   │
│  - EIP-712 domain separator                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Setup

```bash
# Install dependencies
forge install

# Copy environment file
cp env.example .env

# Edit with your values
vim .env
```

## Build

```bash
forge build
```

## Test

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test file
forge test --match-path test/OffRampV3.t.sol

# Run with gas report
forge test --gas-report

# Run coverage
forge coverage
```

## Deploy

### Base Sepolia (Testnet)

```bash
# Load environment
source .env

# Deploy PaymentVerifier + OffRampV3
forge script script/DeployV3.s.sol:DeployV3Script \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify

# Note deployed addresses and update .env
```

### Post-Deployment Setup

After deploying, authorize the attestation service witness:

```bash
# In PaymentVerifier
cast send $PAYMENT_VERIFIER_ADDRESS \
  "addWitness(address)" $WITNESS_ADDRESS \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Contract Interface

### For Users

```solidity
// Create an off-ramp intent
function createIntent(
    uint256 amount,      // USDC amount (6 decimals)
    Currency currency    // Target currency (EUR, GBP, USD, BRL, INR)
) external returns (bytes32 intentId);

// Commit to a solver's quote
function selectQuoteAndCommit(
    bytes32 intentId,
    address solver,
    RTPN rtpn,           // Payment network (SEPA_INSTANT, FPS, etc.)
    string receivingInfo, // IBAN, sort code, etc.
    string recipientName
) external;

// Cancel intent after expiry (get USDC back)
function cancelIntent(bytes32 intentId) external;
```

### For Solvers

```solidity
// Submit a quote for an intent
function submitQuote(
    bytes32 intentId,
    uint256 fiatAmount,    // Fiat amount in cents (2 decimals)
    uint256 fee,           // Fee in USDC (6 decimals)
    uint32 estimatedTime,  // Seconds to complete
    uint64 expiresAt,      // Quote expiry timestamp
    RTPN rtpn              // Payment network
) external;

// Fulfill with zkTLS proof
function fulfillIntentWithProof(
    bytes32 intentId,
    PaymentAttestation calldata attestation,
    bytes calldata signature
) external;
```

### PaymentAttestation Struct

```solidity
struct PaymentAttestation {
    bytes32 intentHash;    // Must match intentId
    uint256 amount;        // Fiat amount in cents
    uint256 timestamp;     // Payment timestamp
    string paymentId;      // Provider's transfer ID (used as nullifier)
    bytes32 dataHash;      // Hash of additional data
}
```

## Security Features

- **Nullifier Registry** - Each payment proof can only be used once
- **EIP-712 Signatures** - Typed data for secure off-chain attestations
- **Witness Authorization** - Only authorized witnesses can sign attestations
- **ReentrancyGuard** - All state-changing functions protected
- **Pausable** - Emergency circuit breaker (owner only)
- **Amount Validation** - 1% tolerance on fiat amount

## Deployed Addresses

### Base Sepolia

| Contract | Address |
|----------|---------|
| OffRampV3 | `0x34249f4ab741f0661a38651a08213dde1469b60f` |
| PaymentVerifier | `0xd54e8219d30c2d04a8faec64657f06f440889d70` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### Base Mainnet

| Contract | Address |
|----------|---------|
| OffRampV3 | TBD |
| PaymentVerifier | TBD |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Gas Costs

| Function | Gas (approx) |
|----------|--------------|
| createIntent | ~120,000 |
| submitQuote | ~80,000 |
| selectQuoteAndCommit | ~150,000 |
| fulfillIntentWithProof | ~200,000 |
| cancelIntent | ~60,000 |

## License

MIT
