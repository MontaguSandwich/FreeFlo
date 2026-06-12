"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import { PHASE_LABELS } from "./phases";

/**
 * PhaseStepper (§4) — the 4-phase chip row (Set up → Pay & prove → Convert →
 * Done). A read-only projection over the unchanged FlowStep (`activeIndex`
 * comes from phaseIndex()). Completed phases show a check, the active phase is
 * emerald, future phases are muted. Pure presentational.
 */
export function PhaseStepper({ activeIndex }: { activeIndex: 0 | 1 | 2 | 3 }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {PHASE_LABELS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "future";
        return (
          <Box key={label} sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  background:
                    state === "active"
                      ? (t) => t.ff.brandGradient
                      : state === "done"
                        ? "rgba(16,185,129,0.16)"
                        : (t) => t.ff.surface2,
                  color: (t) =>
                    state === "active" ? t.ff.onBrand : state === "done" ? t.ff.brand : t.ff.textTertiary,
                  border: (t) => (state === "future" ? `1px solid ${t.ff.border}` : "none"),
                }}
              >
                {state === "done" ? <CheckIcon sx={{ fontSize: 13 }} /> : i + 1}
              </Box>
              <Typography
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: state === "active" ? 600 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: (t) =>
                    state === "active" ? t.ff.text : state === "done" ? t.ff.textSecondary : t.ff.textTertiary,
                  display: { xs: i === activeIndex ? "block" : "none", sm: "block" },
                }}
              >
                {label}
              </Typography>
            </Box>
            {i < PHASE_LABELS.length - 1 && (
              <Box
                sx={{
                  flex: 1,
                  height: 2,
                  mx: 1,
                  minWidth: 8,
                  borderRadius: (t) => `${t.ff.radius.pill}px`,
                  background: (t) => (i < activeIndex ? t.ff.brand : t.ff.border),
                  transition: (t) => `background ${t.ff.motion.slow} ${t.ff.motion.ease}`,
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
