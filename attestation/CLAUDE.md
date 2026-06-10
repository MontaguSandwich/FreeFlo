# Attestation Service (Rust)

Verifies TLSNotary proofs, validates on-chain intent state, signs EIP-712 attestations.

## Location

Binary only at /opt/freeflo/attestation-service/target/release/attestation-service on 77.42.68.242
No source code on that server. Env at /etc/freeflo/

## Dual Deployment

Mainnet: port 4001, env /etc/freeflo/attestation.env, chainId 8453
Testnet: port 4002, env /etc/freeflo/attestation-testnet.env, chainId 84532

## Starting

set -a && source /etc/freeflo/attestation-testnet.env && set +a
/opt/freeflo/attestation-service/target/release/attestation-service &

## Key Env Vars

WITNESS_PRIVATE_KEY, CHAIN_ID, VERIFIER_CONTRACT, RPC_URL, OFFRAMP_CONTRACT, SOLVER_API_KEYS, ALLOWED_SERVERS

## Dependencies

tlsnotary/tlsn v0.1.0-alpha.13 git dep. Version MUST match prover.

## Health

curl http://127.0.0.1:4001/api/v1/health
curl http://127.0.0.1:4002/api/v1/health
