"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * SummaryRow (§3 #8) — one `label → value` line with a tabular, right-aligned
 * value. The atom for the on-screen breakdown groups (Order / Quote / receipt).
 */
export function SummaryRow({
  label,
  value,
  accent = false,
  mono = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
      <Typography sx={{ fontSize: "0.9375rem", color: (t) => t.ff.textSecondary, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: mono ? "0.8125rem" : "0.9375rem",
          fontWeight: accent ? 700 : 500,
          fontVariantNumeric: "tabular-nums",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
          color: (t) => (accent ? t.ff.brandStrong : t.ff.text),
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/**
 * SummaryGroup — a titled surface2 panel that stacks SummaryRows (the "Order" /
 * "Quote" breakdown blocks in §5.5 / §5.10 / §5.11).
 */
export function SummaryGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        background: (t) => t.ff.surface2,
        border: (t) => `1px solid ${t.ff.border}`,
        borderRadius: (t) => `${t.ff.radius.lg}px`,
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
      }}
    >
      {title && (
        <Typography
          sx={{
            fontSize: "0.7rem",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: (t) => t.ff.textTertiary,
          }}
        >
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}
