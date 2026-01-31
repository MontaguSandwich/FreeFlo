// OffRampV3 contract configuration and ABI

import { NETWORK_ADDRESSES } from "./network";

// Addresses are resolved from NEXT_PUBLIC_NETWORK env var (see network.ts)
export const OFFRAMP_V3_ADDRESS = NETWORK_ADDRESSES.OFFRAMP_V3;
export const USDC_ADDRESS = NETWORK_ADDRESSES.USDC;

// Legacy V2 address (deprecated)
export const OFFRAMP_V2_ADDRESS = OFFRAMP_V3_ADDRESS;

// Enums matching contract
export enum Currency {
  EUR = 0,
  GBP = 1,
  USD = 2,
  BRL = 3,
  INR = 4,
}

export enum RTPN {
  SEPA_INSTANT = 0,
  SEPA_STANDARD = 1,
  FPS = 2,
  BACS = 3,
  PIX = 4,
  TED = 5,
  UPI = 6,
  IMPS = 7,
  FEDNOW = 8,
  ACH = 9,
}

export enum IntentStatus {
  NONE = 0,
  PENDING_QUOTE = 1,
  COMMITTED = 2,
  FULFILLED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

// ABI for OffRampV2
export const OFFRAMP_V2_ABI = [
  // Events
  {
    type: "event",
    name: "IntentCreated",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "currency", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteSubmitted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "rtpn", type: "uint8", indexed: false },
      { name: "fiatAmount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "estimatedTime", type: "uint64", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteSelected",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "rtpn", type: "uint8", indexed: false },
      { name: "fiatAmount", type: "uint256", indexed: false },
      { name: "receivingInfo", type: "string", indexed: false },
      { name: "recipientName", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentFulfilled",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "transferId", type: "bytes32", indexed: false },
      { name: "fiatSent", type: "uint256", indexed: false },
    ],
  },

  // Read functions
  {
    type: "function",
    name: "getIntent",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "depositor", type: "address" },
          { name: "usdcAmount", type: "uint256" },
          { name: "currency", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint64" },
          { name: "committedAt", type: "uint64" },
          { name: "selectedSolver", type: "address" },
          { name: "selectedRtpn", type: "uint8" },
          { name: "selectedFiatAmount", type: "uint256" },
          { name: "receivingInfo", type: "string" },
          { name: "recipientName", type: "string" },
          { name: "transferId", type: "bytes32" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getIntentQuotes",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "solver", type: "address" },
          { name: "rtpn", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getQuote",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "solver", type: "address" },
      { name: "rtpn", type: "uint8" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "solver", type: "address" },
          { name: "rtpn", type: "uint8" },
          { name: "fiatAmount", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "estimatedTime", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "selected", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "solverInfo",
    inputs: [{ name: "solver", type: "address" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "totalFulfilled", type: "uint256" },
      { name: "totalVolume", type: "uint256" },
      { name: "avgFulfillmentTime", type: "uint64" },
      { name: "active", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "QUOTE_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "SELECTION_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FULFILLMENT_WINDOW",
    inputs: [],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },

  // Write functions
  {
    type: "function",
    name: "createIntent",
    inputs: [
      { name: "usdcAmount", type: "uint256" },
      { name: "currency", type: "uint8" },
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "selectQuoteAndCommit",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "solver", type: "address" },
      { name: "rtpn", type: "uint8" },
      { name: "receivingInfo", type: "string" },
      { name: "recipientName", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelIntent",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ERC20 ABI for USDC
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
] as const;



