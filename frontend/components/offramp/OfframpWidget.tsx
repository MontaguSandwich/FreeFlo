"use client";

import { useCallback } from "react";
import { useAccount } from "wagmi";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useExecuteOfframp } from "@/hooks/useExecuteOfframp";
import { FlowCard } from "@/components/fiat-to-fiat/ui";
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
      <FlowCard
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
            borderRadius: (t) => `${t.ff.radius.lg}px`,
            background: (t) =>
              `linear-gradient(to bottom right, ${t.ff.glow1}, ${t.ff.glow2})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AccountBalanceWalletIcon
            sx={{ fontSize: 40, color: (t) => t.ff.brandStrong }}
          />
        </Box>
        <Typography variant="h3" sx={{ color: (t) => t.ff.text, mb: 1 }}>
          Connect Your Wallet
        </Typography>
        <Typography sx={{ color: (t) => t.ff.textSecondary }}>
          Connect your wallet to start off-ramping USDC
        </Typography>
      </FlowCard>
    );
  }

  // Toggle between input and execution views
  if (view === "execution") {
    return <OfframpExecution onReset={handleReset} />;
  }

  return <OfframpInput onStartExecution={handleStartExecution} />;
}
