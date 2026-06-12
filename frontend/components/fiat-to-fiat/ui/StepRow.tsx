"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CircularProgress from "@mui/material/CircularProgress";

export type StepStatus = "done" | "active" | "pending";

/**
 * StepRow (§3 #5) — mirrors StepItem's status vocabulary (outline check = done,
 * spinner/lock = in-progress, hollow circle = pending) for the cross-border
 * two-tier TEE timeline. The active row can show a trailing slot (a "~30s"
 * label or a live seconds figure). Pure presentational.
 */
export function StepRow({
  status,
  label,
  trailing,
  locked = false,
  last = false,
}: {
  status: StepStatus;
  label: string;
  trailing?: React.ReactNode;
  locked?: boolean;
  last?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderBottom: (t) => (last ? "none" : `1px solid ${t.ff.border}`),
        background: status === "active" ? "rgba(16,185,129,0.04)" : "transparent",
      }}
    >
      <Box sx={{ width: 24, height: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {status === "done" ? (
          <CheckCircleIcon sx={{ fontSize: 22, color: (t) => t.ff.brand }} />
        ) : status === "active" ? (
          locked ? (
            <LockOutlinedIcon sx={{ fontSize: 20, color: (t) => t.ff.brand }} />
          ) : (
            <CircularProgress size={18} thickness={5} sx={{ color: (t) => t.ff.brand }} />
          )
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: (t) => t.ff.textTertiary }} />
        )}
      </Box>
      <Typography
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: "0.9375rem",
          fontWeight: status === "active" ? 600 : 500,
          color: (t) => (status === "pending" ? t.ff.textTertiary : t.ff.text),
        }}
      >
        {label}
      </Typography>
      {trailing && (
        <Typography
          sx={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: (t) => (status === "active" ? t.ff.brandStrong : t.ff.textSecondary),
            flexShrink: 0,
          }}
        >
          {trailing}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Stepper — a bordered surface that stacks StepRows (the inner vertical timeline
 * of the two-tier TEE stepper).
 */
export function Stepper({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        background: (t) => t.ff.surface2,
        border: (t) => `1px solid ${t.ff.border}`,
        borderRadius: (t) => `${t.ff.radius.lg}px`,
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}

/**
 * NodeStepper — the horizontal 3-node phase stepper for the verify screen
 * (Pay → Verify → Convert), mapping the IA phases. Distinct from the top-level
 * PhaseStepper (4 phases); this is the in-screen 3-node skeleton Peer uses.
 */
export function NodeStepper({
  nodes,
}: {
  nodes: { label: string; status: StepStatus }[];
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      {nodes.map((n, i) => (
        <Box key={n.label} sx={{ display: "flex", alignItems: "center", flex: i < nodes.length - 1 ? 1 : "0 0 auto" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                flexShrink: 0,
                background: (t) =>
                  n.status === "done" || n.status === "active" ? t.ff.brand : "transparent",
                border: (t) => (n.status === "pending" ? `2px solid ${t.ff.textTertiary}` : "none"),
                boxShadow: (t) => (n.status === "active" ? `0 0 0 4px ${t.ff.borderActive}` : "none"),
              }}
            />
            <Typography
              sx={{
                fontSize: "0.8125rem",
                fontWeight: n.status === "active" ? 600 : 500,
                color: (t) => (n.status === "pending" ? t.ff.textTertiary : t.ff.text),
                whiteSpace: "nowrap",
              }}
            >
              {n.label}
            </Typography>
          </Box>
          {i < nodes.length - 1 && (
            <Box
              sx={{
                flex: 1,
                height: 2,
                mx: 1,
                minWidth: 16,
                borderRadius: (t) => `${t.ff.radius.pill}px`,
                background: (t) => (n.status === "done" ? t.ff.brand : t.ff.border),
              }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
