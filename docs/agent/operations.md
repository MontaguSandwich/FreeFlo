# Operations Reference

## Servers

Solver VPS: 95.217.235.164, code at /opt/zkp2p-offramp/
Attestation: 77.42.68.242, binary at /opt/freeflo/attestation-service/ (no source)

## PM2 (Solver)

Mainnet: pm2 start bash --name zkp2p-solver -- -c 'cd /opt/zkp2p-offramp/solver && exec node dist/index-v3.js'
Testnet: pm2 start bash --name zkp2p-solver-testnet -- -c 'cd /opt/zkp2p-offramp/solver && ENV_FILE=.env.testnet exec node dist/index-v3.js'

## Attestation

set -a && source /etc/freeflo/attestation-testnet.env && set +a
/opt/freeflo/attestation-service/target/release/attestation-service &

## Qonto Sandbox Token

cd solver && QONTO_SANDBOX=true QONTO_STAGING_TOKEN=<token> QONTO_CLIENT_ID=<id> QONTO_CLIENT_SECRET=<secret> node scripts/qonto-oauth-simple.mjs

## Witness Key

0x343830917e4e5f6291146af68f76eada08631a27 authorized on both mainnet and testnet.

## Related Docs

docs/OPERATIONS_RUNBOOK.md, docs/ARCHITECTURE.md, docs/SOLVER_ONBOARDING.md, docs/ATTESTATION_SEPARATION_SPEC.md, CHANGELOG.md
