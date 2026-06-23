import { parseAbi, getAddress } from "viem";
import { config } from "./config.js";
import { makeClient } from "./chain.js";
import { postTelegram } from "./alert.js";
import { loadCursor, saveCursor } from "./store.js";

// FreeFlo trade tracker — a positive activity feed (separate Telegram bot) that posts each
// OffRampV3 intent's lifecycle: created → quote committed → fulfilled (or cancelled). Inspired
// by the Peer order bot. Read-only (events + a persisted block cursor); never acts on-chain.

const CURRENCY = ["EUR", "GBP", "USD", "BRL", "INR"];
const RTPN = ["SEPA Instant", "SEPA Standard", "FPS", "BACS", "PIX", "TED", "UPI", "IMPS", "FedNow", "ACH"];
const RTPN_CCY = ["EUR", "EUR", "GBP", "GBP", "BRL", "BRL", "INR", "INR", "USD", "USD"];

// OffRampV3 lifecycle events (Solidity enums ABI-encode as uint8).
const eventsAbi = parseAbi([
  "event IntentCreated(bytes32 indexed intentId, address indexed depositor, uint256 usdcAmount, uint8 currency)",
  "event QuoteSelected(bytes32 indexed intentId, address indexed solver, uint8 rtpn, uint256 fiatAmount, string receivingInfo, string recipientName)",
  "event IntentFulfilled(bytes32 indexed intentId, address indexed solver, bytes32 transferId, uint256 fiatSent, bool verifiedByZkTLS)",
  "event IntentCancelled(bytes32 indexed intentId)",
]);

const short = (s: string, h = 6, t = 4) => (s && s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);
const usdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(2)} USDC`;
const amt2 = (v: bigint) => (Number(v) / 100).toFixed(2); // fiat amounts are 2-decimal
const txUrl = (h?: string | null) => (h ? `\nhttps://basescan.org/tx/${h}` : "");

function fmt(eventName: string, a: any, txHash: string | null): string | null {
  const id = short(String(a.intentId));
  switch (eventName) {
    case "IntentCreated": {
      const f2f = getAddress(a.depositor).toLowerCase() === config.router.toLowerCase();
      return `🟡 Offramp created · ${f2f ? "Fiat-to-Fiat" : "Direct"}\nIntent: ${id}\nFrom: ${short(a.depositor)}\nAmount: ${usdc(a.usdcAmount)} → ${CURRENCY[Number(a.currency)] ?? "?"}${txUrl(txHash)}`;
    }
    case "QuoteSelected":
      return `🔵 Quote committed\nIntent: ${id}\nSolver: ${short(a.solver)}\nYou receive: ${amt2(a.fiatAmount)} ${RTPN_CCY[Number(a.rtpn)] ?? ""} via ${RTPN[Number(a.rtpn)] ?? "?"}\nTo: ${a.recipientName || "recipient"}${txUrl(txHash)}`;
    case "IntentFulfilled":
      return `🟢 Fulfilled — fiat sent ✅\nIntent: ${id}\nSent: ${amt2(a.fiatSent)}${a.verifiedByZkTLS ? " (zkTLS-verified)" : ""}${txUrl(txHash)}`;
    case "IntentCancelled":
      return `🔴 Cancelled — USDC reclaimed\nIntent: ${id}${txUrl(txHash)}`;
    default:
      return null;
  }
}

type Client = ReturnType<typeof makeClient>;

// Collect ordered, formatted messages for OffRampV3 events in [from, to] (chunked).
// Throws on any chunk failure so the caller can avoid advancing the cursor and retry.
async function collect(client: Client, from: bigint, to: bigint): Promise<string[]> {
  const logs: any[] = [];
  for (let start = from; start <= to; start += config.chunkBlocks) {
    const end = start + config.chunkBlocks - 1n > to ? to : start + config.chunkBlocks - 1n;
    const chunk = await client.getContractEvents({ address: config.offramp, abi: eventsAbi, fromBlock: start, toBlock: end });
    logs.push(...chunk);
  }
  logs.sort((x, y) =>
    x.blockNumber === y.blockNumber
      ? Number((x.logIndex ?? 0) - (y.logIndex ?? 0))
      : Number((x.blockNumber ?? 0n) - (y.blockNumber ?? 0n)),
  );
  return logs.map((l) => fmt(l.eventName, l.args, l.transactionHash)).filter((m): m is string => m !== null);
}

async function tick(client: Client): Promise<void> {
  const latest = await client.getBlockNumber();
  let cursor = loadCursor();
  if (cursor === null) {
    // Forward-only by default — start at the current block so we don't dump history.
    cursor = config.tracker.startBlock ?? latest;
    saveCursor(cursor);
    console.log(`tracker cursor initialized at block ${cursor}`);
    return;
  }
  if (latest <= cursor) return;
  const from = cursor + 1n;
  let messages: string[];
  try {
    messages = await collect(client, from, latest);
  } catch (err) {
    console.warn(`tracker scan ${from}-${latest} failed: ${(err as Error).message.split("\n")[0]} (will retry)`);
    return; // don't advance the cursor — retry the whole range next tick (no missed events)
  }
  for (const msg of messages) {
    await postTelegram(config.tracker.token, config.tracker.chatId, msg);
    await new Promise((r) => setTimeout(r, 150)); // gentle on Telegram's rate limit
  }
  saveCursor(latest);
  if (messages.length) console.log(`tracker: posted ${messages.length} event(s); cursor → ${latest}`);
}

// ---- entry ----
const client = makeClient(config);
console.log(`FreeFlo trade tracker — offramp=${config.offramp}, interval=${config.tracker.intervalMs / 1000}s`);
if (!config.tracker.token || !config.tracker.chatId) {
  console.warn("⚠ TRACKER_BOT_TOKEN / TRACKER_CHAT_ID not set — events detected but not posted.");
}

if (process.argv.includes("--dry")) {
  // Verification: print formatted messages for a recent window; post nothing.
  const latest = await client.getBlockNumber();
  const window = config.tracker.startBlock ?? 30000n;
  const from = latest > window ? latest - window : 0n;
  console.log(`[dry] scanning ${from}-${latest} (no posts)…\n`);
  const messages = await collect(client, from, latest);
  console.log(`[dry] ${messages.length} event(s):\n`);
  for (const m of messages) console.log(m + "\n");
} else if (process.argv.includes("--once")) {
  await tick(client);
} else {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick(client).catch((e) => console.error("tracker tick error:", e));
    await new Promise((r) => setTimeout(r, config.tracker.intervalMs));
  }
}
