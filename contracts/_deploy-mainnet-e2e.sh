#!/usr/bin/env bash
# One-off mainnet E2E deploy + solver seed. Reads your key from $DEPLOYER_PRIVATE_KEY.
# Run:  export DEPLOYER_PRIVATE_KEY=0x<your 0x4045… key>   (already set in your shell)
#       bash _deploy-mainnet-e2e.sh
# Safe to delete after the E2E. Contains no secrets.
set -euo pipefail
: "${DEPLOYER_PRIVATE_KEY:?Run 'export DEPLOYER_PRIVATE_KEY=0x<your key>' first}"
cd "$(dirname "$0")"

RPC=https://mainnet.base.org
WITNESS=0x1b0b233207418E581Cc1182B431a04d1C1Bddb8a
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
SOLVER=0x25ac46C084620d0F129399111cDf0aD2C9Ff196D

echo ">>> [1/2] Deploying audited PaymentVerifier + OffRampV3 to Base mainnet..."
WITNESS_ADDRESS="$WITNESS" USDC_ADDRESS="$USDC" \
  forge script script/DeployFixed.s.sol:DeployFixedScript \
  --rpc-url "$RPC" --broadcast

echo ">>> [2/2] Seeding solver $SOLVER with 0.0002 ETH for gas..."
cast send "$SOLVER" --value 0.0002ether \
  --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC"

echo ">>> Done. Deployed addresses are in the [1/2] output above and in:"
echo "    contracts/broadcast/DeployFixed.s.sol/8453/run-latest.json"
