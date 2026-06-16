use alloy_primitives::{keccak256, Address, B256, U256};
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
            b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
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

// ============ Compact (TIER-1 sign-once offramp) binding ============
//
// Mirrors FreeFloCompactArbiter (contracts/src/FreeFloCompactArbiter.sol): hashMandate,
// _computeClaimHash, and the fill() filler binding. Verified byte-identical to the LIVE Base
// Compact via contracts/test/CompactForkE2E.t.sol; the cast-derived vector is pinned in the tests
// below. For the Compact flow the attestation service sets `intentHash = compact_intent_hash(...)`
// instead of an OffRampV3 intent id, and binds the proven IBAN to the mandate's receivingInfo.

/// EIP-712 hashStruct of the FreeFlo Mandate (== the Compact `witness` word).
pub fn mandate_hash(
    receiving_info: &str,
    recipient_name: &str,
    min_eur_amount: u64,
    currency: u8,
    expiry: u64,
) -> B256 {
    let type_hash = keccak256(
        b"Mandate(string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)",
    );
    let mut e = Vec::with_capacity(32 * 6);
    e.extend_from_slice(&type_hash[..]);
    e.extend_from_slice(&keccak256(receiving_info.as_bytes())[..]);
    e.extend_from_slice(&keccak256(recipient_name.as_bytes())[..]);
    e.extend_from_slice(&U256::from(min_eur_amount).to_be_bytes::<32>());
    e.extend_from_slice(&U256::from(currency).to_be_bytes::<32>());
    e.extend_from_slice(&U256::from(expiry).to_be_bytes::<32>());
    keccak256(&e)
}

/// keccak256 of the full witnessed Compact typestring (== arbiter.COMPACT_WITNESS_TYPEHASH). The
/// Compact hardcodes the "...,uint256 amount,Mandate mandate)Mandate(" wrapper; the inner fields
/// are the Mandate's.
fn compact_witness_typehash() -> B256 {
    keccak256(
        b"Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount,Mandate mandate)Mandate(string receivingInfo,string recipientName,uint256 minEurAmount,uint8 currency,uint256 expiry)",
    )
}

/// Replicate The Compact's single-chain claim hash for a FreeFlo witnessed compact. The lock `id`
/// splits into `bytes12 lockTag` (upper 96 bits, left-aligned) and `address token` (lower 160 bits).
/// MUST match FreeFloCompactArbiter._computeClaimHash (and thus the value the live Compact returns).
pub fn compact_claim_hash(
    arbiter: Address,
    sponsor: Address,
    nonce: U256,
    expires: U256,
    id: U256,
    amount: U256,
    witness: B256,
) -> B256 {
    let id_be = id.to_be_bytes::<32>();
    let mut lock_tag_word = [0u8; 32]; // bytes12 left-aligned (top 12 bytes of id, then zeros)
    lock_tag_word[0..12].copy_from_slice(&id_be[0..12]);
    let mut token_word = [0u8; 32]; // address right-aligned (low 20 bytes of id)
    token_word[12..32].copy_from_slice(&id_be[12..32]);

    let mut e = Vec::with_capacity(32 * 9);
    e.extend_from_slice(&compact_witness_typehash()[..]);
    e.extend_from_slice(&arbiter.into_word()[..]);
    e.extend_from_slice(&sponsor.into_word()[..]);
    e.extend_from_slice(&nonce.to_be_bytes::<32>());
    e.extend_from_slice(&expires.to_be_bytes::<32>());
    e.extend_from_slice(&lock_tag_word);
    e.extend_from_slice(&token_word);
    e.extend_from_slice(&amount.to_be_bytes::<32>());
    e.extend_from_slice(&witness[..]);
    keccak256(&e)
}

/// The attestation `intentHash` for the Compact flow: keccak256(abi.encode(claimHash, filler)).
/// Binds the proof to this exact lock AND this filler (front-run defense) — matches
/// FreeFloCompactArbiter.fill()'s `keccak256(abi.encode(claimHash, msg.sender))`.
pub fn compact_intent_hash(claim_hash: B256, filler: Address) -> B256 {
    let mut e = Vec::with_capacity(64);
    e.extend_from_slice(&claim_hash[..]);
    e.extend_from_slice(&filler.into_word()[..]);
    keccak256(&e)
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

    #[test]
    fn test_compact_hash_parity() {
        // Vector generated via `cast` from the fork-verified arbiter formula (2026-06-15). If any
        // of these drift, the solver would request an intentHash the arbiter rejects -> fills fail.
        assert_eq!(
            format!("0x{}", hex::encode(compact_witness_typehash())),
            "0x1331dc8984a3ba9642121253c4ae47058b74099838b0e4caa45a756074ff4453"
        );

        let mh = mandate_hash(
            "DE89370400440532013000",
            "Anna Muller",
            9000,
            0,
            1_800_000_000,
        );
        assert_eq!(
            format!("0x{}", hex::encode(mh)),
            "0x065c610d6193de67fbf5f0006f4a36290c469dbdd34caf2e9a8a7dfef1fca049"
        );

        let arbiter: Address = "0x0000000000000000000000000000000000000A11"
            .parse()
            .unwrap();
        let sponsor: Address = "0x0000000000000000000000000000000000005111"
            .parse()
            .unwrap();
        let filler: Address = "0x0000000000000000000000000000000000005050"
            .parse()
            .unwrap();
        // id = lockTag(0x800000000000000000000abc) in the upper 96 bits | USDC in the lower 160.
        let id = U256::from_str_radix(
            "800000000000000000000abc833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            16,
        )
        .unwrap();
        let ch = compact_claim_hash(
            arbiter,
            sponsor,
            U256::from(7u64),
            U256::from(1_800_000_000u64),
            id,
            U256::from(100_000_000u64),
            mh,
        );
        assert_eq!(
            format!("0x{}", hex::encode(ch)),
            "0xae155db05708ef3bebd24e49343d0eac5a822031f655cfb3f9453a44633b470b"
        );

        let ih = compact_intent_hash(ch, filler);
        assert_eq!(
            format!("0x{}", hex::encode(ih)),
            "0x7b068e804240bea61c9a1dc4cf33215abb065cbe051779cf3c3851010f34952e"
        );
    }
}
