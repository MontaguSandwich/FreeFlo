"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PrimaryButton, GhostButton, NoticeBanner, RiskGate, SummaryGroup, SummaryRow, phaseOfFour, groupIban } from "../ui";

/**
 * router_commit (§5.10) — confirm the SEPA quote (gravity #2). Behaviour preserved:
 *  - the CTA calls handleRouterCommit and is HARD-disabled when
 *    deadlineRemaining === 0 (INV-7 — committing a stale quote reverts).
 *  - the deadline warning shows for `< 300 && > 0` (warning) and `=== 0` (error)
 *    — the EXACT thresholds from the current component.
 *  - the full breakdown reads the same flowData fields
 *    (usdcAmount, quotedEurAmount, eurIban, recipientName).
 *
 * NEW (per spec): a RiskGate confirming the euro amount + destination. The ack
 * is presentational LOCAL state — it only adds to the CTA's disabled condition,
 * never weakening the on-chain deadline gate (the CTA stays disabled at expiry
 * regardless of the ack).
 */
export function CommitScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const {
    step, flowData, deadlineRemaining, formatUsdc, formatEur, formatCountdown,
    handleRouterCommit, handleReclaimTransfer, isCommitting, isReclaiming,
  } = flow;
  const [ack, setAck] = useState(false);

  const expired = deadlineRemaining === 0;
  const euroLabel = formatEur(flowData.quotedEurAmount);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Confirm your euro transfer
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            Lock in this quote and we send the SEPA payment
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      <SummaryGroup title="Quote">
        <SummaryRow label="USDC deposited" value={formatUsdc(flowData.usdcAmount)} />
        <SummaryRow label="You receive" value={`${euroLabel} (firm)`} accent />
        <SummaryRow label="To" value={flowData.recipientName || "recipient"} />
        <SummaryRow label="IBAN" value={groupIban(flowData.eurIban)} mono />
      </SummaryGroup>

      {/* Deadline warning — exact thresholds preserved */}
      {deadlineRemaining < 300 && deadlineRemaining > 0 && (
        <NoticeBanner kind="warning">
          Quote window closes in {formatCountdown(deadlineRemaining)}. Confirm now to avoid expiry.
        </NoticeBanner>
      )}
      {expired && (
        <NoticeBanner kind="error">Quote window has expired. The intent can no longer be committed.</NoticeBanner>
      )}

      {!expired && (
        <RiskGate
          warning="This sends euros to the bank account above."
          ackLabel={`Send ${euroLabel} to ${flowData.recipientName || "the recipient"}`}
          checked={ack}
          onChange={setAck}
        />
      )}

      <PrimaryButton
        onClick={handleRouterCommit}
        disabled={expired || !ack || isReclaiming}
        loading={isCommitting}
        loadingLabel="Confirming…"
      >
        Confirm &amp; send euros
      </PrimaryButton>

      {/* Escape hatch: if the solver has no on-chain quote (e.g. amount below its
          minimum), commit reverts — let the user reclaim the PENDING USDC and retry. */}
      <GhostButton
        onClick={handleReclaimTransfer}
        disabled={isCommitting}
        loading={isReclaiming}
        loadingLabel="Reclaiming…"
      >
        Cancel &amp; reclaim USDC
      </GhostButton>
    </Box>
  );
}
