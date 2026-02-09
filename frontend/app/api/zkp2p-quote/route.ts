/**
 * ZKP2P Quote API Proxy
 *
 * Proxies quote requests to ZKP2P API to avoid CORS issues.
 * The ZKP2P API expects POST requests with JSON body.
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
  const paymentPlatformsParam = searchParams.get('paymentPlatforms') || 'wise';
  const isExactFiat = searchParams.get('isExactFiat') !== 'false';
  const includeNearbyQuotes = searchParams.get('includeNearbyQuotes') !== 'false';
  const nearbySearchRange = parseInt(searchParams.get('nearbySearchRange') || '20', 10);

  if (!amount || !user || !recipient || !destinationChainId || !destinationToken) {
    return NextResponse.json(
      { error: 'Missing required parameters: amount, user, recipient, destinationChainId, destinationToken' },
      { status: 400 }
    );
  }

  // paymentPlatforms can be comma-separated
  const paymentPlatforms = paymentPlatformsParam.split(',').map(p => p.trim());

  try {
    // ZKP2P API expects POST with JSON body
    // When isExactFiat=true, use exactFiatAmount instead of amount
    const endpoint = isExactFiat ? 'exact-fiat' : 'exact-token';
    const url = `${ZKP2P_API_BASE}/v2/quote/${endpoint}`;

    const requestBody: Record<string, unknown> = {
      paymentPlatforms,
      fiatCurrency,
      user,
      recipient,
      destinationChainId: parseInt(destinationChainId, 10),
      destinationToken,
      includeNearbyQuotes,
      nearbySearchRange,
    };

    // SDK uses exactFiatAmount or exactTokenAmount based on isExactFiat
    if (isExactFiat) {
      requestBody.exactFiatAmount = amount;
    } else {
      requestBody.exactTokenAmount = amount;
    }

    console.log('ZKP2P API request:', url, JSON.stringify(requestBody, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
    console.log('ZKP2P API response:', JSON.stringify(data, null, 2).slice(0, 500));
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
