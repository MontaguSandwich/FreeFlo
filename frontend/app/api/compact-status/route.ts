/**
 * Compact Status API Proxy
 *
 * Polls the solver for the async progress of a "sign-once" Compact order. The browser GETs
 * here with ?orderId=<id>; we forward it to ${SOLVER_API_URL}/api/compact/status?orderId=...
 * server-side. This avoids CORS/mixed-content (the solver runs on plain HTTP) and keeps the
 * solver URL out of the client bundle. Mirrors app/api/compact-fill/route.ts (the POST proxy).
 */

import { NextRequest, NextResponse } from "next/server";

// Single solver target. The quote proxy supports a comma-separated SOLVER_API_URLS list, but a
// fill (and its status) is bound to one specific solver, so we take the first configured URL.
const SOLVER_API_URL = (
  process.env.SOLVER_API_URL ||
  process.env.SOLVER_API_URLS ||
  "http://127.0.0.1:8081"
)
  .split(",")
  .map((u) => u.trim())
  .filter((u) => u.length > 0)[0];

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  if (!SOLVER_API_URL) {
    console.error("compact-status: SOLVER_API_URL not set");
    return NextResponse.json(
      { error: "Server configuration error: solver URL not set" },
      { status: 500 }
    );
  }

  try {
    const url = `${SOLVER_API_URL}/api/compact/status?orderId=${encodeURIComponent(orderId)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
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
      console.error(`compact-status: solver error ${response.status}: ${text.slice(0, 500)}`);
    }
    return NextResponse.json(json, { status: response.status });
  } catch (error) {
    console.error("compact-status: failed to reach solver:", error);
    return NextResponse.json(
      {
        error: "Failed to reach solver for order status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
