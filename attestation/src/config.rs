use anyhow::{anyhow, Result};
use k256::ecdsa::{SigningKey, VerifyingKey};

/// Configuration for the attestation service
pub struct Config {
    /// The private key used to sign attestations (ECDSA secp256k1)
    signing_key: SigningKey,

    /// Chain ID for EIP-712 domain separator
    pub chain_id: u64,

    /// Verifier contract address for EIP-712 domain separator
    pub verifier_contract: [u8; 20],

    /// Allowed server domains for presentation verification
    pub allowed_servers: Vec<String>,

    /// Trusted TLSNotary verifying keys. A presentation is accepted only if its
    /// notary (attestation) signing key matches one of these. Without this pin,
    /// any party could self-notarize a forged transcript and mint attestations.
    notary_keys: Vec<VerifyingKey>,

    /// When true, the service may run without on-chain intent validation
    /// (RPC_URL / OFFRAMP_CONTRACT unset). Dev/test only — never in production.
    pub allow_no_chain_validation: bool,

    /// FreeFloCompactArbiter address (TIER-1 sign-once offramp). When set, the service accepts
    /// Compact-flow attestation requests and binds them to THIS arbiter (never a solver-supplied
    /// one). Unset => the Compact flow is disabled and such requests are rejected.
    pub compact_arbiter: Option<[u8; 20]>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        // Load signing key from environment
        let key_hex = std::env::var("WITNESS_PRIVATE_KEY")
            .map_err(|_| anyhow!("WITNESS_PRIVATE_KEY not set"))?;

        let key_bytes = hex::decode(key_hex.trim_start_matches("0x"))
            .map_err(|e| anyhow!("Invalid WITNESS_PRIVATE_KEY hex: {}", e))?;

        let signing_key = SigningKey::from_bytes((&key_bytes[..]).into())
            .map_err(|e| anyhow!("Invalid WITNESS_PRIVATE_KEY: {}", e))?;

        // Load chain ID (default to Base Sepolia for testing)
        let chain_id = std::env::var("CHAIN_ID")
            .unwrap_or_else(|_| "84532".to_string())
            .parse()
            .map_err(|e| anyhow!("Invalid CHAIN_ID: {}", e))?;

        // Load verifier contract address
        let verifier_hex = std::env::var("VERIFIER_CONTRACT")
            .unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());

        let verifier_bytes = hex::decode(verifier_hex.trim_start_matches("0x"))
            .map_err(|e| anyhow!("Invalid VERIFIER_CONTRACT hex: {}", e))?;

        let mut verifier_contract = [0u8; 20];
        if verifier_bytes.len() != 20 {
            return Err(anyhow!("VERIFIER_CONTRACT must be 20 bytes"));
        }
        verifier_contract.copy_from_slice(&verifier_bytes);

        // Load allowed servers
        let allowed_servers = std::env::var("ALLOWED_SERVERS")
            .unwrap_or_else(|_| "thirdparty.qonto.com".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        // Load pinned notary public keys (SEC1 secp256k1 hex, comma-separated).
        // REQUIRED: the notary is the root of trust for proof authenticity.
        let notary_keys_raw = std::env::var("NOTARY_PUBLIC_KEYS")
            .map_err(|_| anyhow!("NOTARY_PUBLIC_KEYS not set (no trusted notary configured)"))?;
        let notary_keys = notary_keys_raw
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| {
                let bytes = hex::decode(s.trim_start_matches("0x"))
                    .map_err(|e| anyhow!("Invalid NOTARY_PUBLIC_KEYS hex: {}", e))?;
                VerifyingKey::from_sec1_bytes(&bytes)
                    .map_err(|e| anyhow!("Invalid notary public key (not SEC1 secp256k1): {}", e))
            })
            .collect::<Result<Vec<_>>>()?;
        if notary_keys.is_empty() {
            return Err(anyhow!(
                "NOTARY_PUBLIC_KEYS is empty (no trusted notary configured)"
            ));
        }

        // Fail closed on on-chain validation unless explicitly opted out for dev.
        let allow_no_chain_validation = std::env::var("ALLOW_NO_CHAIN_VALIDATION")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        // Optional: the FreeFloCompactArbiter address enabling the TIER-1 sign-once flow.
        let compact_arbiter = match std::env::var("COMPACT_ARBITER") {
            Ok(s) if !s.trim().is_empty() => {
                let bytes = hex::decode(s.trim().trim_start_matches("0x"))
                    .map_err(|e| anyhow!("Invalid COMPACT_ARBITER hex: {}", e))?;
                if bytes.len() != 20 {
                    return Err(anyhow!("COMPACT_ARBITER must be 20 bytes"));
                }
                let mut a = [0u8; 20];
                a.copy_from_slice(&bytes);
                Some(a)
            }
            _ => None,
        };

        Ok(Self {
            signing_key,
            chain_id,
            verifier_contract,
            allowed_servers,
            notary_keys,
            allow_no_chain_validation,
            compact_arbiter,
        })
    }

    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// Trusted TLSNotary verifying keys used to pin proof authenticity.
    pub fn notary_keys(&self) -> &[VerifyingKey] {
        &self.notary_keys
    }

    pub fn witness_address(&self) -> [u8; 20] {
        use alloy_primitives::keccak256;
        use k256::ecdsa::VerifyingKey;

        let verifying_key = VerifyingKey::from(&self.signing_key);
        let pubkey_bytes = verifying_key.to_encoded_point(false);

        // Keccak256 hash of public key (without prefix byte), take last 20 bytes
        let hash = keccak256(&pubkey_bytes.as_bytes()[1..]);
        let mut addr = [0u8; 20];
        addr.copy_from_slice(&hash[12..]);
        addr
    }
}
