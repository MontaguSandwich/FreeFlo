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

async function fetchFromSolver(url: string, amount: string, currency: string): Promise<Quote[]> {
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
      return [];
    }

    const data = await response.json();
    return data.quotes || [];
  } catch (error) {
    console.error(`Failed to fetch from solver ${url}:`, error);
    return [];
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
  const allQuotes = results.flat();
  const seen = new Set<string>();
  const uniqueQuotes = allQuotes.filter(q => {
    const key = `${q.solver.address}-${q.rtpn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by best rate (highest fiatAmount first)
  uniqueQuotes.sort((a, b) => b.fiatAmount - a.fiatAmount);

  return NextResponse.json({ quotes: uniqueQuotes });
}
