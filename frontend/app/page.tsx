"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Background } from "@/components/Background";
import { OfframpWidget } from "@/components/offramp/OfframpWidget";

export default function Home() {
  return (
    <Box component="main" sx={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <Background variant="emerald" />

      <Box sx={{ position: "relative", zIndex: 10, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Header />

        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", px: 4, py: 5 }}>
          <Box sx={{ maxWidth: 960, mx: "auto", width: "100%" }}>
            {/* Hero */}
            <Box sx={{ textAlign: "center", mb: 5 }}>
              <Typography
                variant="h2"
                sx={{
                  fontSize: { xs: "2rem", md: "2.75rem" },
                  fontWeight: 700,
                  color: "white",
                  mb: 2,
                  letterSpacing: "-0.025em",
                }}
              >
                USDC to Fiat,{" "}
                <Box
                  component="span"
                  sx={{
                    background: "linear-gradient(to right, #34d399, #2dd4bf)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Instantly
                </Box>
              </Typography>
              <Typography sx={{ color: "text.secondary", fontSize: "1.125rem", maxWidth: 560, mx: "auto" }}>
                Convert stablecoins to EUR, GBP, USD, BRL, or INR via real-time payment rails.
              </Typography>
            </Box>

            {/* Main Widget */}
            <OfframpWidget />
          </Box>
        </Box>

        <Footer />
      </Box>
    </Box>
  );
}
