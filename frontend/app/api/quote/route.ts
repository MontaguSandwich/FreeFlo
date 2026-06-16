/**
 * Quote API Proxy
 *
 * Proxies quote requests to multiple solver APIs and aggregates results.
 * This avoids CORS/mixed-content issues since solvers run on HTTP.
 */

import { NextRequest, NextResponse } from 'next/server';

// Solver API URLs - comma-separated list
// Example: "http://95.217.235.164:8081,http://77.42.68.242:8081"
const SOLVER_API_URLS = (process.env.SOLVER_API_URLS || process.env.SOLVER_API_URL || 'http://127.0.0.1:8081')
  .split(',')
  .map(url => url.trim())
  .filter(url => url.length > 0);

interface Quote {
  rtpn: number;
  rtpnName: string;
  fiatAmount: number;
  fee: number;
  feeBps: number;
  exchangeRate: number;
  estimatedTime: number;
  solver: { address: string; name: string };
  expiresAt: number;
}

interface SolverQuoteResult {
  quotes: Quote[];
  minUsdcAmount?: number; // solver offramp minimum (USDC base units)
  belowMinimum?: boolean; // requested amount is below the minimum
}

async function fetchFromSolver(url: string, amount: string, currency: string): Promise<SolverQuoteResult> {
  try {
    const response = await fetch(
      `${url}/api/quote?amount=${amount}&currency=${currency}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      console.error(`Solver ${url} error: ${response.status}`);
      return { quotes: [] };
    }

    const data = await response.json();
    return {
      quotes: data.quotes || [],
      minUsdcAmount: data.minUsdcAmount,
      belowMinimum: data.belowMinimum,
    };
  } catch (error) {
    console.error(`Failed to fetch from solver ${url}:`, error);
    return { quotes: [] };
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const amount = searchParams.get('amount');
  const currency = searchParams.get('currency');

  if (!amount || !currency) {
    return NextResponse.json(
      { error: 'Missing amount or currency parameter' },
      { status: 400 }
    );
  }

  // Fetch from all solvers in parallel
  const results = await Promise.all(
    SOLVER_API_URLS.map(url => fetchFromSolver(url, amount, currency))
  );

  // Flatten and dedupe quotes (by solver address + rtpn)
  const allQuotes = results.flatMap(r => r.quotes);
  const seen = new Set<string>();
  const uniqueQuotes = allQuotes.filter(q => {
    const key = `${q.solver.address}-${q.rtpn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by best rate (highest fiatAmount first)
  uniqueQuotes.sort((a, b) => b.fiatAmount - a.fiatAmount);

  // Surface the offramp minimum: the smallest min any solver reports, and whether the
  // requested amount is below it (no quotes + a solver said so) — so the UI can gate
  // sub-minimum amounts instead of starting a transfer that strands at commit.
  const mins = results.map(r => r.minUsdcAmount).filter((m): m is number => typeof m === 'number');
  const minUsdcAmount = mins.length ? Math.min(...mins) : undefined;
  const belowMinimum = uniqueQuotes.length === 0 && results.some(r => r.belowMinimum);

  return NextResponse.json({ quotes: uniqueQuotes, minUsdcAmount, belowMinimum });
}
