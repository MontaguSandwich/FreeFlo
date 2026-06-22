import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { base } from "viem/chains";
import type { Config } from "./config.js";

export const routerAbi = parseAbi([
  "function getPendingTransfer(address user) view returns ((address user, bytes32 intentId, uint256 usdcAmount, string iban, string recipientName, uint256 minEurAmount, uint256 createdAt, uint8 status))",
  "event TransferInitiated(address indexed user, bytes32 indexed intentId, bytes32 indexed zkp2pIntentHash, uint256 usdcAmount, string iban, string recipientName, uint256 minEurAmount)",
]);

export const offrampAbi = parseAbi([
  "function getIntent(bytes32 intentId) view returns ((address depositor, uint256 usdcAmount, uint8 currency, uint8 status, uint64 createdAt, uint64 committedAt, address selectedSolver, uint8 selectedRtpn, uint256 selectedFiatAmount, string receivingInfo, string recipientName, bytes32 transferId))",
]);

// FiatToFiatRouter.TransferStatus
export const TS = { NONE: 0, PENDING: 1, COMMITTED: 2, COMPLETED: 3, CANCELLED: 4, EXPIRED: 5 } as const;
// OffRampV3.IntentStatus
export const IS = { NONE: 0, PENDING_QUOTE: 1, COMMITTED: 2, FULFILLED: 3, CANCELLED: 4, EXPIRED: 5 } as const;

export type RouterSlot = {
  user: `0x${string}`;
  intentId: `0x${string}`;
  usdcAmount: bigint;
  createdAt: bigint;
  status: number;
};

export type OfframpIntent = {
  status: number;
  committedAt: bigint;
  transferId: `0x${string}`;
};

export function makeClient(cfg: Config) {
  return createPublicClient({ chain: base, transport: http(cfg.rpcUrl) });
}

export type SentinelClient = ReturnType<typeof makeClient>;

export async function readRouterSlot(
  client: SentinelClient,
  router: `0x${string}`,
  user: `0x${string}`,
): Promise<RouterSlot> {
  const t = await client.readContract({ address: router, abi: routerAbi, functionName: "getPendingTransfer", args: [user] });
  return { user: t.user, intentId: t.intentId, usdcAmount: t.usdcAmount, createdAt: t.createdAt, status: Number(t.status) };
}

export async function readOfframpIntent(
  client: SentinelClient,
  offramp: `0x${string}`,
  intentId: `0x${string}`,
): Promise<OfframpIntent> {
  const i = await client.readContract({ address: offramp, abi: offrampAbi, functionName: "getIntent", args: [intentId] });
  return { status: Number(i.status), committedAt: i.committedAt, transferId: i.transferId };
}

/** Scan TransferInitiated over a block window (chunked) → unique router users. */
export async function scanRouterUsers(
  client: SentinelClient,
  cfg: Config,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<`0x${string}`[]> {
  const users = new Set<string>();
  for (let start = fromBlock; start <= toBlock; start += cfg.chunkBlocks) {
    const end = start + cfg.chunkBlocks - 1n > toBlock ? toBlock : start + cfg.chunkBlocks - 1n;
    try {
      const logs = await client.getContractEvents({
        address: cfg.router,
        abi: routerAbi,
        eventName: "TransferInitiated",
        fromBlock: start,
        toBlock: end,
      });
      for (const l of logs) if (l.args.user) users.add(getAddress(l.args.user).toLowerCase());
    } catch (err) {
      console.warn(`  ⚠ getLogs ${start}-${end} failed (${(err as Error).message.split("\n")[0]}) — skipping chunk`);
    }
  }
  return [...users] as `0x${string}`[];
}
