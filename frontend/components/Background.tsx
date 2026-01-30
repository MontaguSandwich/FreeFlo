"use client";

import Box from "@mui/material/Box";

interface BackgroundProps {
  variant?: "emerald" | "blue";
}

export function Background({ variant = "emerald" }: BackgroundProps) {
  const colors =
    variant === "blue"
      ? { orb1: "rgba(59, 130, 246, 0.08)", orb2: "rgba(16, 185, 129, 0.08)", orb3: "rgba(20, 184, 166, 0.05)" }
      : { orb1: "rgba(16, 185, 129, 0.08)", orb2: "rgba(20, 184, 166, 0.08)", orb3: "rgba(6, 182, 212, 0.05)" };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "#08080a",
        zIndex: 0,
      }}
    >
      {/* Gradient orbs */}
      <Box
        sx={{
          position: "absolute",
          top: "-30%",
          left: "-15%",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: colors.orb1,
          filter: "blur(150px)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          bottom: "-30%",
          right: "-15%",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: colors.orb2,
          filter: "blur(130px)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: "30%",
          right: "10%",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: colors.orb3,
          filter: "blur(100px)",
        }}
      />

      {/* Subtle grid */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
    </Box>
  );
}
