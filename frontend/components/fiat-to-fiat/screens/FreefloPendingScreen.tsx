"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { StatusScreen, NoticeBanner, DangerButton } from "../ui";

/**
 * freeflo_pending (§5.11) — sending euros. Normally a passive StatusScreen whose only exit
 * is the IntentFulfilled poller → success. If the solver reports a TERMINAL failure during
 * the wait (e.g. the recipient isn't a trusted Qonto beneficiary), the hook's status poller
 * sets `offrampError` and we surface the real reason + a reclaim escape here — immediately,
 * instead of spinning until the 15-minute deadline.
 */
export function FreefloPendingScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { offrampError, handleReclaimTransfer, isReclaiming } = flow;

  if (offrampError) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, py: 2 }}>
        <Typography variant="h4" sx={{ color: (t) => t.ff.text }}>
          Payout couldn’t be completed
        </Typography>
        <NoticeBanner kind="error">{offrampError}</NoticeBanner>
        <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
          Your USDC is safe and still held in the offramp — nothing was sent. Reclaim it back to
          your wallet and try again.
        </Typography>
        <DangerButton loading={isReclaiming} loadingLabel="Reclaiming…" onClick={handleReclaimTransfer}>
          Reclaim my USDC
        </DangerButton>
      </Box>
    );
  }

  return (
    <StatusScreen
      title="Sending euros to your bank…"
      subtitle="A FreeFlo partner is sending the SEPA payment."
      hint="Usually 10–15 seconds"
    />
  );
}
