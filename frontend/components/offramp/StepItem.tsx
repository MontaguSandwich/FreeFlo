"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MuiLink from "@mui/material/Link";
import { type ExecutionStep } from "@/stores/executionStore";

interface StepItemProps {
  step: ExecutionStep;
}

export function StepItem({ step }: StepItemProps) {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time every second while step is pending
  useEffect(() => {
    if (step.status !== "pending" || !step.startedAt) {
      setElapsed(0);
      return;
    }

    // Set initial elapsed value immediately
    setElapsed(Math.floor((Date.now() - step.startedAt) / 1000));

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - step.startedAt!) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [step.status, step.startedAt]);

  const renderStatusIcon = () => {
    switch (step.status) {
      case "idle":
        return (
          <RadioButtonUncheckedIcon
            sx={{ color: (t) => t.ff.textTertiary, fontSize: 24 }}
          />
        );
      case "pending":
        return (
          <CircularProgress
            size={22}
            thickness={4}
            sx={{ color: (t) => t.ff.brand }}
          />
        );
      case "done":
        return (
          <CheckCircleIcon sx={{ color: (t) => t.ff.brand, fontSize: 24 }} />
        );
      case "failed":
        return <ErrorIcon sx={{ color: "error.main", fontSize: 24 }} />;
      case "skipped":
        return (
          <SkipNextIcon sx={{ color: (t) => t.ff.textTertiary, fontSize: 20 }} />
        );
    }
  };

  const isPending = step.status === "pending";
  const isSkipped = step.status === "skipped";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 2,
        px: 2.5,
        py: 1.75,
        borderBottom: (t) => `1px solid ${t.ff.border}`,
        backgroundColor: isPending
          ? "rgba(16, 185, 129, 0.04)"
          : "transparent",
        opacity: isSkipped ? 0.5 : 1,
        transition: "background-color 0.2s ease",
        "&:last-child": {
          borderBottom: "none",
        },
      }}
    >
      {/* Left: Status icon */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          mt: "2px",
        }}
      >
        {renderStatusIcon()}
      </Box>

      {/* Center: Label, elapsed time, error, tx link */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography
            variant="body1"
            sx={{
              fontWeight: isPending ? 600 : 400,
              color: isSkipped ? "text.disabled" : "text.primary",
              fontSize: "0.95rem",
              lineHeight: 1.4,
            }}
          >
            {step.label}
          </Typography>

          {isPending && step.startedAt && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontVariantNumeric: "tabular-nums",
                ml: 0.5,
              }}
            >
              {elapsed}s
            </Typography>
          )}
        </Box>

        {/* Error message */}
        {step.status === "failed" && step.error && (
          <Typography
            variant="body2"
            sx={{
              color: "error.main",
              mt: 0.5,
              fontSize: "0.825rem",
              lineHeight: 1.4,
            }}
          >
            {step.error}
          </Typography>
        )}

        {/* Transaction link */}
        {step.status === "done" && step.txHash && (
          <MuiLink
            href={`https://basescan.org/tx/${step.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.5,
              fontSize: "0.8rem",
              color: (t) => t.ff.brand,
              "&:hover": {
                color: (t) => t.ff.brandStrong,
              },
            }}
          >
            View transaction
            <OpenInNewIcon sx={{ fontSize: 13 }} />
          </MuiLink>
        )}
      </Box>

      {/* Right: Reserved for future use */}
      <Box sx={{ width: 32, flexShrink: 0 }} />
    </Box>
  );
}
