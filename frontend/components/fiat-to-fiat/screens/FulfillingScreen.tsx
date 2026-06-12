"use client";

import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { StatusScreen, DangerButton } from "../ui";

/**
 * zkp2p_fulfilling (§5.9) — releasing USDC. Crypto vocabulary hidden
 * ("Confirming your proof", not "fulfillIntent"). Behaviour preserved:
 *  - the mandatory escape hatch calls handleCancelIntent (isCancelling) — the
 *    extension drives proof + fulfill off-screen, so this rescues the
 *    "extension errored off-screen" dead-end (INV-9).
 *  - the ONLY forward exit is the TransferInitiated poller (in the hook), →
 *    router_waiting; the view adds no exit.
 */
export function FulfillingScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { isCancelling, handleCancelIntent } = flow;
  return (
    <StatusScreen
      variant="ring-verify"
      approxLabel="~30s"
      title="Confirming your proof…"
      subtitle="Releasing USDC and starting your euro conversion."
      hint="Waiting for on-chain confirmation"
      footer={
        <DangerButton onClick={handleCancelIntent} loading={isCancelling} loadingLabel="Cancelling…">
          Stuck? Cancel &amp; reclaim
        </DangerButton>
      }
    />
  );
}
