import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  OFFRAMP_V3_ABI,
  PAYMENT_VERIFIER_ABI,
  FIAT_TO_FIAT_ROUTER_ABI,
  type PaymentAttestationStruct,
} from "./abi-v3.js";
import {
  type IntentCreatedEvent,
  type QuoteSelectedEvent,
  type OnChainIntent,
  type OnChainQuote,
} from "./abi.js";
import { createLogger } from "../utils/logger.js";
import { RTPN } from "../types/index.js";

const log = createLogger("chain-v3");

export interface ChainClientV3Config {
  rpcUrl: string;
  chainId: number;
  offRampAddress: Address;
  verifierAddress: Address;
  solverPrivateKey: `0x${string}`;
  /** Optional FiatToFiatRouter — enables the gasless relayer-commit path. */
  routerAddress?: Address;
}

/**
 * Chain client for OffRampV3 contract with zkTLS verification
 */
export class ChainClientV3 {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private walletClient: any;
  private offRampAddress: Address;
  private verifierAddress: Address;
  private routerAddress?: Address;
  public solverAddress: Address;

  constructor(config: ChainClientV3Config) {
    const chain = config.chainId === 8453 ? base : baseSepolia;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    const account = privateKeyToAccount(config.solverPrivateKey);
    
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });

    this.offRampAddress = config.offRampAddress;
    this.verifierAddress = config.verifierAddress;
    this.routerAddress = config.routerAddress;
    this.solverAddress = account.address;

    log.info(
      {
        address: this.solverAddress,
        chain: chain.name,
        offRamp: this.offRampAddress,
        verifier: this.verifierAddress,
        router: this.routerAddress ?? "(relayer-commit disabled)",
      },
      "V3 Chain client initialized"
    );
  }

  // ============ Read Functions ============

  /**
   * Check if solver is registered (V3 is permissionless - just check if solverInfo exists)
   */
  async isAuthorizedSolver(): Promise<boolean> {
    // In V3, anyone can be a solver. Check if they've registered by checking solverSupportsRtpn
    // A registered solver will have at least one RTPN enabled
    const supportsSepa = await this.publicClient.readContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "solverSupportsRtpn",
      args: [this.solverAddress, 0], // SEPA_INSTANT = 0
    });
    return supportsSepa as boolean;
  }

  async solverSupportsRtpn(rtpn: RTPN): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "solverSupportsRtpn",
      args: [this.solverAddress, rtpn],
    });
    return result as boolean;
  }

  async getIntent(intentId: `0x${string}`): Promise<OnChainIntent> {
    const result = await this.publicClient.readContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "getIntent",
      args: [intentId],
    });
    return result as OnChainIntent;
  }

  async getQuote(intentId: `0x${string}`, solver: Address, rtpn: RTPN): Promise<OnChainQuote> {
    const result = await this.publicClient.readContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "getQuote",
      args: [intentId, solver, rtpn],
    });
    return result as OnChainQuote;
  }

  async canFulfill(intentId: `0x${string}`): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "canFulfill",
      args: [intentId],
    });
    return result as boolean;
  }

  async getCurrentBlock(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
  }

  async isWitnessAuthorized(witnessAddress: Address): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.verifierAddress,
      abi: PAYMENT_VERIFIER_ABI,
      functionName: "authorizedWitnesses",
      args: [witnessAddress],
    });
    return result as boolean;
  }

  async getDomainSeparator(): Promise<`0x${string}`> {
    const result = await this.publicClient.readContract({
      address: this.verifierAddress,
      abi: PAYMENT_VERIFIER_ABI,
      functionName: "DOMAIN_SEPARATOR",
    });
    return result as `0x${string}`;
  }

  // ============ Write Functions ============

  async submitQuote(
    intentId: `0x${string}`,
    rtpn: RTPN,
    fiatAmount: bigint,
    fee: bigint,
    estimatedTime: number
  ): Promise<`0x${string}`> {
    log.info(
      {
        intentId,
        rtpn,
        fiatAmount: fiatAmount.toString(),
        fee: fee.toString(),
        estimatedTime,
      },
      "Submitting quote on-chain (V3)"
    );

    const hash = await this.walletClient.writeContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "submitQuote",
      args: [intentId, rtpn, fiatAmount, fee, BigInt(estimatedTime)],
    });

    log.info({ hash }, "Quote submission transaction sent");

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === "reverted") {
      throw new Error(`Quote submission reverted: ${hash}`);
    }

    log.info({ hash, blockNumber: receipt.blockNumber }, "Quote submitted on-chain");
    return hash;
  }

  /**
   * Fulfill an intent with a zkTLS proof
   */
  async fulfillIntentWithProof(
    intentId: `0x${string}`,
    attestation: PaymentAttestationStruct,
    signature: `0x${string}`
  ): Promise<`0x${string}`> {
    log.info(
      {
        intentId,
        attestation: {
          intentHash: attestation.intentHash,
          amount: attestation.amount.toString(),
          timestamp: attestation.timestamp.toString(),
          paymentId: attestation.paymentId,
          dataHash: attestation.dataHash,
        },
      },
      "Fulfilling intent with zkTLS proof"
    );

    const hash = await this.walletClient.writeContract({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      functionName: "fulfillIntentWithProof",
      args: [intentId, attestation, signature],
    });

    log.info({ hash }, "Fulfillment transaction sent");

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === "reverted") {
      throw new Error(`Fulfillment transaction reverted: ${hash}`);
    }

    log.info({ hash, blockNumber: receipt.blockNumber }, "Fulfillment confirmed with zkTLS proof");
    return hash;
  }

  // ============ FiatToFiatRouter relayer-commit (gasless 3->2) ============

  /** True if `addr` is the configured FiatToFiatRouter (i.e. a router-created intent). */
  isRouterAddress(addr: string): boolean {
    return !!this.routerAddress && addr.toLowerCase() === this.routerAddress.toLowerCase();
  }

  /**
   * Relayer-commit a router-originated intent on the user's behalf (gasless 3->2).
   * Resolves the router's `user` for this intentId from TransferInitiated, then calls
   * FiatToFiatRouter.commitFor(user) — which auto-selects the best on-chain SEPA quote
   * >= the user's signed floor (best execution; the caller cannot route to a worse
   * solver). Best-effort and NON-FATAL: returns null if no router is configured, the
   * TransferInitiated isn't found, or the commit reverts (window closed / below floor /
   * already committed). The user can still self-commit via the frontend fallback.
   */
  async commitForRouterIntent(intentId: `0x${string}`): Promise<`0x${string}` | null> {
    if (!this.routerAddress) return null;
    // Resolve the router user for this intent (TransferInitiated.user, indexed). The
    // intent commits within OffRampV3's 15m window, so a recent lookback covers it.
    let user: Address;
    try {
      const current = await this.publicClient.getBlockNumber();
      const fromBlock = current > 2000n ? current - 2000n : 0n;
      const logs = await this.publicClient.getContractEvents({
        address: this.routerAddress,
        abi: FIAT_TO_FIAT_ROUTER_ABI,
        eventName: "TransferInitiated",
        args: { intentId },
        fromBlock,
        toBlock: current,
      });
      if (!logs || logs.length === 0) {
        log.warn(
          { intentId },
          "Router intent but no TransferInitiated in lookback window; skipping relayer commit"
        );
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user = (logs[0] as any).args.user as Address;
    } catch (error) {
      log.warn(
        { intentId, error: error instanceof Error ? error.message : error },
        "Relayer commit: failed to resolve router user (non-fatal)"
      );
      return null;
    }

    // The quote tx is already mined (submitQuote awaited its receipt), but
    // load-balanced public RPC nodes lag the chain tip — calling commitFor
    // immediately races that lag: the node serving the read hasn't seen the quote
    // block yet, so _bestSepaQuote reads 0 quotes and reverts SlippageExceeded.
    // Retry through the lag. A revert fails at gas-estimation (NO tx is sent, no gas
    // spent), so retrying is cheap and self-heals once the read node catches up. A
    // genuinely below-floor quote just exhausts the retries and the user's manual
    // commit (frontend fallback) takes over.
    const ATTEMPTS = 6;
    const RETRY_MS = 2000;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        log.info(
          { intentId, user, attempt },
          "Relayer-committing router intent for user (commitFor)"
        );
        const hash = await this.walletClient.writeContract({
          address: this.routerAddress,
          abi: FIAT_TO_FIAT_ROUTER_ABI,
          functionName: "commitFor",
          args: [user],
        });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          log.warn({ intentId, user, hash }, "commitFor tx reverted on-chain (non-fatal)");
          return null;
        }
        log.info(
          { intentId, user, hash, blockNumber: receipt.blockNumber, attempt },
          "✅ Relayer commit confirmed (user paid no gas)"
        );
        return hash;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < ATTEMPTS) {
          log.info(
            { intentId, attempt, nextInMs: RETRY_MS },
            "commitFor not landable yet (quote likely not visible on the read node); retrying"
          );
          await new Promise((r) => setTimeout(r, RETRY_MS));
        } else {
          log.warn(
            { intentId, user, attempts: ATTEMPTS, error: msg },
            "Relayer commitFor failed after retries (non-fatal); user can self-commit"
          );
          return null;
        }
      }
    }
    return null;
  }

  // ============ Event Watching (eth_getLogs polling) ============
  // Uses getContractEvents (eth_getLogs) instead of watchContractEvent (eth_newFilter)
  // because public RPCs don't support server-side filters.

  private async pollEvents(
    eventName: string,
    fromBlock: bigint,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onEvent: (eventLog: any) => void,
    stopped: { value: boolean }
  ): Promise<void> {
    // Start a few blocks behind to avoid load balancer inconsistency
    let lastBlock = fromBlock > 5n ? fromBlock - 5n : 0n;

    while (!stopped.value) {
      try {
        const currentBlock = await this.publicClient.getBlockNumber();
        // Safety margin: query up to 3 blocks behind tip to ensure all
        // load-balanced nodes have the data
        const safeBlock = currentBlock > 3n ? currentBlock - 3n : currentBlock;

        if (safeBlock > lastBlock) {
          const logs = await this.publicClient.getContractEvents({
            address: this.offRampAddress,
            abi: OFFRAMP_V3_ABI,
            eventName,
            fromBlock: lastBlock + 1n,
            toBlock: safeBlock,
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const eventLog of logs as any[]) {
            onEvent(eventLog);
          }

          lastBlock = safeBlock;
        }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : error },
          `${eventName} watcher error`
        );
      }
      await new Promise(resolve => setTimeout(resolve, 4_000));
    }
  }

  watchIntentCreated(
    fromBlock: bigint,
    onIntent: (event: IntentCreatedEvent, blockNumber: bigint) => void
  ): () => void {
    log.info({ fromBlock: fromBlock.toString() }, "Starting IntentCreated watcher (V3)");

    const stopped = { value: false };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pollEvents("IntentCreated", fromBlock, (eventLog: any) => {
      const args = eventLog.args as unknown as IntentCreatedEvent;
      log.info(
        {
          intentId: args.intentId,
          depositor: args.depositor,
          usdcAmount: args.usdcAmount.toString(),
          currency: args.currency,
        },
        "New intent detected (V3)"
      );
      onIntent(args, eventLog.blockNumber);
    }, stopped);

    return () => { stopped.value = true; };
  }

  watchQuoteSelected(
    fromBlock: bigint,
    onQuoteSelected: (event: QuoteSelectedEvent, blockNumber: bigint) => void
  ): () => void {
    log.info({ fromBlock: fromBlock.toString() }, "Starting QuoteSelected watcher (V3)");

    const stopped = { value: false };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pollEvents("QuoteSelected", fromBlock, (eventLog: any) => {
      const args = eventLog.args as unknown as QuoteSelectedEvent;
      log.info(
        {
          intentId: args.intentId,
          solver: args.solver,
          rtpn: args.rtpn,
          fiatAmount: args.fiatAmount.toString(),
        },
        "Quote selected (V3)"
      );
      onQuoteSelected(args, eventLog.blockNumber);
    }, stopped);

    return () => { stopped.value = true; };
  }

  // ============ Historical Events ============

  async getHistoricalIntentCreated(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<Array<{ event: IntentCreatedEvent; blockNumber: bigint }>> {
    const logs = await this.publicClient.getContractEvents({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      eventName: "IntentCreated",
      fromBlock,
      toBlock,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return logs.map((eventLog: any) => ({
      event: eventLog.args as unknown as IntentCreatedEvent,
      blockNumber: eventLog.blockNumber,
    }));
  }

  async getHistoricalQuoteSelected(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<Array<{ event: QuoteSelectedEvent; blockNumber: bigint }>> {
    const logs = await this.publicClient.getContractEvents({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      eventName: "QuoteSelected",
      fromBlock,
      toBlock,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return logs.map((eventLog: any) => ({
      event: eventLog.args as unknown as QuoteSelectedEvent,
      blockNumber: eventLog.blockNumber,
    }));
  }
}

