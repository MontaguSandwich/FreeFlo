/**
 * Solver Intent-Status Proxy
 *
 * Proxies GET /api/intent-status to the solver's quote-API (port 8081, the public one —
 * the health server on 8080 is firewalled). Lets the fiat-to-fiat offramp-wait poller
 * surface a TERMINAL failure (e.g. "recipient isn't a trusted Qonto beneficiary") with the
 * real reason + a reclaim escape, instead of sitting at "pending" until the 15-min deadline.
 *
 * Returns the solver's record ({ found: true, status, error, transferId, ... }) or
 * { found: false } (404) when no configured solver has seen the intent yet ("keep waiting").
 */
import { NextRequest, NextResponse } from 'next/server';

const SOLVER_API_URLS = (process.env.SOLVER_API_URLS || process.env.SOLVER_API_URL || 'http://127.0.0.1:8081')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function GET(request: NextRequest) {
  const intentId = request.nextUrl.searchParams.get('intentId');
  if (!intentId) {
    return NextResponse.json({ error: 'Missing intentId' }, { status: 400 });
  }

  // Ask each configured solver; return the first that actually has a record of this intent.
  for (const base of SOLVER_API_URLS) {
    try {
      const res = await fetch(`${base}/api/intent-status?intentId=${encodeURIComponent(intentId)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue; // 404 (no record) or transient — try the next solver
      const data = await res.json();
      if (data?.found) return NextResponse.json(data);
    } catch {
      /* unreachable solver — try the next */
    }
  }

  return NextResponse.json({ found: false }, { status: 404 });
}
