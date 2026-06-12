"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { CountdownRing } from "./CountdownRing";

/**
 * StatusScreen (§3 #7) — collapses the five near-identical centered-spinner
 * blocks (finding_quotes, authenticating, fulfilling, router_waiting,
 * freeflo_pending) into one component: a centered indicator (spinner OR a
 * CountdownRing), a title, a subtitle, and an optional escape-hatch slot
 * (e.g. "Stuck? Cancel & reclaim"). Pure presentational.
 */
export function StatusScreen({
  title,
  subtitle,
  hint,
  variant = "spinner",
  remaining,
  total,
  approxLabel,
  footer,
}: {
  title: string;
  subtitle?: string;
  hint?: string;
  variant?: "spinner" | "ring-verify";
  remaining?: number;
  total?: number;
  approxLabel?: string;
  footer?: React.ReactNode;
}) {
  return (
    <Box sx={{ textAlign: "center", py: 6, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Box sx={{ mb: 2.5 }}>
        {variant === "ring-verify" ? (
          <CountdownRing variant="verify" remaining={remaining} total={total} approxLabel={approxLabel} size={104} />
        ) : (
          <CircularProgress size={48} thickness={4} sx={{ color: (t) => t.ff.brand }} />
        )}
      </Box>
      <Typography variant="h4" sx={{ mb: 0.5, color: (t) => t.ff.text }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography sx={{ color: (t) => t.ff.textSecondary, maxWidth: 360 }}>{subtitle}</Typography>
      )}
      {hint && (
        <Typography variant="body2" sx={{ color: (t) => t.ff.textTertiary, mt: 1 }}>
          {hint}
        </Typography>
      )}
      {footer && <Box sx={{ mt: 3, width: "100%", maxWidth: 320 }}>{footer}</Box>}
    </Box>
  );
}
