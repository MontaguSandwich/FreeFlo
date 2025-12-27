/**
 * V3 Solver Entry Point
 * 
 * Uses OffRampV3 contracts with zkTLS payment verification.
 * Run with: npm run start:v3
 */

import { config } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { IntentDatabase } from "./db/intents.js";
import { ChainClientV3 } from "./chain/client-v3.js";
import { SolverOrchestratorV3 } from "./orchestrator-v3.js";
import { registry, createQontoProvider } from "./providers/index.js";
import { startHealthServer, updateHealthCheck } from "./health.js";
import { createAttestationClient } from "./attestation/client.js";
import { createQuoteApiServer } from "./api/quote-api.js";

const log = createLogger("main-v3");

let solverAddress: string;

function registerProviders(): void {
  if (config.qonto.enabled) {
    log.info({ authMethod: config.qonto.authMethod }, "Registering Qonto provider (SEPA Instant)");
    
    try {
      const qontoProvider = createQontoProvider({
        QONTO_AUTH_METHOD: config.qonto.authMethod,
        QONTO_API_KEY_LOGIN: config.qonto.apiKeyLogin,
        QONTO_API_KEY_SECRET: config.qonto.apiKeySecret,
        QONTO_ACCESS_TOKEN: config.qonto.accessToken,
        QONTO_REFRESH_TOKEN: config.qonto.refreshToken,
        QONTO_CLIENT_ID: config.qonto.clientId,
        QONTO_CLIENT_SECRET: config.qonto.clientSecret,
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

  const stats = registry.getStats();
  
  if (stats.totalProviders === 0) {
    log.warn("⚠️  No providers registered!");
    log.warn("   The solver will watch for intents but cannot submit quotes.");
    updateHealthCheck("providers", "warning", "No providers registered");
  } else {
    log.info(stats, "Provider registry initialized");
    updateHealthCheck("providers", "ok");
  }
}

async function main() {
  log.info("======================================");
  log.info("  OffRamp V3 Solver (zkTLS Enabled)  ");
  log.info("======================================");
  
  // Validate V3 config
  if (!config.offRampV3Address) {
    log.error("OFFRAMP_V3_ADDRESS not set! Please configure V3 contract address.");
    process.exit(1);
  }
  if (!config.paymentVerifierAddress) {
    log.error("PAYMENT_VERIFIER_ADDRESS not set! Please configure verifier address.");
    process.exit(1);
  }
  
  log.info({ 
    chainId: config.chainId,
    offRampV3: config.offRampV3Address,
    paymentVerifier: config.paymentVerifierAddress,
    attestationService: config.attestation.serviceUrl,
  }, "V3 Configuration loaded");

  // Start health check server
  const healthPort = parseInt(process.env.HEALTH_PORT || "8080");
  const healthServer = startHealthServer(healthPort);

  // Start quote API server (for frontend to get quotes before intent creation)
  const quoteApiPort = parseInt(process.env.QUOTE_API_PORT || "8081");
  let quoteApiServer: ReturnType<typeof createQuoteApiServer> | null = null;

  // Initialize database (use separate DB for V3)
  const dbPath = config.dbPath.replace(".db", "-v3.db");
  const db = new IntentDatabase(dbPath);
  updateHealthCheck("database", "ok");

  // Initialize V3 chain client
  const chain = new ChainClientV3({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    offRampAddress: config.offRampV3Address,
    verifierAddress: config.paymentVerifierAddress,
    solverPrivateKey: config.solverPrivateKey,
  });

  solverAddress = chain.solverAddress;
  log.info({ solverAddress }, "Solver wallet initialized");

  // Initialize attestation client
  const attestation = createAttestationClient(config.attestation.serviceUrl);
  log.info({ url: config.attestation.serviceUrl }, "Attestation client initialized");

  // Register providers
  registerProviders();

  // Start quote API server now that providers are registered
  quoteApiServer = createQuoteApiServer(registry, solverAddress, "ZKP2P Solver");
  quoteApiServer.listen(quoteApiPort, () => {
    log.info({ port: quoteApiPort }, "Quote API server started");
  });

  // Create prover config if enabled
  const proverConfig = config.prover.enabled && config.prover.tlsnExamplesPath ? {
    tlsnExamplesPath: config.prover.tlsnExamplesPath,
    proofStoragePath: config.prover.proofStoragePath,
    // Use prover-specific API key credentials (not OAuth)
    qontoApiKeyLogin: config.prover.qontoApiKeyLogin || config.qonto.apiKeyLogin,
    qontoApiKeySecret: config.prover.qontoApiKeySecret || config.qonto.apiKeySecret,
    qontoBankAccountSlug: config.prover.qontoBankAccountSlug,
    timeout: config.prover.timeout,
  } : undefined;

  if (proverConfig) {
    log.info({ tlsnPath: proverConfig.tlsnExamplesPath }, "Automatic TLSNotary proof generation enabled");
  } else {
    log.info("Manual TLSNotary proof generation mode (set PROVER_ENABLED=true to automate)");
  }

  // Create V3 orchestrator
  const orchestrator = new SolverOrchestratorV3(
    db,
    chain,
    registry,
    attestation,
    {
      pollInterval: config.orchestrator.pollInterval,
      minUsdcAmount: config.orchestrator.minUsdcAmount,
      maxUsdcAmount: config.orchestrator.maxUsdcAmount,
      proofStoragePath: config.prover.proofStoragePath,
      prover: proverConfig,
    }
  );

  // Handle shutdown
  process.on("SIGINT", () => {
    log.info("Received SIGINT, shutting down...");
    orchestrator.stop();
    healthServer.close();
    quoteApiServer?.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Received SIGTERM, shutting down...");
    orchestrator.stop();
    healthServer.close();
    quoteApiServer?.close();
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

