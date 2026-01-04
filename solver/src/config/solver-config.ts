/**
 * Solver Configuration Schema & Loader
 *
 * Allows solvers to customize operational parameters via a solver-config.json file.
 * This separates sensitive values (env vars) from operational tuning (JSON file).
 *
 * Usage:
 *   1. Copy solver-config.example.json to solver-config.json
 *   2. Customize values as needed
 *   3. Restart the solver - config loads at startup
 *
 * Priority: solver-config.json values override env var defaults.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("solver-config");

// ============ Schema Types ============

export interface SolverLimitsConfig {
  /** Minimum USDC amount to quote (in base units, 6 decimals). Default: 1_000_000 (1 USDC) */
  minUsdcAmount: number;
  /** Maximum USDC amount to quote (in base units, 6 decimals). Default: 10_000_000_000 (10,000 USDC) */
  maxUsdcAmount: number;
  /** Maximum daily volume in USDC (in base units, 6 decimals). Default: 50_000_000_000 (50,000 USDC) */
  maxDailyVolume?: number;
}

export interface SolverPricingConfig {
  /** Fee in basis points (e.g., 50 = 0.5%). Default: 50 */
  feeBps: number;
  /** Minimum fee in USDC cents (optional floor). Default: undefined */
  minFeeCents?: number;
}

export interface SolverSupportedConfig {
  /** Supported fiat currencies. Default: ["EUR"] */
  currencies: string[];
  /** Supported real-time payment networks. Default: ["SEPA_INSTANT"] */
  rtpns: string[];
}

export interface SolverConfigSchema {
  limits: SolverLimitsConfig;
  pricing: SolverPricingConfig;
  supported: SolverSupportedConfig;
}

// ============ Default Configuration ============

export const DEFAULT_SOLVER_CONFIG: SolverConfigSchema = {
  limits: {
    minUsdcAmount: 1_000_000, // 1 USDC (6 decimals)
    maxUsdcAmount: 10_000_000_000, // 10,000 USDC
    maxDailyVolume: 50_000_000_000, // 50,000 USDC
  },
  pricing: {
    feeBps: 50, // 0.5%
  },
  supported: {
    currencies: ["EUR"],
    rtpns: ["SEPA_INSTANT"],
  },
};

// ============ Config Loader ============

/**
 * Attempts to load solver-config.json from multiple locations:
 *   1. CWD/solver-config.json
 *   2. solver/solver-config.json (if running from project root)
 *   3. ../solver-config.json (if running from solver/src)
 *
 * If file doesn't exist, returns default config (not an error).
 * If file exists but is invalid JSON, logs error and returns defaults.
 */
export function loadSolverConfig(): SolverConfigSchema {
  const candidatePaths = [
    path.join(process.cwd(), "solver-config.json"),
    path.join(process.cwd(), "solver", "solver-config.json"),
    path.join(__dirname, "..", "..", "solver-config.json"),
  ];

  let configPath: string | null = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    log.info("No solver-config.json found, using default configuration");
    logConfigSummary(DEFAULT_SOLVER_CONFIG);
    return DEFAULT_SOLVER_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<SolverConfigSchema>;

    // Deep merge with defaults
    const merged: SolverConfigSchema = {
      limits: {
        ...DEFAULT_SOLVER_CONFIG.limits,
        ...(parsed.limits || {}),
      },
      pricing: {
        ...DEFAULT_SOLVER_CONFIG.pricing,
        ...(parsed.pricing || {}),
      },
      supported: {
        ...DEFAULT_SOLVER_CONFIG.supported,
        ...(parsed.supported || {}),
      },
    };

    // Validate critical values
    if (merged.limits.minUsdcAmount < 0) {
      log.warn("minUsdcAmount cannot be negative, using default");
      merged.limits.minUsdcAmount = DEFAULT_SOLVER_CONFIG.limits.minUsdcAmount;
    }
    if (merged.limits.maxUsdcAmount < merged.limits.minUsdcAmount) {
      log.warn("maxUsdcAmount must be >= minUsdcAmount, using default");
      merged.limits.maxUsdcAmount = DEFAULT_SOLVER_CONFIG.limits.maxUsdcAmount;
    }
    if (merged.pricing.feeBps < 0 || merged.pricing.feeBps > 10000) {
      log.warn("feeBps must be 0-10000, using default");
      merged.pricing.feeBps = DEFAULT_SOLVER_CONFIG.pricing.feeBps;
    }

    log.info({ path: configPath }, "Loaded solver-config.json");
    logConfigSummary(merged);

    return merged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ path: configPath, error: message }, "Failed to parse solver-config.json, using defaults");
    logConfigSummary(DEFAULT_SOLVER_CONFIG);
    return DEFAULT_SOLVER_CONFIG;
  }
}

/**
 * Logs a summary of the loaded configuration for visibility
 */
function logConfigSummary(cfg: SolverConfigSchema): void {
  const minUsdc = (cfg.limits.minUsdcAmount / 1_000_000).toFixed(2);
  const maxUsdc = (cfg.limits.maxUsdcAmount / 1_000_000).toFixed(2);
  const dailyVolume = cfg.limits.maxDailyVolume
    ? (cfg.limits.maxDailyVolume / 1_000_000).toFixed(2)
    : "unlimited";

  log.info(
    {
      limits: {
        minUsdc: "$" + minUsdc,
        maxUsdc: "$" + maxUsdc,
        dailyVolume: dailyVolume === "unlimited" ? dailyVolume : "$" + dailyVolume,
      },
      pricing: {
        feeBps: cfg.pricing.feeBps,
        feePercent: (cfg.pricing.feeBps / 100).toFixed(2) + "%",
        minFeeCents: cfg.pricing.minFeeCents,
      },
      supported: {
        currencies: cfg.supported.currencies,
        rtpns: cfg.supported.rtpns,
      },
    },
    "Solver configuration loaded"
  );
}

// ============ Singleton Instance ============

let _solverConfig: SolverConfigSchema | null = null;

/**
 * Gets the solver configuration, loading it on first access.
 * Subsequent calls return the cached config.
 */
export function getSolverConfig(): SolverConfigSchema {
  if (!_solverConfig) {
    _solverConfig = loadSolverConfig();
  }
  return _solverConfig;
}

/**
 * Reloads the solver configuration from disk.
 * Useful for hot-reloading config changes (if implemented).
 */
export function reloadSolverConfig(): SolverConfigSchema {
  _solverConfig = loadSolverConfig();
  return _solverConfig;
}
