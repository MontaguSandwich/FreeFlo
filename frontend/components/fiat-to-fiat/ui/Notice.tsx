"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * NoticeBanner (§3 #10) — one Alert visual language with `kind` mapped to the
 * destructive/warning/info/success tokens (so error is amber-red, never brand).
 * Carries an optional `action` slot (the Cancel + Dismiss buttons live here for
 * the error panel). The MuiAlert theme override already colours each severity
 * from the tokens, so this stays a thin, consistent wrapper.
 */
export function NoticeBanner({
  kind,
  children,
  action,
  icon,
}: {
  kind: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Alert
      severity={kind}
      icon={icon}
      action={action ? <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>{action}</Box> : undefined}
      sx={{ borderRadius: (t) => `${t.ff.radius.md}px` }}
    >
      <Typography variant="body2" sx={{ color: "inherit" }}>
        {children}
      </Typography>
    </Alert>
  );
}
