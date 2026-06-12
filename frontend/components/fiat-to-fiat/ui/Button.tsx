"use client";

import MuiButton, { type ButtonProps } from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

/**
 * Button primitives (§3 #2). Four variants mapped to the theme's button
 * variant overrides so both surfaces share one button vocabulary:
 *   PrimaryButton   → containedPrimary (brandGradient fill)
 *   SecondaryButton → surface2 + border outline
 *   GhostButton     → text-only
 *   DangerButton    → outlinedError (destructive text + border) — the tokenized
 *                     "Cancel & reclaim" treatment.
 * All are full-width by default (the wizard is a single-column form), sentence
 * case (theme default), radius.md. A `loading` flag swaps in a spinner and
 * disables the button without changing the handler wiring.
 */

type FfButtonProps = Omit<ButtonProps, "variant" | "color"> & {
  loading?: boolean;
  loadingLabel?: React.ReactNode;
};

const baseSx = (py: number) => ({
  py,
  width: "100%",
  borderRadius: (t: any) => `${t.ff.radius.md}px`,
  fontWeight: 600,
  fontSize: "0.9375rem",
});

export function PrimaryButton({
  loading = false,
  loadingLabel,
  disabled,
  children,
  sx,
  ...rest
}: FfButtonProps) {
  return (
    <MuiButton
      variant="contained"
      color="primary"
      disabled={disabled || loading}
      sx={[baseSx(1.75), ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    >
      {loading ? (
        <>
          <CircularProgress size={18} thickness={5} sx={{ color: "inherit", mr: 1 }} />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </MuiButton>
  );
}

export function SecondaryButton({
  loading = false,
  loadingLabel,
  disabled,
  children,
  sx,
  ...rest
}: FfButtonProps) {
  return (
    <MuiButton
      variant="outlined"
      disabled={disabled || loading}
      sx={[
        baseSx(1.5),
        (t) => ({
          color: t.ff.text,
          borderColor: t.ff.borderStrong,
          background: t.ff.surface2,
          "&:hover": { borderColor: t.ff.borderActive, background: t.ff.surface2 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </MuiButton>
  );
}

export function GhostButton({
  loading = false,
  loadingLabel,
  disabled,
  children,
  sx,
  ...rest
}: FfButtonProps) {
  return (
    <MuiButton
      variant="text"
      disabled={disabled || loading}
      sx={[
        {
          py: 1,
          borderRadius: (t: any) => `${t.ff.radius.md}px`,
          fontWeight: 600,
          fontSize: "0.8125rem",
          color: (t: any) => t.ff.textSecondary,
          textTransform: "none",
          "&:hover": { color: (t: any) => t.ff.text, background: (t: any) => t.ff.surface2 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </MuiButton>
  );
}

export function DangerButton({
  loading = false,
  loadingLabel,
  disabled,
  children,
  sx,
  ...rest
}: FfButtonProps) {
  return (
    <MuiButton
      variant="outlined"
      color="error"
      disabled={disabled || loading}
      sx={[baseSx(1.25), { fontWeight: 500, fontSize: "0.875rem" }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </MuiButton>
  );
}
