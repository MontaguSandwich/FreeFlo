"use client";

import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { StatusScreen } from "../ui";

/**
 * router_waiting (§5.10) — preparing the euro quote. StatusScreen. No actions;
 * the quote-poll effect (in the hook) advances to router_commit. The rail shows
 * the live deadline clock now that routerIntentCreatedAt exists (shell-driven).
 */
export function RouterWaitingScreen(_props: { flow: FiatToFiatFlowApi }) {
  return (
    <StatusScreen title="Preparing your euro quote…" subtitle="A FreeFlo partner is quoting your rate." />
  );
}
