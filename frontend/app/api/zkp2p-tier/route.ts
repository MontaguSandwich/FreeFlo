/**
 * ZKP2P Taker-Tier API Proxy
 *
 * Proxies GET /v2/taker/tier to the ZKP2P API server-side (keeps the API key off
 * the client + avoids CORS). The taker tier is keyed by the OWNER wallet address
 * and carries per-platform limits (isLocked / minTierRequired / caps). The frontend
 * uses it to gate higher-risk methods up front — e.g. PayPal requires PLUS tier
 * (~$2000 cumulative volume) — instead of letting the user walk the whole flow into
 * a /v3/intent 403 at "Lock order". Tiers: PEASANT(0) → PEER($500) → PLUS($2000) → PRO($10k).
 */
import { NextRequest, NextResponse } from 'next/server';

const ZKP2P_API_URL = 'https://api.zkp2p.xyz';
// Check both env var names (NEXT_PUBLIC_ is also available server-side)
const ZKP2P_API_KEY = process.env.ZKP2P_API_KEY || process.env.NEXT_PUBLIC_ZKP2P_API_KEY || '';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const owner = sp.get('owner');
  const chainId = sp.get('chainId') || '8453';

  if (!owner) {
    return NextResponse.json({ error: 'Missing required parameter: owner' }, { status: 400 });
  }

  try {
    const url = `${ZKP2P_API_URL}/v2/taker/tier?owner=${owner.toLowerCase()}&chainId=${chainId}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (ZKP2P_API_KEY) headers['x-api-key'] = ZKP2P_API_KEY;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Taker-tier API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { success: false, error: `Taker-tier API error: ${response.status}`, details: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();
    // Unwrap ZKP2P's responseObject envelope; return the tier object directly.
    const tier = data?.responseObject ?? data;
    return NextResponse.json({ success: true, tier });
  } catch (error) {
    console.error('Failed to fetch taker tier:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch taker tier',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
