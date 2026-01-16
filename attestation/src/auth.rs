//! API key authentication for solvers

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// Solver authentication and rate limiting
pub struct SolverAuth {
    /// Map of API key -> solver address
    api_keys: HashMap<String, String>,
    /// Rate limit requests per minute
    rate_limit: u32,
    /// Request counters: solver_address -> (count, window_start)
    rate_counters: RwLock<HashMap<String, (u32, Instant)>>,
}

impl SolverAuth {
    /// Create from environment variable
    /// Format: "key1:0xAddr1,key2:0xAddr2"
    pub fn from_env() -> Self {
        let api_keys_str = std::env::var("SOLVER_API_KEYS").unwrap_or_default();
        let rate_limit = std::env::var("RATE_LIMIT_PER_MINUTE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(100);

        let mut api_keys = HashMap::new();

        for pair in api_keys_str.split(',') {
            let pair = pair.trim();
            if pair.is_empty() {
                continue;
            }

            let parts: Vec<&str> = pair.split(':').collect();
            if parts.len() == 2 {
                let key = parts[0].trim().to_string();
                let addr = parts[1].trim().to_lowercase();
                api_keys.insert(key, addr);
            }
        }

        Self {
            api_keys,
            rate_limit,
            rate_counters: RwLock::new(HashMap::new()),
        }
    }

    /// Check if API key is valid and return solver address
    pub fn validate_api_key(&self, api_key: &str) -> Option<String> {
        self.api_keys.get(api_key).cloned()
    }

    /// Check rate limit for a solver, returns Ok if allowed, Err with retry_after seconds if limited
    pub fn check_rate_limit(&self, solver_address: &str) -> Result<(), u64> {
        let now = Instant::now();
        let window = Duration::from_secs(60);

        let mut counters = self.rate_counters.write().unwrap();

        let entry = counters.entry(solver_address.to_string()).or_insert((0, now));

        // Reset counter if window has passed
        if now.duration_since(entry.1) >= window {
            entry.0 = 0;
            entry.1 = now;
        }

        // Check if rate limited
        if entry.0 >= self.rate_limit {
            let elapsed = now.duration_since(entry.1);
            let retry_after = window.saturating_sub(elapsed).as_secs() + 1;
            return Err(retry_after);
        }

        // Increment counter
        entry.0 += 1;
        Ok(())
    }

    /// Get number of registered solvers
    pub fn solver_count(&self) -> usize {
        self.api_keys.len()
    }

    /// Check if authentication is enabled (any API keys configured)
    pub fn is_enabled(&self) -> bool {
        !self.api_keys.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_api_keys() {
        std::env::set_var("SOLVER_API_KEYS", "key1:0xABC,key2:0xDEF");
        let auth = SolverAuth::from_env();

        assert_eq!(auth.validate_api_key("key1"), Some("0xabc".to_string()));
        assert_eq!(auth.validate_api_key("key2"), Some("0xdef".to_string()));
        assert_eq!(auth.validate_api_key("key3"), None);

        std::env::remove_var("SOLVER_API_KEYS");
    }

    #[test]
    fn test_rate_limiting() {
        std::env::set_var("RATE_LIMIT_PER_MINUTE", "5");
        std::env::remove_var("SOLVER_API_KEYS");
        let auth = SolverAuth::from_env();

        // First 5 requests should succeed
        for _ in 0..5 {
            assert!(auth.check_rate_limit("0xtest").is_ok());
        }

        // 6th request should be rate limited
        assert!(auth.check_rate_limit("0xtest").is_err());

        std::env::remove_var("RATE_LIMIT_PER_MINUTE");
    }
}
