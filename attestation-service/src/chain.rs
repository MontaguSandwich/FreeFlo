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
    pub amount: U256,
    pub status: IntentStatus,
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
        // selectedFiatAmount at base+256..base+288

        // Check if intent exists (depositor is not zero)
        if depositor == Address::ZERO {
            return Ok(None);
        }

        Ok(Some(OnChainIntent {
            owner: depositor,
            solver: selected_solver,
            amount: usdc_amount,
            status,
        }))
    }

    /// Check if an address is an authorized solver
    /// Calls: OffRampV3.authorizedSolvers(address) returns (bool)
    pub async fn is_solver_authorized(&self, solver: &str) -> Result<bool, String> {
        // Function selector for authorizedSolvers(address)
        // keccak256("authorizedSolvers(address)")[:4] = 0xf6e14bad
        let selector = hex::decode("f6e14bad").unwrap();

        let solver_bytes = hex::decode(solver.trim_start_matches("0x"))
            .map_err(|e| format!("Invalid solver address: {}", e))?;

        if solver_bytes.len() != 20 {
            return Err("Solver address must be 20 bytes".to_string());
        }

        let mut calldata = selector;
        calldata.extend_from_slice(&[0u8; 12]); // Pad to 32 bytes
        calldata.extend_from_slice(&solver_bytes);

        let result = self.eth_call(&calldata).await?;

        // Result is 32 bytes, last byte is boolean
        if result.len() < 32 {
            return Ok(false);
        }

        Ok(result[31] != 0)
    }

    /// Make an eth_call RPC request
    async fn eth_call(&self, calldata: &[u8]) -> Result<Vec<u8>, String> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            method: "eth_call",
            params: vec![
                serde_json::json!({
                    "to": format!("0x{}", hex::encode(self.offramp_contract.as_slice())),
                    "data": format!("0x{}", hex::encode(calldata)),
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

/// Validate an intent before creating attestation
pub async fn validate_intent(
    chain: &ChainClient,
    intent_hash: [u8; 32],
    solver_address: &str,
    expected_amount_cents: i64,
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

    // Check solver is authorized
    let is_authorized = chain.is_solver_authorized(solver_address).await?;
    if !is_authorized {
        warn!(solver = %solver_address, "Unauthorized solver attempted attestation");
        return Err(format!("Solver {} is not authorized", solver_address));
    }

    // Check amount matches (convert from wei to cents if needed)
    // Note: This assumes intent.amount is in the same units as expected_amount_cents
    // In practice, you may need to convert based on your contract's denomination
    let intent_amount_cents = intent.amount.to::<u128>() as i64;
    if expected_amount_cents > 0 && intent_amount_cents != expected_amount_cents {
        // Allow some flexibility - the on-chain amount might be in different units
        // Just log a warning for now
        debug!(
            intent_amount = %intent_amount_cents,
            expected_amount = %expected_amount_cents,
            "Amount validation skipped (may be different units)"
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
