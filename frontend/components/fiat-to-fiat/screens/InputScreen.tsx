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
  NoticeBanner,
  phaseOfFour,
} from "../ui";

/**
 * input_all (§5.2) — amount + platform + currency + IBAN + name. Behaviour
 * preserved verbatim:
 *  - controlled inputs bind to the hook's usdInput/ibanInput/nameInput +
 *    selectedPlatform/selectedCurrency setters.
 *  - the estimate well shows only when `usdInput && parseFloat(usdInput) > 0`.
 *  - the CTA calls handleInputSubmit and is disabled when amount/IBAN/name are
 *    empty OR the selected platform is locked for this wallet's ZKP2P tier
 *    (e.g. PayPal needs PLUS) — see platformLock below.
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
    takerTier,
    platformLock,
    formatEur,
    estimatedEur,
    handleInputSubmit,
  } = flow;

  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const amt = parseFloat(usdInput);
  const showEstimate = Boolean(usdInput) && amt > 0;
  // Gate up front on the wallet's ZKP2P tier so a locked method (e.g. PayPal needs
  // PLUS) can't start a flow that would 403 at "Lock order". platformLock() returns
  // null until tier data loads, so this is a no-op when we don't know yet.
  const selectedLock = platformLock(selectedPlatform);
  const isPlatformLocked = Boolean(selectedLock?.locked);
  const platformName = PLATFORMS[selectedPlatform]?.name || selectedPlatform;
  const platformOptions = Object.values(PLATFORMS).map((p) => {
    const lock = platformLock(p.id);
    const suffix = lock?.locked ? ` 🔒${lock.minTierRequired ? ` ${lock.minTierRequired}` : ""}` : "";
    return { value: p.id, label: `${p.icon} ${p.name}${suffix}` };
  });
  const disabled =
    !usdInput || parseFloat(usdInput) <= 0 || !ibanInput || !nameInput || isPlatformLocked;

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
          options={platformOptions}
        />
        <PlatformSelect
          label="Currency"
          value={selectedCurrency}
          onChange={setSelectedCurrency}
          options={availableCurrencies.map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
        />
      </Box>

      {isPlatformLocked && (
        <NoticeBanner kind="warning">
          {platformName} requires a ZKP2P {selectedLock?.minTierRequired || "higher"} tier
          {takerTier?.tier ? ` — your wallet is ${takerTier.tier}` : ""}. Pick another payment
          method, or build more ZKP2P volume to unlock it.
        </NoticeBanner>
      )}

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
          <SummaryRow
            label="Estimated euros received"
            value={estimatedEur !== null ? `≈ ${formatEur(estimatedEur)}` : "Fetching live rate…"}
            accent
          />
          <SummaryRow label="Price protection" value={`${slippagePercent}% slippage`} />
        </SummaryGroup>
      )}

      <PrimaryButton onClick={handleInputSubmit} disabled={disabled}>
        Find partners
      </PrimaryButton>
    </Box>
  );
}
