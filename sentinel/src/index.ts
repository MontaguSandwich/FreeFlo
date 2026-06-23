import { config } from "./config.js";
import { makeClient } from "./chain.js";
import { detectOnchainStuck } from "./detectors/onchain.js";
import { detectSolverHealth } from "./detectors/solver.js";
import { loadState, saveState, reconcile } from "./store.js";
import { alertNew, alertResolved } from "./alert.js";
import { selfHeal } from "./heal.js";
import type { Incident } from "./types.js";

const SEV_ICON: Record<Incident["severity"], string> = { info: "·", warning: "▲", critical: "✖" };

function printIncidents(incidents: Incident[]) {
  if (incidents.length === 0) {
    console.log("✓ No incidents.");
    return;
  }
  const order = { critical: 0, warning: 1, info: 2 } as const;
  [...incidents]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .forEach((i) => {
      console.log(`${SEV_ICON[i.severity]} [${i.severity.toUpperCase()}] ${i.class} ${i.autonomous ? "(auto-heal)" : "(alert/approve)"}`);
      console.log(`   ${i.subject} — ${i.detail}`);
      console.log(`   recovery: ${i.recovery}`);
    });
}

async function sweep() {
  const client = makeClient(config);
  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`\nSentinel sweep @ ${new Date().toISOString()}  (autoheal=${config.autoheal})`);

  const incidents: Incident[] = [];
  try {
    incidents.push(...(await detectOnchainStuck(client, config)));
  } catch (e) {
    console.error("onchain detector failed:", (e as Error).message);
  }
  try {
    incidents.push(...(await detectSolverHealth(config, nowSec)));
  } catch (e) {
    console.error("solver detector failed:", (e as Error).message);
  }

  printIncidents(incidents);

  // Persist + dedupe → alert only on newly-appeared and newly-resolved incidents.
  const state = loadState();
  const { newly, resolved } = reconcile(state, incidents, nowSec);
  saveState(state);

  if (newly.length) {
    console.log(`→ alerting ${newly.length} new incident(s)`);
    await alertNew(config, newly);
  }
  if (resolved.length) {
    console.log(`→ ${resolved.length} resolved`);
    await alertResolved(config, resolved);
  }

  // Gated, non-refund self-healing (acts only on autonomous incidents).
  for (const line of await selfHeal(config, newly)) console.log("  " + line);

  return incidents;
}

const once = process.argv.includes("--once");

if (once) {
  await sweep();
} else {
  const everyMs = Number(process.env.SENTINEL_INTERVAL_MS ?? 120_000);
  console.log(`FreeFlo Sentinel loop — sweeping every ${everyMs / 1000}s (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sweep().catch((e) => console.error("sweep error:", e));
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
