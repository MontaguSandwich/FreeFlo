/**
 * V3 Solver Orchestrator with zkTLS Proof-based Fulfillment
 * 
 * This orchestrator extends the V2 flow by using zkTLS attestations
 * for permissionless fulfillment verification on-chain.
 */

import { createLogger } from "./utils/logger.js";
import { IntentDatabase } from "./db/intents.js";
import { ChainClientV3 } from "./chain/client-v3.js";
import { ProviderRegistry } from "./providers/registry.js";
import { updateHealthCheck } from "./health.js";
import { AttestationClient } from "./attestation/client.js";
import { generateQontoProof, type ProverConfig } from "./attestation/prover.js";
import type { PaymentAttestationStruct } from "./chain/abi-v3.js";
import {
  Currency,
  RTPN,
  getRtpnsForCurrency,
  RTPN_NAMES,
  CURRENCY_NAMES,
} from "./types/index.js";
import type { IntentCreatedEvent, QuoteSelectedEvent } from "./chain/abi.js";

const log = createLogger("orchestrator-v3");

export interface OrchestratorV3Config {
  pollInterval: number;
  minUsdcAmount: bigint;
  maxUsdcAmount: bigint;
  /** Optional: Base path where TLSNotary proofs are stored */
  proofStoragePath?: string;
  /** Optional: Prover config for automatic proof generation */
  prover?: ProverConfig;
}

/**
 * V3 Solver Orchestrator with zkTLS proof generation
 */
export class SolverOrchestratorV3 {
  private db: IntentDatabase;
  private chain: ChainClientV3;
  private registry: ProviderRegistry;
  private attestation: AttestationClient;
  private config: OrchestratorV3Config;
  private running = false;
  private unwatchIntents?: () => void;
  private unwatchQuotes?: () => void;

  constructor(
    db: IntentDatabase,
    chain: ChainClientV3,
    registry: ProviderRegistry,
    attestation: AttestationClient,
    config: OrchestratorV3Config
  ) {
    this.db = db;
    this.chain = chain;
    this.registry = registry;
    this.attestation = attestation;
    this.config = config;
  }

  async start(): Promise<void> {
    log.info({ solverAddress: this.chain.solverAddress }, "Starting V3 orchestrator (zkTLS enabled)");

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

    // Check attestation service health
    try {
      const health = await this.attestation.healthCheck();
      log.info(
        { witnessAddress: health.witnessAddress, chainId: health.chainId },
        "Attestation service connected"
      );

      // Verify witness is authorized on-chain
      const witnessAuthorized = await this.chain.isWitnessAuthorized(health.witnessAddress as `0x${string}`);
      if (!witnessAuthorized) {
        log.warn(
          { witnessAddress: health.witnessAddress },
          "Attestation service witness is NOT authorized on PaymentVerifier!"
        );
        updateHealthCheck("attestation", "warning", "Witness not authorized on-chain");
      } else {
        log.info("Attestation service witness is authorized on-chain ✓");
        updateHealthCheck("attestation", "ok");
      }
    } catch (error) {
      log.error({ error }, "Failed to connect to attestation service");
      updateHealthCheck("attestation", "error", error instanceof Error ? error.message : "Connection failed");
      // Continue - we may still be able to quote, just not fulfill
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
    log.info("V3 Orchestrator started with zkTLS verification");
    
    await this.mainLoop();
  }

  stop(): void {
    log.info("Stopping V3 orchestrator...");
    this.running = false;
    this.unwatchIntents?.();
    this.unwatchQuotes?.();
    this.db.close();
  }

  // ============ Event Handlers ============

  private handleIntentCreated(event: IntentCreatedEvent, blockNumber: bigint): void {
    log.info(
      {
        intentId: event.intentId,
        depositor: event.depositor,
        usdcAmount: event.usdcAmount.toString(),
        currency: CURRENCY_NAMES[event.currency as Currency],
      },
      "New intent created"
    );

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
        await this.processQuoting();
        await this.processFulfillment();
        await this.processRetryQueue();

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
    if (usdcAmount < this.config.minUsdcAmount || usdcAmount > this.config.maxUsdcAmount) {
      log.info(
        { intentId, usdcAmount: usdcAmount.toString() },
        "Intent amount outside solver limits, skipping"
      );
      this.db.markQuotesSubmitted(intentId);
      return;
    }

    const rtpns = getRtpnsForCurrency(currency as Currency);
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

    for (const rtpn of supportedRtpns) {
      try {
        const authorized = await this.chain.solverSupportsRtpn(rtpn);
        if (!authorized) {
          log.warn(
            { rtpn: RTPN_NAMES[rtpn] },
            "Solver not authorized for this RTPN on-chain, skipping"
          );
          continue;
        }

        const providers = this.registry.getProvidersForRtpn(rtpn);
        if (providers.length === 0) continue;

        const provider = providers[0];

        const quote = await provider.getQuote({
          intentId,
          usdcAmount,
          currency: currency as Currency,
          rtpn,
        });

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

        const txHash = await this.chain.submitQuote(
          intentId as `0x${string}`,
          rtpn,
          quote.fiatAmount,
          quote.fee,
          quote.estimatedTime
        );

        this.db.markQuoteSubmittedOnChain(quoteId, txHash);

        log.info(
          {
            intentId,
            rtpn: RTPN_NAMES[rtpn],
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

    this.db.markQuotesSubmitted(intentId);
  }

  // ============ Fulfillment with zkTLS ============

  private async processFulfillment(): Promise<void> {
    const committedIntents = this.db.getCommittedIntents(this.chain.solverAddress);
    
    if (committedIntents.length === 0) {
      return;
    }

    log.info({ count: committedIntents.length }, "Processing committed intents for fulfillment");

    for (const intent of committedIntents) {
      await this.fulfillIntentWithZkTLS(intent);
    }
  }

  // ============ Retry Queue ============

  /**
   * Process intents that are scheduled for retry
   * These are intents where fiat transfer succeeded but later steps failed
   */
  private async processRetryQueue(): Promise<void> {
    const retryableIntents = this.db.getRetryableIntents(this.chain.solverAddress);
    
    if (retryableIntents.length === 0) {
      return;
    }

    log.info({ count: retryableIntents.length }, "Processing retry queue");

    for (const intent of retryableIntents) {
      // Move back to committed status so fulfillIntentWithZkTLS can process it
      // The existing transfer ID will be found, so it will skip Step 1
      log.info(
        { intentId: intent.intentId, retryCount: (intent as any).retryCount || 1 },
        "Retrying intent (fiat transfer already completed)"
      );
      
      this.db.markForRetry(intent.intentId);
    }
  }

  // ============ Fulfillment with zkTLS ============

  /**
   * Fulfill an intent using zkTLS proof verification
   * 
   * Flow:
   * 1. Execute the fiat transfer via provider
   * 2. Generate TLSNotary proof for the transfer
   * 3. Get EIP-712 attestation from attestation service
   * 4. Submit attestation + signature to OffRampV3.fulfillIntentWithProof
   */
  private async fulfillIntentWithZkTLS(intent: {
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

    if (selectedRtpn === null || selectedFiatAmount === null || !receivingInfo || !recipientName) {
      log.error({ intentId }, "Intent missing required fields for fulfillment");
      this.db.markFailed(intentId, "Missing required fields");
      return;
    }

    const canFulfill = await this.chain.canFulfill(intentId as `0x${string}`);
    if (!canFulfill) {
      log.info({ intentId }, "Intent no longer fulfillable on-chain");
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
      "Fulfilling intent with zkTLS verification"
    );

    const providers = this.registry.getProvidersForRtpn(selectedRtpn as RTPN);
    if (providers.length === 0) {
      log.error({ intentId, rtpn: selectedRtpn }, "No provider for RTPN");
      this.db.markFailed(intentId, `No provider for RTPN ${selectedRtpn}`);
      return;
    }

    const provider = providers[0];

    try {
      // Check if fiat transfer was already completed (for retry scenarios)
      let transferId = this.db.getTransferId(intentId);
      let fiatSent = BigInt(selectedFiatAmount);

      if (transferId) {
        // Transfer already exists - skip Step 1
        log.info(
          { intentId, transferId },
          "Step 1/4: Fiat transfer already completed (resuming from Step 2)"
        );
      } else {
        // Step 1: Execute fiat transfer
        log.info({ intentId }, "Step 1/4: Executing fiat transfer");
        const result = await provider.executeTransfer({
          intentId,
          usdcAmount: BigInt(usdcAmount),
          fiatAmount: BigInt(selectedFiatAmount),
          currency: currency as Currency,
          rtpn: selectedRtpn as RTPN,
          receivingInfo,
          recipientName,
        });

        if (!result.success) {
          log.error({ intentId, error: result.error }, "Fiat transfer failed");
          this.db.markFailed(intentId, result.error || "Transfer failed");
          return;
        }

        transferId = result.transferId;
        fiatSent = result.fiatSent;

        // Save transfer ID immediately so we can resume if later steps fail
        this.db.saveTransferId(intentId, transferId);

        log.info(
          { intentId, transferId, fiatSent: fiatSent.toString() },
          "Step 1/4: Fiat transfer completed"
        );
      }

      // Step 2: Generate TLSNotary proof
      log.info({ intentId }, "Step 2/4: Generating TLSNotary proof");
      const presentation = await this.generateTlsNotaryProof(transferId);

      if (!presentation) {
        log.error({ intentId }, "Failed to generate TLSNotary proof");
        // Don't mark as failed - transfer completed, just needs retry for proof
        this.db.markFailed(intentId, "TLSNotary proof generation failed - retry will resume from Step 2");
        return;
      }

      log.info({ intentId, proofSize: presentation.length }, "Step 2/4: TLSNotary proof generated");

      // Step 3: Get attestation from attestation service
      log.info({ intentId }, "Step 3/4: Requesting attestation");
      const attestationResponse = await this.attestation.attest({
        presentation,
        intentHash: intentId,
        expectedAmountCents: Number(fiatSent),
        expectedBeneficiaryIban: receivingInfo,
      });

      log.info(
        {
          intentId,
          transactionId: attestationResponse.payment.transactionId,
          amountVerified: attestationResponse.payment.amountCents,
        },
        "Step 3/4: Attestation received"
      );

      // Step 4: Submit on-chain with zkTLS proof
      log.info({ intentId }, "Step 4/4: Submitting fulfillment with zkTLS proof");

      // Build the PaymentAttestation struct for the contract
      const attestationStruct: PaymentAttestationStruct = {
        intentHash: intentId as `0x${string}`,
        amount: BigInt(attestationResponse.payment.amountCents),
        timestamp: BigInt(attestationResponse.payment.timestamp),
        paymentId: attestationResponse.payment.transactionId || transferId,
        dataHash: attestationResponse.dataHash as `0x${string}`,
      };

      const txHash = await this.chain.fulfillIntentWithProof(
        intentId as `0x${string}`,
        attestationStruct,
        attestationResponse.signature as `0x${string}`
      );

      this.db.markFulfilled(intentId, txHash, transferId);

      log.info(
        {
          intentId,
          txHash,
          transferId,
          verifiedByZkTLS: true,
        },
        "✅ Intent fulfilled with zkTLS verification"
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ intentId, error: errorMessage }, "Failed to fulfill intent with zkTLS");
      this.db.markFailed(intentId, errorMessage);
    }
  }

  /**
   * Generate a TLSNotary proof for a completed transfer
   * 
   * If prover is configured, automatically generates the proof.
   * Otherwise, looks for pre-generated proofs in the storage path.
   */
  private async generateTlsNotaryProof(transferId: string): Promise<string | null> {
    const proofPath = this.config.proofStoragePath || "./proofs";
    
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      
      // First, check for existing proof
      const proofFile = path.join(proofPath, `${transferId}.presentation.tlsn`);
      
      try {
        const proofBytes = await fs.readFile(proofFile);
        const base64Proof = proofBytes.toString("base64");
        log.info({ transferId, proofFile }, "Found existing TLSNotary proof");
        return base64Proof;
      } catch {
        // Proof file doesn't exist, try to generate
      }

      // If prover is configured, generate automatically
      if (this.config.prover) {
        log.info({ transferId }, "Generating TLSNotary proof automatically...");
        
        const result = await generateQontoProof(transferId, this.config.prover);
        
        if (result.success && result.presentationBase64) {
          log.info(
            { transferId, duration: result.duration },
            "TLSNotary proof generated successfully"
          );
          return result.presentationBase64;
        }
        
        log.error(
          { transferId, error: result.error },
          "Automatic proof generation failed"
        );
        return null;
      }

      // Fallback: check for the latest proof file (for testing)
      const latestProofFile = path.join(proofPath, "qonto_transfer.presentation.tlsn");
      try {
        const proofBytes = await fs.readFile(latestProofFile);
        const base64Proof = proofBytes.toString("base64");
        log.info({ transferId, proofFile: latestProofFile }, "Using latest TLSNotary proof (testing mode)");
        return base64Proof;
      } catch {
        // Latest proof file doesn't exist
      }

      log.warn(
        { transferId, proofPath },
        "No TLSNotary proof found - manual proof generation required"
      );
      log.warn("Run: cargo run --release --example qonto_prove_transfer");
      
      return null;

    } catch (error) {
      log.error({ transferId, error }, "Error during TLSNotary proof generation");
      return null;
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

    // If fresh database, look back 1000 blocks to find existing intents
    // Otherwise continue from where we left off
    const LOOKBACK_BLOCKS = 1000n;
    const startBlock = lastBlock > 0n ? lastBlock + 1n : (currentBlock > LOOKBACK_BLOCKS ? currentBlock - LOOKBACK_BLOCKS : 0n);
    
    if (startBlock >= currentBlock) {
      log.info("No historical blocks to sync");
      this.db.setLastBlock(currentBlock);
      return;
    }

    log.info(
      { fromBlock: startBlock.toString(), toBlock: currentBlock.toString() },
      "Syncing historical events"
    );

    const CHUNK_SIZE = 9n;
    
    for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE + 1n) {
      const to = from + CHUNK_SIZE > currentBlock ? currentBlock : from + CHUNK_SIZE;
      
      const intentEvents = await this.chain.getHistoricalIntentCreated(from, to);
      for (const { event, blockNumber } of intentEvents) {
        this.handleIntentCreated(event, blockNumber);
      }

      const quoteEvents = await this.chain.getHistoricalQuoteSelected(from, to);
      for (const { event, blockNumber } of quoteEvents) {
        this.handleQuoteSelected(event, blockNumber);
      }
    }

    this.db.setLastBlock(currentBlock);
    log.info("Historical sync complete");
  }
}

