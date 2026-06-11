// FiatToFiatRouter contract configuration
import { encodeAbiParameters } from "viem";

// ZKP2P V3 Contract Addresses (Base Mainnet)
// These are the official V3 contracts with permissionless PostIntentHooks
export const ZKP2P_V3_ORCHESTRATOR = "0x888888359E981B5225CA48fbCdCeff702FC3b888" as const;
export const ZKP2P_V3_ESCROW = "0x777777779d229cdF3110e9de47943791c26300Ef" as const;
export const ZKP2P_V3_PROTOCOL_VIEWER = "0xC8A622e1614BB58141E72e1D6023B16f08677d6c" as const;

// ⚠️ DEPRECATED router deployments — DO NOT route new transfers here. Each was wired
// (immutable `offRamp`) to the PRE-AUDIT OffRampV3 0x5072…, whose PaymentVerifier 0x5eFc…
// does NOT authorize our witness 0xf68E… — so every fulfillment reverts NotAuthorizedWitness
// (0x41110897). Kept only so transaction history / reclaim can still surface stuck funds.
export const FIAT_TO_FIAT_ROUTER_V3_PREAUDIT = "0x8558D9701C80A5805E6ea940AfD05e36cfE27B23" as const; // 2026-03-18
export const FIAT_TO_FIAT_ROUTER_V2 = "0x6dBb90D2bE03dF76b08267A8942D38Ecece82581" as const;
export const FIAT_TO_FIAT_ROUTER_V1 = "0xA9F5E04Ee35cd017710c28c049748B7Af85BC0B8" as const;

// Active router — wired to the AUDITED prod OffRampV3 0x57c621994616110a50bD820388e4E8a41F00b4D7
// (verifier 0x5602…, witness 0xf68E… which we control).
// Deployed 2026-06-11 (Base 8453), tx 0xb4732534d8360b83981c1e2378f12ed501d1c8439ac6f2e62684f046d247750b.
export const FIAT_TO_FIAT_ROUTER_ADDRESS = "0xaA11AFe4bDF080a9604a8B47b17D5AD66d13e967" as const;

// Transfer status enum matching contract
export enum RouterTransferStatus {
  NONE = 0,
  PENDING = 1,
  COMMITTED = 2,
  COMPLETED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

// ABI for FiatToFiatRouter
export const FIAT_TO_FIAT_ROUTER_ABI = [
  // Events
  {
    type: "event",
    name: "TransferInitiated",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "zkp2pIntentHash", type: "bytes32", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "iban", type: "string", indexed: false },
      { name: "recipientName", type: "string", indexed: false },
      { name: "minEurAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferCommitted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: false },
      { name: "eurAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferCompleted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "TransferCancelled",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferExpired",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
    ],
  },

  // Read functions
  {
    type: "function",
    name: "pendingTransfers",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "intentId", type: "bytes32" },
      { name: "usdcAmount", type: "uint256" },
      { name: "iban", type: "string" },
      { name: "recipientName", type: "string" },
      { name: "minEurAmount", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPendingTransfer",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "intentId", type: "bytes32" },
          { name: "usdcAmount", type: "uint256" },
          { name: "iban", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "minEurAmount", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "canCommit",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "encodePayload",
    inputs: [
      { name: "iban", type: "string" },
      { name: "recipientName", type: "string" },
      { name: "minEurAmount", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "COMMIT_TIMEOUT",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },

  // Write functions
  {
    type: "function",
    name: "commit",
    inputs: [{ name: "solver", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancel",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rescueTimedOut",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "markComplete",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// TypeScript types
export interface PendingTransfer {
  user: `0x${string}`;
  intentId: `0x${string}`;
  usdcAmount: bigint;
  iban: string;
  recipientName: string;
  minEurAmount: bigint;
  createdAt: bigint;
  status: RouterTransferStatus;
}

// Helper to encode hook payload (matches contract's encodePayload)
export function encodeHookPayload(
  iban: string,
  recipientName: string,
  minEurAmount: bigint
): `0x${string}` {
  // Encode as a single tuple matching the contract's `HookPayload` struct — NOT
  // three flat params, which produces a different head layout and makes the
  // contract's abi.decode(data, (HookPayload)) revert.
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "iban", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "minEurAmount", type: "uint256" },
        ],
      },
    ],
    [{ iban, recipientName, minEurAmount }]
  );
}

// Helper to format EUR amount (2 decimals stored as integer)
export function formatEurAmount(amount: bigint): string {
  const num = Number(amount) / 100;
  return num.toFixed(2);
}

// Helper to parse EUR amount to contract format
export function parseEurAmount(amount: number): bigint {
  return BigInt(Math.floor(amount * 100));
}
