"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * Field (§3 #3) — a labeled input well. UPPERCASE label token + a surface3
 * fill + emerald focus ring (theme tokens, no hex). Controlled; the parent owns
 * `value`/`onChange` (the hook's controlled inputs). `helperText` + `error`
 * surface inline per-field validation (mirrors OfframpInput's helperText).
 */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  uppercaseValue = false,
  helperText,
  error = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  uppercaseValue?: boolean;
  helperText?: string;
  error?: boolean;
}) {
  return (
    <Box>
      <Typography
        sx={{
          display: "block",
          mb: 1,
          fontSize: "0.8125rem",
          fontWeight: 600,
          color: (t) => t.ff.textSecondary,
        }}
      >
        {label}
      </Typography>
      <Box
        component="input"
        type={type}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(uppercaseValue ? e.target.value.toUpperCase() : e.target.value)
        }
        placeholder={placeholder}
        sx={{
          width: "100%",
          px: 2,
          py: 1.5,
          boxSizing: "border-box",
          background: (t) => t.ff.surface3,
          border: (t) => `1px solid ${error ? t.ff.destructiveBorder : t.ff.borderStrong}`,
          borderRadius: (t) => `${t.ff.radius.md}px`,
          color: (t) => t.ff.text,
          outline: "none",
          fontSize: "1rem",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
          transition: (t) => `border-color ${t.ff.motion.fast} ${t.ff.motion.ease}`,
          "&::placeholder": { color: (t) => t.ff.textDisabled },
          "&:focus": { borderColor: (t) => (error ? t.ff.destructive : t.ff.borderActive) },
        }}
      />
      {helperText && (
        <Typography
          sx={{
            mt: 0.75,
            fontSize: "0.75rem",
            color: (t) => (error ? t.ff.destructive : t.ff.textTertiary),
          }}
        >
          {helperText}
        </Typography>
      )}
    </Box>
  );
}
