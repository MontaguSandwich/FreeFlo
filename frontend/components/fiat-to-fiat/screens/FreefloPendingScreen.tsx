"use client";

import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { StatusScreen } from "../ui";

/**
 * freeflo_pending (§5.11) — sending euros. StatusScreen. No actions; the
 * IntentFulfilled poller (in the hook, enabled by step === "freeflo_pending"
 * && routerIntentId) is the only exit → success.
 */
export function FreefloPendingScreen(_props: { flow: FiatToFiatFlowApi }) {
  return (
    <StatusScreen
      title="Sending euros to your bank…"
      subtitle="A FreeFlo partner is sending the SEPA payment."
      hint="Usually 10–15 seconds"
    />
  );
}
