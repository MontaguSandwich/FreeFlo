"use client";

import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS } from "@/lib/platforms";
import { StatusScreen } from "../ui";

/**
 * finding_quotes (§5.3) — searching. StatusScreen spinner. Copy preserved
 * ("Finding partners… / Checking {platform} liquidity"). No actions; the hook
 * advances to select_maker or returns to input_all with a Notice on empty.
 */
export function FindingQuotesScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const platformName = PLATFORMS[flow.selectedPlatform]?.name || "payment";
  return <StatusScreen title="Finding partners…" subtitle={`Checking ${platformName} liquidity`} />;
}
