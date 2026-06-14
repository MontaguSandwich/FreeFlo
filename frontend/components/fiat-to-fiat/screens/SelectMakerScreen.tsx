"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { FiatToFiatFlowApi, ZkpQuote } from "@/hooks/useFiatToFiatFlow";
import { CURRENCIES } from "@/lib/platforms";
import { MakerCard, NoticeBanner, phaseOfFour } from "../ui";

/**
 * select_maker (§5.4) — pick a partner. Behaviour preserved:
 *  - maps flow.zkp2pQuotes, each card's onSelect calls handleSelectMaker(quote)
 *    (unchanged — sets zkp2pQuote / usdcAmount / venmoPayee, lazy-resolves handle).
 *  - renders each maker as a MakerCard showing the payee handle (@…) with a
 *    tier-coloured verification check, the platform, and the fiat to pay (Peer-style).
 *    (The earlier "don't leak handles" rule is intentionally reversed — the handle is
 *    public maker data and surfacing it helps the user choose.)
 *  - the best quote (most USDC fronted for the same fiat) gets the "Best rate" badge.
 *  - empty/loading state is first-class (no maker list ⇒ a calm Notice rather
 *    than a blank screen — the hook normally routes empties back to input_all,
 *    but if we land here with none we never show nothing).
 */

function bestDepositId(quotes: ZkpQuote[]): string | null {
  let best: { id: string; amt: bigint } | null = null;
  for (const q of quotes) {
    let amt = BigInt(0);
    try {
      amt = q.tokenAmount ? BigInt(q.tokenAmount) : BigInt(0);
    } catch {
      amt = BigInt(0);
    }
    if (!best || amt > best.amt) best = { id: q.depositId, amt };
  }
  return best?.id ?? null;
}

export function SelectMakerScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { step, zkp2pQuotes, flowData, selectedCurrency, handleSelectMaker } = flow;
  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const bestId = bestDepositId(zkp2pQuotes);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Choose a partner
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            Who fronts the USDC for your {symbol}
            {flowData.usdAmount.toFixed(2)}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      {zkp2pQuotes.length === 0 ? (
        <NoticeBanner kind="info">
          No partners loaded yet. Go back and try a different amount or platform.
        </NoticeBanner>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {zkp2pQuotes.map((quote) => (
            <MakerCard
              key={String(quote.depositId)}
              quote={quote}
              isBest={quote.depositId === bestId}
              onSelect={() => handleSelectMaker(quote)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
