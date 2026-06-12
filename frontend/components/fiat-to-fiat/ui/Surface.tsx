"use client";

import Box, { type BoxProps } from "@mui/material/Box";

/**
 * FlowCard — the wizard shell (§3 #1). One component for "the wizard card":
 * surfaceGlass + radius.xl + litEdge + elev.1. Replaces the two divergent
 * hand-rolled card shells. Pure presentational; forwards `sx`.
 */
export function FlowCard({ sx, children, ...rest }: BoxProps) {
  return (
    <Box
      sx={[
        (t) => ({
          background: t.ff.surfaceGlass,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: `${t.ff.radius.xl}px`,
          border: `1px solid ${t.ff.border}`,
          boxShadow: t.ff.elev1,
          overflow: "hidden",
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}

/**
 * Surface — a nested inset panel (summary blocks, wells). `level` chooses the
 * fill depth (2 = nested row, 3 = deepest inset).
 */
export function Surface({
  level = 2,
  sx,
  children,
  ...rest
}: BoxProps & { level?: 2 | 3 }) {
  return (
    <Box
      sx={[
        (t) => ({
          background: level === 3 ? t.ff.surface3 : t.ff.surface2,
          borderRadius: `${t.ff.radius.lg}px`,
          border: `1px solid ${t.ff.border}`,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}
