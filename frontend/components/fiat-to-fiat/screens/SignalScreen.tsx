"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS, CURRENCIES } from "@/lib/platforms";
import { PrimaryButton, NoticeBanner, SummaryGroup, SummaryRow, phaseOfFour, maskIban } from "../ui";

/**
 * zkp2p_signal (§5.5) — confirm & lock the order. Behaviour preserved:
 *  - the CTA calls handleSignalIntent and shows a spinner while isSignaling
 *    (PrimaryButton loading), with the same disabled-on-signaling semantics.
 *  - the breakdown reads the same flowData fields as the original
 *    (usdAmount/platform, usdcAmount, minEurAmount, eurIban, recipientName).
 *  - INV-3 pass-through (referralFees + tuple payload + IntentSignaled extraction)
 *    is entirely inside handleSignalIntent — the view only calls it.
 */
export function SignalScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { step, flowData, selectedPlatform, selectedCurrency, isSignaling, formatUsdc, formatEur, handleSignalIntent } = flow;
  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const platformName = PLATFORMS[selectedPlatform]?.name || "payment";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Confirm your order
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            We&apos;ll lock the partner&apos;s USDC for your transfer
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      <SummaryGroup title="Order">
        <SummaryRow label="You pay" value={`${symbol}${flowData.usdAmount.toFixed(2)} via ${platformName}`} />
        <SummaryRow label="Partner fronts" value={formatUsdc(flowData.usdcAmount)} />
        <SummaryRow label="You receive" value={`≈ ${formatEur(flowData.minEurAmount)} by SEPA`} accent />
        <SummaryRow
          label="To"
          value={
            <>
              {flowData.recipientName || "recipient"}
              <Box component="span" sx={{ ml: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {maskIban(flowData.eurIban)}
              </Box>
            </>
          }
        />
      </SummaryGroup>

      <NoticeBanner kind="info">
        Your bank details are sealed on-chain. After you pay and prove it, the USDC converts to euros automatically.
      </NoticeBanner>

      <PrimaryButton onClick={handleSignalIntent} loading={isSignaling} loadingLabel="Signing…">
        Lock order
      </PrimaryButton>
    </Box>
  );
}
