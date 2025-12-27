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
    this.solverAddress = account.address;

    log.info(
      {
        address: this.solverAddress,
        chain: chain.name,
        offRamp: this.offRampAddress,
        verifier: this.verifierAddress,
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

  // ============ Event Watching ============

  watchIntentCreated(
    fromBlock: bigint,
    onIntent: (event: IntentCreatedEvent, blockNumber: bigint) => void
  ): () => void {
    log.info({ fromBlock: fromBlock.toString() }, "Starting IntentCreated watcher (V3)");

    const unwatch = this.publicClient.watchContractEvent({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      eventName: "IntentCreated",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onLogs: (logs: any[]) => {
        for (const eventLog of logs) {
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
        }
      },
    });

    return unwatch;
  }

  watchQuoteSelected(
    fromBlock: bigint,
    onQuoteSelected: (event: QuoteSelectedEvent, blockNumber: bigint) => void
  ): () => void {
    log.info({ fromBlock: fromBlock.toString() }, "Starting QuoteSelected watcher (V3)");

    const unwatch = this.publicClient.watchContractEvent({
      address: this.offRampAddress,
      abi: OFFRAMP_V3_ABI,
      eventName: "QuoteSelected",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onLogs: (logs: any[]) => {
        for (const eventLog of logs) {
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
        }
      },
    });

    return unwatch;
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

