"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Background } from "@/components/Background";
import { VenmoToSepaFlow } from "@/components/VenmoToSepaFlow";

export default function VenmoToSepaPage() {
  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Background variant="blue" />

      <Box
        sx={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
        }}
      >
        <Header />

        {/* Main Content */}
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
          <Box sx={{ maxWidth: "lg", mx: "auto", width: "100%" }}>
            {/* Hero */}
            <Box sx={{ textAlign: "center", mb: 4 }}>
              <Chip
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        bgcolor: "#60a5fa",
                        borderRadius: "50%",
                        animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                        "@keyframes pulse": {
                          "0%, 100%": { opacity: 1 },
                          "50%": { opacity: 0.5 },
                        },
                      }}
                    />
                    <Typography
                      component="span"
                      sx={{
                        fontSize: "0.75rem",
                        color: "#60a5fa",
                        fontWeight: 500,
                      }}
                    >
                      Powered by ZKP2P + FreeFlo
                    </Typography>
                  </Box>
                }
                sx={{
                  bgcolor: "rgba(59, 130, 246, 0.1)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                  borderRadius: "9999px",
                  mb: 2,
                  height: "auto",
                  "& .MuiChip-label": {
                    px: 1.5,
                    py: 0.75,
                  },
                }}
              />

              <Typography
                variant="h3"
                sx={{
                  fontWeight: 700,
                  color: "white",
                  mb: 1.5,
                  letterSpacing: "-0.02em",
                  fontSize: { xs: "1.875rem", md: "2.25rem" },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    background: "linear-gradient(to right, #60a5fa, #34d399)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Venmo
                </Box>
                {" to "}
                <Box
                  component="span"
                  sx={{
                    background: "linear-gradient(to right, #34d399, #2dd4bf)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  SEPA
                </Box>
              </Typography>

              <Typography
                sx={{
                  color: "#a1a1aa",
                  fontSize: "1rem",
                  maxWidth: 448,
                  mx: "auto",
                }}
              >
                Send USD from Venmo and receive EUR in any European bank account.
                Trustless, fast, and low-cost.
              </Typography>
            </Box>

            {/* VenmoToSepaFlow */}
            <VenmoToSepaFlow />

            {/* Info Cards */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 2,
                mt: 3,
              }}
            >
              <Card
                sx={{
                  bgcolor: "rgba(24, 24, 27, 0.5)",
                  border: "1px solid",
                  borderColor: "#27272a",
                  borderRadius: 3,
                  p: 2,
                  boxShadow: "none",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 2,
                      bgcolor: "rgba(59, 130, 246, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        color: "#60a5fa",
                        fontWeight: 700,
                        fontSize: "0.875rem",
                      }}
                    >
                      1
                    </Typography>
                  </Box>
                  <Typography
                    sx={{
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      color: "white",
                    }}
                  >
                    ZKP2P
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: "0.75rem", color: "#71717a" }}>
                  Convert Venmo USD to USDC using zero-knowledge proofs
                </Typography>
              </Card>

              <Card
                sx={{
                  bgcolor: "rgba(24, 24, 27, 0.5)",
                  border: "1px solid",
                  borderColor: "#27272a",
                  borderRadius: 3,
                  p: 2,
                  boxShadow: "none",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 2,
                      bgcolor: "rgba(16, 185, 129, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        color: "#34d399",
                        fontWeight: 700,
                        fontSize: "0.875rem",
                      }}
                    >
                      2
                    </Typography>
                  </Box>
                  <Typography
                    sx={{
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      color: "white",
                    }}
                  >
                    FreeFlo
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: "0.75rem", color: "#71717a" }}>
                  Convert USDC to EUR via SEPA Instant in ~15 seconds
                </Typography>
              </Card>
            </Box>
          </Box>
        </Box>

        <Footer variant="venmo" />
      </Box>
    </Box>
  );
}
