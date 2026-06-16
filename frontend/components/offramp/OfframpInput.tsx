"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useQuotes } from "@/hooks/useQuotes";
import { useApproveUSDC } from "@/hooks/useApproveUSDC";
import { FlowCard, PrimaryButton, ProviderGlyph } from "@/components/fiat-to-fiat/ui";
import { QuoteCard, QuoteCardSkeleton, NoQuotesMessage } from "./QuoteCard";
import {
  Currency,
  CURRENCIES,
  validateReceivingInfo,
  getReceivingInfoPlaceholder,
  getReceivingInfoLabel,
  getRtpnsForCurrency,
} from "@/lib/quotes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfframpInputProps {
  onStartExecution: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENCY_ORDER: Currency[] = ["EUR", "GBP", "USD", "BRL", "INR"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OfframpInput({ onStartExecution }: OfframpInputProps) {
  // ---- Wallet ----------------------------------------------------------
  const { isConnected, address } = useAccount();

  // ---- Stores ----------------------------------------------------------
  const {
    amount,
    currency,
    receivingInfo,
    recipientName,
    selectedQuote,
    setAmount,
    setCurrency,
    setReceivingInfo,
    setRecipientName,
    setSelectedQuote,
  } = useFormStore();

  const { setView } = useExecutionStore();

  // ---- Hooks -----------------------------------------------------------
  const { balance } = useApproveUSDC(address);
  const { quotes, isLoading } = useQuotes(amount, currency);

  // ---- Derived values --------------------------------------------------
  const numAmount = parseFloat(amount);
  const hasValidAmount = !isNaN(numAmount) && numAmount >= 0.1;

  const formattedBalance =
    balance !== undefined ? formatUnits(balance, 6) : undefined;

  const firstRtpn = getRtpnsForCurrency(currency)[0];

  const receivingValidation =
    receivingInfo.length > 0 && firstRtpn
      ? validateReceivingInfo(firstRtpn, receivingInfo)
      : null;

  const currencyInfo = CURRENCIES[currency];

  // ---- Determine CTA label & disabled state ----------------------------
  const getCtaState = useCallback((): {
    label: string;
    disabled: boolean;
  } => {
    if (!isConnected) {
      return { label: "Connect wallet to continue", disabled: true };
    }
    if (!hasValidAmount) {
      return { label: "Enter at least 0.1 USDC", disabled: true };
    }
    if (
      balance !== undefined &&
      parseUnits(amount || "0", 6) > balance
    ) {
      return { label: "Insufficient USDC balance", disabled: true };
    }
    if (!selectedQuote) {
      return { label: "Select a route", disabled: true };
    }
    if (
      !receivingInfo ||
      (firstRtpn &&
        !validateReceivingInfo(firstRtpn, receivingInfo).valid)
    ) {
      return { label: "Fill in recipient details", disabled: true };
    }
    if (!recipientName || recipientName.trim().length < 2) {
      return { label: "Fill in recipient details", disabled: true };
    }
    return { label: "Review & Start", disabled: false };
  }, [
    isConnected,
    hasValidAmount,
    balance,
    amount,
    selectedQuote,
    receivingInfo,
    recipientName,
    firstRtpn,
  ]);

  const cta = getCtaState();

  // ---- Handlers --------------------------------------------------------
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty, digits, and one decimal point
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      setAmount(val);
      // Clear selected quote when amount changes
      setSelectedQuote(null);
    }
  };

  const handleCurrencyChange = (
    _: React.MouseEvent<HTMLElement>,
    newCurrency: Currency | null
  ) => {
    if (newCurrency) {
      setCurrency(newCurrency);
      setSelectedQuote(null);
      setReceivingInfo("");
    }
  };

  const handleSubmit = () => {
    if (!cta.disabled) {
      onStartExecution();
    }
  };

  // ---- Render ----------------------------------------------------------
  return (
    <FlowCard
      sx={{
        maxWidth: 480,
        mx: "auto",
        overflow: "visible",
      }}
    >
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* =============================================================== */}
        {/*  1. Amount input                                                */}
        {/* =============================================================== */}
        <Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography
              variant="body2"
              sx={{ color: (t) => t.ff.textSecondary, fontWeight: 500 }}
            >
              You send
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {formattedBalance !== undefined && (
                <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary }}>
                  Balance:{" "}
                  {parseFloat(formattedBalance).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Typography>
              )}
            </Box>
          </Box>

          <TextField
            fullWidth
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.00"
            variant="outlined"
            inputProps={{
              inputMode: "decimal",
              style: {
                fontSize: "1.5rem",
                fontWeight: 700,
              },
            }}
            InputProps={{
              sx: { color: (t) => t.ff.text },
              endAdornment: (
                <InputAdornment position="end">
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    {/* USDC glyph (shared provider mark) */}
                    <ProviderGlyph id="usdc" size={24} radius={12} />
                    <Typography
                      sx={{
                        color: (t) => t.ff.textSecondary,
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      USDC
                    </Typography>
                  </Box>
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {/* =============================================================== */}
        {/*  2. Currency selector                                           */}
        {/* =============================================================== */}
        <Box>
          <Typography
            variant="body2"
            sx={{ color: (t) => t.ff.textSecondary, fontWeight: 500, mb: 1 }}
          >
            You receive
          </Typography>

          <ToggleButtonGroup
            value={currency}
            exclusive
            onChange={handleCurrencyChange}
            fullWidth
            sx={{
              "& .MuiToggleButtonGroup-grouped": {
                mx: 0.5,
                py: 1,
                px: 1.5,
                fontSize: "0.8125rem",
                "&:first-of-type": {
                  ml: 0,
                },
                "&:last-of-type": {
                  mr: 0,
                },
              },
            }}
          >
            {CURRENCY_ORDER.map((c) => (
              <ToggleButton key={c} value={c}>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                  }}
                >
                  <Typography sx={{ fontSize: "1.125rem", lineHeight: 1 }}>
                    {CURRENCIES[c].flag}
                  </Typography>
                  <Typography
                    sx={{ fontSize: "0.6875rem", fontWeight: 600 }}
                  >
                    {c}
                  </Typography>
                </Box>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 0.75,
              color: (t) => t.ff.textTertiary,
              textAlign: "center",
            }}
          >
            {currencyInfo.flag} {currencyInfo.name} ({currencyInfo.symbol})
          </Typography>
        </Box>

        {/* =============================================================== */}
        {/*  3. Recipient details                                           */}
        {/* =============================================================== */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography
            variant="body2"
            sx={{ color: (t) => t.ff.textSecondary, fontWeight: 500 }}
          >
            Recipient details
          </Typography>

          {/* Receiving info (IBAN / Sort Code / etc.) */}
          <TextField
            fullWidth
            label={firstRtpn ? getReceivingInfoLabel(firstRtpn) : "Receiving Info"}
            placeholder={
              firstRtpn ? getReceivingInfoPlaceholder(firstRtpn) : ""
            }
            value={receivingInfo}
            onChange={(e) => setReceivingInfo(e.target.value)}
            error={
              receivingValidation !== null && !receivingValidation.valid
            }
            helperText={
              receivingValidation !== null && !receivingValidation.valid
                ? receivingValidation.error
                : undefined
            }
            variant="outlined"
            InputProps={{
              sx: { color: (t) => t.ff.text },
            }}
            InputLabelProps={{
              sx: { color: (t) => t.ff.textTertiary },
            }}
            sx={{
              "& .MuiFormHelperText-root.Mui-error": {
                color: (t) => t.ff.destructive,
              },
            }}
          />

          {/* Recipient name */}
          <TextField
            fullWidth
            label="Recipient name"
            placeholder="John Doe"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            error={
              recipientName.length > 0 && recipientName.trim().length < 2
            }
            helperText={
              recipientName.length > 0 && recipientName.trim().length < 2
                ? "Name must be at least 2 characters"
                : undefined
            }
            variant="outlined"
            InputProps={{
              sx: { color: (t) => t.ff.text },
            }}
            InputLabelProps={{
              sx: { color: (t) => t.ff.textTertiary },
            }}
            sx={{
              "& .MuiFormHelperText-root.Mui-error": {
                color: (t) => t.ff.destructive,
              },
            }}
          />
        </Box>

        {/* =============================================================== */}
        {/*  4. Quotes section                                              */}
        {/* =============================================================== */}
        {hasValidAmount && (
          <Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1.5,
              }}
            >
              <Typography
                variant="body2"
                sx={{ color: (t) => t.ff.textSecondary, fontWeight: 500 }}
              >
                {isLoading
                  ? "Finding routes..."
                  : `Available Routes (${quotes.length})`}
              </Typography>
              {isLoading && (
                <CircularProgress
                  size={16}
                  sx={{ color: (t) => t.ff.brand }}
                />
              )}
            </Box>

            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {isLoading && quotes.length === 0 && (
                <>
                  <QuoteCardSkeleton />
                  <QuoteCardSkeleton />
                </>
              )}

              {!isLoading && quotes.length === 0 && (
                <NoQuotesMessage currency={currency} />
              )}

              {quotes.map((quote) => (
                <QuoteCard
                  key={`${quote.rtpn}-${quote.solver.address}`}
                  quote={quote}
                  isSelected={
                    selectedQuote?.rtpn === quote.rtpn &&
                    selectedQuote?.solver.address === quote.solver.address
                  }
                  onSelect={() => setSelectedQuote(quote)}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* =============================================================== */}
        {/*  5. Action button                                               */}
        {/* =============================================================== */}
        <PrimaryButton
          disabled={cta.disabled}
          onClick={handleSubmit}
          startIcon={
            cta.disabled && !isConnected ? (
              <AccountBalanceWalletIcon sx={{ fontSize: 20 }} />
            ) : undefined
          }
        >
          {cta.label}
        </PrimaryButton>
      </Box>
    </FlowCard>
  );
}
