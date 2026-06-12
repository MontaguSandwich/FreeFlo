"use client";

import Box from "@mui/material/Box";
import CheckIcon from "@mui/icons-material/Check";

/**
 * SuccessCheck (§2.7 / §5.11) — a single check scaling in inside a tinted
 * circle. Restrained: NO confetti. The scale-in is disabled under
 * prefers-reduced-motion by the theme's global reduced-motion rule.
 */
export function SuccessCheck({ size = 80 }: { size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        mx: "auto",
        borderRadius: "50%",
        background: (t) => t.ff.brandGradient,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: (t) => t.ff.litEdge,
        animation: "ffCheckIn 200ms cubic-bezier(0.2,0.8,0.2,1)",
        "@keyframes ffCheckIn": {
          from: { transform: "scale(0.96)", opacity: 0.4 },
          to: { transform: "scale(1)", opacity: 1 },
        },
      }}
    >
      <CheckIcon sx={{ fontSize: size * 0.5, color: (t) => t.ff.onBrand }} />
    </Box>
  );
}
