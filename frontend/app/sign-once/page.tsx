"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Background } from "@/components/Background";
import { SignOnceFlow } from "@/components/sign-once/SignOnceFlow";

export default function SignOncePage() {
  return (
    <Box component="main" sx={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <Background variant="emerald" />

      <Box
        sx={{
          position: "relative",
          zIndex: 10,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Header />

        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            px: 4,
            py: 5,
          }}
        >
          <Box sx={{ maxWidth: 560, mx: "auto", width: "100%" }}>
            {/* Hero */}
            <Box sx={{ textAlign: "center", mb: 4 }}>
              <Chip
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        bgcolor: (t) => t.ff.brandStrong,
                        borderRadius: "50%",
                      }}
                    />
                    <Typography
                      component="span"
                      sx={{ fontSize: "0.75rem", color: (t) => t.ff.brandStrong, fontWeight: 500 }}
                    >
                      The Compact · one signature
                    </Typography>
                  </Box>
                }
                sx={{
                  bgcolor: (t) => t.ff.glow1,
                  border: (t) => `1px solid ${t.ff.border}`,
                  borderRadius: "9999px",
                  mb: 2,
                  height: "auto",
                  "& .MuiChip-label": { px: 1.5, py: 0.75 },
                }}
              />

              <Typography
                variant="h2"
                sx={{
                  fontWeight: 700,
                  color: "white",
                  mb: 1.5,
                  letterSpacing: "-0.025em",
                  fontSize: { xs: "1.875rem", md: "2.5rem" },
                }}
              >
                Offramp in{" "}
                <Box
                  component="span"
                  sx={{
                    background: "linear-gradient(to right, #34d399, #2dd4bf)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  one signature
                </Box>
              </Typography>

              <Typography sx={{ color: (t) => t.ff.textSecondary, fontSize: "1rem", maxWidth: 440, mx: "auto" }}>
                Sign one gasless order — the solver pays all gas. It sends SEPA EUR and claims
                your USDC; no per-step transactions. First time only, a one-time Permit2 approval.
              </Typography>
            </Box>

            <SignOnceFlow />
          </Box>
        </Box>

        <Footer />
      </Box>
    </Box>
  );
}
