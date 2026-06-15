/**
 * Compact Fill API Proxy
 *
 * Proxies a signed "sign-once" Compact order to the solver's fill endpoint. The browser
 * POSTs the { claim, mandate } payload here; we forward it to ${SOLVER_API_URL}/api/compact/fill
 * server-side. This avoids CORS/mixed-content (the solver runs on plain HTTP) and keeps the
 * solver URL out of the client bundle. Mirrors app/api/quote/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";

// Single solver target. The quote proxy supports a comma-separated SOLVER_API_URLS list, but a
// fill is bound to one specific solver, so we take the first configured URL.
const SOLVER_API_URL = (
  process.env.SOLVER_API_URL ||
  process.env.SOLVER_API_URLS ||
  "http://127.0.0.1:8081"
)
  .split(",")
  .map((u) => u.trim())
  .filter((u) => u.length > 0)[0];

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!SOLVER_API_URL) {
    console.error("compact-fill: SOLVER_API_URL not set");
    return NextResponse.json(
      { error: "Server configuration error: solver URL not set" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${SOLVER_API_URL}/api/compact/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    // Pass the solver's JSON through verbatim (preserving its status code) so the client
    // can surface real errors. Fall back to text if the solver didn't return JSON.
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: "Solver returned a non-JSON response", details: text.slice(0, 500) };
    }

    if (!response.ok) {
      console.error(`compact-fill: solver error ${response.status}: ${text.slice(0, 500)}`);
    }
    return NextResponse.json(json, { status: response.status });
  } catch (error) {
    console.error("compact-fill: failed to reach solver:", error);
    return NextResponse.json(
      {
        error: "Failed to submit order to solver",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
