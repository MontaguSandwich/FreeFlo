// Datacenter-side twin of iptest.ts — runs INSIDE the prod container against the compiled dist
// (no tsx in the prod image). Same probe: EUR 0.01 to a trusted beneficiary, report instant vs standard.
//   docker compose exec -e TEST_IBAN=.. -e TEST_NAME=".." solver node /app/iptest.mjs box-datacenter
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.ENV_FILE || "/app/solver.env", override: true });

import { randomBytes } from "node:crypto";
import { createQontoProvider } from "./dist/providers/qonto.js";
import { Currency, RTPN } from "./dist/types/index.js";

const label = process.argv[2] || "iptest";
const iban = process.env.TEST_IBAN || "";
const name = process.env.TEST_NAME || "";
if (!iban || !name) { console.error("set TEST_IBAN and TEST_NAME"); process.exit(1); }

const provider = createQontoProvider(process.env, "0x0000000000000000000000000000000000000000");
const intentId = "0x" + randomBytes(32).toString("hex");
const start = Date.now();
console.log(`[${label}] firing EUR 0.01 -> ${name} / ${iban.slice(0, 12)}...  intent=${intentId.slice(0, 12)}`);

try {
  const r = await provider.executeTransfer({
    intentId, usdcAmount: 1000000n, fiatAmount: 1n,
    currency: Currency.EUR, rtpn: RTPN.SEPA_INSTANT,
    receivingInfo: iban, recipientName: name,
  });
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${label}] after ${secs}s: success=${r.success} transferId=${r.transferId} error=${r.error || "none"}`);
  console.log(`[${label}] VERDICT: ${r.success ? "INSTANT" : "NOT instant (standard/declined)"}`);
  process.exit(0);
} catch (e) {
  console.error(`[${label}] ERROR:`, e?.message || e);
  process.exit(1);
}
