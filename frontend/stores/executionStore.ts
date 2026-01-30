import { create } from "zustand";

export type ExecutionStepId =
  | "createIntent"
  | "approve"
  | "commit"
  | "transferPending"
  | "complete";

export type StepStatus = "idle" | "pending" | "done" | "failed" | "skipped";

export interface ExecutionStep {
  id: ExecutionStepId;
  label: string;
  status: StepStatus;
  txHash?: string;
  error?: string;
  startedAt?: number;
}

const initialSteps: ExecutionStep[] = [
  { id: "createIntent", label: "Create Intent", status: "idle" },
  { id: "approve", label: "Approve USDC", status: "idle" },
  { id: "commit", label: "Confirm & Commit", status: "idle" },
  { id: "transferPending", label: "Transfer Pending", status: "idle" },
  { id: "complete", label: "Complete", status: "idle" },
];

interface ExecutionState {
  view: "input" | "execution";
  steps: ExecutionStep[];
  intentId: `0x${string}` | null;
  error: string | null;

  setView: (view: "input" | "execution") => void;
  setStepStatus: (
    stepId: ExecutionStepId,
    status: StepStatus,
    extra?: { txHash?: string; error?: string }
  ) => void;
  setIntentId: (id: `0x${string}` | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  view: "input",
  steps: initialSteps.map((s) => ({ ...s })),
  intentId: null,
  error: null,

  setView: (view) => set({ view }),

  setStepStatus: (stepId, status, extra) =>
    set((state) => ({
      steps: state.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              status,
              ...(extra?.txHash !== undefined && { txHash: extra.txHash }),
              ...(extra?.error !== undefined && { error: extra.error }),
              ...(status === "pending" && { startedAt: Date.now() }),
            }
          : step
      ),
    })),

  setIntentId: (id) => set({ intentId: id }),

  setError: (error) => set({ error }),

  reset: () =>
    set({
      view: "input",
      steps: initialSteps.map((s) => ({ ...s })),
      intentId: null,
      error: null,
    }),
}));
