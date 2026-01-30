import { create } from "zustand";
import { Currency, RTPNQuote } from "@/lib/quotes";

interface FormState {
  amount: string;
  currency: Currency;
  receivingInfo: string;
  recipientName: string;
  selectedQuote: RTPNQuote | null;

  setAmount: (amount: string) => void;
  setCurrency: (currency: Currency) => void;
  setReceivingInfo: (info: string) => void;
  setRecipientName: (name: string) => void;
  setSelectedQuote: (quote: RTPNQuote | null) => void;
  reset: () => void;
}

const initialState = {
  amount: "",
  currency: "EUR" as Currency,
  receivingInfo: "",
  recipientName: "",
  selectedQuote: null as RTPNQuote | null,
};

export const useFormStore = create<FormState>((set) => ({
  ...initialState,

  setAmount: (amount) => set({ amount }),
  setCurrency: (currency) => set({ currency }),
  setReceivingInfo: (info) => set({ receivingInfo: info }),
  setRecipientName: (name) => set({ recipientName: name }),
  setSelectedQuote: (quote) => set({ selectedQuote: quote }),
  reset: () => set({ ...initialState }),
}));
