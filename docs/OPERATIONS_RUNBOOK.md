# FreeFlo Operations Runbook

Quick reference for operating and debugging the FreeFlo protocol.

## Table of Contents

- [Environment Setup](#environment-setup)
- [Solver Operations](#solver-operations)
- [Attestation Service Operations](#attestation-service-operations)
- [On-Chain Commands](#on-chain-commands)
- [Emergency Procedures](#emergency-procedures)
- [Debugging](#debugging)

---

## Environment Setup

### Common Variables

```bash
# Set these once per session
export RPC="https://base-sepolia-rpc.publicnode.com"
export OFFRAMP="0x34249F4AB741F0661A38651A08213DDe1469b60f"
export VERIFIER="0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe"
export USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
```

### Server Addresses

| Service | IP | Port |
|---------|-----|------|
| Solver VPS | 95.217.235.164 | 8080 (health), 8081 (quotes) |
| Attestation | 77.42.68.242 | 4001 |

### Active Development Branch

Both servers run on: `claude/review-deployment-feedback-bQM6t`

To check what branch/commit a server is running:
```bash
cd /opt/zkp2p-offramp && git branch --show-current && git log -1 --oneline  # Solver
cd /opt/freeflo/attestation-service && git branch --show-current && git log -1 --oneline  # Attestation
```

---

## Solver Operations

### SSH Access

```bash
ssh root@95.217.235.164
```

### Health Checks

```bash
# Health endpoint
curl http://127.0.0.1:8080/health

# Quote API
curl "http://127.0.0.1:8081/api/quote?amount=100&currency=EUR"

# External check (from anywhere)
curl "http://95.217.235.164:8081/api/quote?amount=100&currency=EUR"
```

### PM2 Management

```bash
# View status
pm2 list

# View logs (live)
pm2 logs zkp2p-solver

# View last N lines
pm2 logs zkp2p-solver --lines 50

# Restart solver
pm2 restart zkp2p-solver

# Stop solver
pm2 stop zkp2p-solver

# Show process details
pm2 show zkp2p-solver
```

### Rebuild Solver

```bash
cd /opt/zkp2p-offramp/solver
npm run build
pm2 restart zkp2p-solver
```

### Update Solver Code

```bash
cd /opt/zkp2p-offramp
git fetch origin
git checkout claude/review-deployment-feedback-bQM6t
git pull
cd solver
npm run build
pm2 restart zkp2p-solver
```

### Check Solver Configuration

```bash
# View env file (redact secrets in logs!)
cat /opt/zkp2p-offramp/solver/.env

# Check specific var
grep ATTESTATION /opt/zkp2p-offramp/solver/.env
```

### Build TLSNotary Prover

```bash
cd /opt/zkp2p-offramp/tlsn/qonto
cargo build --release --bin qonto_prove_transfer
cargo build --release --bin qonto_present_transfer

# Verify binaries
ls -la /opt/zkp2p-offramp/tlsn/target/release/qonto_*
```

---

## Attestation Service Operations

### SSH Access

```bash
ssh root@77.42.68.242
```

### Health Check

```bash
curl http://127.0.0.1:4001/api/v1/health
curl -v http://127.0.0.1:4001/api/v1/health  # verbose
```

### View Logs

```bash
tail -f /var/log/attestation.log
tail -100 /var/log/attestation.log
```

### Check Running Process

```bash
ps aux | grep attestation | grep -v grep
```

### Restart Attestation Service

```bash
# Kill existing
pkill -f attestation-service

# Load env and start (set -a exports all variables)
set -a
source /etc/freeflo/attestation.env
set +a

cd /opt/freeflo/attestation-service
./target/release/attestation-service &

# Verify
sleep 2
curl http://127.0.0.1:4001/api/v1/health
```

### View Current Configuration

```bash
# View env file
cat /etc/freeflo/attestation.env

# View running process env
ps aux | grep attestation | grep -v grep  # get PID
cat /proc/<PID>/environ | tr '\0' '\n' | grep -E "SOLVER|WITNESS|RPC"
```

### Add New Solver API Key

```bash
# Generate random API key
openssl rand -hex 32

# Add to env file (replace KEY and ADDRESS)
sed -i 's|^SOLVER_API_KEYS=\(.*\)|SOLVER_API_KEYS=\1,NEW_KEY:0xNEW_ADDRESS|' /etc/freeflo/attestation.env

# Verify
grep SOLVER_API_KEYS /etc/freeflo/attestation.env

# Restart service (see above)
```

### Rebuild Attestation Service

```bash
cd /opt/freeflo/attestation-service
cargo build --release
# Then restart (see above)
```

### Update Attestation Service Code

```bash
cd /opt/freeflo/attestation-service
git fetch origin
git pull origin claude/review-deployment-feedback-bQM6t
cargo build --release

# Restart
pkill -f attestation-service
set -a
source /etc/freeflo/attestation.env
set +a
./target/release/attestation-service &

# Verify
sleep 2
curl http://127.0.0.1:4001/api/v1/health
```

---

## On-Chain Commands

### Intent Operations

```bash
# Get intent details
cast call $OFFRAMP "getIntent(bytes32)" $INTENT_ID --rpc-url $RPC

# Decode intent status (0=NONE, 1=PENDING_QUOTE, 2=COMMITTED, 3=FULFILLED, 4=CANCELLED, 5=EXPIRED)
cast call $OFFRAMP "getIntent(bytes32)" $INTENT_ID --rpc-url $RPC | head -c 66
```

### Solver Operations

```bash
# Check solver info
cast call $OFFRAMP "solverInfo(address)" $SOLVER_ADDRESS --rpc-url $RPC

# Check if solver supports SEPA_INSTANT (RTPN 0)
cast call $OFFRAMP "solverSupportsRtpn(address,uint8)" $SOLVER_ADDRESS 0 --rpc-url $RPC

# Register solver
cast send $OFFRAMP "registerSolver(string)" "SolverName" \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC

# Enable SEPA_INSTANT for solver
cast send $OFFRAMP "setSolverRtpn(uint8,bool)" 0 true \
  --private-key $SOLVER_PRIVATE_KEY --rpc-url $RPC
```

### Witness/Verifier Operations

```bash
# Check if witness is authorized
cast call $VERIFIER "authorizedWitnesses(address)" $WITNESS_ADDRESS --rpc-url $RPC

# Get domain separator
cast call $VERIFIER "DOMAIN_SEPARATOR()" --rpc-url $RPC

# Authorize witness (owner only)
cast send $VERIFIER "setWitnessAuthorization(address,bool)" $WITNESS_ADDRESS true \
  --private-key $OWNER_PRIVATE_KEY --rpc-url $RPC
```

### Balance Checks

```bash
# ETH balance
cast balance $ADDRESS --rpc-url $RPC

# USDC balance (6 decimals)
cast call $USDC "balanceOf(address)" $ADDRESS --rpc-url $RPC
# Convert to human readable
cast call $USDC "balanceOf(address)" $ADDRESS --rpc-url $RPC | cast --to-dec | awk '{print $1/1000000}'

# Contract USDC balance
cast call $USDC "balanceOf(address)" $OFFRAMP --rpc-url $RPC | cast --to-dec | awk '{print $1/1000000}'
```

### Watch Events

```bash
# Watch all contract events
cast logs --rpc-url $RPC --address $OFFRAMP --from-block latest

# Watch from specific block
cast logs --rpc-url $RPC --address $OFFRAMP --from-block 36100000
```

---

## Emergency Procedures

### Emergency Withdraw Stuck Funds (Owner Only)

When USDC is stuck in expired/cancelled intents:

```bash
# Check contract balance first
cast call $USDC "balanceOf(address)" $OFFRAMP --rpc-url $RPC | cast --to-dec | awk '{print $1/1000000 " USDC"}'

# Emergency withdraw (owner only)
cast send $OFFRAMP "emergencyWithdraw(address,uint256)" $USDC $AMOUNT_IN_WEI \
  --private-key $OWNER_PRIVATE_KEY --rpc-url $RPC

# Example: Withdraw 10 USDC (10 * 10^6)
cast send $OFFRAMP "emergencyWithdraw(address,uint256)" $USDC 10000000 \
  --private-key $OWNER_PRIVATE_KEY --rpc-url $RPC
```

### Cancel Expired Intent (User)

```bash
# User can cancel their own expired intent
cast send $OFFRAMP "cancelIntent(bytes32)" $INTENT_ID \
  --private-key $USER_PRIVATE_KEY --rpc-url $RPC
```

### Clear Solver State

If solver database is corrupted:

```bash
cd /opt/zkp2p-offramp/solver
pm2 stop zkp2p-solver
rm -rf data/ *.db proofs/
pm2 restart zkp2p-solver
```

### Refresh Qonto OAuth Tokens

If tokens expired and auto-refresh failed:

```bash
# On local machine (not VPS), run OAuth flow again
cd FreeFlo/solver
QONTO_CLIENT_ID=xxx QONTO_CLIENT_SECRET=xxx node scripts/qonto-oauth-simple.mjs

# Copy new tokens to VPS .env
# Update QONTO_ACCESS_TOKEN and QONTO_REFRESH_TOKEN
# Restart solver
pm2 restart zkp2p-solver
```

---

## Debugging

### Error Signatures

| Selector | Error | Likely Cause |
|----------|-------|--------------|
| `0x41110897` | NotAuthorizedWitness | EIP-712 domain mismatch or witness not authorized |
| `0x8baa579f` | InvalidSignature | Attestation signature verification failed |
| `0xcad2ae02` | NullifierAlreadyUsed | Payment ID already claimed |
| `0x69388023` | PaymentVerificationFailed | Bad attestation data format |
| `0x88366b0a` | QuoteWindowClosed | Intent expired (>5 min) |

### Decode Transaction Error

```bash
# Get failed tx receipt
cast receipt $TX_HASH --rpc-url $RPC

# Decode revert reason
cast call --trace $TX_HASH --rpc-url $RPC
```

### Check Attestation Service Connectivity

```bash
# From solver VPS
curl -v https://attestation.freeflo.live/api/v1/health

# Test attestation endpoint (will fail auth but confirms connectivity)
curl -X POST https://attestation.freeflo.live/api/v1/attest \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Sync Issues

If solver misses events:

```bash
# Check last synced block in logs
pm2 logs zkp2p-solver --lines 100 | grep -i sync

# Clear state and resync
pm2 stop zkp2p-solver
rm -rf /opt/zkp2p-offramp/solver/data/
pm2 restart zkp2p-solver
```

### Clock Sync (VoP Token Issues)

```bash
# Check time sync status
timedatectl status

# Enable NTP if not synced
timedatectl set-ntp true
systemctl restart systemd-timesyncd
```

### Test E2E Flow Manually

```bash
# 1. Create intent on frontend, note the intent ID

# 2. Check intent on-chain
cast call $OFFRAMP "getIntent(bytes32)" $INTENT_ID --rpc-url $RPC

# 3. Watch solver logs
pm2 logs zkp2p-solver

# 4. Watch attestation logs (on attestation server)
tail -f /var/log/attestation.log

# 5. Check transaction on basescan
# https://sepolia.basescan.org/tx/$TX_HASH
```

---

## Quick Reference

### File Locations

| File | Path |
|------|------|
| Solver code | `/opt/zkp2p-offramp/solver/` |
| Solver .env | `/opt/zkp2p-offramp/solver/.env` |
| Solver logs | `pm2 logs zkp2p-solver` |
| TLSNotary prover | `/opt/zkp2p-offramp/tlsn/qonto/` |
| Attestation service | `/opt/freeflo/attestation-service/` |
| Attestation .env | `/etc/freeflo/attestation.env` |
| Attestation logs | `/var/log/attestation.log` |

### Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| OffRampV3 | `0x34249F4AB741F0661A38651A08213DDe1469b60f` |
| PaymentVerifier | `0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### Registered Solvers

| Name | Address | API Key (first 8 chars) |
|------|---------|-------------------------|
| ZKP2P Solver | `0xD871FC606Db7621f0Ff4B522220346FC4F033d69` | `7b6f206c...` |
| Kayanski | `0xb3dbe55c3c2A8Fa5b315957195E0b441bcCdF34F` | `03cdc52e...` |

### Witness

| Address | Status |
|---------|--------|
| `0x343830917e4e5f6291146af68f76eada08631a27` | Authorized |
