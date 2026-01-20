# Unified Exchange Rate Oracle for Solver Competition

**Status**: Proposed
**Priority**: High
**Related**: Solver quoting design, attestation validation

## Problem

Currently, solvers can use any exchange rate when calculating `fiatAmount` from `usdcAmount`. This undermines the design goal of **solvers competing on fees only**.

```
Current state:
Solver A: 100 USDC - 1 USDC fee = 99 USDC × 0.925 = €91.57
Solver B: 100 USDC - 1 USDC fee = 99 USDC × 0.920 = €91.08  ← different rate!
```

Each solver fetches rates independently (CoinGecko, env var, etc.) leading to inconsistent quotes.

## Design Goal

All solvers use a FreeFlo-controlled exchange rate. Competition happens **only on fees**.

```
With unified Oracle:
Oracle rate: 0.9250
Solver A: 100 USDC - 1 USDC fee = 99 USDC × 0.9250 = €91.58
Solver B: 100 USDC - 2 USDC fee = 98 USDC × 0.9250 = €90.65  ← competes on fee only
```

## Proposed Approaches

### Option A: On-Chain Oracle (Recommended)

Deploy `ExchangeRateOracle.sol` that stores authoritative rates:

```solidity
contract ExchangeRateOracle {
    mapping(Currency => Rate) public rates;

    struct Rate {
        uint256 rate;      // 18 decimals (e.g., 0.925e18 for EUR)
        uint64 updatedAt;
        uint64 validUntil;
    }

    function getRate(Currency currency) external view returns (uint256 rate, uint64 validUntil);
    function updateRate(Currency currency, uint256 rate, uint64 validFor) external onlyAdmin;
}
```

Enforce in `OffRampV3.submitQuote()`:

```solidity
function submitQuote(..., uint256 fiatAmount, uint256 fee, ...) {
    uint256 expectedFiat = (intent.usdcAmount - fee) * oracle.getRate(intent.currency) / 1e18;
    uint256 tolerance = expectedFiat / 1000;  // 0.1% tolerance

    require(
        fiatAmount >= expectedFiat - tolerance && fiatAmount <= expectedFiat + tolerance,
        "Quote must use oracle rate"
    );
}
```

**Pros**: Trustless enforcement, transparent, on-chain audit trail, bad quotes rejected at submission
**Cons**: Gas for rate updates, requires frequent updates

### Option B: Attestation Service Oracle

Add rate validation to attestation service:

```rust
// attestation/src/oracle/mod.rs
fn validate_quote_rate(&self, intent: &Intent, quote: &Quote) -> Result<()> {
    let official_rate = self.get_rate(intent.currency)?;
    let expected_fiat = (intent.usdc_amount - quote.fee) * official_rate;

    if (quote.fiat_amount - expected_fiat).abs() > tolerance {
        return Err(AttestationError::InvalidRate);
    }
    Ok(())
}
```

**Pros**: No gas costs, simpler implementation
**Cons**: Validation happens late (after quote selection), relies on attestation service

### Option C: Hybrid (Best of Both)

- On-chain Oracle as source of truth
- Attestation service reads/caches rates from chain
- Contract enforces at quote submission
- Attestation double-checks before signing (defense in depth)

## Suggested File Structure

```
contracts/src/oracle/
├── IExchangeRateOracle.sol    # Interface
└── ExchangeRateOracle.sol     # Implementation

attestation/src/oracle/
├── mod.rs                     # Oracle module
├── rates.rs                   # Rate storage + sync from chain
└── validation.rs              # Quote rate validation
```

## Reference

Similar to OIF's oracle approach: https://github.com/openintentsframework/oif-contracts/tree/main/src/oracles

## Tasks

- [ ] Design Oracle interface (rate precision, update frequency, staleness handling)
- [ ] Implement `ExchangeRateOracle.sol`
- [ ] Add rate enforcement to `OffRampV3.submitQuote()`
- [ ] Add Oracle module to attestation service
- [ ] Update solver to fetch rates from Oracle
- [ ] Deploy and test on testnet
