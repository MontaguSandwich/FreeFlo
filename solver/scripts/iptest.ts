/**
 * One-off Qonto SEPA instant-vs-standard A/B probe.
 *
 * Fires a €0.01 transfer to a trusted beneficiary via the real provider path
 * (VoP -> create -> poll up to ~30s -> cancel if it didn't settle fast) and
 * reports whether it settled INSTANT. Run the SAME probe from a residential IP
 * (laptop) vs a datacenter IP (server) to isolate the source-IP variable.
 *
 *   ENV_FILE=.env.production TEST_IBAN=FR... TEST_NAME="..." npx tsx scripts/iptest.ts <label>
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.ENV_FILE || ".env.production", override: true });

import { randomBytes } from "node:crypto";
import { createQontoProvider } from "../src/providers/qonto.js";
import { Currency, RTPN } from "../src/types/index.js";

const label = process.argv[2] || "iptest";
const iban = process.env.TEST_IBAN || "";
const name = process.env.TEST_NAME || "";
if (!iban || !name) {
  console.error("set TEST_IBAN and TEST_NAME");
  process.exit(1);
}

const provider = createQontoProvider(
  process.env as unknown as Parameters<typeof createQontoProvider>[0],
  "0x0000000000000000000000000000000000000000"
);

const intentId = "0x" + randomBytes(32).toString("hex"); // unique -> distinct Qonto idempotency key
const start = Date.now();
console.log(`[${label}] firing EUR 0.01 -> ${name} / ${iban.slice(0, 12)}...  intent=${intentId.slice(0, 12)}`);

provider
  .executeTransfer({
    intentId,
    usdcAmount: 1_000_000n,
    fiatAmount: 1n, // EUR 0.01 (2 decimals)
    currency: Currency.EUR,
    rtpn: RTPN.SEPA_INSTANT,
    receivingInfo: iban,
    recipientName: name,
  })
  .then((r) => {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${label}] result after ${secs}s:`, JSON.stringify(r));
    console.log(
      `[${label}] VERDICT: ${
        r.success
          ? "INSTANT (settled within the ~30s window)"
          : "NOT instant (standard/declined — did not settle fast)"
      }`
    );
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[${label}] ERROR:`, e?.message || e);
    process.exit(1);
  });
