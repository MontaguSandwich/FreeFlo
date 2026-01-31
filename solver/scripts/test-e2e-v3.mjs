#!/usr/bin/env node

/**
 * E2E Test Script for V3 zkTLS Flow
 * 
 * This script tests the full flow:
 * 1. Creates an intent on OffRampV3
 * 2. Waits for solver to quote
 * 3. Selects quote and commits
 * 4. Monitors for fulfillment
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { config } from 'dotenv';

config();

// Contract addresses - read from env vars, default to Base Sepolia testnet
const OFFRAMP_V3 = process.env.OFFRAMP_V3_ADDRESS || '0x34249F4AB741F0661A38651A08213DDe1469b60f';
const USDC = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '84532');

// Minimal ABIs
const OFFRAMP_V3_ABI = [
  {
    type: 'function',
    name: 'createIntent',
    inputs: [
      { name: 'usdcAmount', type: 'uint256' },
      { name: 'currency', type: 'uint8' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getIntent',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'depositor', type: 'address' },
        { name: 'usdcAmount', type: 'uint256' },
        { name: 'currency', type: 'uint8' },
        { name: 'status', type: 'uint8' },
        { name: 'createdAt', type: 'uint64' },
        { name: 'committedAt', type: 'uint64' },
        { name: 'selectedSolver', type: 'address' },
        { name: 'selectedRtpn', type: 'uint8' },
        { name: 'selectedFiatAmount', type: 'uint256' },
        { name: 'receivingInfo', type: 'string' },
        { name: 'recipientName', type: 'string' },
        { name: 'transferId', type: 'bytes32' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getIntentQuotes',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'solver', type: 'address' },
        { name: 'rtpn', type: 'uint8' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getQuote',
    inputs: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'solver', type: 'address' },
      { name: 'rtpn', type: 'uint8' },
    ],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'solver', type: 'address' },
        { name: 'rtpn', type: 'uint8' },
        { name: 'fiatAmount', type: 'uint256' },
        { name: 'fee', type: 'uint256' },
        { name: 'estimatedTime', type: 'uint64' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'selected', type: 'bool' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'selectQuoteAndCommit',
    inputs: [
      { name: 'intentId', type: 'bytes32' },
      { name: 'solver', type: 'address' },
      { name: 'rtpn', type: 'uint8' },
      { name: 'receivingInfo', type: 'string' },
      { name: 'recipientName', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'IntentCreated',
    inputs: [
      { name: 'intentId', type: 'bytes32', indexed: true },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'usdcAmount', type: 'uint256', indexed: false },
      { name: 'currency', type: 'uint8', indexed: false },
    ],
  },
];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
];

const STATUS_NAMES = ['NONE', 'PENDING_QUOTE', 'COMMITTED', 'FULFILLED', 'CANCELLED', 'EXPIRED'];

async function main() {
  console.log('🧪 OffRamp V3 E2E Test');
  console.log('='.repeat(50));

  // Get config
  const rpcUrl = process.env.RPC_URL;
  const userPrivateKey = process.env.TEST_USER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  const testIban = process.env.TEST_IBAN || 'FR7630004028420000984528570';
  const testRecipient = process.env.TEST_RECIPIENT || 'Test User';
  const testAmount = process.env.TEST_AMOUNT || '1'; // USDC

  if (!rpcUrl || !userPrivateKey) {
    console.error('❌ Missing RPC_URL or TEST_USER_PRIVATE_KEY');
    process.exit(1);
  }

  // Setup clients - select chain based on CHAIN_ID env var
  const chain = CHAIN_ID === 8453 ? base : baseSepolia;
  const account = privateKeyToAccount(userPrivateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  console.log(`\n📍 Network:      ${chain.name} (${CHAIN_ID})`);
  console.log(`📍 User address: ${account.address}`);
  console.log(`📍 OffRamp V3:   ${OFFRAMP_V3}`);
  console.log(`📍 USDC:         ${USDC}`);
  console.log(`📍 Test IBAN:    ${testIban}`);
  console.log(`📍 Amount:       ${testAmount} USDC`);

  // Check USDC balance
  const balance = await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  console.log(`\n💰 USDC Balance: ${formatUnits(balance, 6)} USDC`);

  const amountWei = parseUnits(testAmount, 6);
  if (balance < amountWei) {
    console.error(`❌ Insufficient USDC balance. Need ${testAmount} USDC`);
    console.log(`   Get test USDC from: https://faucet.circle.com/`);
    process.exit(1);
  }

  // Step 1: Create intent
  console.log('\n📝 Step 1: Creating intent...');
  
  const createHash = await walletClient.writeContract({
    address: OFFRAMP_V3,
    abi: OFFRAMP_V3_ABI,
    functionName: 'createIntent',
    args: [amountWei, 0], // 0 = EUR
  });

  console.log(`   TX: ${createHash}`);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  
  // Get intentId from logs
  const intentLog = createReceipt.logs.find(
    (log) => log.topics[0] === '0x9e09c5fd62b69b38db5cb2c1e30cb9127fe47c00c46f4f4cc0c0beec7f5fc37b' // IntentCreated topic
  );
  const intentId = intentLog?.topics[1];
  
  if (!intentId) {
    console.error('❌ Failed to get intentId from logs');
    process.exit(1);
  }

  console.log(`   ✅ Intent created: ${intentId}`);

  // Step 2: Wait for quotes
  console.log('\n⏳ Step 2: Waiting for solver quotes...');
  console.log('   (Make sure the V3 solver is running: npm run dev:v3)');

  let quotes = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    
    const quoteKeys = await publicClient.readContract({
      address: OFFRAMP_V3,
      abi: OFFRAMP_V3_ABI,
      functionName: 'getIntentQuotes',
      args: [intentId],
    });

    if (quoteKeys.length > 0) {
      console.log(`   Found ${quoteKeys.length} quote(s)!`);
      
      for (const key of quoteKeys) {
        const quote = await publicClient.readContract({
          address: OFFRAMP_V3,
          abi: OFFRAMP_V3_ABI,
          functionName: 'getQuote',
          args: [intentId, key.solver, key.rtpn],
        });
        
        console.log(`   - Solver: ${quote.solver.slice(0, 10)}...`);
        console.log(`     Fiat:   €${(Number(quote.fiatAmount) / 100).toFixed(2)}`);
        console.log(`     Fee:    ${formatUnits(quote.fee, 6)} USDC`);
        
        quotes.push({ ...quote, solver: key.solver, rtpn: key.rtpn });
      }
      break;
    }
    
    process.stdout.write('.');
  }

  if (quotes.length === 0) {
    console.log('\n❌ No quotes received. Is the solver running?');
    process.exit(1);
  }

  // Step 3: Approve and commit
  console.log('\n💳 Step 3: Approving USDC and selecting quote...');

  // Check allowance
  const allowance = await publicClient.readContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, OFFRAMP_V3],
  });

  if (allowance < amountWei) {
    console.log('   Approving USDC...');
    const approveHash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [OFFRAMP_V3, amountWei],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('   ✅ USDC approved');
  }

  // Select best quote (first one)
  const bestQuote = quotes[0];
  console.log(`   Selecting quote from ${bestQuote.solver.slice(0, 10)}...`);

  const commitHash = await walletClient.writeContract({
    address: OFFRAMP_V3,
    abi: OFFRAMP_V3_ABI,
    functionName: 'selectQuoteAndCommit',
    args: [intentId, bestQuote.solver, bestQuote.rtpn, testIban, testRecipient],
  });

  console.log(`   TX: ${commitHash}`);
  await publicClient.waitForTransactionReceipt({ hash: commitHash });
  console.log('   ✅ Quote selected and USDC committed');

  // Step 4: Monitor for fulfillment
  console.log('\n⏳ Step 4: Waiting for zkTLS fulfillment...');
  console.log('   The solver will now:');
  console.log('   1. Execute the SEPA transfer via Qonto');
  console.log('   2. Generate a TLSNotary proof');
  console.log('   3. Get attestation from the attestation service');
  console.log('   4. Call fulfillIntentWithProof()');
  console.log('');

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const intent = await publicClient.readContract({
      address: OFFRAMP_V3,
      abi: OFFRAMP_V3_ABI,
      functionName: 'getIntent',
      args: [intentId],
    });

    const status = STATUS_NAMES[intent.status];
    process.stdout.write(`\r   Status: ${status} (${i * 5}s elapsed)`);

    if (intent.status === 3) { // FULFILLED
      console.log('\n\n🎉 SUCCESS! Intent fulfilled with zkTLS verification!');
      console.log(`   Transfer ID: ${intent.transferId}`);
      return;
    }

    if (intent.status >= 4) { // CANCELLED or EXPIRED
      console.log(`\n\n❌ Intent ${status}`);
      return;
    }
  }

  console.log('\n\n⏰ Timeout waiting for fulfillment');
  console.log('   The solver may need manual TLSNotary proof generation.');
  console.log('   Run: cargo run --release --example qonto_prove_transfer');
}

main().catch(console.error);

