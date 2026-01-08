#!/bin/bash
# Phase 2 Deployment Script for Attestation Service
# Run this on the attestation server (77.42.68.242)

set -e

echo "=== Phase 2: Deploying Attestation Service Updates ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Pull latest code
echo -e "${YELLOW}[1/6] Pulling latest code...${NC}"
cd /opt/freeflo
git fetch origin claude/review-deployment-feedback-bQM6t
git checkout claude/review-deployment-feedback-bQM6t
git pull origin claude/review-deployment-feedback-bQM6t
echo -e "${GREEN}✓ Code updated${NC}"
echo ""

# 2. Build attestation service
echo -e "${YELLOW}[2/6] Building attestation service...${NC}"
cd /opt/freeflo/attestation-service
source "$HOME/.cargo/env"
cargo build --release
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# 3. Generate solver API key (if not already set)
echo -e "${YELLOW}[3/6] Checking solver API key...${NC}"
if grep -q "^SOLVER_API_KEYS=$" /etc/freeflo/attestation.env 2>/dev/null || ! grep -q "SOLVER_API_KEYS" /etc/freeflo/attestation.env 2>/dev/null; then
    # Generate a new API key
    SOLVER_ADDRESS="0xYOUR_SOLVER_ADDRESS"  # Replace with actual solver address
    API_KEY=$(openssl rand -hex 32)
    echo ""
    echo -e "${YELLOW}Generated new solver API key:${NC}"
    echo "  Solver Address: $SOLVER_ADDRESS"
    echo "  API Key: $API_KEY"
    echo ""
    echo -e "${YELLOW}Please update /etc/freeflo/attestation.env with:${NC}"
    echo "  SOLVER_API_KEYS=$API_KEY:$SOLVER_ADDRESS"
    echo ""
    echo -e "${YELLOW}And update solver's .env with:${NC}"
    echo "  ATTESTATION_API_KEY=$API_KEY"
    echo ""
else
    echo -e "${GREEN}✓ SOLVER_API_KEYS already configured${NC}"
fi
echo ""

# 4. Update environment file with new Phase 2 variables
echo -e "${YELLOW}[4/6] Checking environment configuration...${NC}"

# Check for required Phase 2 env vars
MISSING_VARS=()

if ! grep -q "RPC_URL" /etc/freeflo/attestation.env 2>/dev/null; then
    MISSING_VARS+=("RPC_URL=https://base-sepolia-rpc.publicnode.com")
fi

if ! grep -q "OFFRAMP_CONTRACT" /etc/freeflo/attestation.env 2>/dev/null; then
    MISSING_VARS+=("OFFRAMP_CONTRACT=0x34249F4AB741F0661A38651A08213DDe1469b60f")
fi

if ! grep -q "RATE_LIMIT_PER_MINUTE" /etc/freeflo/attestation.env 2>/dev/null; then
    MISSING_VARS+=("RATE_LIMIT_PER_MINUTE=100")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${YELLOW}Adding missing environment variables...${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "$var" >> /etc/freeflo/attestation.env
        echo "  Added: $var"
    done
    echo -e "${GREEN}✓ Environment updated${NC}"
else
    echo -e "${GREEN}✓ All Phase 2 env vars present${NC}"
fi
echo ""

# 5. Restart service
echo -e "${YELLOW}[5/6] Restarting attestation service...${NC}"
systemctl restart freeflo-attestation
sleep 2
systemctl status freeflo-attestation --no-pager
echo -e "${GREEN}✓ Service restarted${NC}"
echo ""

# 6. Verify deployment
echo -e "${YELLOW}[6/6] Verifying deployment...${NC}"
sleep 3
HEALTH=$(curl -s https://attestation.freeflo.live/api/v1/health)
echo "Health response: $HEALTH"

# Check if auth is enabled
if echo "$HEALTH" | grep -q '"auth_enabled":true'; then
    echo -e "${GREEN}✓ Authentication enabled${NC}"
else
    echo -e "${RED}✗ Authentication NOT enabled - check SOLVER_API_KEYS${NC}"
fi

# Check if chain validation is enabled
if echo "$HEALTH" | grep -q '"chain_validation_enabled":true'; then
    echo -e "${GREEN}✓ Chain validation enabled${NC}"
else
    echo -e "${RED}✗ Chain validation NOT enabled - check RPC_URL and OFFRAMP_CONTRACT${NC}"
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. If SOLVER_API_KEYS was generated, update it with actual solver address"
echo "2. Add ATTESTATION_API_KEY to solver's environment"
echo "3. Restart solver: pm2 restart zkp2p-solver"
echo "4. Test with a real attestation request"
