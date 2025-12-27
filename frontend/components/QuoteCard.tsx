"use client";

import { RTPNQuote, CURRENCIES } from "@/lib/quotes";

interface QuoteCardProps {
  quote: RTPNQuote;
  isSelected: boolean;
  onSelect: () => void;
}

export function QuoteCard({ quote, isSelected, onSelect }: QuoteCardProps) {
  const currencyInfo = CURRENCIES[quote.rtpnInfo.currency];
  const timeRemaining = Math.max(0, Math.floor((quote.expiresAt - Date.now()) / 1000));
  const isExpired = timeRemaining === 0;

  const speedColors = {
    instant: 'from-emerald-500 to-teal-500',
    fast: 'from-amber-500 to-orange-500',
    standard: 'from-zinc-500 to-zinc-600',
  };

  const speedBadge = {
    instant: { bg: 'bg-emerald-500/15 text-emerald-400', label: '⚡' },
    fast: { bg: 'bg-amber-500/15 text-amber-400', label: '🚀' },
    standard: { bg: 'bg-zinc-600/30 text-zinc-400', label: '📦' },
  };

  return (
    <button
      onClick={onSelect}
      disabled={isExpired}
      className={`
        w-full text-left p-3 rounded-xl border transition-all duration-200 relative overflow-hidden
        ${isSelected 
          ? 'border-emerald-500 bg-emerald-500/5' 
          : isExpired
            ? 'border-zinc-800 bg-zinc-900/50 opacity-50 cursor-not-allowed'
            : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50'
        }
      `}
    >
      {/* Speed indicator line */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${speedColors[quote.rtpnInfo.speed]}`} />

      {/* Main row: RTPN + Output amount */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${speedBadge[quote.rtpnInfo.speed].bg}`}>
            {speedBadge[quote.rtpnInfo.speed].label}
          </span>
          <span className="text-sm font-medium text-white">{quote.rtpnInfo.name}</span>
          <span className="text-[10px] text-zinc-500">{quote.rtpnInfo.avgTime}</span>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-white">
            {currencyInfo.symbol}{quote.outputAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Details row */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <span>{quote.solver.avatar}</span>
          <span>{quote.solver.name}</span>
          <span className="text-amber-400">★{quote.solver.rating}</span>
        </div>
        <span>Fee: {quote.feePercent}%</span>
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2">
          <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}
    </button>
  );
}

// Loading skeleton - compact
export function QuoteCardSkeleton() {
  return (
    <div className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-900/50 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-6 bg-zinc-800 rounded" />
          <div className="h-4 w-20 bg-zinc-800 rounded" />
        </div>
        <div className="h-5 w-16 bg-zinc-800 rounded" />
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="h-3 w-24 bg-zinc-800/50 rounded" />
        <div className="h-3 w-12 bg-zinc-800/50 rounded" />
      </div>
    </div>
  );
}

// Empty state when no quotes
export function NoQuotes({ currency }: { currency: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-zinc-400 text-xs">No quotes for {currency}</p>
    </div>
  );
}
