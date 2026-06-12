import type { FlowStep } from "@/hooks/useFiatToFiatFlow";

/**
 * Phase projection (§4.1). The 14 internal FlowSteps are an engineering truth
 * and MUST NOT be renamed (their string values drive pollers / persistence /
 * resume lists). This is a READ-ONLY display projection over the unchanged
 * `step` — it adds zero state and renames zero literal. The user sees 4 phases:
 *   1 Set up · 2 Pay & prove · 3 Convert · 4 Done.
 *
 * `error` is NOT a phase (it's a flag); it renders as a Notice, never a stuck
 * phase. When step === "error" we keep the last phase index at 0 (the rail's
 * phase chip simply shows "Set up"), since the error banner carries the message.
 */

export const PHASE_LABELS = ["Set up", "Pay & prove", "Convert", "Done"] as const;

const PHASE_OF_STEP: Record<Exclude<FlowStep, "error">, 0 | 1 | 2 | 3> = {
  select_flow: 0,
  input_all: 0,
  finding_quotes: 0,
  select_maker: 0,
  zkp2p_signal: 1,
  zkp2p_send_venmo: 1,
  zkp2p_verify: 1,
  zkp2p_authenticating: 1,
  zkp2p_select_payment: 1,
  zkp2p_fulfilling: 1,
  router_waiting: 2,
  router_commit: 2,
  freeflo_pending: 2,
  success: 3,
};

/** Active phase index (0..3) for a given FlowStep. */
export function phaseIndex(step: FlowStep): 0 | 1 | 2 | 3 {
  if (step === "error") return 0;
  return PHASE_OF_STEP[step];
}

/** Human "N of 4" label for screen headers. */
export function phaseOfFour(step: FlowStep): string {
  return `${phaseIndex(step) + 1} of 4`;
}

/** The active phase's display label. */
export function phaseLabel(step: FlowStep): string {
  return PHASE_LABELS[phaseIndex(step)];
}
