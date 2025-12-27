use anyhow::{anyhow, Result};
use k256::ecdsa::SigningKey;

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
        
        Ok(Self {
            signing_key,
            chain_id,
            verifier_contract,
            allowed_servers,
        })
    }
    
    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }
    
    pub fn witness_address(&self) -> [u8; 20] {
        use k256::ecdsa::VerifyingKey;
        use alloy_primitives::keccak256;
        
        let verifying_key = VerifyingKey::from(&self.signing_key);
        let pubkey_bytes = verifying_key.to_encoded_point(false);
        
        // Keccak256 hash of public key (without prefix byte), take last 20 bytes
        let hash = keccak256(&pubkey_bytes.as_bytes()[1..]);
        let mut addr = [0u8; 20];
        addr.copy_from_slice(&hash[12..]);
        addr
    }
}

