/**
 * Quote API Proxy
 *
 * Proxies quote requests to the solver API.
 * This avoids CORS/mixed-content issues since the solver runs on HTTP.
 */

import { NextRequest, NextResponse } from 'next/server';

// Solver API URL - defaults to localhost for development
const SOLVER_API_URL = process.env.SOLVER_API_URL || 'http://127.0.0.1:8081';

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

  try {
    const response = await fetch(
      `${SOLVER_API_URL}/api/quote?amount=${amount}&currency=${currency}`,
      {
        headers: { 'Accept': 'application/json' },
        // 10 second timeout
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      console.error(`Solver API error: ${response.status}`);
      return NextResponse.json(
        { error: 'Solver API unavailable', quotes: [] },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch quotes from solver:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quotes', quotes: [] },
      { status: 503 }
    );
  }
}
