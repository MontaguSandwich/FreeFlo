"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { CURRENCIES } from "@/lib/quotes";
import {
  FlowCard,
  PrimaryButton,
  NoticeBanner,
  SummaryRow,
  SummaryGroup,
  SuccessCheck,
} from "@/components/fiat-to-fiat/ui";
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
    <FlowCard
      sx={{
        maxWidth: 480,
        mx: "auto",
        width: "100%",
      }}
    >
      {/* Summary header */}
      <Box
        sx={{
          px: 3,
          py: 2.5,
          background:
            "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)",
          borderBottom: (t) => `1px solid ${t.ff.border}`,
        }}
      >
        <Typography
          variant="body2"
          sx={{ color: (t) => t.ff.textSecondary, mb: 0.5, fontSize: "0.8rem" }}
        >
          Offramp in progress
        </Typography>
        <Typography
          variant="h4"
          sx={{
            fontSize: "1.1rem",
            color: (t) => t.ff.text,
          }}
        >
          {amount} USDC &rarr; {outputAmount} {currencySymbol}
          <Typography
            component="span"
            sx={{
              fontWeight: 400,
              fontSize: "0.85rem",
              color: (t) => t.ff.textSecondary,
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
          <NoticeBanner kind="error">{error}</NoticeBanner>
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
            <SuccessCheck size={64} />
            <Typography variant="h3" sx={{ color: (t) => t.ff.text }}>
              Transfer Complete!
            </Typography>

            {/* Summary box */}
            <Box sx={{ width: "100%" }}>
              <SummaryGroup>
                <SummaryRow label="You sent" value={`${amount} USDC`} accent />
                <SummaryRow
                  label="You received"
                  value={`${outputAmount} ${currencySymbol}`}
                  accent
                />
                <SummaryRow label="Network" value={rtpnName} />
                <SummaryRow label="Solver" value={solverName} />
              </SummaryGroup>
            </Box>

            <PrimaryButton onClick={handleReset} sx={{ mt: 1 }}>
              New Transfer
            </PrimaryButton>
          </Box>
        </>
      )}
    </FlowCard>
  );
}
