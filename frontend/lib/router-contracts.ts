// VenmoToSepaRouter contract configuration

// Placeholder - update after deployment
export const VENMO_TO_SEPA_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Transfer status enum matching contract
export enum RouterTransferStatus {
  NONE = 0,
  PENDING = 1,
  COMMITTED = 2,
  COMPLETED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

// ABI for VenmoToSepaRouter
export const VENMO_TO_SEPA_ROUTER_ABI = [
  // Events
  {
    type: "event",
    name: "TransferInitiated",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "intentId", type: "bytes32", indexed: true },
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
    inputs: [
      { name: "solver", type: "address" },
      { name: "quotedEurAmount", type: "uint256" },
    ],
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
  // ABI encode the HookPayload struct
  // struct HookPayload { string iban; string recipientName; uint256 minEurAmount; }
  const { encodeAbiParameters, parseAbiParameters } = require("viem");

  return encodeAbiParameters(
    parseAbiParameters("string, string, uint256"),
    [iban, recipientName, minEurAmount]
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
