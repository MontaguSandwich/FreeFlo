import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Locally-tracked offramp intents, persisted to localStorage so a user can find and
 * cancel/reclaim intents created in earlier sessions (the wizard's executionStore only
 * holds the active intent in memory). Discovery is browser-scoped; on-chain status is
 * always read live — we only persist identifiers + display metadata here.
 */
export interface TrackedIntent {
  intentId: `0x${string}`;
  createdAt: number; // client clock (ms), for display ordering only
  amountUsdc: string;
  currency: string;
  receivingInfo?: string;
  recipientName?: string;
}

interface IntentsState {
  intents: TrackedIntent[];
  addIntent: (intent: TrackedIntent) => void;
  removeIntent: (intentId: string) => void;
  clear: () => void;
}

export const useIntentsStore = create<IntentsState>()(
  persist(
    (set) => ({
      intents: [],
      addIntent: (intent) =>
        set((state) =>
          state.intents.some((i) => i.intentId === intent.intentId)
            ? state
            : { intents: [intent, ...state.intents].slice(0, 50) }
        ),
      removeIntent: (intentId) =>
        set((state) => ({
          intents: state.intents.filter((i) => i.intentId !== intentId),
        })),
      clear: () => set({ intents: [] }),
    }),
    { name: "freeflo-tracked-intents" }
  )
);
