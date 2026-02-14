/**
 * ZKP2P Quote API Proxy
 *
 * Proxies quote requests to ZKP2P API to avoid CORS issues.
 * The ZKP2P API expects POST requests with JSON body and x-api-key header.
 */

import { NextRequest, NextResponse } from 'next/server';

const ZKP2P_API_BASE = 'https://api.zkp2p.xyz';
const ZKP2P_API_KEY = process.env.ZKP2P_API_KEY || '';

// Staging escrow address - filters quotes to staging deposits only
const ZKP2P_STAGING_ESCROW = '0x5C2a8D9246777eE4501B6C426a8B8C7635C7b5b5';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Required parameters
  const amount = searchParams.get('amount'); // e.g., "100.00" for $100
  const fiatCurrency = searchParams.get('fiatCurrency') || 'USD';
  const user = searchParams.get('user');
  const recipient = searchParams.get('recipient');
  const destinationChainId = searchParams.get('destinationChainId');
  const destinationToken = searchParams.get('destinationToken');

  // Optional parameters
  const paymentPlatformsParam = searchParams.get('paymentPlatforms') || 'revolut';
  const isExactFiat = searchParams.get('isExactFiat') !== 'false';
  const quotesToReturn = parseInt(searchParams.get('quotesToReturn') || '10', 10);

  if (!amount || !user || !recipient || !destinationChainId || !destinationToken) {
    return NextResponse.json(
      { error: 'Missing required parameters: amount, user, recipient, destinationChainId, destinationToken' },
      { status: 400 }
    );
  }

  // API key is optional - warn if not set but still try the request
  if (!ZKP2P_API_KEY) {
    console.warn('ZKP2P_API_KEY not set - trying request without auth');
  }

  // paymentPlatforms can be comma-separated
  const paymentPlatforms = paymentPlatformsParam.split(',').map(p => p.trim());

  // Convert amount to 6 decimal places (like USDC)
  // e.g., "100.00" -> "100000000"
  const amountFloat = parseFloat(amount);
  const amountInSmallestUnit = Math.round(amountFloat * 1_000_000).toString();

  try {
    // ZKP2P API expects POST with JSON body
    const endpoint = isExactFiat ? 'exact-fiat' : 'exact-token';
    const url = `${ZKP2P_API_BASE}/v2/quote/${endpoint}?quotesToReturn=${quotesToReturn}`;

    const requestBody: Record<string, unknown> = {
      paymentPlatforms,
      fiatCurrency,
      user,
      recipient,
      destinationChainId: parseInt(destinationChainId, 10),
      destinationToken,
      escrowAddresses: [ZKP2P_STAGING_ESCROW],
    };

    // Amount in smallest unit (6 decimals)
    if (isExactFiat) {
      requestBody.exactFiatAmount = amountInSmallestUnit;
    } else {
      requestBody.exactTokenAmount = amountInSmallestUnit;
    }

    console.log('ZKP2P API request:', url, JSON.stringify(requestBody, null, 2));

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (ZKP2P_API_KEY) {
      headers['x-api-key'] = ZKP2P_API_KEY;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
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
