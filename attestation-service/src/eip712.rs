use alloy_primitives::{keccak256, B256, U256};
use alloy_sol_types::sol;
use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};

use crate::error::AttestationError;

// Define EIP-712 types matching ZKP2P's PaymentAttestation
sol! {
    struct PaymentAttestation {
        bytes32 intentHash;
        uint256 amount;
        uint256 timestamp;
        string paymentId;
        bytes32 dataHash;
    }
}

/// EIP-712 Domain for payment attestations
#[derive(Debug, Clone)]
pub struct AttestationDomain {
    pub name: String,
    pub version: String,
    pub chain_id: u64,
    pub verifying_contract: [u8; 20],
}

impl Default for AttestationDomain {
    fn default() -> Self {
        Self {
            name: "WisePaymentVerifier".to_string(),
            version: "1".to_string(),
            chain_id: 84532, // Base Sepolia
            verifying_contract: [0u8; 20],
        }
    }
}

impl AttestationDomain {
    pub fn new(chain_id: u64, verifying_contract: [u8; 20]) -> Self {
        Self {
            chain_id,
            verifying_contract,
            ..Default::default()
        }
    }
    
    /// Compute the EIP-712 domain separator
    pub fn domain_separator(&self) -> B256 {
        let type_hash = keccak256(
            b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        
        let name_hash = keccak256(self.name.as_bytes());
        let version_hash = keccak256(self.version.as_bytes());
        
        let mut encoded = Vec::new();
        encoded.extend_from_slice(&type_hash[..]);
        encoded.extend_from_slice(&name_hash[..]);
        encoded.extend_from_slice(&version_hash[..]);
        encoded.extend_from_slice(&U256::from(self.chain_id).to_be_bytes::<32>());
        
        // Pad address to 32 bytes
        let mut addr_padded = [0u8; 32];
        addr_padded[12..].copy_from_slice(&self.verifying_contract);
        encoded.extend_from_slice(&addr_padded);
        
        keccak256(&encoded)
    }
}

/// Attestation data to be signed
#[derive(Debug, Clone)]
pub struct AttestationData {
    pub intent_hash: [u8; 32],
    pub amount: u64,
    pub timestamp: u64,
    pub payment_id: String,
    pub data: Vec<u8>,
}

impl AttestationData {
    /// Compute the struct hash for EIP-712 signing
    pub fn struct_hash(&self) -> B256 {
        let type_hash = keccak256(
            b"PaymentAttestation(bytes32 intentHash,uint256 amount,uint256 timestamp,string paymentId,bytes32 dataHash)"
        );
        
        let payment_id_hash = keccak256(self.payment_id.as_bytes());
        let data_hash = keccak256(&self.data);
        
        let mut encoded = Vec::new();
        encoded.extend_from_slice(&type_hash[..]);
        encoded.extend_from_slice(&self.intent_hash);
        encoded.extend_from_slice(&U256::from(self.amount).to_be_bytes::<32>());
        encoded.extend_from_slice(&U256::from(self.timestamp).to_be_bytes::<32>());
        encoded.extend_from_slice(&payment_id_hash[..]);
        encoded.extend_from_slice(&data_hash[..]);
        
        keccak256(&encoded)
    }
    
    pub fn data_hash(&self) -> B256 {
        keccak256(&self.data)
    }
}

/// Sign an attestation using EIP-712
pub fn sign_attestation(
    domain: &AttestationDomain,
    data: &AttestationData,
    signing_key: &SigningKey,
) -> Result<([u8; 65], B256), AttestationError> {
    let domain_separator = domain.domain_separator();
    let struct_hash = data.struct_hash();
    
    // EIP-712: \x19\x01 || domain_separator || struct_hash
    let mut message = Vec::with_capacity(66);
    message.push(0x19);
    message.push(0x01);
    message.extend_from_slice(&domain_separator[..]);
    message.extend_from_slice(&struct_hash[..]);
    
    let digest = keccak256(&message);
    
    // Sign the digest using prehash signing
    let (signature, recovery_id) = signing_key
        .sign_prehash_recoverable(&digest[..])
        .map_err(|e| AttestationError::SigningError(format!("Failed to sign: {}", e)))?;
    
    // Encode as 65-byte signature: r (32) || s (32) || v (1)
    let mut sig_bytes = [0u8; 65];
    sig_bytes[..32].copy_from_slice(&signature.r().to_bytes());
    sig_bytes[32..64].copy_from_slice(&signature.s().to_bytes());
    sig_bytes[64] = recovery_id.to_byte() + 27; // Ethereum v value
    
    Ok((sig_bytes, digest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::VerifyingKey;
    
    #[test]
    fn test_domain_separator() {
        let domain = AttestationDomain::default();
        let separator = domain.domain_separator();
        assert!(!separator.is_zero());
    }
    
    #[test]
    fn test_sign_attestation() {
        let domain = AttestationDomain::default();
        let data = AttestationData {
            intent_hash: [1u8; 32],
            amount: 100_00, // €100.00 in cents
            timestamp: 1703500000,
            payment_id: "tx-123".to_string(),
            data: b"test data".to_vec(),
        };
        
        // Generate a test key
        let signing_key = SigningKey::random(&mut rand::thread_rng());
        
        let (signature, digest) = sign_attestation(&domain, &data, &signing_key).unwrap();
        
        // Verify signature length
        assert_eq!(signature.len(), 65);
        
        // Verify recovery
        let v = signature[64];
        assert!(v == 27 || v == 28);
    }
}

