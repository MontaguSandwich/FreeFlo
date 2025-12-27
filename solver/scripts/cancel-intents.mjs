#!/usr/bin/env node
/**
 * Cancel expired intents and recover USDC
 * 
 * This script finds ALL your intents by scanning IntentCreated events
 * and cancels any that are cancellable (expired quotes, committed but unfulfilled, etc.)
 * 
 * Usage: 
 *   PRIVATE_KEY=0x... node scripts/cancel-intents.mjs
 */

import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CONTRACT = '0x853AB21012a8B0D1A0B3Fc63c40749c42D790aa5';
const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';

// Contract deployment block (approximate)
const FROM_BLOCK = 35300000n;

const ABI = [
  {
    type: 'function',
    name: 'cancelIntent',
    inputs: [{ name: 'intentId', type: 'bytes32' }],
    outputs: [],
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
    name: 'QUOTE_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SELECTION_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'FULFILLMENT_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }],
    stateMutability: 'view',
  },
];

const INTENT_CREATED_EVENT = parseAbiItem(
  'event IntentCreated(bytes32 indexed intentId, address indexed depositor, uint256 usdcAmount, uint8 currency)'
);

const STATUSES = ['NONE', 'PENDING_QUOTE', 'COMMITTED', 'FULFILLED', 'CANCELLED', 'EXPIRED'];

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  
  if (!privateKey) {
    console.log('❌ Missing PRIVATE_KEY environment variable');
    console.log('');
    console.log('Usage:');
    console.log('  PRIVATE_KEY=0x... node scripts/cancel-intents.mjs');
    console.log('');
    console.log('Use your wallet private key (the one connected to the frontend)');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log('🔑 Using wallet:', account.address);
  console.log('');

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  // Get time windows from contract
  console.log('📋 Fetching contract time windows...');
  const quoteWindow = await publicClient.readContract({ address: CONTRACT, abi: ABI, functionName: 'QUOTE_WINDOW' });
  const selectionWindow = await publicClient.readContract({ address: CONTRACT, abi: ABI, functionName: 'SELECTION_WINDOW' });
  const fulfillmentWindow = await publicClient.readContract({ address: CONTRACT, abi: ABI, functionName: 'FULFILLMENT_WINDOW' });
  console.log(`   QUOTE_WINDOW: ${Number(quoteWindow)/60} min, SELECTION_WINDOW: ${Number(selectionWindow)/60} min, FULFILLMENT_WINDOW: ${Number(fulfillmentWindow)/60} min`);
  console.log('');

  // Find all IntentCreated events for this user
  console.log('🔍 Scanning for your intents on-chain...');
  const logs = await publicClient.getLogs({
    address: CONTRACT,
    event: INTENT_CREATED_EVENT,
    args: {
      depositor: account.address,
    },
    fromBlock: FROM_BLOCK,
    toBlock: 'latest',
  });

  console.log(`   Found ${logs.length} intent(s) created by your wallet`);
  console.log('');

  if (logs.length === 0) {
    console.log('No intents found. Nothing to cancel.');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let totalRecovered = 0;
  let cancelledCount = 0;
  let skippedCount = 0;

  for (const log of logs) {
    const intentId = log.args.intentId;
    
    try {
      // Check intent status
      const intent = await publicClient.readContract({
        address: CONTRACT,
        abi: ABI,
        functionName: 'getIntent',
        args: [intentId],
      });

      const status = STATUSES[intent.status];
      const amount = Number(intent.usdcAmount) / 1e6;
      const createdAt = Number(intent.createdAt);
      const committedAt = Number(intent.committedAt);

      // Skip if already cancelled/fulfilled
      if (status === 'CANCELLED' || status === 'FULFILLED' || status === 'NONE') {
        console.log(`⏭️  ${intentId.slice(0,10)}... - Already ${status} (${amount} USDC)`);
        skippedCount++;
        continue;
      }

      // Check if cancellable based on time windows
      let canCancel = false;
      let reason = '';

      if (status === 'PENDING_QUOTE') {
        const expiresAt = createdAt + Number(quoteWindow) + Number(selectionWindow);
        if (now > expiresAt) {
          canCancel = true;
          reason = 'Quote+Selection window expired';
        } else {
          reason = `Waiting until ${new Date(expiresAt * 1000).toLocaleTimeString()}`;
        }
      } else if (status === 'COMMITTED') {
        const expiresAt = committedAt + Number(fulfillmentWindow);
        if (now > expiresAt) {
          canCancel = true;
          reason = 'Fulfillment window expired';
        } else {
          reason = `Waiting until ${new Date(expiresAt * 1000).toLocaleTimeString()}`;
        }
      }

      if (!canCancel) {
        console.log(`⏳ ${intentId.slice(0,10)}... - ${status} (${amount} USDC) - ${reason}`);
        skippedCount++;
        continue;
      }

      console.log(`🔄 Cancelling ${intentId.slice(0,10)}... (${amount} USDC, ${status}, ${reason})`);

      // Cancel the intent
      const hash = await walletClient.writeContract({
        address: CONTRACT,
        abi: ABI,
        functionName: 'cancelIntent',
        args: [intentId],
      });

      console.log(`   Tx: ${hash}`);
      
      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      
      if (receipt.status === 'success') {
        console.log(`   ✅ Cancelled! ${amount} USDC returned`);
        totalRecovered += amount;
        cancelledCount++;
      } else {
        console.log(`   ❌ Transaction failed`);
      }

    } catch (error) {
      console.log(`   ❌ Error with ${intentId.slice(0,10)}...: ${error.message}`);
    }
    
    console.log('');
  }

  console.log('='.repeat(50));
  console.log(`✅ Cancelled: ${cancelledCount} intent(s)`);
  console.log(`⏭️  Skipped: ${skippedCount} intent(s)`);
  console.log(`💰 Recovered: ${totalRecovered.toFixed(2)} USDC`);
}

main().catch(console.error);

