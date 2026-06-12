"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ScheduleIcon from "@mui/icons-material/Schedule";

/**
 * CountdownRing (§3 #11) — the hero micro-interaction. A conic-gradient ring
 * over a track that fills as time elapses, with a centered glyph + tabular
 * figure. Two skins:
 *   - "verify": a lock, an indeterminate slow sweep, "~Ns" — the calm bounded
 *     wait that HIDES all crypto vocabulary.
 *   - "deadline": a clock, the MM:SS figure, brand→destructive under threshold.
 *
 * Pure presentational; `remaining`/`total` come from the hook's useCountdown.
 * Honors prefers-reduced-motion: the indeterminate sweep animation is disabled
 * globally by the theme's reduced-motion CssBaseline rule, leaving a static ring.
 */

function ringStyle(pct: number, color: string, track: string) {
  // pct 0..100 = how much of the ring is "spent" (filled with color).
  return {
    background: `conic-gradient(${color} ${pct * 3.6}deg, ${track} ${pct * 3.6}deg)`,
  };
}

export function CountdownRing({
  variant = "verify",
  remaining,
  total,
  size = 96,
  approxLabel,
  danger = false,
}: {
  variant?: "verify" | "deadline";
  remaining?: number;
  total?: number;
  size?: number;
  approxLabel?: string; // e.g. "~30s" for indeterminate verify
  danger?: boolean;
}) {
  const isVerify = variant === "verify";
  const color = danger ? "var(--ff-ring-danger)" : "var(--ff-ring-brand)";
  const pct =
    total && total > 0 && typeof remaining === "number"
      ? Math.min(100, Math.max(0, ((total - remaining) / total) * 100))
      : 0;
  const indeterminate = isVerify && (total == null || remaining == null);
  const ring = size;
  const inner = size - 12;

  return (
    <Box
      sx={{
        position: "relative",
        width: ring,
        height: ring,
        mx: "auto",
        // expose the ring colors as CSS vars so the conic-gradient + the sweep
        // share one source. (Tokens, no literals beyond mapping.)
        "--ff-ring-brand": (t: any) => t.ff.brand,
        "--ff-ring-danger": (t: any) => t.ff.destructive,
      }}
    >
      {/* the spent/track ring */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          ...(indeterminate
            ? { background: "transparent" }
            : ringStyle(pct, danger ? "var(--ff-ring-danger)" : "var(--ff-ring-brand)", "var(--ff-ring-track)")),
          "--ff-ring-track": (t: any) => t.ff.ringTrack,
        }}
      />
      {/* indeterminate slow conic sweep (disabled under reduced-motion) */}
      {indeterminate && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `conic-gradient(transparent 0deg, ${color} 90deg, transparent 200deg)`,
            opacity: 0.9,
            animation: "ffRingSpin 1.4s linear infinite",
            "@keyframes ffRingSpin": {
              from: { transform: "rotate(0deg)" },
              to: { transform: "rotate(360deg)" },
            },
          }}
        />
      )}
      {/* inner disc */}
      <Box
        sx={{
          position: "absolute",
          top: 6,
          left: 6,
          width: inner,
          height: inner,
          borderRadius: "50%",
          background: (t) => t.ff.surface1,
          border: (t) => `1px solid ${t.ff.border}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.25,
        }}
      >
        {isVerify ? (
          <LockOutlinedIcon sx={{ fontSize: size * 0.26, color: (t) => (danger ? t.ff.destructive : t.ff.brand) }} />
        ) : (
          <ScheduleIcon sx={{ fontSize: size * 0.22, color: (t) => (danger ? t.ff.destructive : t.ff.textSecondary) }} />
        )}
        <Typography
          sx={{
            fontSize: size * 0.16,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: (t) => (danger ? t.ff.destructive : t.ff.text),
          }}
        >
          {indeterminate
            ? approxLabel ?? "~30s"
            : isVerify
              ? `${remaining ?? 0}s`
              : approxLabel}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * CountdownPill — a compact inline countdown for the summary rail (clock glyph +
 * MM:SS). Turns destructive under the danger threshold.
 */
export function CountdownPill({
  label,
  danger = false,
  expired = false,
}: {
  label: string;
  danger?: boolean;
  expired?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: (t) => `${t.ff.radius.pill}px`,
        background: (t) => (danger ? t.ff.destructiveBg : t.ff.warningBg),
        color: (t) => (danger ? t.ff.destructive : t.ff.warning),
      }}
    >
      <ScheduleIcon sx={{ fontSize: 14 }} />
      <Typography
        sx={{ fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "inherit" }}
      >
        {expired ? "EXPIRED" : label}
      </Typography>
    </Box>
  );
}
