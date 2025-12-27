import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  stringToBytes,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  OFFRAMP_ABI,
  type IntentCreatedEvent,
  type QuoteSelectedEvent,
  type OnChainIntent,
  type OnChainQuote,
} from "./abi.js";
import { createLogger } from "../utils/logger.js";
import { RTPN } from "../types/index.js";

const log = createLogger("chain");

export interface ChainClientConfig {
  rpcUrl: string;
  chainId: number;
  contractAddress: Address;
  solverPrivateKey: `0x${string}`;
}

/**
 * Chain client for OffRamp contract
 */
export class ChainClient {
  // Using 'any' to avoid complex viem type issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private walletClient: any;
  private contractAddress: Address;
  public solverAddress: Address;

  constructor(config: ChainClientConfig) {
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

    this.contractAddress = config.contractAddress;
    this.solverAddress = account.address;

    log.info(
      { address: this.solverAddress, chain: chain.name, contract: this.contractAddress },
      "Chain client initialized"
    );
  }

  // ============ Read Functions ============

  async isAuthorizedSolver(): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "authorizedSolvers",
      args: [this.solverAddress],
    });
    return result as boolean;
  }

  async solverSupportsRtpn(rtpn: RTPN): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "solverSupportsRtpn",
      args: [this.solverAddress, rtpn],
    });
    return result as boolean;
  }

  async getIntent(intentId: `0x${string}`): Promise<OnChainIntent> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "getIntent",
      args: [intentId],
    });
    return result as OnChainIntent;
  }

  async getQuote(intentId: `0x${string}`, solver: Address, rtpn: RTPN): Promise<OnChainQuote> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "getQuote",
      args: [intentId, solver, rtpn],
    });
    return result as OnChainQuote;
  }

  async canFulfill(intentId: `0x${string}`): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "canFulfill",
      args: [intentId],
    });
    return result as boolean;
  }

  async getCurrentBlock(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
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
      "Submitting quote on-chain"
    );

    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
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

  async fulfillIntent(
    intentId: `0x${string}`,
    transferId: string,
    fiatSent: bigint
  ): Promise<`0x${string}`> {
    // Convert transfer ID to bytes32
    const transferIdBytes32 = keccak256(toHex(stringToBytes(transferId)));

    log.info(
      {
        intentId,
        transferId,
        transferIdBytes32,
        fiatSent: fiatSent.toString(),
      },
      "Submitting fulfillment transaction"
    );

    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
      functionName: "fulfillIntent",
      args: [intentId, transferIdBytes32, fiatSent],
    });

    log.info({ hash }, "Fulfillment transaction sent");

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === "reverted") {
      throw new Error(`Fulfillment transaction reverted: ${hash}`);
    }

    log.info({ hash, blockNumber: receipt.blockNumber }, "Fulfillment confirmed");
    return hash;
  }

  // ============ Event Watching ============

  watchIntentCreated(
    fromBlock: bigint,
    onIntent: (event: IntentCreatedEvent, blockNumber: bigint) => void
  ): () => void {
    log.info({ fromBlock: fromBlock.toString() }, "Starting IntentCreated watcher");

    const unwatch = this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
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
            "New intent detected"
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
    log.info({ fromBlock: fromBlock.toString() }, "Starting QuoteSelected watcher");

    const unwatch = this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
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
            "Quote selected"
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
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
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
      address: this.contractAddress,
      abi: OFFRAMP_ABI,
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

