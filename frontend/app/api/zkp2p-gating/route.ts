/**
 * ZKP2P Gating Signature API Proxy
 *
 * Proxies gating signature requests to ZKP2P API to avoid CORS issues
 * and keep the API key server-side.
 *
 * IMPORTANT: Uses /v3/intent endpoint for V2 Orchestrator (permissionless hooks).
 * The V3 endpoint requires callerAddress and referralFees array format.
 */

import { NextRequest, NextResponse } from 'next/server';

const ZKP2P_API_URL = 'https://api.zkp2p.xyz';
// Check both env var names (NEXT_PUBLIC_ is also available server-side)
const ZKP2P_API_KEY = process.env.ZKP2P_API_KEY || process.env.NEXT_PUBLIC_ZKP2P_API_KEY || '';

// V2 Orchestrator address (permissionless PostIntentHook)
const ZKP2P_V2_ORCHESTRATOR = '0x888888359E981B5225CA48fbCdCeff702FC3b888';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Required fields
    const {
      processorName,
      payeeDetails,
      depositId,
      amount,
      toAddress,
      paymentMethod,
      fiatCurrency,
      conversionRate,
      chainId,
      escrowAddress,
      postIntentHook,
      data,
    } = body;

    if (!processorName || !depositId || !amount || !toAddress || !escrowAddress) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // API key is required for gating
    if (!ZKP2P_API_KEY) {
      console.error('ZKP2P_API_KEY not set');
      return NextResponse.json(
        { error: 'Server configuration error: API key not set' },
        { status: 500 }
      );
    }

    // V3 endpoint format for V2 Orchestrator (permissionless PostIntentHook)
    // Key differences from V2 endpoint:
    // - callerAddress instead of toAddress in some contexts
    // - referralFees as array instead of referrer/referrerFee
    const requestBody = {
      processorName,
      payeeDetails,
      depositId: depositId.toString(),
      amount: amount.toString(),
      toAddress,
      callerAddress: toAddress, // Required for V3 endpoint
      paymentMethod,
      fiatCurrency,
      conversionRate: conversionRate.toString(),
      chainId: chainId.toString(),
      orchestratorAddress: ZKP2P_V2_ORCHESTRATOR,
      escrowAddress,
      referralFees: [], // Empty array - no referral fees
      postIntentHook: postIntentHook || '0x0000000000000000000000000000000000000000',
      data: data || '0x',
    };

    console.log('Gating API request (V3):', `${ZKP2P_API_URL}/v3/intent`, JSON.stringify(requestBody, null, 2));

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': ZKP2P_API_KEY,
    };

    // Use /v3/intent endpoint for V2 Orchestrator
    const response = await fetch(`${ZKP2P_API_URL}/v3/intent`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gating API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        {
          success: false,
          error: `Gating API error: ${response.status}`,
          details: errorText
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log('Gating API response:', JSON.stringify(result, null, 2).slice(0, 500));

    // Extract signature and expiration from response
    const signature = result?.responseObject?.signedIntent;
    const expiration = result?.responseObject?.intentData?.signatureExpiration
      ?? result?.responseObject?.signatureExpiration;

    if (!signature || !expiration) {
      console.error('Missing signature or expiration in response:', result);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid response from gating API',
          details: 'Missing signedIntent or signatureExpiration'
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      signature,
      expiration: expiration.toString(),
    });

  } catch (error) {
    console.error('Failed to fetch gating signature:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch gating signature',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
