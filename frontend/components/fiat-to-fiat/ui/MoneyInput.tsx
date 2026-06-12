"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * MoneyInput (§3 #3) — the big-amount input well: a UPPERCASE "YOU SEND" label,
 * the currency symbol adornment, the amountXl figure, a currency badge, and an
 * optional row of quick-amount chips. Controlled (`value`/`onChange`); display
 * only — all validation lives in the hook's handler.
 */
export function MoneyInput({
  label = "You send",
  symbol,
  currencyCode,
  value,
  onChange,
  quickAmounts,
  onQuickPick,
}: {
  label?: string;
  symbol: string;
  currencyCode: string;
  value: string;
  onChange: (v: string) => void;
  quickAmounts?: number[];
  onQuickPick?: (amount: number) => void;
}) {
  return (
    <Box
      sx={{
        background: (t) => t.ff.surface3,
        border: (t) => `1px solid ${t.ff.border}`,
        borderRadius: (t) => `${t.ff.radius.lg}px`,
        p: 2,
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography
          sx={{
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: (t) => t.ff.textTertiary,
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: (t) => t.ff.textTertiary,
          }}
        >
          {currencyCode}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1 }}>
        <Typography sx={{ fontSize: "2.125rem", fontWeight: 700, color: (t) => t.ff.textSecondary }}>
          {symbol}
        </Typography>
        <Box
          component="input"
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder="0.00"
          sx={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "2.125rem",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
            color: (t) => t.ff.text,
            "&::placeholder": { color: (t) => t.ff.textDisabled },
          }}
        />
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderRadius: (t) => `${t.ff.radius.sm}px`,
            background: "rgba(16,185,129,0.12)",
            color: (t) => t.ff.brandStrong,
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          {currencyCode}
        </Box>
      </Box>

      {quickAmounts && quickAmounts.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, mt: 2, flexWrap: "wrap" }}>
          {quickAmounts.map((amount) => {
            const selected = value === amount.toString();
            return (
              <Box
                key={amount}
                component="button"
                type="button"
                onClick={() => (onQuickPick ? onQuickPick(amount) : onChange(amount.toString()))}
                sx={{
                  flex: 1,
                  minWidth: 56,
                  py: 1,
                  cursor: "pointer",
                  borderRadius: (t) => `${t.ff.radius.sm}px`,
                  background: selected ? "rgba(16,185,129,0.18)" : (t) => t.ff.surface2,
                  border: (t) =>
                    selected ? `1px solid ${t.ff.borderActive}` : "1px solid transparent",
                  color: (t) => t.ff.text,
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  transition: (t) => `all ${t.ff.motion.fast} ${t.ff.motion.ease}`,
                  "&:hover": { background: "rgba(16,185,129,0.10)" },
                }}
              >
                {symbol}
                {amount}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
