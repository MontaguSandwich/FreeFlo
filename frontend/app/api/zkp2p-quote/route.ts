/**
 * ZKP2P Quote API Proxy
 *
 * Proxies quote requests to ZKP2P API to avoid CORS issues.
 * The ZKP2P SDK makes direct browser requests which get blocked by CORS.
 */

import { NextRequest, NextResponse } from 'next/server';

const ZKP2P_API_BASE = 'https://api.zkp2p.xyz';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Required parameters
  const amount = searchParams.get('amount');
  const fiatCurrency = searchParams.get('fiatCurrency') || 'USD';
  const user = searchParams.get('user');
  const recipient = searchParams.get('recipient');
  const destinationChainId = searchParams.get('destinationChainId');
  const destinationToken = searchParams.get('destinationToken');

  // Optional parameters
  const paymentPlatforms = searchParams.get('paymentPlatforms') || 'venmo';
  const isExactFiat = searchParams.get('isExactFiat') || 'true';
  const includeNearbyQuotes = searchParams.get('includeNearbyQuotes') || 'true';
  const nearbySearchRange = searchParams.get('nearbySearchRange') || '20';

  if (!amount || !user || !recipient || !destinationChainId || !destinationToken) {
    return NextResponse.json(
      { error: 'Missing required parameters: amount, user, recipient, destinationChainId, destinationToken' },
      { status: 400 }
    );
  }

  try {
    // Build query params for ZKP2P API
    const queryParams = new URLSearchParams({
      paymentPlatforms,
      fiatCurrency,
      user,
      recipient,
      destinationChainId,
      destinationToken,
      amount,
      isExactFiat,
      includeNearbyQuotes,
      nearbySearchRange,
    });

    const url = `${ZKP2P_API_BASE}/v1/quote/exact-fiat?${queryParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ZKP2P API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        {
          success: false,
          error: `ZKP2P API error: ${response.status}`,
          details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Failed to fetch from ZKP2P API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch quotes from ZKP2P',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
