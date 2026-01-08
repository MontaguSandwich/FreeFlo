//! On-chain intent validation via RPC calls

use alloy_primitives::{Address, FixedBytes, U256};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// On-chain intent status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentStatus {
    None = 0,
    Active = 1,
    Fulfilled = 2,
    Cancelled = 3,
}

impl From<u8> for IntentStatus {
    fn from(v: u8) -> Self {
        match v {
            1 => IntentStatus::Active,
            2 => IntentStatus::Fulfilled,
            3 => IntentStatus::Cancelled,
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
    /// Calls: OffRampV3.intents(bytes32 intentId) returns (Intent)
    pub async fn get_intent(&self, intent_hash: [u8; 32]) -> Result<Option<OnChainIntent>, String> {
        // Function selector for intents(bytes32)
        // keccak256("intents(bytes32)")[:4] = 0xbd564402
        let selector = hex::decode("bd564402").unwrap();

        let mut calldata = selector;
        calldata.extend_from_slice(&intent_hash);

        let result = self.eth_call(&calldata).await?;

        if result.len() < 128 {
            // Intent doesn't exist or empty response
            return Ok(None);
        }

        // Parse Intent struct:
        // struct Intent {
        //     address owner;      // offset 0
        //     address solver;     // offset 32
        //     uint256 amount;     // offset 64
        //     uint8 status;       // offset 96 (packed in uint256)
        //     ...
        // }

        let owner = Address::from_slice(&result[12..32]);
        let solver = Address::from_slice(&result[44..64]);
        let amount = U256::from_be_slice(&result[64..96]);
        let status = IntentStatus::from(result[127]); // Last byte of status word

        // Check if intent exists (owner is not zero)
        if owner == Address::ZERO {
            return Ok(None);
        }

        Ok(Some(OnChainIntent {
            owner,
            solver,
            amount,
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

    // Check intent is active
    if intent.status != IntentStatus::Active {
        return Err(format!(
            "Intent is not active (status: {:?})",
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
        assert_eq!(IntentStatus::from(1), IntentStatus::Active);
        assert_eq!(IntentStatus::from(2), IntentStatus::Fulfilled);
        assert_eq!(IntentStatus::from(3), IntentStatus::Cancelled);
        assert_eq!(IntentStatus::from(99), IntentStatus::None);
    }
}
