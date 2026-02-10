/**
 * Test script to check ZKP2P/Peer API endpoints
 * Run with: node scripts/test-zkp2p-api.mjs
 */

const API_ENDPOINTS = [
  'https://api.zkp2p.xyz',
  'https://api.peer.xyz',
  'https://peer.xyz/api',
];

const testRequest = {
  paymentPlatforms: ['wise'],
  fiatCurrency: 'USD',
  user: '0xfE6071530280d779ce438ED1cb3cFfC25a9Cff67',
  recipient: '0xfE6071530280d779ce438ED1cb3cFfC25a9Cff67',
  destinationChainId: 8453,
  destinationToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  includeNearbyQuotes: true,
  nearbySearchRange: 20,
  exactFiatAmount: '100.00',
};

async function testEndpoint(baseUrl) {
  const url = `${baseUrl}/v2/quote/exact-fiat`;
  console.log(`\n--- Testing: ${url} ---`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest),
      signal: AbortSignal.timeout(10000),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    const text = await response.text();

    // Check if it's JSON
    try {
      const json = JSON.parse(text);
      console.log('Response (JSON):', JSON.stringify(json, null, 2).slice(0, 1000));
      return { url, status: response.status, success: response.ok, data: json };
    } catch {
      console.log('Response (text):', text.slice(0, 500));
      return { url, status: response.status, success: false, error: 'Not JSON' };
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { url, status: 0, success: false, error: error.message };
  }
}

async function testV1Endpoint(baseUrl) {
  const url = `${baseUrl}/v1/quote/exact-fiat`;
  console.log(`\n--- Testing: ${url} ---`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest),
      signal: AbortSignal.timeout(10000),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    const text = await response.text();
    try {
      const json = JSON.parse(text);
      console.log('Response (JSON):', JSON.stringify(json, null, 2).slice(0, 1000));
      return { url, status: response.status, success: response.ok, data: json };
    } catch {
      console.log('Response (text):', text.slice(0, 500));
      return { url, status: response.status, success: false, error: 'Not JSON' };
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { url, status: 0, success: false, error: error.message };
  }
}

async function testHealthEndpoint(baseUrl) {
  const url = `${baseUrl}/health`;
  console.log(`\n--- Testing health: ${url} ---`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.log('Response:', text.slice(0, 200));
    return { url, status: response.status };
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return { url, status: 0, error: error.message };
  }
}

async function main() {
  console.log('Testing ZKP2P/Peer API endpoints...\n');
  console.log('Request body:', JSON.stringify(testRequest, null, 2));

  const results = [];

  for (const baseUrl of API_ENDPOINTS) {
    // Test health
    await testHealthEndpoint(baseUrl);

    // Test v2 quote
    const v2Result = await testEndpoint(baseUrl);
    results.push(v2Result);

    // Test v1 quote
    const v1Result = await testV1Endpoint(baseUrl);
    results.push(v1Result);
  }

  console.log('\n\n=== SUMMARY ===');
  for (const r of results) {
    const status = r.success ? '✓ SUCCESS' : `✗ FAILED (${r.status})`;
    console.log(`${status}: ${r.url}`);
  }
}

main().catch(console.error);
