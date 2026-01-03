import { createLogger } from "./utils/logger.js";
import { IntentDatabase } from "./db/intents.js";
import { ChainClient } from "./chain/client.js";
import { ProviderRegistry } from "./providers/registry.js";
import { updateHealthCheck } from "./health.js";
import {
  Currency,
  RTPN,
  getRtpnsForCurrency,
  RTPN_NAMES,
  CURRENCY_NAMES,
  IntentStatus,
} from "./types/index.js";
import type { IntentCreatedEvent, QuoteSelectedEvent } from "./chain/abi.js";
import {
  intentsSeenTotal,
  quotesSubmittedTotal,
  intentsFulfilledTotal,
  intentsFailedTotal,
  transferDurationSeconds,
} from "./metrics.js";

const log = createLogger("orchestrator");

export interface OrchestratorConfig {
  pollInterval: number;        // ms between loop iterations
  minUsdcAmount: bigint;       // minimum USDC to process
  maxUsdcAmount: bigint;       // maximum USDC to process
}

/**
 * Main solver orchestrator
 * - Watches for new intents
 * - Submits quotes via registered providers
 * - Fulfills committed intents
 */
export class SolverOrchestrator {
  private db: IntentDatabase;
  private chain: ChainClient;
  private registry: ProviderRegistry;
  private config: OrchestratorConfig;
  private running = false;
  private unwatchIntents?: () => void;
  private unwatchQuotes?: () => void;

  constructor(
    db: IntentDatabase,
    chain: ChainClient,
    registry: ProviderRegistry,
    config: OrchestratorConfig
  ) {
    this.db = db;
    this.chain = chain;
    this.registry = registry;
    this.config = config;
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    log.info({ solverAddress: this.chain.solverAddress }, "Starting orchestrator");

    // Check authorization
    try {
      const authorized = await this.chain.isAuthorizedSolver();
      if (!authorized) {
        log.error(
          { address: this.chain.solverAddress },
          "Solver is not authorized on the contract!"
        );
        updateHealthCheck("chain", "error", "Solver not authorized");
        throw new Error("Solver not authorized");
      }
      log.info("Solver authorization confirmed");
      updateHealthCheck("chain", "ok");
    } catch (error) {
      updateHealthCheck("chain", "error", error instanceof Error ? error.message : "Chain connection failed");
      throw error;
    }

    // Log supported RTPNs
    const supportedRtpns = this.registry.getSupportedRtpns();
    log.info(
      { rtpns: supportedRtpns.map(r => RTPN_NAMES[r]) },
      "Supported RTPNs from registered providers"
    );

    // Sync historical events
    await this.syncHistorical();

    // Start event watchers
    const currentBlock = await this.chain.getCurrentBlock();
    
    this.unwatchIntents = this.chain.watchIntentCreated(
      currentBlock,
      this.handleIntentCreated.bind(this)
    );
    
    this.unwatchQuotes = this.chain.watchQuoteSelected(
      currentBlock,
      this.handleQuoteSelected.bind(this)
    );

    // Log stats
    const stats = this.db.getStats();
    log.info(stats, "Current stats");

    // Start main loop
    this.running = true;
    log.info("Orchestrator started");
    
    await this.mainLoop();
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    log.info("Stopping orchestrator...");
    this.running = false;
    this.unwatchIntents?.();
    this.unwatchQuotes?.();
    this.db.close();
  }

  // ============ Event Handlers ============

  private handleIntentCreated(event: IntentCreatedEvent, blockNumber: bigint): void {
    const currencyName = CURRENCY_NAMES[event.currency as Currency] || "unknown";

    log.info(
      {
        intentId: event.intentId,
        depositor: event.depositor,
        usdcAmount: event.usdcAmount.toString(),
        currency: currencyName,
      },
      "New intent created"
    );

    // Increment metrics
    intentsSeenTotal.inc({ currency: currencyName });

    // Store in database
    this.db.insertIntent({
      intentId: event.intentId,
      depositor: event.depositor,
      usdcAmount: event.usdcAmount,
      currency: event.currency,
      createdAt: Math.floor(Date.now() / 1000),
    });

    this.db.setLastBlock(blockNumber);
  }

  private handleQuoteSelected(event: QuoteSelectedEvent, blockNumber: bigint): void {
    // Only process if we're the selected solver
    if (event.solver.toLowerCase() !== this.chain.solverAddress.toLowerCase()) {
      log.debug(
        { intentId: event.intentId, selectedSolver: event.solver },
        "Quote selected by different solver, ignoring"
      );
      return;
    }

    log.info(
      {
        intentId: event.intentId,
        rtpn: RTPN_NAMES[event.rtpn as RTPN],
        fiatAmount: event.fiatAmount.toString(),
        receivingInfo: event.receivingInfo.substring(0, 10) + "...",
      },
      "Our quote was selected!"
    );

    // Update database
    this.db.updateIntentCommitted(event.intentId, {
      selectedSolver: event.solver,
      selectedRtpn: event.rtpn,
      selectedFiatAmount: event.fiatAmount,
      receivingInfo: event.receivingInfo,
      recipientName: event.recipientName,
      committedAt: Math.floor(Date.now() / 1000),
    });

    this.db.setLastBlock(blockNumber);
  }

  // ============ Main Loop ============

  private async mainLoop(): Promise<void> {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (this.running) {
      try {
        // 1. Submit quotes for new intents
        await this.processQuoting();

        // 2. Fulfill committed intents
        await this.processFulfillment();

        // Reset error counter on success
        consecutiveErrors = 0;
        updateHealthCheck("chain", "ok");

      } catch (error) {
        consecutiveErrors++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ error: errorMessage, consecutiveErrors }, "Error in main loop");

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          updateHealthCheck("chain", "error", `${consecutiveErrors} consecutive errors: ${errorMessage}`);
        } else {
          updateHealthCheck("chain", "warning", `Error: ${errorMessage}`);
        }
      }

      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, this.config.pollInterval));
    }
  }

  // ============ Quoting ============

  private async processQuoting(): Promise<void> {
    const intentsNeedingQuotes = this.db.getIntentsNeedingQuotes();
    
    if (intentsNeedingQuotes.length === 0) {
      return;
    }

    log.info({ count: intentsNeedingQuotes.length }, "Processing intents for quoting");

    for (const intent of intentsNeedingQuotes) {
      await this.submitQuotesForIntent(intent.intentId, intent.currency, BigInt(intent.usdcAmount));
    }
  }

  private async submitQuotesForIntent(
    intentId: string,
    currency: number,
    usdcAmount: bigint
  ): Promise<void> {
    // Check amount limits
    if (usdcAmount < this.config.minUsdcAmount || usdcAmount > this.config.maxUsdcAmount) {
      log.info(
        { intentId, usdcAmount: usdcAmount.toString() },
        "Intent amount outside solver limits, skipping"
      );
      this.db.markQuotesSubmitted(intentId);
      return;
    }

    // Get RTPNs for this currency
    const rtpns = getRtpnsForCurrency(currency as Currency);
    
    // Filter to RTPNs we have providers for
    const supportedRtpns = rtpns.filter(rtpn => this.registry.hasProviderForRtpn(rtpn));

    if (supportedRtpns.length === 0) {
      log.info(
        { intentId, currency: CURRENCY_NAMES[currency as Currency] },
        "No providers support this currency, skipping"
      );
      this.db.markQuotesSubmitted(intentId);
      return;
    }

    log.info(
      {
        intentId,
        currency: CURRENCY_NAMES[currency as Currency],
        rtpns: supportedRtpns.map(r => RTPN_NAMES[r]),
      },
      "Generating quotes"
    );

    // Generate and submit quotes for each supported RTPN
    for (const rtpn of supportedRtpns) {
      try {
        // Check if we're authorized for this RTPN on-chain
        const authorized = await this.chain.solverSupportsRtpn(rtpn);
        if (!authorized) {
          log.warn(
            { rtpn: RTPN_NAMES[rtpn] },
            "Solver not authorized for this RTPN on-chain, skipping"
          );
          continue;
        }

        // Get provider for this RTPN
        const providers = this.registry.getProvidersForRtpn(rtpn);
        if (providers.length === 0) continue;

        // Use first provider (in future, could get best quote across providers)
        const provider = providers[0];

        // Generate quote
        const quote = await provider.getQuote({
          intentId,
          usdcAmount,
          currency: currency as Currency,
          rtpn,
        });

        // Store quote locally
        const quoteId = `${intentId}-${rtpn}`;
        this.db.insertQuote({
          id: quoteId,
          intentId,
          rtpn,
          fiatAmount: quote.fiatAmount,
          fee: quote.fee,
          estimatedTime: quote.estimatedTime,
          expiresAt: quote.expiresAt,
        });

        // Submit quote on-chain
        const txHash = await this.chain.submitQuote(
          intentId as `0x${string}`,
          rtpn,
          quote.fiatAmount,
          quote.fee,
          quote.estimatedTime
        );

        this.db.markQuoteSubmittedOnChain(quoteId, txHash);

        const rtpnName = RTPN_NAMES[rtpn] || "unknown";
        const currencyName = CURRENCY_NAMES[currency as Currency] || "unknown";

        // Increment quote submitted metric
        quotesSubmittedTotal.inc({ rtpn: rtpnName, currency: currencyName });

        log.info(
          {
            intentId,
            rtpn: rtpnName,
            fiatAmount: (Number(quote.fiatAmount) / 100).toFixed(2),
            fee: (Number(quote.fee) / 1_000_000).toFixed(2),
            txHash,
          },
          "Quote submitted on-chain"
        );

      } catch (error) {
        log.error(
          { intentId, rtpn: RTPN_NAMES[rtpn], error },
          "Failed to submit quote"
        );
      }
    }

    // Mark quotes as submitted (even if some failed)
    this.db.markQuotesSubmitted(intentId);
  }

  // ============ Fulfillment ============

  private async processFulfillment(): Promise<void> {
    const committedIntents = this.db.getCommittedIntents(this.chain.solverAddress);
    
    if (committedIntents.length === 0) {
      return;
    }

    log.info({ count: committedIntents.length }, "Processing committed intents for fulfillment");

    for (const intent of committedIntents) {
      await this.fulfillIntent(intent);
    }
  }

  private async fulfillIntent(intent: {
    intentId: string;
    usdcAmount: string;
    currency: number;
    selectedRtpn: number | null;
    selectedFiatAmount: string | null;
    receivingInfo: string | null;
    recipientName: string | null;
  }): Promise<void> {
    const {
      intentId,
      usdcAmount,
      currency,
      selectedRtpn,
      selectedFiatAmount,
      receivingInfo,
      recipientName,
    } = intent;

    const rtpnName = selectedRtpn !== null ? (RTPN_NAMES[selectedRtpn as RTPN] || "unknown") : "unknown";

    if (selectedRtpn === null || selectedFiatAmount === null || !receivingInfo || !recipientName) {
      log.error({ intentId }, "Intent missing required fields for fulfillment");
      intentsFailedTotal.inc({ rtpn: rtpnName, reason: "missing_fields" });
      this.db.markFailed(intentId, "Missing required fields");
      return;
    }

    // Check if still fulfillable on-chain
    const canFulfill = await this.chain.canFulfill(intentId as `0x${string}`);
    if (!canFulfill) {
      log.info({ intentId }, "Intent no longer fulfillable on-chain");
      intentsFailedTotal.inc({ rtpn: rtpnName, reason: "not_fulfillable" });
      this.db.markFailed(intentId, "No longer fulfillable");
      return;
    }

    log.info(
      {
        intentId,
        rtpn: RTPN_NAMES[selectedRtpn as RTPN],
        fiatAmount: (Number(selectedFiatAmount) / 100).toFixed(2),
        receivingInfo: receivingInfo.substring(0, 10) + "...",
      },
      "Fulfilling intent"
    );

    // Get provider for this RTPN
    const providers = this.registry.getProvidersForRtpn(selectedRtpn as RTPN);
    if (providers.length === 0) {
      log.error({ intentId, rtpn: selectedRtpn }, "No provider for RTPN");
      intentsFailedTotal.inc({ rtpn: rtpnName, reason: "no_provider" });
      this.db.markFailed(intentId, `No provider for RTPN ${selectedRtpn}`);
      return;
    }

    const provider = providers[0];
    const transferStartTime = Date.now();

    try {
      // Execute fiat transfer
      const result = await provider.executeTransfer({
        intentId,
        usdcAmount: BigInt(usdcAmount),
        fiatAmount: BigInt(selectedFiatAmount),
        currency: currency as Currency,
        rtpn: selectedRtpn as RTPN,
        receivingInfo,
        recipientName,
      });

      const transferDuration = (Date.now() - transferStartTime) / 1000;

      if (!result.success) {
        log.error({ intentId, error: result.error }, "Fiat transfer failed");
        intentsFailedTotal.inc({ rtpn: rtpnName, reason: "transfer_failed" });
        transferDurationSeconds.observe({ rtpn: rtpnName, status: "failed" }, transferDuration);
        this.db.markFailed(intentId, result.error || "Transfer failed");
        return;
      }

      log.info(
        { intentId, transferId: result.transferId },
        "Fiat transfer completed, submitting on-chain fulfillment"
      );

      // Submit fulfillment on-chain
      const txHash = await this.chain.fulfillIntent(
        intentId as `0x${string}`,
        result.transferId,
        result.fiatSent
      );

      // Mark as fulfilled
      this.db.markFulfilled(intentId, txHash, result.transferId);

      // Record successful metrics
      intentsFulfilledTotal.inc({ rtpn: rtpnName });
      transferDurationSeconds.observe({ rtpn: rtpnName, status: "success" }, transferDuration);

      log.info(
        { intentId, txHash, transferId: result.transferId },
        "Intent fulfilled successfully"
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ intentId, error: errorMessage }, "Failed to fulfill intent");
      intentsFailedTotal.inc({ rtpn: rtpnName, reason: "exception" });
      this.db.markFailed(intentId, errorMessage);
    }
  }

  // ============ Historical Sync ============

  private async syncHistorical(): Promise<void> {
    const lastBlock = this.db.getLastBlock();
    const currentBlock = await this.chain.getCurrentBlock();

    if (lastBlock >= currentBlock) {
      log.info("Already synced to latest block");
      return;
    }

    // If starting fresh, start from current block
    const startBlock = lastBlock > 0n ? lastBlock + 1n : currentBlock;
    
    if (startBlock >= currentBlock) {
      log.info("No historical blocks to sync");
      this.db.setLastBlock(currentBlock);
      return;
    }

    log.info(
      { fromBlock: startBlock.toString(), toBlock: currentBlock.toString() },
      "Syncing historical events"
    );

    // Sync in chunks to avoid RPC limits
    const CHUNK_SIZE = 9n;
    
    for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE + 1n) {
      const to = from + CHUNK_SIZE > currentBlock ? currentBlock : from + CHUNK_SIZE;
      
      // Get IntentCreated events
      const intentEvents = await this.chain.getHistoricalIntentCreated(from, to);
      for (const { event, blockNumber } of intentEvents) {
        this.handleIntentCreated(event, blockNumber);
      }

      // Get QuoteSelected events
      const quoteEvents = await this.chain.getHistoricalQuoteSelected(from, to);
      for (const { event, blockNumber } of quoteEvents) {
        this.handleQuoteSelected(event, blockNumber);
      }
    }

    this.db.setLastBlock(currentBlock);
    log.info("Historical sync complete");
  }
}



