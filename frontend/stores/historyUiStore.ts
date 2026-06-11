import { create } from "zustand";

/** Ephemeral UI state for the transaction-history dialog (open/close). */
interface HistoryUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useHistoryUiStore = create<HistoryUiState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
