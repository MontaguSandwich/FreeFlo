"use client";

import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Badge from "@mui/material/Badge";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import HistoryIcon from "@mui/icons-material/History";
import BoltIcon from "@mui/icons-material/Bolt";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useExecuteOfframp } from "@/hooks/useExecuteOfframp";
import { useHistoryUiStore } from "@/stores/historyUiStore";
import { useReclaimableCount } from "@/hooks/useReclaimableCount";
import { FlowCard } from "@/components/fiat-to-fiat/ui";
import { OfframpInput } from "./OfframpInput";
import { OfframpExecution } from "./OfframpExecution";
import { TransactionHistory } from "./TransactionHistory";
import { SignOnceFlow } from "@/components/sign-once/SignOnceFlow";

export function OfframpWidget() {
  const { isConnected, address } = useAccount();
  const { view } = useExecutionStore();
  const { startExecution } = useExecuteOfframp();

  // Sign-once (Compact, 1 gasless signature) vs the standard 3-tx OffRampV3 flow — in-place toggle.
  const [signOnce, setSignOnce] = useState(false);

  // Transaction history — lifted up here (out of OfframpInput) so it + the mode toggle live in one
  // persistent strip and stay visible/usable in BOTH modes. Store-backed, so it renders anywhere.
  const historyOpen = useHistoryUiStore((s) => s.open);
  const setHistoryOpen = useHistoryUiStore((s) => s.setOpen);
  const reclaimableCount = useReclaimableCount(address);

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
      <FlowCard sx={{ maxWidth: 480, mx: "auto", p: 6, textAlign: "center" }}>
        <Box
          sx={{
            width: 80,
            height: 80,
            mx: "auto",
            mb: 3,
            borderRadius: (t) => `${t.ff.radius.lg}px`,
            background: (t) => `linear-gradient(to bottom right, ${t.ff.glow1}, ${t.ff.glow2})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AccountBalanceWalletIcon sx={{ fontSize: 40, color: (t) => t.ff.brandStrong }} />
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

  const body = signOnce ? (
    <SignOnceFlow />
  ) : view === "execution" ? (
    <OfframpExecution onReset={handleReset} />
  ) : (
    <OfframpInput onStartExecution={handleStartExecution} />
  );

  return (
    <Box sx={{ maxWidth: 480, mx: "auto" }}>
      {/* Mode strip — persistent across both flows: [Standard | 1-signature] toggle + history. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1.5,
          px: 0.5,
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={signOnce ? "once" : "standard"}
          onChange={(_e, v) => {
            if (v !== null) setSignOnce(v === "once");
          }}
          aria-label="offramp mode"
          sx={{
            "& .MuiToggleButton-root": {
              textTransform: "none",
              px: 1.5,
              py: 0.5,
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: (t) => t.ff.textSecondary,
              borderColor: (t) => t.ff.border,
              "&.Mui-selected": {
                color: (t) => t.ff.brandStrong,
                bgcolor: (t) => t.ff.glow1,
                "&:hover": { bgcolor: (t) => t.ff.glow1 },
              },
            },
          }}
        >
          <ToggleButton value="standard">Standard</ToggleButton>
          <ToggleButton value="once">
            <BoltIcon sx={{ fontSize: 15, mr: 0.5 }} />
            1-signature
          </ToggleButton>
        </ToggleButtonGroup>

        <Tooltip title="Transaction history">
          <IconButton
            size="small"
            onClick={() => setHistoryOpen(true)}
            aria-label="transaction history"
            sx={{ color: (t) => t.ff.textTertiary, "&:hover": { color: (t) => t.ff.brandStrong } }}
          >
            <Badge variant="dot" color="error" overlap="circular" invisible={reclaimableCount === 0}>
              <HistoryIcon sx={{ fontSize: 18 }} />
            </Badge>
          </IconButton>
        </Tooltip>
      </Box>

      {body}

      <TransactionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </Box>
  );
}
