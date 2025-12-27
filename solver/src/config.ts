import { config as loadEnv } from "dotenv";
import type { Address, Hex } from "viem";

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Chain
  rpcUrl: requireEnv("RPC_URL"),
  chainId: parseInt(optionalEnv("CHAIN_ID", "84532")), // Base Sepolia default

  // Contract
  offRampAddress: requireEnv("OFFRAMP_V2_ADDRESS") as Address,

  // Solver wallet
  solverPrivateKey: requireEnv("SOLVER_PRIVATE_KEY") as Hex,

  // Orchestrator settings
  orchestrator: {
    pollInterval: parseInt(optionalEnv("POLL_INTERVAL", "5000")),
    minUsdcAmount: BigInt(optionalEnv("MIN_USDC_AMOUNT", "1000000")), // 1 USDC
    maxUsdcAmount: BigInt(optionalEnv("MAX_USDC_AMOUNT", "10000000000")), // 10,000 USDC
  },

  // Database
  dbPath: optionalEnv("DB_PATH", "./solver.db"),

  // ==========================================================================
  // PROVIDER CONFIGURATIONS
  // ==========================================================================

  // Qonto - SEPA Instant (EUR)
  // https://docs.qonto.com/api-reference/business-api/
  qonto: {
    enabled: optionalEnv("QONTO_ENABLED", "false") === "true",
    // Auth method: "oauth" (recommended) or "api_key"
    authMethod: optionalEnv("QONTO_AUTH_METHOD", "oauth") as "api_key" | "oauth",
    // API Key auth
    apiKeyLogin: optionalEnv("QONTO_API_KEY_LOGIN", ""),
    apiKeySecret: optionalEnv("QONTO_API_KEY_SECRET", ""),
    // OAuth auth (recommended for transfers)
    accessToken: optionalEnv("QONTO_ACCESS_TOKEN", ""),
    refreshToken: optionalEnv("QONTO_REFRESH_TOKEN", ""),
    // OAuth client credentials (for automatic token refresh)
    clientId: optionalEnv("QONTO_CLIENT_ID", ""),
    clientSecret: optionalEnv("QONTO_CLIENT_SECRET", ""),
    // Common
    bankAccountId: optionalEnv("QONTO_BANK_ACCOUNT_ID", ""),
    useSandbox: optionalEnv("QONTO_USE_SANDBOX", "false") === "true",
    stagingToken: optionalEnv("QONTO_STAGING_TOKEN", ""),
    feeBps: parseInt(optionalEnv("QONTO_FEE_BPS", "50")), // 0.5% default
  },

  // -------------------------------------------------------------------------
  // ADD NEW PROVIDERS HERE
  // -------------------------------------------------------------------------
  // 
  // Example for a new provider:
  //
  // newProvider: {
  //   enabled: optionalEnv("NEW_PROVIDER_ENABLED", "false") === "true",
  //   apiKey: optionalEnv("NEW_PROVIDER_API_KEY", ""),
  //   // ...other config
  // },
  //
  // -------------------------------------------------------------------------

  // ==========================================================================
  // V3 CONTRACTS (with zkTLS verification)
  // ==========================================================================
  offRampV3Address: optionalEnv("OFFRAMP_V3_ADDRESS", "") as Address,
  paymentVerifierAddress: optionalEnv("PAYMENT_VERIFIER_ADDRESS", "") as Address,

  // ==========================================================================
  // ATTESTATION SERVICE (for zkTLS proof verification)
  // ==========================================================================
  attestation: {
    enabled: optionalEnv("ATTESTATION_ENABLED", "false") === "true",
    serviceUrl: optionalEnv("ATTESTATION_SERVICE_URL", "http://localhost:4001"),
    timeout: parseInt(optionalEnv("ATTESTATION_TIMEOUT", "30000")),
  },

  // ==========================================================================
  // TLSNOTARY PROVER (for automatic proof generation)
  // ==========================================================================
  prover: {
    enabled: optionalEnv("PROVER_ENABLED", "false") === "true",
    tlsnExamplesPath: optionalEnv("TLSN_EXAMPLES_PATH", ""),
    proofStoragePath: optionalEnv("PROOF_STORAGE_PATH", "./proofs"),
    timeout: parseInt(optionalEnv("PROVER_TIMEOUT", "180000")), // 3 minutes (first run needs compilation)
    // API key credentials for TLSNotary (reads from Qonto API)
    qontoApiKeyLogin: optionalEnv("QONTO_API_KEY_LOGIN", ""),
    qontoApiKeySecret: optionalEnv("QONTO_API_KEY_SECRET", ""),
    qontoBankAccountSlug: optionalEnv("QONTO_BANK_ACCOUNT_SLUG", ""),
  },
};

export type Config = typeof config;



