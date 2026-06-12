"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS, CURRENCIES, QUICK_AMOUNTS } from "@/lib/platforms";
import {
  PrimaryButton,
  PlatformSelect,
  MoneyInput,
  Field,
  SummaryGroup,
  SummaryRow,
  phaseOfFour,
} from "../ui";

/**
 * input_all (§5.2) — amount + platform + currency + IBAN + name. Behaviour
 * preserved verbatim:
 *  - controlled inputs bind to the hook's usdInput/ibanInput/nameInput +
 *    selectedPlatform/selectedCurrency setters.
 *  - the estimate well shows only when `usdInput && parseFloat(usdInput) > 0`.
 *  - the CTA calls handleInputSubmit and is disabled with the EXACT condition
 *    `!usdInput || parseFloat(usdInput) <= 0 || !ibanInput || !nameInput`.
 *  - IBAN is upper-cased on change (uppercaseValue), mirroring the original.
 */
export function InputScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const {
    step,
    usdInput,
    setUsdInput,
    ibanInput,
    setIbanInput,
    nameInput,
    setNameInput,
    selectedPlatform,
    setSelectedPlatform,
    selectedCurrency,
    setSelectedCurrency,
    availableCurrencies,
    slippagePercent,
    formatEur,
    calculateEstimatedEur,
    handleInputSubmit,
  } = flow;

  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const amt = parseFloat(usdInput);
  const showEstimate = Boolean(usdInput) && amt > 0;
  const disabled = !usdInput || parseFloat(usdInput) <= 0 || !ibanInput || !nameInput;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Set up your transfer
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            Choose how much, and where the euros land
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", gap: 2 }}>
        <PlatformSelect
          label="Pay with"
          value={selectedPlatform}
          onChange={setSelectedPlatform}
          options={Object.values(PLATFORMS).map((p) => ({ value: p.id, label: `${p.icon} ${p.name}` }))}
        />
        <PlatformSelect
          label="Currency"
          value={selectedCurrency}
          onChange={setSelectedCurrency}
          options={availableCurrencies.map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
        />
      </Box>

      <MoneyInput
        symbol={symbol}
        currencyCode={selectedCurrency}
        value={usdInput}
        onChange={setUsdInput}
        quickAmounts={QUICK_AMOUNTS}
      />

      <Field
        label="Recipient IBAN"
        value={ibanInput}
        onChange={setIbanInput}
        placeholder="DE89 3704 0044 0532 0130 00"
        mono
        uppercaseValue
      />
      <Field label="Recipient name" value={nameInput} onChange={setNameInput} placeholder="Anna Müller" />

      {showEstimate && (
        <SummaryGroup>
          <SummaryRow label="Estimated euros received" value={`≈ ${formatEur(calculateEstimatedEur(amt))}`} accent />
          <SummaryRow label="Price protection" value={`${slippagePercent}% slippage`} />
        </SummaryGroup>
      )}

      <PrimaryButton onClick={handleInputSubmit} disabled={disabled}>
        Find partners
      </PrimaryButton>
    </Box>
  );
}
