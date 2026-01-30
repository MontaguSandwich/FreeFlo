"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { CURRENCIES } from "@/lib/quotes";
import { StepItem } from "./StepItem";

interface OfframpExecutionProps {
  onReset: () => void;
}

export function OfframpExecution({ onReset }: OfframpExecutionProps) {
  const { amount, selectedQuote } = useFormStore();
  const { steps, error } = useExecutionStore();
  const formReset = useFormStore((s) => s.reset);
  const executionReset = useExecutionStore((s) => s.reset);

  const completeStep = steps.find((s) => s.id === "complete");
  const isComplete = completeStep?.status === "done";
  const isInProgress = steps.some((s) => s.status === "pending");

  const currencyInfo = selectedQuote
    ? CURRENCIES[selectedQuote.rtpnInfo.currency]
    : null;
  const rtpnName = selectedQuote?.rtpnInfo.name ?? "";
  const outputAmount = selectedQuote?.outputAmount ?? 0;
  const currencySymbol = currencyInfo?.symbol ?? "";
  const solverName = selectedQuote?.solver.name ?? "";

  const handleReset = () => {
    formReset();
    executionReset();
    onReset();
  };

  return (
    <Card
      elevation={0}
      sx={{
        maxWidth: 480,
        mx: "auto",
        width: "100%",
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
      }}
    >
      {/* Summary header */}
      <Box
        sx={{
          px: 3,
          py: 2.5,
          background:
            "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", mb: 0.5, fontSize: "0.8rem" }}
        >
          Offramp in progress
        </Typography>
        <Typography
          variant="h6"
          sx={{
            fontWeight: 600,
            fontSize: "1.1rem",
            color: "text.primary",
          }}
        >
          {amount} USDC &rarr; {outputAmount} {currencySymbol}
          <Typography
            component="span"
            sx={{
              fontWeight: 400,
              fontSize: "0.85rem",
              color: "text.secondary",
              ml: 1,
            }}
          >
            via {rtpnName}
          </Typography>
        </Typography>
      </Box>

      {/* Step list */}
      <Box sx={{ py: 0.5 }}>
        {steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
      </Box>

      {/* Error display */}
      {error && (
        <Box sx={{ px: 2.5, pb: 2 }}>
          <Alert
            severity="error"
            sx={{
              borderRadius: 2,
              "& .MuiAlert-message": { fontSize: "0.875rem" },
            }}
          >
            {error}
          </Alert>
        </Box>
      )}

      {/* Success state */}
      {isComplete && (
        <>
          <Divider />
          <Box
            sx={{
              px: 3,
              py: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <CheckCircleOutlineIcon
              sx={{ fontSize: 48, color: "#10b981" }}
            />
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, color: "text.primary" }}
            >
              Transfer Complete!
            </Typography>

            {/* Summary box */}
            <Box
              sx={{
                width: "100%",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                backgroundColor: "rgba(16, 185, 129, 0.03)",
                p: 2,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  You sent
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {amount} USDC
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  You received
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {outputAmount} {currencySymbol}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  Network
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {rtpnName}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  Solver
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {solverName}
                </Typography>
              </Box>
            </Box>

            <Button
              variant="contained"
              fullWidth
              onClick={handleReset}
              sx={{
                mt: 1,
                py: 1.25,
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.95rem",
                backgroundColor: "#10b981",
                "&:hover": {
                  backgroundColor: "#059669",
                },
              }}
            >
              New Transfer
            </Button>
          </Box>
        </>
      )}
    </Card>
  );
}
