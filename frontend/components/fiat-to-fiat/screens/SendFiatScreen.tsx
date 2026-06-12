"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS, CURRENCIES } from "@/lib/platforms";
import { PrimaryButton, DangerButton, DoDontList, RiskGate, phaseOfFour } from "../ui";

/**
 * zkp2p_send_venmo (§5.6) — the gravity screen. A real, irreversible payment.
 * Behaviour preserved:
 *  - the primary CTA calls handleVenmoSent (→ zkp2p_verify), UNCHANGED handler.
 *  - "Cancel & reclaim" calls handleCancelIntent with the isCancelling flag
 *    (INV-9 — the escape hatch stays reachable here).
 *  - the payee handle is shown here ONLY (formatPayee(zkp2pQuote.payeeUsername),
 *    with its humane fallback), with a copy affordance.
 *
 * NEW (per spec): a do/don't checklist + a RiskGate that gates the CTA at the
 * moment of payment. The ack toggle is purely presentational LOCAL state — it
 * never touches the flow hook / pollers / persistence / setStep; it only sets
 * the CTA's `disabled`. The handler wiring is identical to today.
 */
export function SendFiatScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { step, flowData, selectedPlatform, selectedCurrency, isCancelling, formatPayee, handleVenmoSent, handleCancelIntent } =
    flow;
  const [ack, setAck] = useState(false);

  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const amountLabel = `${symbol}${flowData.usdAmount.toFixed(2)}`;
  const platformName = PLATFORMS[selectedPlatform]?.name || "your payment app";
  const handle = formatPayee(flowData.zkp2pQuote?.payeeUsername);

  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable — the value is visible to copy manually */
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Send your {platformName} payment
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            Open {platformName} and pay the partner exactly this
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      {/* Send-to + amount well (surface3) — the one place the handle shows */}
      <Box
        sx={{
          background: (t) => t.ff.surface3,
          border: (t) => `1px solid ${t.ff.border}`,
          borderRadius: (t) => `${t.ff.radius.lg}px`,
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        <Box>
          <Typography
            sx={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: (t) => t.ff.textTertiary }}
          >
            Send to
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Typography sx={{ fontSize: "1.375rem", fontWeight: 700, color: (t) => t.ff.brandStrong, wordBreak: "break-all" }}>
              {handle}
            </Typography>
            <IconButton onClick={() => copy(flowData.zkp2pQuote?.payeeUsername || handle)} size="small" sx={{ color: (t) => t.ff.textSecondary }}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ borderTop: (t) => `1px solid ${t.ff.border}`, pt: 1.5 }}>
          <Typography
            sx={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: (t) => t.ff.textTertiary }}
          >
            Amount
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Typography sx={{ fontSize: "1.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: (t) => t.ff.text }}>
              {amountLabel}
            </Typography>
            <IconButton onClick={() => copy(flowData.usdAmount.toFixed(2))} size="small" sx={{ color: (t) => t.ff.textSecondary }}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <DoDontList
        title="Before you pay:"
        items={[
          { ok: true, text: `Send exactly ${amountLabel} in one payment` },
          { ok: true, text: "Pay from your balance (so it confirms fast)" },
          { ok: true, text: "Use a personal account" },
          { ok: false, text: "Don't add a note mentioning crypto / FreeFlo" },
          { ok: false, text: "Don't pay from a bank / eCheck (can clear too late)" },
        ]}
      />

      <RiskGate
        warning="This sends real money and cannot be reversed."
        ackLabel={`I've sent exactly ${amountLabel} to the partner`}
        checked={ack}
        onChange={setAck}
      />

      <PrimaryButton onClick={handleVenmoSent} disabled={!ack}>
        I&apos;ve sent the payment
      </PrimaryButton>
      <DangerButton onClick={handleCancelIntent} loading={isCancelling} loadingLabel="Cancelling…">
        Cancel &amp; reclaim
      </DangerButton>
    </Box>
  );
}
