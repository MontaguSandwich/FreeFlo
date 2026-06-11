#!/usr/bin/env bash
# PRODUCTION deploy — audited PaymentVerifier + OffRampV3 to Base mainnet (chain 8453).
# REAL MONEY. Unlike _deploy-mainnet-e2e.sh, NOTHING is hardcoded — you supply a fresh,
# securely-generated witness + a funded owner/deployer key. No private key is ever printed.
#
# Keep secrets OUT of the transcript: put DEPLOYER_PRIVATE_KEY in a gitignored file and
# source it before running, e.g.:
#   set -a; source contracts/.env.deploy; set +a        # .env.deploy is gitignored
#   WITNESS_ADDRESS=0x<prod witness pubaddr> SEED_SOLVER=0x<solver> bash contracts/_deploy-prod.sh
#
# Required env:
#   DEPLOYER_PRIVATE_KEY  funded ~0.005 ETH on Base; becomes OffRampV3 OWNER (admin) — use a FRESH key.
#   WITNESS_ADDRESS       public address of your prod witness key (private key lives in attestation/.env.production).
# Optional env:
#   RPC          default https://mainnet.base.org (fine for a one-shot deploy; the 429 issue is only the solver sync).
#   USDC         default real Base USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
#   SEED_SOLVER  if set, sends 0.0002 ETH to this solver address for gas after deploy.
set -euo pipefail
: "${DEPLOYER_PRIVATE_KEY:?source your gitignored deploy env first (DEPLOYER_PRIVATE_KEY unset)}"
: "${WITNESS_ADDRESS:?set WITNESS_ADDRESS=0x<prod witness public address>}"
cd "$(dirname "$0")"

RPC="${RPC:-https://mainnet.base.org}"
USDC="${USDC:-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913}"

echo ">>> Deploying audited PaymentVerifier + OffRampV3 to Base mainnet (chain 8453)"
echo ">>> Witness: $WITNESS_ADDRESS"
echo ">>> USDC:    $USDC"
WITNESS_ADDRESS="$WITNESS_ADDRESS" USDC_ADDRESS="$USDC" \
  forge script script/DeployFixed.s.sol:DeployFixedScript \
  --rpc-url "$RPC" --broadcast

if [ -n "${SEED_SOLVER:-}" ]; then
  echo ">>> Seeding solver $SEED_SOLVER with 0.0002 ETH for gas..."
  cast send "$SEED_SOLVER" --value 0.0002ether \
    --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC"
fi

echo ">>> Done. Deployed addresses are above + in broadcast/DeployFixed.s.sol/8453/run-latest.json"
echo ">>> Next:"
echo ">>>   1. Fill OFFRAMP_V3_ADDRESS / PAYMENT_VERIFIER_ADDRESS in solver/.env.production + attestation/.env.production"
echo ">>>   2. Register the solver (else it exits at boot):"
echo ">>>      cast send <OffRampV3> 'setSolverRtpn(uint8,bool)' 0 true --private-key \$SOLVER_PRIVATE_KEY --rpc-url \$RPC"
