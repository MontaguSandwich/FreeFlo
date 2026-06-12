"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

/**
 * RiskAckChecklist / RiskGate (§3 #12) — an irreversibility line + a checkbox
 * that gates a CTA ("I understand this payment is real and cannot be reversed").
 * Used at the fiat-send and commit moments (the gravity screens). The checkbox
 * state is owned by the SCREEN (local presentational acknowledgment), NOT the
 * flow hook — it gates the button but never the flow logic. `onChange` lifts the
 * boolean so the screen can disable the primary CTA.
 */
export function RiskGate({
  warning,
  ackLabel,
  checked,
  onChange,
}: {
  warning: string;
  ackLabel: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Box
      sx={{
        background: (t) => t.ff.destructiveBg,
        border: (t) => `1px solid ${t.ff.destructiveBorder}`,
        borderRadius: (t) => `${t.ff.radius.md}px`,
        p: 1.75,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <WarningAmberIcon sx={{ fontSize: 18, color: (t) => t.ff.destructive, mt: "1px", flexShrink: 0 }} />
        <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: (t) => t.ff.destructive, lineHeight: 1.45 }}>
          {warning}
        </Typography>
      </Box>
      <Box
        component="label"
        sx={{ display: "flex", alignItems: "flex-start", gap: 1, cursor: "pointer", userSelect: "none" }}
      >
        <Box
          component="input"
          type="checkbox"
          checked={checked}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
          sx={{
            mt: "2px",
            width: 18,
            height: 18,
            flexShrink: 0,
            cursor: "pointer",
            accentColor: (t: any) => t.ff.brand,
          }}
        />
        <Typography sx={{ fontSize: "0.875rem", color: (t) => t.ff.text, lineHeight: 1.45 }}>
          {ackLabel}
        </Typography>
      </Box>
    </Box>
  );
}
