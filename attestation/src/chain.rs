//! On-chain intent validation via RPC calls

use alloy_primitives::{Address, FixedBytes, U256};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// On-chain intent status (matches OffRampV3.IntentStatus)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentStatus {
    None = 0,
    PendingQuote = 1,
    Committed = 2,     // User committed to a quote, solver should fulfill
    Fulfilled = 3,
    Cancelled = 4,
    Expired = 5,
}

impl From<u8> for IntentStatus {
    fn from(v: u8) -> Self {
        match v {
            1 => IntentStatus::PendingQuote,
            2 => IntentStatus::Committed,
            3 => IntentStatus::Fulfilled,
            4 => IntentStatus::Cancelled,
            5 => IntentStatus::Expired,
            _ => IntentStatus::None,
        }
    }
}

/// Intent data from on-chain
#[derive(Debug, Clone)]
pub struct OnChainIntent {
    pub owner: Address,
    pub solver: Address,
    pub usdc_amount: U256,
    /// The fiat amount the solver committed to pay (2 decimals, in cents)
    pub selected_fiat_amount: U256,
    pub status: IntentStatus,
    /// Recipient bank details (IBAN), decoded from the on-chain Intent's dynamic
    /// `receivingInfo` string. This is the authoritative payee a proof must match.
    pub receiving_info: String,
}

/// Chain client for RPC calls
pub struct ChainClient {
    rpc_url: String,
    offramp_contract: Address,
    http_client: reqwest::Client,
}

#[derive(Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    method: &'static str,
    params: Vec<serde_json::Value>,
    id: u64,
}

#[derive(Deserialize)]
struct JsonRpcResponse {
    result: Option<String>,
    error: Option<serde_json::Value>,
}

impl ChainClient {
    pub fn new(rpc_url: String, offramp_contract: Address) -> Self {
        Self {
            rpc_url,
            offramp_contract,
            http_client: reqwest::Client::new(),
        }
    }

    /// Create from environment variables
    pub fn from_env() -> Option<Self> {
        let rpc_url = std::env::var("RPC_URL").ok()?;
        let offramp_hex = std::env::var("OFFRAMP_CONTRACT").ok()?;

        let offramp_bytes = hex::decode(offramp_hex.trim_start_matches("0x")).ok()?;
        if offramp_bytes.len() != 20 {
            return None;
        }

        let offramp_contract = Address::from_slice(&offramp_bytes);

        Some(Self::new(rpc_url, offramp_contract))
    }

    /// Get intent from on-chain
    /// Calls: OffRampV3.getIntent(bytes32 intentId) returns (Intent)
    pub async fn get_intent(&self, intent_hash: [u8; 32]) -> Result<Option<OnChainIntent>, String> {
        // Function selector for getIntent(bytes32)
        // keccak256("getIntent(bytes32)")[:4] = 0xf13c46aa
        let selector = hex::decode("f13c46aa").unwrap();

        let mut calldata = selector;
        calldata.extend_from_slice(&intent_hash);

        let result = self.eth_call(&calldata).await?;

        // Response is a dynamic tuple with offset pointer at start
        // Minimum size: 32 (offset) + 256 (first 8 fields) = 288 bytes
        if result.len() < 288 {
            // Intent doesn't exist or empty response
            return Ok(None);
        }

        // Parse Intent struct (getIntent returns full struct as dynamic tuple):
        // First 32 bytes are offset pointer (0x20), actual data starts at byte 32
        // struct Intent {
        //     address depositor;        // offset 32+0  = 32
        //     uint256 usdcAmount;       // offset 32+32 = 64
        //     Currency currency;        // offset 32+64 = 96  (uint8 padded to 32)
        //     IntentStatus status;      // offset 32+96 = 128 (uint8 padded to 32)
        //     uint64 createdAt;         // offset 32+128 = 160
        //     uint64 committedAt;       // offset 32+160 = 192
        //     address selectedSolver;   // offset 32+192 = 224
        //     RTPN selectedRtpn;        // offset 32+224 = 256 (uint8 padded to 32)
        //     uint256 selectedFiatAmount; // offset 32+256 = 288
        //     ...
        // }

        let base = 32; // Skip offset pointer

        let depositor = Address::from_slice(&result[base + 12..base + 32]);
        let usdc_amount = U256::from_be_slice(&result[base + 32..base + 64]);
        // currency at base+64..base+96 (not needed for validation)
        let status = IntentStatus::from(result[base + 96 + 31]); // Last byte of status word
        // createdAt at base+128..base+160
        // committedAt at base+160..base+192
        let selected_solver = Address::from_slice(&result[base + 192 + 12..base + 224]);
        // selectedRtpn at base+224..base+256 (not needed for validation)
        // selectedFiatAmount at base+256..base+288 (this is in cents, 2 decimals)
        let selected_fiat_amount = if result.len() >= base + 288 {
            U256::from_be_slice(&result[base + 256..base + 288])
        } else {
            U256::ZERO
        };

        // Check if intent exists (depositor is not zero)
        if depositor == Address::ZERO {
            return Ok(None);
        }

        // Decode the dynamic `receivingInfo` string (Intent field index 9).
        let receiving_info = decode_dynamic_string(&result, base, 9).unwrap_or_default();

        Ok(Some(OnChainIntent {
            owner: depositor,
            solver: selected_solver,
            usdc_amount,
            selected_fiat_amount,
            status,
            receiving_info,
        }))
    }

    /// Make an eth_call RPC request
    async fn eth_call(&self, calldata: &[u8]) -> Result<Vec<u8>, String> {
        let to_addr = format!("0x{}", hex::encode(self.offramp_contract.as_slice()));
        let data_hex = format!("0x{}", hex::encode(calldata));

        debug!(
            to = %to_addr,
            data = %data_hex,
            rpc_url = %self.rpc_url,
            "Making eth_call"
        );

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            method: "eth_call",
            params: vec![
                serde_json::json!({
                    "to": to_addr,
                    "data": data_hex,
                }),
                serde_json::json!("latest"),
            ],
            id: 1,
        };

        let response = self
            .http_client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("RPC request failed: {}", e))?;

        let json_response: JsonRpcResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse RPC response: {}", e))?;

        if let Some(error) = json_response.error {
            return Err(format!("RPC error: {:?}", error));
        }

        let result_hex = json_response.result.unwrap_or_default();
        let result_hex = result_hex.trim_start_matches("0x");

        if result_hex.is_empty() {
            return Ok(vec![]);
        }

        hex::decode(result_hex).map_err(|e| format!("Failed to decode result: {}", e))
    }
}

/// Decode a dynamic `string` field from an ABI-encoded struct tuple.
/// `base` is where the tuple head begins; `field_index` is the string's position.
fn decode_dynamic_string(data: &[u8], base: usize, field_index: usize) -> Option<String> {
    let head = base + field_index * 32;
    if data.len() < head + 32 {
        return None;
    }
    let offset = U256::from_be_slice(&data[head..head + 32]).to::<u128>() as usize;
    let len_pos = base + offset;
    if data.len() < len_pos + 32 {
        return None;
    }
    let len = U256::from_be_slice(&data[len_pos..len_pos + 32]).to::<u128>() as usize;
    let start = len_pos + 32;
    if data.len() < start + len {
        return None;
    }
    String::from_utf8(data[start..start + len].to_vec()).ok()
}

/// Normalize an IBAN for comparison: strip whitespace and uppercase.
fn normalize_iban(iban: &str) -> String {
    iban.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase()
}

/// Validate an intent before creating attestation
pub async fn validate_intent(
    chain: &ChainClient,
    intent_hash: [u8; 32],
    solver_address: &str,
    proven_amount_cents: i64,
    proven_iban: &str,
) -> Result<(), String> {
    debug!(
        intent_hash = %hex::encode(intent_hash),
        solver = %solver_address,
        "Validating intent on-chain"
    );

    // Get intent from chain
    let intent = chain
        .get_intent(intent_hash)
        .await?
        .ok_or_else(|| "Intent does not exist on-chain".to_string())?;

    // Check intent is in COMMITTED status (ready for fulfillment)
    if intent.status != IntentStatus::Committed {
        return Err(format!(
            "Intent is not ready for fulfillment (status: {:?})",
            intent.status
        ));
    }

    // Check solver matches (if intent has assigned solver)
    if intent.solver != Address::ZERO {
        let solver_bytes = hex::decode(solver_address.trim_start_matches("0x"))
            .map_err(|e| format!("Invalid solver address: {}", e))?;
        let solver_addr = Address::from_slice(&solver_bytes);

        if intent.solver != solver_addr {
            return Err(format!(
                "Solver mismatch: intent assigned to {}, request from {}",
                intent.solver, solver_address
            ));
        }
    }

    // Bind the PROVEN beneficiary IBAN to the user's on-chain recipient. The
    // solver does not get to assert the payee; the chain does.
    if normalize_iban(proven_iban) != normalize_iban(&intent.receiving_info) {
        return Err(format!(
            "Beneficiary mismatch: proof paid IBAN '{}', on-chain recipient is '{}'",
            proven_iban, intent.receiving_info
        ));
    }

    // Note: OffRampV3 is permissionless - no authorizedSolvers mapping
    // The selectedSolver check above is sufficient to verify the solver
    // is authorized to fulfill this specific intent

    // Validate fiat amount: the proof amount must be >= the committed fiat amount
    // Both values are in cents (2 decimals)
    let committed_fiat_cents = intent.selected_fiat_amount.to::<u128>() as i64;

    if proven_amount_cents > 0 && committed_fiat_cents > 0 {
        if proven_amount_cents < committed_fiat_cents {
            return Err(format!(
                "Amount mismatch: proof shows {} cents paid, but solver committed to {} cents on-chain",
                proven_amount_cents, committed_fiat_cents
            ));
        }

        debug!(
            proof_amount_cents = %proven_amount_cents,
            committed_fiat_cents = %committed_fiat_cents,
            "Fiat amount validated: proof >= committed"
        );
    } else if committed_fiat_cents == 0 {
        // Intent may not have a selected quote yet, or legacy data
        warn!(
            "No committed fiat amount on-chain (selectedFiatAmount=0), skipping amount validation"
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_iban() {
        assert_eq!(
            normalize_iban("de89 3704 0044 0532 0130 00"),
            "DE89370400440532013000"
        );
        assert_eq!(normalize_iban("  fr76 1234  "), "FR761234");
    }

    #[test]
    fn test_decode_dynamic_string() {
        // Minimal ABI tuple: outer offset word, then base=32 with a 1-word head
        // whose only field (index 0) is a dynamic string.
        let s = b"GB33BUKB20201555555555";
        let mut data = vec![0u8; 32]; // outer offset pointer
        let base = data.len();
        let str_offset = 32usize; // tail starts right after the 1-word head
        let mut head = [0u8; 32];
        head[24..32].copy_from_slice(&(str_offset as u64).to_be_bytes());
        data.extend_from_slice(&head);
        let mut len_word = [0u8; 32];
        len_word[24..32].copy_from_slice(&(s.len() as u64).to_be_bytes());
        data.extend_from_slice(&len_word);
        let mut padded = s.to_vec();
        padded.resize(((s.len() + 31) / 32) * 32, 0);
        data.extend_from_slice(&padded);

        assert_eq!(
            decode_dynamic_string(&data, base, 0).as_deref(),
            Some("GB33BUKB20201555555555")
        );
        // Truncated input → None, not a panic.
        assert_eq!(decode_dynamic_string(&data[..base + 10], base, 0), None);
    }

    #[test]
    fn test_intent_status_from() {
        assert_eq!(IntentStatus::from(0), IntentStatus::None);
        assert_eq!(IntentStatus::from(1), IntentStatus::PendingQuote);
        assert_eq!(IntentStatus::from(2), IntentStatus::Committed);
        assert_eq!(IntentStatus::from(3), IntentStatus::Fulfilled);
        assert_eq!(IntentStatus::from(4), IntentStatus::Cancelled);
        assert_eq!(IntentStatus::from(5), IntentStatus::Expired);
        assert_eq!(IntentStatus::from(99), IntentStatus::None);
    }
}
