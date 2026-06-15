import { config as loadEnv } from "dotenv";
import type { Address, Hex } from "viem";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load env file with override: true to prevent inherited shell env var contamination
// (critical for dual-deployment where testnet/mainnet pm2 instances share a shell)
// Set ENV_FILE=.env.testnet to load testnet config instead of default .env
const envFile = process.env.ENV_FILE || ".env";
loadEnv({ path: envFile, override: true });

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

/**
 * Default TLSNotary prover adapter dir, used only when TLSN_EXAMPLES_PATH is unset.
 * Walks up from this module looking for providers/prover/adapters/qonto so it resolves
 * whether the solver runs from src (tsx) or dist (compiled). Replaces the old hardcoded
 * /opt VPS default, which on any other machine failed late as "spawn cargo ENOENT".
 */
function defaultTlsnExamplesPath(): string {
  const rel = "providers/prover/adapters/qonto";
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), rel);
}

export const config = {
  // Chain
  rpcUrl: requireEnv("RPC_URL"),
  chainId: parseInt(requireEnv("CHAIN_ID")), // 8453 (Base) or 84532 (Base Sepolia)

  // Contract (V2 - legacy, optional for V3-only deployments)
  offRampAddress: optionalEnv("OFFRAMP_V2_ADDRESS", "") as Address,

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

  // FiatToFiatRouter — when set, the solver acts as a gasless relayer: after quoting
  // a router-originated intent it calls commitFor(user), collapsing fiat->fiat 3->2.
  // Unset = no relayer behavior (the user commits via the frontend, as before).
  fiatToFiatRouterAddress: optionalEnv("FIAT_TO_FIAT_ROUTER_ADDRESS", "") as Address,

  // Compact (TIER-1 sign-once offramp) — when BOTH are set, the solver exposes the
  // POST /api/compact/fill endpoint and can fill user-signed Compact orders (send SEPA,
  // attest, arbiter.fill). Unset = the Compact path is disabled (additive; existing
  // intent watching/fulfillment is unaffected). Cast undefined when unset.
  compactArbiterAddress: (process.env.COMPACT_ARBITER_ADDRESS || undefined) as Address | undefined,
  compactAllocatorAddress: (process.env.FREEFLO_ALLOCATOR_ADDRESS || undefined) as Address | undefined,

  // Allocator signing key. The FreeFloAllocator authorizes each claim with an off-chain ECDSA sig;
  // when ALLOCATOR_SIGNER_KEY is set the solver signs allocatorData with THIS key instead of the
  // solver fill key, separating allocator authority from the filler/relayer wallet. Unset = fall back
  // to SOLVER_PRIVATE_KEY (matches the live allocator 0x2C87, whose signer IS the solver key). NOTE:
  // splitting the on-chain authority requires deploying a NEW FreeFloAllocator with this key's address
  // as ALLOCATOR_SIGNER and re-wiring the lock id — this is only the client-side plumbing.
  compactAllocatorSignerKey: (process.env.ALLOCATOR_SIGNER_KEY || undefined) as Hex | undefined,

  // Inbound hardening for the open Compact fill endpoint. The pre-fiat gate already prevents fund
  // loss (a fake/unfunded order reverts before any SEPA), so this is a RESOURCE-abuse guard: stop
  // anonymous spam from burning fill gas / Qonto idempotency slots / memory.
  //  - apiKey: when set, POST /api/compact/fill + GET /api/compact/status require a matching
  //    `X-Solver-API-Key` header. The Next /api/compact-fill proxy injects it server-side so the
  //    browser never holds it. Unset = no auth (local dev) + a boot warning when the Compact path is on.
  //  - rate*/maxInflight: per-IP fixed-window limit on fills + a hard cap on concurrent orders.
  compactFill: {
    apiKey: optionalEnv("COMPACT_FILL_API_KEY", ""),
    rateWindowMs: parseInt(optionalEnv("COMPACT_FILL_RATE_WINDOW_MS", "60000")),
    rateMax: parseInt(optionalEnv("COMPACT_FILL_RATE_MAX", "5")),
    maxInflight: parseInt(optionalEnv("COMPACT_FILL_MAX_INFLIGHT", "50")),
  },

  // ==========================================================================
  // ATTESTATION SERVICE (for zkTLS proof verification)
  // ==========================================================================
  attestation: {
    enabled: optionalEnv("ATTESTATION_ENABLED", "false") === "true",
    serviceUrl: optionalEnv("ATTESTATION_SERVICE_URL", "http://localhost:4001"),
    timeout: parseInt(optionalEnv("ATTESTATION_TIMEOUT", "30000")),
    // API key for authenticating with FreeFlo's attestation service
    apiKey: optionalEnv("ATTESTATION_API_KEY", ""),
  },

  // ==========================================================================
  // TLSNOTARY PROVER (for automatic proof generation)
  // ==========================================================================
  prover: {
    enabled: optionalEnv("PROVER_ENABLED", "false") === "true",
    tlsnExamplesPath: optionalEnv("TLSN_EXAMPLES_PATH", "") || defaultTlsnExamplesPath(),
    proofStoragePath: optionalEnv("PROOF_STORAGE_PATH", "./proofs"),
    timeout: parseInt(optionalEnv("PROVER_TIMEOUT", "180000")), // 3 minutes (first run needs compilation)
    // API key credentials for TLSNotary (reads from Qonto API)
    qontoApiKeyLogin: optionalEnv("QONTO_API_KEY_LOGIN", ""),
    qontoApiKeySecret: optionalEnv("QONTO_API_KEY_SECRET", ""),
    qontoBankAccountSlug: optionalEnv("QONTO_BANK_ACCOUNT_SLUG", ""),
  },
};

export type Config = typeof config;



