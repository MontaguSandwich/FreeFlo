"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";

interface FooterProps {
  variant?: "default" | "venmo";
}

export function Footer({ variant = "default" }: FooterProps) {
  return (
    <Box
      component="footer"
      sx={{
        width: "100%",
        px: 4,
        py: 3,
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          maxWidth: 1280,
          mx: "auto",
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
          <Typography variant="caption" sx={{ color: "#52525b" }}>
            {variant === "venmo" ? "Cross-border RTPN bridge" : "Powered by crypto-native rails"}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "#3f3f46", display: { xs: "none", md: "inline" } }}
          >
            {variant === "venmo" ? "|" : "\u2022"}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "#52525b", display: { xs: "none", md: "inline" } }}
          >
            {variant === "venmo" ? "Venmo (US) \u2192 SEPA (EU)" : "SEPA \u2022 FPS \u2022 PIX \u2022 UPI \u2022 FedNow"}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
          {variant === "venmo" ? (
            <>
              <MuiLink
                href="https://zkp2p.xyz"
                target="_blank"
                rel="noopener noreferrer"
                underline="none"
                sx={{ fontSize: "0.75rem", color: "#52525b", "&:hover": { color: "#a1a1aa" } }}
              >
                ZKP2P
              </MuiLink>
              <MuiLink
                href="https://github.com/MontaguSandwich/FreeFlo"
                target="_blank"
                rel="noopener noreferrer"
                underline="none"
                sx={{ fontSize: "0.75rem", color: "#52525b", "&:hover": { color: "#a1a1aa" } }}
              >
                FreeFlo
              </MuiLink>
            </>
          ) : (
            <>
              <MuiLink
                href="#"
                underline="none"
                sx={{ fontSize: "0.75rem", color: "#52525b", "&:hover": { color: "#a1a1aa" } }}
              >
                Docs
              </MuiLink>
              <MuiLink
                href="#"
                underline="none"
                sx={{ fontSize: "0.75rem", color: "#52525b", "&:hover": { color: "#a1a1aa" } }}
              >
                GitHub
              </MuiLink>
              <MuiLink
                href="#"
                underline="none"
                sx={{ fontSize: "0.75rem", color: "#52525b", "&:hover": { color: "#a1a1aa" } }}
              >
                Support
              </MuiLink>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
