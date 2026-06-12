"use client";

import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { StatusScreen, GhostButton } from "../ui";

/**
 * zkp2p_authenticating (§5.7) — extension capture in progress. The Verify node
 * becomes a live CountdownRing (lock skin, ~30s). Crypto vocabulary hidden.
 * Behaviour preserved: the Back ghost returns to zkp2p_verify via setStep
 * ("zkp2p_verify") — the EXACT call the current component makes. setStep here is
 * the hook's setter (not new screen state); it's the same Back affordance.
 */
export function AuthenticatingScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  return (
    <StatusScreen
      variant="ring-verify"
      approxLabel="~30s"
      title="Verifying your payment"
      subtitle="Finishing sign-in… your recent payments will load here."
      footer={<GhostButton onClick={() => flow.setStep("zkp2p_verify")}>Back</GhostButton>}
    />
  );
}
