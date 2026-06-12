/**
 * ZKP2P Payee Details Proxy
 *
 * Resolves a maker's human-readable handle (offchainId) from the hashed on-chain id.
 * Mirrors the SDK's apiGetPayeeDetails: GET /v2/makers/{processorName}/{hashedOnchainId}.
 * Proxied server-side to avoid CORS (same pattern as the quote/gating proxies).
 *
 * Used as a fallback when a quote arrives without curated `payeeData` so the send
 * screen can still show who to pay instead of "@unknown".
 */

import { NextRequest, NextResponse } from 'next/server';

const ZKP2P_API_URL = 'https://api.zkp2p.xyz';
const ZKP2P_API_KEY = process.env.ZKP2P_API_KEY || process.env.NEXT_PUBLIC_ZKP2P_API_KEY || '';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const processorName = searchParams.get('processorName');
  const hashedOnchainId = searchParams.get('hashedOnchainId');

  if (!processorName || !hashedOnchainId) {
    return NextResponse.json(
      { error: 'Missing required parameters: processorName, hashedOnchainId' },
      { status: 400 },
    );
  }

  const url = `${ZKP2P_API_URL}/v2/makers/${encodeURIComponent(processorName)}/${encodeURIComponent(hashedOnchainId)}`;

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (ZKP2P_API_KEY) headers['x-api-key'] = ZKP2P_API_KEY;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error(`ZKP2P makers API error: ${response.status} - ${details}`);
      return NextResponse.json(
        { error: `ZKP2P makers API error: ${response.status}`, details },
        { status: response.status },
      );
    }

    const data = await response.json();
    // API wraps the record in `responseObject` (GetPayeeDetailsResponse).
    const record = data?.responseObject || data;
    return NextResponse.json({
      offchainId: record?.offchainId ?? null,
      telegramUsername: record?.telegramUsername ?? null,
      processorName: record?.processorName ?? processorName,
    });
  } catch (error) {
    console.error('Failed to fetch payee details from ZKP2P:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch payee details',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
