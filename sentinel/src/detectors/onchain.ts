import { getAddress } from "viem";
import type { Config } from "../config.js";
import type { Incident } from "../types.js";
import { IS, TS, readRouterSlot, readOfframpIntent, scanRouterUsers, type SentinelClient } from "../chain.js";

/**
 * Detect stuck on-chain states by inspecting each active router user's slot (and, when
 * COMMITTED, its underlying OffRampV3 intent). Read-only — emits Incidents, never acts.
 * Refund-class incidents are flagged autonomous:false (a user clicks the in-UI reclaim,
 * or we alert) per the non-refund-only autonomy rule.
 */
export async function detectOnchainStuck(client: SentinelClient, cfg: Config): Promise<Incident[]> {
  const latest = await client.getBlock({ blockTag: "latest" });
  if (latest.number === null) throw new Error("latest block has no number");
  const nowSec = Number(latest.timestamp);
  const fromBlock = latest.number > cfg.lookbackBlocks ? latest.number - cfg.lookbackBlocks : 0n;

  const scanned = await scanRouterUsers(client, cfg, fromBlock, latest.number);
  const users = [...new Set([...scanned, ...cfg.watchUsers.map((u) => u.toLowerCase())])] as `0x${string}`[];
  console.log(`  scanned blocks ${fromBlock}-${latest.number}: ${scanned.length} user(s) from events, ${users.length} total to check`);

  const incidents: Incident[] = [];

  for (const user of users) {
    let slot;
    try {
      slot = await readRouterSlot(client, cfg.router, getAddress(user));
    } catch (err) {
      console.warn(`  ⚠ read slot ${user} failed: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    if (slot.status === TS.NONE || slot.status >= TS.COMPLETED) continue; // free / terminal

    const ageMin = Math.round((nowSec - Number(slot.createdAt)) / 60);
    const usdc = (Number(slot.usdcAmount) / 1e6).toFixed(4);

    if (slot.status === TS.PENDING) {
      const pastWindow = nowSec > Number(slot.createdAt) + cfg.COMMIT_TIMEOUT;
      incidents.push({
        id: `router-pending:${user}:${slot.intentId}`,
        class: pastWindow ? "router-pending-timed-out" : "router-pending-waiting",
        severity: pastWindow ? "warning" : "info",
        subject: user,
        detail: `Router slot PENDING ${ageMin}m (${usdc} USDC). ${pastWindow ? "Past the 15m commit window." : "Still awaiting commit."}`,
        recovery: pastWindow
          ? "User: cancel() now, or anyone: rescueTimedOut(user). Refund — surface the in-UI reclaim button / alert."
          : "Within window — the relayer/user can still commit. Watch only.",
        autonomous: false, // refund-class or just-watch
        ts: nowSec,
      });
      continue;
    }

    // COMMITTED → inspect the underlying OffRampV3 intent.
    let intent;
    try {
      intent = await readOfframpIntent(client, cfg.offramp, slot.intentId);
    } catch (err) {
      console.warn(`  ⚠ read intent ${slot.intentId} failed: ${(err as Error).message.split("\n")[0]}`);
      continue;
    }
    const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const noFiatSent = intent.transferId === ZERO;
    const committedAgoMin = Math.round((nowSec - Number(intent.committedAt)) / 60);
    const pastFulfil = nowSec > Number(intent.committedAt) + cfg.FULFILLMENT_WINDOW;

    if (intent.status === IS.FULFILLED) continue; // done; markComplete is cosmetic

    if (intent.status === IS.COMMITTED && pastFulfil) {
      incidents.push({
        id: `router-committed-stuck:${user}:${slot.intentId}`,
        class: "router-committed-stuck",
        severity: "critical",
        subject: user,
        detail: `Router COMMITTED ${usdc} USDC; offramp intent committed ${committedAgoMin}m ago, NOT fulfilled${noFiatSent ? " (no fiat sent — transferId empty)" : ""}. Blocks this wallet's next intent (0x4c0b07ac).`,
        recovery: "Anyone: rescueCommitted(user) (window passed → succeeds). Refund — surface the in-UI 'Reclaim previous transfer' button / alert the user.",
        autonomous: false, // refund
        ts: nowSec,
      });
    } else if (intent.status === IS.COMMITTED) {
      incidents.push({
        id: `router-committed-inflight:${user}:${slot.intentId}`,
        class: "router-committed-inflight",
        severity: "info",
        subject: user,
        detail: `Router COMMITTED ${usdc} USDC; offramp in-flight (committed ${committedAgoMin}m ago, ${30 - committedAgoMin}m left). Solver should fulfill or it becomes rescuable.`,
        recovery: "Within the 30m fulfilment window — watch. If it lapses it becomes a router-committed-stuck.",
        autonomous: false,
        ts: nowSec,
      });
    } else if (intent.status === IS.PENDING_QUOTE) {
      incidents.push({
        id: `router-committed-noquote:${user}:${slot.intentId}`,
        class: "router-committed-inflight",
        severity: "warning",
        subject: user,
        detail: `Router COMMITTED ${usdc} USDC but the offramp intent is still PENDING_QUOTE — no solver quote landed. Likely sub-minimum or solver down.`,
        recovery: "If no quote ever lands, the slot times out → rescuable. Watch; escalate if the solver isn't quoting.",
        autonomous: false,
        ts: nowSec,
      });
    }
  }

  return incidents;
}
