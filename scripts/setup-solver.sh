#!/bin/bash
# =============================================================================
# FreeFlo Solver Setup Script
# =============================================================================
# This script helps you set up a new solver by:
# 1. Registering the solver on OffRampV3 (optional, for reputation)
# 2. Declaring supported RTPNs
# 3. Authorizing the witness on PaymentVerifier (requires contract owner)
#
# Prerequisites:
# - foundry installed (https://getfoundry.sh)
# - Solver private key with ETH for gas
# - Contract owner private key (for witness authorization)
#
# Usage:
#   ./scripts/setup-solver.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=============================================="
echo "  FreeFlo Solver Setup"
echo "=============================================="
echo ""

# =============================================================================
# Configuration
# =============================================================================

# Default to Base Sepolia testnet
RPC_URL="${RPC_URL:-https://base-sepolia-rpc.publicnode.com}"
CHAIN_ID="${CHAIN_ID:-84532}"

# Contract addresses (Base Sepolia testnet defaults)
OFFRAMP_V3="${OFFRAMP_V3_ADDRESS:-0x34249F4AB741F0661A38651A08213DDe1469b60f}"
PAYMENT_VERIFIER="${PAYMENT_VERIFIER_ADDRESS:-0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe}"

echo "Configuration:"
echo "  RPC URL: $RPC_URL"
echo "  Chain ID: $CHAIN_ID"
echo "  OffRampV3: $OFFRAMP_V3"
echo "  PaymentVerifier: $PAYMENT_VERIFIER"
echo ""

# =============================================================================
# Check Prerequisites
# =============================================================================

if ! command -v cast &> /dev/null; then
    echo -e "${RED}Error: 'cast' not found. Please install Foundry:${NC}"
    echo "  curl -L https://foundry.paradigm.xyz | bash"
    echo "  foundryup"
    exit 1
fi

# =============================================================================
# Get Solver Address
# =============================================================================

echo "Step 1: Solver Registration (optional)"
echo "---------------------------------------"
echo ""

read -p "Enter your SOLVER wallet address (0x...): " SOLVER_ADDRESS

if [[ ! "$SOLVER_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo -e "${RED}Invalid address format${NC}"
    exit 1
fi

# Check current solver status
echo ""
echo "Checking current solver status..."

SOLVER_INFO=$(cast call "$OFFRAMP_V3" "solverInfo(address)(string,uint256,uint256,uint256,bool)" "$SOLVER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "NOT_REGISTERED")

if [[ "$SOLVER_INFO" == "NOT_REGISTERED" ]] || [[ "$SOLVER_INFO" == *"(, 0, 0, 0, false)"* ]]; then
    echo -e "${YELLOW}Solver not registered yet${NC}"

    read -p "Do you want to register the solver? (y/n): " REGISTER_SOLVER

    if [[ "$REGISTER_SOLVER" == "y" ]]; then
        read -p "Enter solver name (e.g., 'MySolver'): " SOLVER_NAME
        read -sp "Enter SOLVER private key (0x...): " SOLVER_PRIVATE_KEY
        echo ""

        echo "Registering solver..."
        cast send "$OFFRAMP_V3" "registerSolver(string)" "$SOLVER_NAME" \
            --private-key "$SOLVER_PRIVATE_KEY" \
            --rpc-url "$RPC_URL"

        echo -e "${GREEN}✓ Solver registered${NC}"
    fi
else
    echo -e "${GREEN}✓ Solver already registered${NC}"
    echo "  Info: $SOLVER_INFO"
fi

# =============================================================================
# Set Supported RTPNs
# =============================================================================

echo ""
echo "Step 2: Configure Supported RTPNs"
echo "----------------------------------"
echo ""
echo "RTPNs available:"
echo "  0 = SEPA_INSTANT (EUR)"
echo "  1 = SEPA_STANDARD (EUR)"
echo "  2 = FPS (GBP)"
echo "  3 = BACS (GBP)"
echo "  4 = PIX (BRL)"
echo "  5 = TED (BRL)"
echo "  6 = UPI (INR)"
echo "  7 = IMPS (INR)"
echo "  8 = FEDNOW (USD)"
echo "  9 = ACH (USD)"
echo ""

# Check current SEPA_INSTANT support
SUPPORTS_SEPA=$(cast call "$OFFRAMP_V3" "solverSupportsRtpn(address,uint8)" "$SOLVER_ADDRESS" 0 --rpc-url "$RPC_URL" 2>/dev/null || echo "false")

if [[ "$SUPPORTS_SEPA" == "true" ]]; then
    echo -e "${GREEN}✓ Solver already supports SEPA_INSTANT${NC}"
else
    echo -e "${YELLOW}Solver does not support SEPA_INSTANT${NC}"

    read -p "Enable SEPA_INSTANT support? (y/n): " ENABLE_SEPA

    if [[ "$ENABLE_SEPA" == "y" ]]; then
        if [[ -z "$SOLVER_PRIVATE_KEY" ]]; then
            read -sp "Enter SOLVER private key (0x...): " SOLVER_PRIVATE_KEY
            echo ""
        fi

        echo "Setting SEPA_INSTANT support..."
        cast send "$OFFRAMP_V3" "setSolverRtpn(uint8,bool)" 0 true \
            --private-key "$SOLVER_PRIVATE_KEY" \
            --rpc-url "$RPC_URL"

        echo -e "${GREEN}✓ SEPA_INSTANT enabled${NC}"
    fi
fi

# =============================================================================
# Authorize Witness
# =============================================================================

echo ""
echo "Step 3: Authorize Witness on PaymentVerifier"
echo "---------------------------------------------"
echo ""
echo -e "${YELLOW}NOTE: This step requires the CONTRACT OWNER's private key${NC}"
echo ""

read -p "Enter your WITNESS address (attestation service signer, 0x...): " WITNESS_ADDRESS

if [[ ! "$WITNESS_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo -e "${RED}Invalid address format${NC}"
    exit 1
fi

# Check if witness is authorized
IS_AUTHORIZED=$(cast call "$PAYMENT_VERIFIER" "authorizedWitnesses(address)" "$WITNESS_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "false")

if [[ "$IS_AUTHORIZED" == "true" ]]; then
    echo -e "${GREEN}✓ Witness already authorized${NC}"
else
    echo -e "${YELLOW}Witness not authorized${NC}"

    read -p "Do you want to authorize the witness? (y/n): " AUTH_WITNESS

    if [[ "$AUTH_WITNESS" == "y" ]]; then
        read -sp "Enter CONTRACT OWNER private key (0x...): " OWNER_PRIVATE_KEY
        echo ""

        echo "Authorizing witness..."
        cast send "$PAYMENT_VERIFIER" "addWitness(address)" "$WITNESS_ADDRESS" \
            --private-key "$OWNER_PRIVATE_KEY" \
            --rpc-url "$RPC_URL"

        echo -e "${GREEN}✓ Witness authorized${NC}"
    fi
fi

# =============================================================================
# Verification
# =============================================================================

echo ""
echo "=============================================="
echo "  Verification"
echo "=============================================="
echo ""

# Re-check all statuses
echo "Checking final status..."

SOLVER_INFO=$(cast call "$OFFRAMP_V3" "solverInfo(address)(string,uint256,uint256,uint256,bool)" "$SOLVER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "Not registered")
SUPPORTS_SEPA=$(cast call "$OFFRAMP_V3" "solverSupportsRtpn(address,uint8)" "$SOLVER_ADDRESS" 0 --rpc-url "$RPC_URL" 2>/dev/null || echo "false")
IS_AUTHORIZED=$(cast call "$PAYMENT_VERIFIER" "authorizedWitnesses(address)" "$WITNESS_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "false")

echo ""
echo "Results:"
echo "  Solver registered: $SOLVER_INFO"
echo "  SEPA_INSTANT support: $SUPPORTS_SEPA"
echo "  Witness authorized: $IS_AUTHORIZED"
echo ""

if [[ "$IS_AUTHORIZED" == "true" ]] && [[ "$SUPPORTS_SEPA" == "true" ]]; then
    echo -e "${GREEN}=============================================="
    echo "  ✓ Setup Complete!"
    echo "=============================================="
    echo ""
    echo "Your solver is ready to process SEPA Instant transfers."
    echo ""
    echo "Next steps:"
    echo "  1. Configure solver/.env with your settings"
    echo "  2. Start the solver: npm run start:v3"
    echo "  3. Start the attestation service"
    echo "  4. Test with a small transaction"
    echo "${NC}"
else
    echo -e "${YELLOW}=============================================="
    echo "  ⚠ Setup Incomplete"
    echo "=============================================="
    echo ""
    echo "Some steps are not complete. Please review above."
    echo "${NC}"
fi
