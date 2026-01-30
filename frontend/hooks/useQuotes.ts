import { useState, useEffect, useCallback } from "react";
import { fetchQuotesByRtpn, type Currency, type RTPNQuote } from "@/lib/quotes";

export function useQuotes(amount: string, currency: Currency) {
  const [quotes, setQuotes] = useState<RTPNQuote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadQuotes = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      setQuotes([]);
      return;
    }
    setIsLoading(true);
    try {
      const newQuotes = await fetchQuotesByRtpn(numAmount, currency);
      setQuotes(newQuotes);
    } catch (err) {
      console.error("Failed to fetch quotes:", err);
      setQuotes([]);
    } finally {
      setIsLoading(false);
    }
  }, [amount, currency]);

  // Debounced fetch on amount/currency change
  useEffect(() => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      setQuotes([]);
      return;
    }
    const timer = setTimeout(loadQuotes, 400);
    return () => clearTimeout(timer);
  }, [amount, currency, loadQuotes]);

  return { quotes, isLoading, refresh: loadQuotes };
}
