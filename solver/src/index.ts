import { config } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { IntentDatabase } from "./db/intents.js";
import { ChainClient } from "./chain/client.js";
import { SolverOrchestrator } from "./orchestrator.js";
import { registry, createQontoProvider } from "./providers/index.js";
import { startHealthServer, updateHealthCheck } from "./health.js";

const log = createLogger("main");

// Solver address - set after chain client init
let solverAddress: string;

// =============================================================================
// PROVIDER REGISTRATION
// =============================================================================

function registerProviders(): void {
  // -------------------------------------------------------------------------
  // QONTO - SEPA Instant (EUR)
  // -------------------------------------------------------------------------
  if (config.qonto.enabled) {
    log.info({ authMethod: config.qonto.authMethod }, "Registering Qonto provider (SEPA Instant)");
    
    try {
      const qontoProvider = createQontoProvider({
        // Auth method
        QONTO_AUTH_METHOD: config.qonto.authMethod,
        // API Key auth
        QONTO_API_KEY_LOGIN: config.qonto.apiKeyLogin,
        QONTO_API_KEY_SECRET: config.qonto.apiKeySecret,
        // OAuth auth
        QONTO_ACCESS_TOKEN: config.qonto.accessToken,
        QONTO_REFRESH_TOKEN: config.qonto.refreshToken,
        QONTO_CLIENT_ID: config.qonto.clientId,
        QONTO_CLIENT_SECRET: config.qonto.clientSecret,
        // Common
        QONTO_BANK_ACCOUNT_ID: config.qonto.bankAccountId,
        QONTO_USE_SANDBOX: config.qonto.useSandbox ? "true" : "false",
        QONTO_STAGING_TOKEN: config.qonto.stagingToken,
        QONTO_FEE_BPS: config.qonto.feeBps?.toString(),
      }, solverAddress);
      
      registry.register(qontoProvider);
      log.info("✅ Qonto provider registered successfully");
    } catch (error) {
      log.error({ error }, "Failed to initialize Qonto provider");
    }
  }

  // -------------------------------------------------------------------------
  // ADD NEW PROVIDERS HERE
  // -------------------------------------------------------------------------
  // 
  // Example for a new provider:
  //
  // if (config.newProvider?.enabled) {
  //   const provider = createNewProvider(config.newProvider, solverAddress);
  //   registry.register(provider);
  // }
  //
  // -------------------------------------------------------------------------

  const stats = registry.getStats();
  
  if (stats.totalProviders === 0) {
    log.warn("⚠️  No providers registered!");
    log.warn("   The solver will watch for intents but cannot submit quotes.");
    log.warn("   Add a provider implementation to enable quoting.");
    updateHealthCheck("providers", "warning", "No providers registered");
  } else {
    log.info(stats, "Provider registry initialized");
    updateHealthCheck("providers", "ok");
  }
}

async function main() {
  log.info("OffRamp V2 Solver starting...");
  log.info({ 
    chainId: config.chainId,
    contract: config.offRampAddress,
  }, "Configuration loaded");

  // Start health check server
  const healthPort = parseInt(process.env.HEALTH_PORT || "8080");
  const healthServer = startHealthServer(healthPort);

  // Initialize database
  const db = new IntentDatabase(config.dbPath);
  updateHealthCheck("database", "ok");

  // Initialize chain client
  const chain = new ChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    contractAddress: config.offRampAddress,
    solverPrivateKey: config.solverPrivateKey,
  });

  // Set solver address for provider registration
  solverAddress = chain.solverAddress;
  log.info({ solverAddress }, "Solver wallet initialized");

  // Register providers (modular - add new ones in registerProviders())
  registerProviders();

  // Create orchestrator
  const orchestrator = new SolverOrchestrator(
    db,
    chain,
    registry,
    {
      pollInterval: config.orchestrator.pollInterval,
      minUsdcAmount: config.orchestrator.minUsdcAmount,
      maxUsdcAmount: config.orchestrator.maxUsdcAmount,
    }
  );

  // Handle shutdown
  process.on("SIGINT", () => {
    log.info("Received SIGINT, shutting down...");
    orchestrator.stop();
    healthServer.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Received SIGTERM, shutting down...");
    orchestrator.stop();
    healthServer.close();
    process.exit(0);
  });

  // Start orchestrator
  try {
    await orchestrator.start();
  } catch (error) {
    log.error({ error }, "Fatal error");
    process.exit(1);
  }
}

main();



