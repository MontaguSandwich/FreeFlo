"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Alert from "@mui/material/Alert";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Card from "@mui/material/Card";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useQuotes } from "@/hooks/useQuotes";
import { useApproveUSDC } from "@/hooks/useApproveUSDC";
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
  const hasValidAmount = !isNaN(numAmount) && numAmount >= 1;

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
      return { label: "Enter at least 1 USDC", disabled: true };
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
    <Card
      sx={{
        maxWidth: 480,
        mx: "auto",
        bgcolor: "rgb(24, 24, 27)", // zinc-900
        border: "1px solid rgb(39, 39, 42)", // zinc-800
        borderRadius: 3,
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
              sx={{ color: "rgb(161, 161, 170)", fontWeight: 500 }}
            >
              You send
            </Typography>
            {formattedBalance !== undefined && (
              <Typography
                variant="caption"
                sx={{ color: "rgb(113, 113, 122)" }}
              >
                Balance:{" "}
                {parseFloat(formattedBalance).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Typography>
            )}
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
                color: "#fff",
              },
            }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    {/* USDC blue circle badge */}
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        bgcolor: "#2775CA",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Typography
                        sx={{
                          color: "#fff",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                      >
                        $
                      </Typography>
                    </Box>
                    <Typography
                      sx={{
                        color: "rgb(161, 161, 170)",
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
            sx={{
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgb(9, 9, 11)", // zinc-950
                borderRadius: 2,
                "& fieldset": {
                  borderColor: "rgb(39, 39, 42)", // zinc-800
                },
                "&:hover fieldset": {
                  borderColor: "rgb(63, 63, 70)", // zinc-700
                },
                "&.Mui-focused fieldset": {
                  borderColor: "rgb(16, 185, 129)", // emerald-500
                },
              },
            }}
          />
        </Box>

        {/* =============================================================== */}
        {/*  2. Currency selector                                           */}
        {/* =============================================================== */}
        <Box>
          <Typography
            variant="body2"
            sx={{ color: "rgb(161, 161, 170)", fontWeight: 500, mb: 1 }}
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
                border: "1px solid rgb(39, 39, 42)",
                borderRadius: "12px !important",
                mx: 0.5,
                py: 1,
                px: 1.5,
                textTransform: "none",
                color: "rgb(161, 161, 170)",
                fontSize: "0.8125rem",
                fontWeight: 500,
                "&:first-of-type": {
                  ml: 0,
                },
                "&:last-of-type": {
                  mr: 0,
                },
                "&.Mui-selected": {
                  bgcolor: "rgba(16, 185, 129, 0.1)",
                  color: "rgb(52, 211, 153)", // emerald-400
                  borderColor: "rgb(16, 185, 129)", // emerald-500
                  "&:hover": {
                    bgcolor: "rgba(16, 185, 129, 0.15)",
                  },
                },
                "&:hover": {
                  bgcolor: "rgb(39, 39, 42)",
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
              color: "rgb(113, 113, 122)",
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
            sx={{ color: "rgb(161, 161, 170)", fontWeight: 500 }}
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
            inputProps={{
              style: { color: "#fff" },
            }}
            InputLabelProps={{
              sx: { color: "rgb(113, 113, 122)" },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgb(9, 9, 11)",
                borderRadius: 2,
                "& fieldset": {
                  borderColor: "rgb(39, 39, 42)",
                },
                "&:hover fieldset": {
                  borderColor: "rgb(63, 63, 70)",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "rgb(16, 185, 129)",
                },
              },
              "& .MuiFormHelperText-root": {
                color: "rgb(239, 68, 68)", // red-500
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
            inputProps={{
              style: { color: "#fff" },
            }}
            InputLabelProps={{
              sx: { color: "rgb(113, 113, 122)" },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgb(9, 9, 11)",
                borderRadius: 2,
                "& fieldset": {
                  borderColor: "rgb(39, 39, 42)",
                },
                "&:hover fieldset": {
                  borderColor: "rgb(63, 63, 70)",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "rgb(16, 185, 129)",
                },
              },
              "& .MuiFormHelperText-root": {
                color: "rgb(239, 68, 68)",
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
                sx={{ color: "rgb(161, 161, 170)", fontWeight: 500 }}
              >
                {isLoading
                  ? "Finding routes..."
                  : `Available Routes (${quotes.length})`}
              </Typography>
              {isLoading && (
                <CircularProgress
                  size={16}
                  sx={{ color: "rgb(16, 185, 129)" }}
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
        <Button
          fullWidth
          variant="contained"
          disabled={cta.disabled}
          onClick={handleSubmit}
          startIcon={
            cta.disabled && !isConnected ? (
              <AccountBalanceWalletIcon sx={{ fontSize: 20 }} />
            ) : undefined
          }
          sx={{
            py: 1.5,
            borderRadius: 2,
            textTransform: "none",
            fontWeight: 600,
            fontSize: "1rem",
            bgcolor: cta.disabled
              ? "rgb(39, 39, 42)" // zinc-800
              : "rgb(16, 185, 129)", // emerald-500
            color: cta.disabled ? "rgb(113, 113, 122)" : "#fff",
            "&:hover": {
              bgcolor: cta.disabled
                ? "rgb(39, 39, 42)"
                : "rgb(5, 150, 105)", // emerald-600
            },
            "&.Mui-disabled": {
              color: "rgb(113, 113, 122)", // zinc-500
              bgcolor: "rgb(39, 39, 42)",
            },
          }}
        >
          {cta.label}
        </Button>
      </Box>
    </Card>
  );
}
