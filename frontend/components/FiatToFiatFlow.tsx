"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { useFiatToFiatFlow } from "@/hooks/useFiatToFiatFlow";
import { CURRENCIES } from "@/lib/platforms";

import {
  FlowCard,
  TransferSummaryRail,
  PhaseStepper,
  NoticeBanner,
  CountdownPill,
  GhostButton,
  DangerButton,
  FlowChevron,
  phaseIndex,
} from "./fiat-to-fiat/ui";
import {
  SelectFlowScreen,
  InputScreen,
  FindingQuotesScreen,
  SelectMakerScreen,
  SignalScreen,
  SendFiatScreen,
  VerifyScreen,
  AuthenticatingScreen,
  SelectPaymentScreen,
  FulfillingScreen,
  RouterWaitingScreen,
  CommitScreen,
  FreefloPendingScreen,
  SuccessScreen,
} from "./fiat-to-fiat/screens";

// ============================================================================
// FiatToFiatFlow — the wizard SHELL (Gate 4). The flow LOGIC is frozen behind
// useFiatToFiatFlow(); this file is presentation only. It renders:
//   1. the re-skinned not-connected card,
//   2. the persistent TransferSummaryRail + PhaseStepper (a READ-ONLY projection
//      over the unchanged FlowStep — no FlowStep is renamed),
//   3. the re-skinned error banner (the active-intent Cancel + Dismiss logic
//      preserved verbatim),
//   4. the stage-2 deadline countdown (gated exactly as before),
//   5. a switch on flow.step that renders the matching screen with `flow={flow}`.
// EVERY FlowStep maps to a screen — there is no blank/unhandled state.
// ============================================================================

export function FiatToFiatFlow() {
  const flow = useFiatToFiatFlow();
  const {
    isConnected,
    step,
    flowData,
    error,
    setError,
    isCancelling,
    selectedCurrency,
    progress,
    deadlineRemaining,
    formatEur,
    formatCountdown,
    estimatedEur,
    handleCancelIntent,
  } = flow;

  // ---- Not connected: re-skinned card (tokens) -----------------------------
  if (!isConnected) {
    return (
      <FlowCard sx={{ p: 4, textAlign: "center" }}>
        <Box sx={{ mb: 2, display: "flex", justifyContent: "center" }}>
          <FlowChevron size={32} />
        </Box>
        <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 1 }}>
          Connect your wallet
        </Typography>
        <Typography sx={{ color: (t) => t.ff.textSecondary }}>
          Connect your wallet to start a cross-border transfer.
        </Typography>
      </FlowCard>
    );
  }

  // ---- Rail projection (read-only over flowData / derived) -----------------
  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const amountIn = `${symbol}${flowData.usdAmount.toFixed(2)}`;
  // Firm euro figure once a FreeFlo quote resolves; otherwise the committed floor,
  // then the live input estimate. Show "…" until one of those resolves.
  const hasFirmEur = flowData.quotedEurAmount > 0;
  const estEur = flowData.minEurAmount > 0 ? flowData.minEurAmount : (estimatedEur ?? 0);
  const amountOut = hasFirmEur
    ? formatEur(flowData.quotedEurAmount)
    : estEur > 0
      ? formatEur(estEur)
      : "…";

  const showRail = step !== "select_flow" && step !== "success";
  // The deadline clock surfaces once the FreeFlo intent exists (INV-7).
  const hasDeadline = Boolean(flowData.routerIntentCreatedAt);
  const deadlineDanger = deadlineRemaining < 120;
  const deadlineExpired = deadlineRemaining === 0;
  const deadlineLabel = formatCountdown(deadlineRemaining);

  // ---- Error-banner action slot: active-intent Cancel + Dismiss ------------
  // Preserved VERBATIM: Cancel shows ONLY when the error is the active-intent
  // kind AND a zkp2pIntentHash exists; Dismiss always shows.
  const showActiveIntentCancel =
    !!error &&
    (error.includes("active intent") || error.includes("active order")) &&
    !!flowData.zkp2pIntentHash;

  const errorAction = (
    <>
      {showActiveIntentCancel && (
        <DangerButton
          onClick={handleCancelIntent}
          loading={isCancelling}
          loadingLabel="Cancelling…"
          sx={{ width: "auto", py: 0.5, px: 1.5, fontSize: "0.75rem" }}
        >
          Cancel intent
        </DangerButton>
      )}
      <GhostButton onClick={() => setError(null)} sx={{ py: 0.5, px: 1.5, fontSize: "0.75rem" }}>
        Dismiss
      </GhostButton>
    </>
  );

  return (
    <FlowCard>
      {/* 1. Persistent transfer-summary rail (hidden on select_flow + success) */}
      {showRail && (
        <TransferSummaryRail
          amountIn={amountIn}
          amountOut={amountOut}
          amountOutEstimate={!hasFirmEur}
          recipientName={flowData.recipientName || undefined}
          recipientIban={flowData.eurIban || undefined}
          phaseIdx={phaseIndex(step)}
          showDeadline={hasDeadline}
          deadlineLabel={deadlineLabel}
          deadlineDanger={deadlineDanger}
          deadlineExpired={deadlineExpired}
        />
      )}

      {/* 2. Phase stepper (read-only projection over FlowStep) */}
      {showRail && (
        <Box sx={{ px: 3, py: 1.5, borderBottom: (t) => `1px solid ${t.ff.border}` }}>
          <PhaseStepper activeIndex={phaseIndex(step)} />
        </Box>
      )}

      {/* 3. Stage-2 deadline countdown (gated exactly as the original) */}
      {progress.stage === 2 && flowData.routerIntentCreatedAt && (
        <Box
          sx={{
            px: 3,
            py: 1.25,
            borderBottom: (t) => `1px solid ${t.ff.border}`,
            background: (t) => (deadlineDanger ? t.ff.destructiveBg : t.ff.warningBg),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="body2" sx={{ color: (t) => (deadlineDanger ? t.ff.destructive : t.ff.warning) }}>
            Quote window
          </Typography>
          <CountdownPill label={deadlineLabel} danger={deadlineDanger} expired={deadlineExpired} />
        </Box>
      )}

      {/* 4. Error banner (active-intent Cancel + Dismiss preserved) */}
      {error && (
        <Box sx={{ mx: 3, mt: 2 }}>
          <NoticeBanner kind="error" action={errorAction}>
            {error}
          </NoticeBanner>
        </Box>
      )}

      {/* 5. Step switch — EVERY FlowStep maps to a screen (no blank states) */}
      <Box sx={{ p: 3 }}>
        {step === "select_flow" && <SelectFlowScreen flow={flow} />}
        {step === "input_all" && <InputScreen flow={flow} />}
        {step === "finding_quotes" && <FindingQuotesScreen flow={flow} />}
        {step === "select_maker" && <SelectMakerScreen flow={flow} />}
        {step === "zkp2p_signal" && <SignalScreen flow={flow} />}
        {step === "zkp2p_send_venmo" && <SendFiatScreen flow={flow} />}
        {step === "zkp2p_verify" && <VerifyScreen flow={flow} />}
        {step === "zkp2p_authenticating" && <AuthenticatingScreen flow={flow} />}
        {step === "zkp2p_select_payment" && <SelectPaymentScreen flow={flow} />}
        {step === "zkp2p_fulfilling" && <FulfillingScreen flow={flow} />}
        {step === "router_waiting" && <RouterWaitingScreen flow={flow} />}
        {step === "router_commit" && <CommitScreen flow={flow} />}
        {step === "freeflo_pending" && <FreefloPendingScreen flow={flow} />}
        {step === "success" && <SuccessScreen flow={flow} />}
        {step === "error" && (
          // `error` is a flag, not a phase (§4.1). The message renders in the
          // banner above with its recovery actions; this keeps the body from
          // ever being blank when step === "error".
          <Box sx={{ textAlign: "center", py: 4 }}>
            <Typography sx={{ color: (t) => t.ff.textSecondary }}>
              {error || "Something went wrong. Use the actions above to retry or reclaim."}
            </Typography>
          </Box>
        )}
      </Box>
    </FlowCard>
  );
}
