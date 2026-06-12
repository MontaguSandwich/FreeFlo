"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS, CURRENCIES } from "@/lib/platforms";
import { PrimaryButton, SuccessCheck, SummaryGroup, SummaryRow, maskIban } from "../ui";

/**
 * success (§5.11) — restrained, NO confetti. Behaviour preserved:
 *  - "Start another transfer" calls resetFlow (UNCHANGED — clears flowData +
 *    the storage key + the metadata unsub).
 *  - the receipt reads the same flowData fields (usdAmount/platform,
 *    quotedEurAmount, eurIban). INV-5 (storage cleared on success) is handled by
 *    the hook's persistence effect; the view only renders + offers reset.
 */
export function SuccessScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { flowData, selectedPlatform, selectedCurrency, formatEur, resetFlow } = flow;
  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const platformName = PLATFORMS[selectedPlatform]?.name || "payment";

  return (
    <Box sx={{ textAlign: "center", py: 4, display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <SuccessCheck size={76} />
        <Typography variant="h3" sx={{ color: (t) => t.ff.text, mt: 2.5 }}>
          Euros are on the way
        </Typography>
      </Box>

      <SummaryGroup>
        <SummaryRow label="You sent" value={`${symbol}${flowData.usdAmount.toFixed(2)} via ${platformName}`} />
        <SummaryRow label="Recipient receives" value={`${formatEur(flowData.quotedEurAmount)} by SEPA`} accent />
        <SummaryRow
          label="Reference"
          value={<Box component="span" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{maskIban(flowData.eurIban)}</Box>}
        />
      </SummaryGroup>

      <PrimaryButton onClick={resetFlow}>Start another transfer</PrimaryButton>
    </Box>
  );
}
