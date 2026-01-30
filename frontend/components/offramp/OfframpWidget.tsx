"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useExecuteOfframp } from "@/hooks/useExecuteOfframp";
import { OfframpInput } from "./OfframpInput";
import { OfframpExecution } from "./OfframpExecution";

export function OfframpWidget() {
  const { isConnected } = useAccount();
  const { view } = useExecutionStore();
  const { startExecution } = useExecuteOfframp();

  const handleStartExecution = useCallback(() => {
    startExecution();
  }, [startExecution]);

  const handleReset = useCallback(() => {
    useFormStore.getState().reset();
    useExecutionStore.getState().reset();
  }, []);

  // Not connected state
  if (!isConnected) {
    return (
      <Card
        sx={{
          maxWidth: 480,
          mx: "auto",
          p: 6,
          textAlign: "center",
        }}
      >
        <Box
          sx={{
            width: 80,
            height: 80,
            mx: "auto",
            mb: 3,
            borderRadius: 4,
            background: "linear-gradient(to bottom right, rgba(16, 185, 129, 0.2), rgba(20, 184, 166, 0.2))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AccountBalanceWalletIcon sx={{ fontSize: 40, color: "#34d399" }} />
        </Box>
        <Typography variant="h5" sx={{ color: "white", mb: 1 }}>
          Connect Your Wallet
        </Typography>
        <Typography sx={{ color: "text.secondary" }}>
          Connect your wallet to start off-ramping USDC
        </Typography>
      </Card>
    );
  }

  // Toggle between input and execution views
  if (view === "execution") {
    return <OfframpExecution onReset={handleReset} />;
  }

  return <OfframpInput onStartExecution={handleStartExecution} />;
}
