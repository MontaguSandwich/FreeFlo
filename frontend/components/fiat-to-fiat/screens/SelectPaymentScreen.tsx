"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PaymentRow, GhostButton, NoticeBanner, phaseOfFour } from "../ui";

/**
 * zkp2p_select_payment (§5.8) — pick the payment to prove. Behaviour preserved:
 *  - maps flow.verifyData.rows; each row's onSelect calls handleSelectAndFulfill(r)
 *    (UNCHANGED — builds the buyerTee proof with params.index = originalIndex).
 *  - the "Refresh payments" ghost calls handleVerifyPayment (verbatim re-run).
 *  - empty state when `(verifyData?.rows.length ?? 0) === 0` (same condition).
 *
 * NEW (per spec): rows become cards, and the row whose amount equals the
 * expected flowData.usdAmount is highlighted with "✓ matches" to cut
 * mis-selection. Display-only — the same handler fires for whichever row is tapped.
 */
export function SelectPaymentScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { step, verifyData, flowData, handleSelectAndFulfill, handleVerifyPayment } = flow;
  const rows = verifyData?.rows ?? [];
  const expected = flowData.usdAmount;

  // The extension reports each row's `amount` in the provider's own units — which
  // for some providers (e.g. Revolut) is MINOR units (cents): a €0.10 payment
  // arrives as "10" and rendered raw as "10 EUR" (the ×100 bug). Detect the scale
  // ONCE against the amount the user was told to pay: if no row matches `expected`
  // as-is but one matches when divided by 100, the provider reports cents. This
  // also handles major-unit providers (divisor stays 1) and fixes the highlight.
  const parseAmt = (a?: string) => (a == null ? NaN : Number(String(a).replace(/[^0-9.]/g, "")));
  const near = (v: number) => Number.isFinite(v) && Math.abs(v - expected) < Math.max(0.01, expected * 0.02);
  const divisor =
    !rows.some((r) => near(parseAmt(r.amount))) && rows.some((r) => near(parseAmt(r.amount) / 100)) ? 100 : 1;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Which payment was it?
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            Pick the payment you just made — we verify it privately.
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      {rows.length === 0 ? (
        <NoticeBanner kind="warning">No payments found yet. Finish the payment, then Refresh.</NoticeBanner>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((r, i) => {
            const n = parseAmt(r.amount) / divisor;
            const matches = near(n);
            const amountLabel = Number.isFinite(n)
              ? `${n.toFixed(2)}${r.currency ? ` ${r.currency}` : ""}`
              : `Payment #${r.originalIndex}`;
            return (
              <PaymentRow
                key={r.paymentId || `${r.originalIndex}-${i}`}
                amountLabel={amountLabel}
                recipient={r.recipient || undefined}
                matches={matches}
                onSelect={() => handleSelectAndFulfill(r)}
              />
            );
          })}
        </Box>
      )}

      <GhostButton onClick={handleVerifyPayment} sx={{ alignSelf: "center" }}>
        Refresh payments
      </GhostButton>
    </Box>
  );
}
