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
  MANDATE_WITNESS_TYPESTRING,
  type CompactClaimInput,
  type CompactMandateInput,
} from "./chain/compact-abi.js";
import {
  Currency,
  RTPN,
  getRtpnsForCurrency,
  RTPN_NAMES,
  CURRENCY_NAMES,
} from "./types/index.js";
import type { IntentCreatedEvent, QuoteSelectedEvent } from "./chain/abi.js";
import { initAlertService, type AlertService } from "./alerts/index.js";
import { getStageFromStep } from "./types/errors.js";

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
 * A user-signed Compact fill order (TIER-1 sign-once offramp), as the frontend POSTs it to
 * /api/compact/fill. All uint256 fields are decimal strings on the wire; the orchestrator parses
 * them into BigInt for the chain client. This path is additive and never touches the intent watcher.
 */
export interface CompactFillOrder {
  claim: {
    sponsor: string;
    nonce: string; // uint256
    expires: string; // uint256
    witness: string; // bytes32
    witnessTypestring: string;
    id: string; // uint256 resource-lock id
    allocatedAmount: string; // uint256 USDC (6dp)
  };
  mandate: {
    receivingInfo: string;
    recipientName: string;
    minEurAmount: string; // uint256
    currency: number; // Currency enum
    expiry: string; // uint256
  };
  /**
   * The user's single Permit2 PermitTransferFrom signature (witnessed by the claim hash). The solver
   * relayer submits it via The Compact's depositERC20AndRegisterViaPermit2 to fund+register the lock
   * gasless — replacing the sponsorSignature (the compact is registered on-chain instead of signed
   * into the claim). nonce/deadline are the Permit2 nonce/deadline the user signed over.
   */
  permit2: {
    nonce: string; // uint256 Permit2 nonce
    deadline: string; // uint256 Permit2 deadline
    signature: string; // bytes
  };
}

/**
 * Incremental progress for an in-flight Compact fill, pushed to the optional onProgress callback at
 * each pipeline step (deposit → SEPA → proof → fill). The async HTTP layer maps these onto the
 * GET /api/compact/status record so the frontend can poll the fill it kicked off. Purely advisory:
 * the fill logic/ordering is unchanged whether or not a callback is supplied.
 */
export type CompactProgress = {
  status: "depositing" | "paying" | "proving" | "releasing" | "complete";
  depositTxHash?: string;
  transferId?: string;
  fillTxHash?: string;
  eurCents?: number;
};

/**
 * V3 Solver Orchestrator with zkTLS proof generation
 */
export class SolverOrchestratorV3 {
  private db: IntentDatabase;
  private chain: ChainClientV3;
  private registry: ProviderRegistry;
  private attestation: AttestationClient;
  private config: OrchestratorV3Config;
  private alerts: AlertService;
  private running = false;
  private unwatchIntents?: () => void;
  private unwatchQuotes?: () => void;
  private lastWitnessCheck = 0;
  private static readonly WITNESS_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_RETRIES = 5;

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
    this.alerts = initAlertService();
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
        await this.checkWitnessAuthorization();

        consecutiveErrors = 0;
        updateHealthCheck("chain", "ok");

      } catch (error) {
        consecutiveErrors++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error({ error: errorMessage, consecutiveErrors }, "Error in main loop");

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          updateHealthCheck("chain", "error", `${consecutiveErrors} consecutive errors: ${errorMessage}`);
          // Alert on repeated main loop failures
          await this.alerts.reportSystemError({
            type: "solver_unhealthy",
            message: `Solver main loop failing: ${consecutiveErrors} consecutive errors`,
            details: { lastError: errorMessage, consecutiveErrors },
          });
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
      await this.submitQuotesForIntent(
        intent.intentId,
        intent.currency,
        BigInt(intent.usdcAmount),
        intent.depositor,
      );
    }
  }

  private async submitQuotesForIntent(
    intentId: string,
    currency: number,
    usdcAmount: bigint,
    depositor?: string
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

    // Gasless 3->2: if a FiatToFiatRouter created this intent, relayer-commit it for
    // the user now that our quote is on-chain. commitFor picks the best on-chain quote
    // >= the user's floor, so we never route them to a worse price. Best-effort: a
    // failure (no router configured, window closed, below floor) is logged, not fatal —
    // the user can still self-commit via the frontend.
    if (depositor && this.chain.isRouterAddress(depositor)) {
      await this.chain.commitForRouterIntent(intentId as `0x${string}`);
    }
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

  // ============ Compact fill (TIER-1 sign-once offramp) ============

  /**
   * Fill a user-signed Compact order: send SEPA, prove it, get the witness attestation bound to
   * the Compact claim hash, then call arbiter.fill to release the user's locked USDC to the solver.
   *
   * Mirrors fulfillIntentWithZkTLS but for a Compact order — there is NO DB row (the order is
   * driven by the HTTP request, not the on-chain intent watcher), and the synthetic "intentId" used
   * for Qonto idempotency/reference is the Compact claim hash. Additive: existing flows untouched.
   */
  async fulfillCompactOrder(
    order: CompactFillOrder,
    onProgress?: (u: CompactProgress) => void
  ): Promise<{ txHash: string }> {
    // 1. Guard: the Compact path requires both arbiter + allocator addresses configured.
    if (!this.chain.compactEnabled) {
      throw new Error("Compact flow not enabled");
    }

    // 2. Parse the wire order into the chain client's input shapes. allocatorData/claimants are
    //    filled by fillCompactOrder/the arbiter respectively, so pass placeholders here.
    //    sponsorSignature is EMPTY ("0x"): the compact is REGISTERED on-chain by the gasless
    //    deposit (Step 0) rather than signed into the claim, and The Compact accepts an empty
    //    sponsor signature once the claim hash is registered. witnessTypestring is the canonical
    //    Mandate typestring so the claim hash matches what the deposit registered.
    const claim: CompactClaimInput = {
      allocatorData: "0x",
      sponsorSignature: "0x",
      sponsor: order.claim.sponsor as `0x${string}`,
      nonce: BigInt(order.claim.nonce),
      expires: BigInt(order.claim.expires),
      witness: order.claim.witness as `0x${string}`,
      witnessTypestring: MANDATE_WITNESS_TYPESTRING,
      id: BigInt(order.claim.id),
      allocatedAmount: BigInt(order.claim.allocatedAmount),
      claimants: [],
    };
    const mandate: CompactMandateInput = {
      receivingInfo: order.mandate.receivingInfo,
      recipientName: order.mandate.recipientName,
      minEurAmount: BigInt(order.mandate.minEurAmount),
      currency: Number(order.mandate.currency),
      expiry: BigInt(order.mandate.expiry),
    };

    // 3. Pick the Qonto (SEPA Instant) provider.
    const providers = this.registry.getProvidersForRtpn(RTPN.SEPA_INSTANT);
    if (providers.length === 0) {
      throw new Error("No provider for SEPA_INSTANT (Compact fill requires Qonto)");
    }
    const provider = providers[0];

    // The Compact claim hash doubles as the synthetic intentId for Qonto idempotency/reference and
    // is the value the attestation binds the proven IBAN to (keccak(claimHash, solver)).
    const claimHash = await this.chain.computeCompactClaimHash(claim, mandate);

    log.info(
      {
        claimHash,
        sponsor: claim.sponsor,
        id: claim.id.toString(),
        minEur: (Number(mandate.minEurAmount) / 100).toFixed(2),
        receivingInfo: mandate.receivingInfo.substring(0, 10) + "...",
      },
      "Filling Compact order (sign-once offramp)"
    );

    try {
      // Step 0/4: relayer deposit+register (gasless). The solver submits the user's single Permit2
      // signature to The Compact, funding AND registering the lock for THIS claim hash in one tx.
      // This IS the pre-fiat safety gate: an invalid signature or a user without USDC reverts HERE,
      // BEFORE any SEPA is sent — so a fake/unfunded order can never drain the solver's EUR (same
      // safety property as the old on-chain balance/signature gate, now enforced by the deposit).
      // The empty sponsorSignature in `claim` then settles on-chain because the compact is registered.
      log.info({ claimHash }, "Step 0/4: relayer deposit+register (gasless)");
      onProgress?.({ status: "depositing" });
      const depositTxHash = await this.chain.depositAndRegisterViaPermit2({
        sponsor: claim.sponsor,
        amount: claim.allocatedAmount,
        id: claim.id, // lockTag is derived from the id inside the chain client
        claimHash,
        permit2Nonce: BigInt(order.permit2.nonce),
        deadline: BigInt(order.permit2.deadline),
        signature: order.permit2.signature as `0x${string}`,
      });

      // 4. SEPA send. Use the claim hash as the synthetic intentId so Qonto's deterministic
      //    idempotency key is stable across retries. The deposit is now mined (the safety gate
      //    has passed), so it is safe to send fiat — report progress before the SEPA call.
      onProgress?.({ status: "paying", depositTxHash });
      log.info({ claimHash }, "Step 1/4: Executing fiat transfer (Compact)");
      const result = await provider.executeTransfer({
        intentId: claimHash,
        usdcAmount: claim.allocatedAmount,
        fiatAmount: mandate.minEurAmount,
        currency: Currency.EUR,
        rtpn: RTPN.SEPA_INSTANT,
        receivingInfo: mandate.receivingInfo,
        recipientName: mandate.recipientName,
      });

      if (!result.success) {
        log.error(
          { claimHash, transferId: result.transferId, error: result.error },
          "Compact fiat transfer failed"
        );
        throw new Error(result.error || "Fiat transfer failed");
      }

      const transferId = result.transferId;
      const fiatSent = result.fiatSent;
      log.info(
        { claimHash, transferId, fiatSent: fiatSent.toString() },
        "Step 1/4: Fiat transfer completed (Compact)"
      );

      // 5. Generate the TLSNotary proofs (transfer + beneficiary).
      onProgress?.({ status: "proving", transferId });
      log.info({ claimHash }, "Step 2/4: Generating TLSNotary proof (Compact)");
      const proofs = await this.generateTlsNotaryProof(transferId);
      if (!proofs) {
        throw new Error("TLSNotary proof generation failed");
      }
      log.info(
        {
          claimHash,
          transferProofSize: proofs.transfer.length,
          beneficiaryProofSize: proofs.beneficiary.length,
        },
        "Step 2/4: TLSNotary proofs generated (Compact)"
      );

      // The proof is in hand; the remaining steps (attestation + on-chain fill) release the USDC.
      onProgress?.({ status: "releasing" });

      // 6. Get the witness attestation, bound to the Compact claim (intentHash = keccak(claimHash,
      //    solver)). The `compact` payload tells the service to bind the proven IBAN to the mandate.
      log.info({ claimHash }, "Step 3/4: Requesting attestation (Compact)");
      const att = await this.attestation.attest({
        presentation: proofs.transfer,
        beneficiaryPresentation: proofs.beneficiary,
        intentHash: this.chain.compactIntentHash(claimHash),
        expectedAmountCents: Number(fiatSent),
        expectedBeneficiaryIban: mandate.receivingInfo,
        compact: {
          sponsor: claim.sponsor,
          nonce: claim.nonce.toString(),
          expires: Number(claim.expires),
          id: claim.id.toString(),
          allocated_amount: claim.allocatedAmount.toString(),
          filler: this.chain.solverAddress,
          mandate: {
            receiving_info: mandate.receivingInfo,
            recipient_name: mandate.recipientName,
            min_eur_amount: Number(mandate.minEurAmount),
            currency: mandate.currency,
            expiry: Number(mandate.expiry),
          },
        },
      });
      log.info(
        {
          claimHash,
          transactionId: att.payment.transactionId,
          amountVerified: att.payment.amountCents,
        },
        "Step 3/4: Attestation received (Compact)"
      );

      // 7. Build the on-chain attestation struct. intentHash MUST be keccak(claimHash, solver) so it
      //    matches what arbiter.fill recomputes and what the witness signed.
      const attestationStruct: PaymentAttestationStruct = {
        intentHash: this.chain.compactIntentHash(claimHash),
        amount: BigInt(att.payment.amountCents),
        timestamp: BigInt(att.payment.timestamp),
        paymentId: att.payment.transactionId || transferId,
        dataHash: att.dataHash as `0x${string}`,
      };

      // 8. Fill: arbiter computes the claim hash, signs allocatorData, verifies the attestation via
      //    the reused PaymentVerifier, and releases the locked USDC to the solver.
      log.info({ claimHash }, "Step 4/4: Filling Compact order on-chain");
      const txHash = await this.chain.fillCompactOrder(
        claim,
        mandate,
        attestationStruct,
        att.signature as `0x${string}`
      );

      log.info(
        { claimHash, txHash, transferId, verifiedByZkTLS: true },
        "✅ Compact order filled (USDC released to solver)"
      );

      onProgress?.({ status: "complete", fillTxHash: txHash, eurCents: Number(fiatSent) });
      return { txHash };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ claimHash, error: errorMessage }, "Failed to fill Compact order");
      throw error;
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
      await this.alerts.reportIntentError({
        intentId,
        error: "Missing required fields for fulfillment",
        stage: "unknown",
      });
      return;
    }

    const canFulfill = await this.chain.canFulfill(intentId as `0x${string}`);
    if (!canFulfill) {
      log.info({ intentId }, "Intent no longer fulfillable on-chain");
      const transferId = this.db.getTransferId(intentId);
      this.db.markFailed(intentId, "No longer fulfillable");
      // Only alert if fiat was already sent (critical situation)
      if (transferId) {
        await this.alerts.reportIntentError({
          intentId,
          error: "Intent no longer fulfillable but fiat was already sent",
          stage: "on_chain_fulfillment",
          transferId,
        });
      }
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
          // Record the provider transfer id (when present) BEFORE deciding how
          // to fail, so an in-flight or rejected transfer is never lost for
          // reconciliation and any retry resumes from proof generation instead
          // of issuing a fresh send. qonto.ts returns a non-empty transferId on
          // the declined/cancelled and instant-window-exceeded branches.
          if (result.transferId) {
            this.db.saveTransferId(intentId, result.transferId);
          }

          if (result.requiresReconciliation) {
            // The fiat transfer FAILED but its outcome is unknown - it may still
            // settle at the recipient (e.g. fell back to SEPA Standard). Keep the
            // intent retryable so it can resume from proof generation if the
            // payment lands (the saved transferId means retry never re-sends),
            // and raise a CRITICAL reconciliation alert for ops.
            log.error(
              { intentId, transferId: result.transferId, error: result.error },
              "Fiat transfer outcome UNKNOWN - possible in-flight settlement, manual reconciliation required"
            );
            this.db.markFailed(
              intentId,
              result.error || "Transfer outcome unknown - manual reconciliation required",
              true
            );
            await this.alerts.reportIntentError({
              intentId,
              error: result.error || "Fiat may have settled despite failure - manual reconciliation required",
              stage: "fiat_transfer",
              transferId: result.transferId,
            });
            return;
          }

          // Clean terminal failure - no fiat left the account (VoP/declined/
          // cancelled/API error). Permanently fail; do NOT auto-retry, because
          // the retry path would only re-attempt proof generation for a payment
          // that never settled. Any transferId saved above is kept for audit.
          log.error({ intentId, error: result.error }, "Fiat transfer failed");
          this.db.markFailed(intentId, result.error || "Transfer failed", false);
          await this.alerts.reportIntentError({
            intentId,
            error: result.error || "Fiat transfer failed",
            stage: "fiat_transfer",
            transferId: result.transferId || null,
          });
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
      const proofs = await this.generateTlsNotaryProof(transferId);

      if (!proofs) {
        log.error({ intentId }, "Failed to generate TLSNotary proof");
        // Don't mark as failed - transfer completed, just needs retry for proof
        const retryInfo = this.db.getRetryInfo(intentId);
        this.db.markFailed(intentId, "TLSNotary proof generation failed - retry will resume from Step 2");
        await this.alerts.reportIntentError({
          intentId,
          error: "TLSNotary proof generation failed",
          stage: "proof_generation",
          retryCount: retryInfo?.retryCount,
          maxRetries: SolverOrchestratorV3.MAX_RETRIES,
          transferId,
        });
        return;
      }

      log.info(
        { intentId, transferProofSize: proofs.transfer.length, beneficiaryProofSize: proofs.beneficiary.length },
        "Step 2/4: TLSNotary proofs generated"
      );

      // Step 3: Get attestation from attestation service
      log.info({ intentId }, "Step 3/4: Requesting attestation");
      const attestationResponse = await this.attestation.attest({
        presentation: proofs.transfer,
        beneficiaryPresentation: proofs.beneficiary,
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

      // Send success alert
      await this.alerts.reportIntentSuccess({
        intentId,
        usdcAmount: usdcAmount,
        fiatAmount: selectedFiatAmount,
        currency: CURRENCY_NAMES[currency as Currency] || "???",
        transferId,
        txHash,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ intentId, error: errorMessage }, "Failed to fulfill intent with zkTLS");
      const retryInfo = this.db.getRetryInfo(intentId);
      const existingTransferId = this.db.getTransferId(intentId);
      this.db.markFailed(intentId, errorMessage);

      // Determine which stage based on whether transfer ID exists
      const stage = existingTransferId ? "attestation" : "fiat_transfer";
      await this.alerts.reportIntentError({
        intentId,
        error: errorMessage,
        stage,
        retryCount: retryInfo?.retryCount,
        maxRetries: SolverOrchestratorV3.MAX_RETRIES,
        transferId: existingTransferId,
      });
    }
  }

  /**
   * Generate a TLSNotary proof for a completed transfer
   * 
   * If prover is configured, automatically generates the proof.
   * Otherwise, looks for pre-generated proofs in the storage path.
   */
  private async generateTlsNotaryProof(
    transferId: string
  ): Promise<{ transfer: string; beneficiary: string } | null> {
    if (!this.config.prover) {
      log.error({ transferId }, "No prover configured; cannot generate TLSNotary proof");
      return null;
    }

    // Always regenerate both proofs (cheap; a stale cache once shipped an empty proof).
    // Qonto won't serve transfer status + beneficiary IBAN on one notarized
    // connection, so we prove each endpoint separately; the attestation binds them.
    log.info({ transferId }, "Generating TLSNotary proofs (transfer + beneficiary)...");
    const result = await generateQontoProof(transferId, this.config.prover);

    if (
      result.success &&
      result.transferPresentationBase64 &&
      result.beneficiaryPresentationBase64
    ) {
      log.info(
        { transferId, duration: result.duration },
        "TLSNotary proofs generated successfully"
      );
      return {
        transfer: result.transferPresentationBase64,
        beneficiary: result.beneficiaryPresentationBase64,
      };
    }

    log.error({ transferId, error: result.error }, "Automatic proof generation failed");
    return null;
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

  // ============ Witness Authorization Check ============

  /**
   * Periodically check that the attestation service witness is still authorized.
   * Alerts if authorization is revoked (prevents silent failures).
   */
  private async checkWitnessAuthorization(): Promise<void> {
    const now = Date.now();
    if (now - this.lastWitnessCheck < SolverOrchestratorV3.WITNESS_CHECK_INTERVAL) {
      return; // Not time to check yet
    }

    this.lastWitnessCheck = now;

    try {
      const health = await this.attestation.healthCheck();
      const witnessAddress = health.witnessAddress as `0x${string}`;
      const isAuthorized = await this.chain.isWitnessAuthorized(witnessAddress);

      if (!isAuthorized) {
        log.error({ witnessAddress }, "Witness authorization revoked!");
        updateHealthCheck("attestation", "error", "Witness not authorized");
        await this.alerts.reportSystemError({
          type: "witness_unauthorized",
          message: "Attestation service witness is no longer authorized on PaymentVerifier",
          details: { witnessAddress },
        });
      } else {
        updateHealthCheck("attestation", "ok");
      }
    } catch (error) {
      // Don't alert on check failure - attestation service might be temporarily down
      log.warn({ error }, "Failed to check witness authorization");
    }
  }
}

