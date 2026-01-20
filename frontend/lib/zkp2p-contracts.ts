// ZKP2P V3 Contract Configuration
// Contracts are on Base Mainnet

// Base Mainnet USDC
export const USDC_MAINNET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// ZKP2P V3 Contracts on Base Mainnet
// Note: These are placeholder addresses - need to be updated with actual deployed addresses
// from https://github.com/zkp2p/zkp2p-contracts/tree/main/deployments/base
export const ZKP2P_ESCROW_ADDRESS = "0x0000000000000000000000000000000000000000" as const; // TODO: Get from ZKP2P team
export const ZKP2P_ORCHESTRATOR_ADDRESS = "0x0000000000000000000000000000000000000000" as const; // TODO: Get from ZKP2P team

// Payment methods enum matching ZKP2P contract
export enum ZKP2PPaymentMethod {
  VENMO = 0,
  PAYPAL = 1,
  WISE = 2,
  ZELLE = 3,
  CASHAPP = 4,
  REVOLUT = 5,
  MERCADOPAGO = 6,
  MONZO = 7,
}

// Intent status enum
export enum ZKP2PIntentStatus {
  NONE = 0,
  SIGNALED = 1,
  FULFILLED = 2,
  CANCELLED = 3,
}

// Escrow ABI (key functions for onramping USD → USDC)
export const ZKP2P_ESCROW_ABI = [
  // Events
  {
    type: "event",
    name: "DepositCreated",
    inputs: [
      { name: "depositId", type: "bytes32", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositWithdrawn",
    inputs: [
      { name: "depositId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },

  // Read functions
  {
    type: "function",
    name: "getDeposit",
    inputs: [{ name: "depositId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "maker", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "availableAmount", type: "uint256" },
          { name: "paymentMethods", type: "uint8[]" },
          { name: "conversionRates", type: "uint256[]" },
          { name: "minAmounts", type: "uint256[]" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAvailableDeposits",
    inputs: [
      { name: "paymentMethod", type: "uint8" },
      { name: "minAmount", type: "uint256" },
    ],
    outputs: [{ type: "bytes32[]" }],
    stateMutability: "view",
  },
] as const;

// Orchestrator ABI (key functions for intent lifecycle)
export const ZKP2P_ORCHESTRATOR_ABI = [
  // Events
  {
    type: "event",
    name: "IntentSignaled",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "escrow", type: "address", indexed: true },
      { name: "depositId", type: "bytes32", indexed: true },
      { name: "taker", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "paymentMethod", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentFulfilled",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "taker", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "IntentCancelled",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
    ],
  },

  // Read functions
  {
    type: "function",
    name: "getIntent",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "escrow", type: "address" },
          { name: "depositId", type: "bytes32" },
          { name: "taker", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "paymentMethod", type: "uint8" },
          { name: "payeeDetails", type: "string" },
          { name: "status", type: "uint8" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "intentExpirationPeriod",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },

  // Write functions
  {
    type: "function",
    name: "signalIntent",
    inputs: [
      { name: "escrow", type: "address" },
      { name: "depositId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "paymentMethod", type: "uint8" },
      { name: "payeeDetails", type: "string" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "intentHash", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fulfillIntent",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "paymentProof", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelIntent",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// Type definitions
export interface ZKP2PDeposit {
  depositId: `0x${string}`;
  maker: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  availableAmount: bigint;
  paymentMethods: ZKP2PPaymentMethod[];
  conversionRates: bigint[]; // USD cents per USDC (6 decimals)
  minAmounts: bigint[];
  active: boolean;
}

export interface ZKP2PIntent {
  intentHash: `0x${string}`;
  escrow: `0x${string}`;
  depositId: `0x${string}`;
  taker: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
  paymentMethod: ZKP2PPaymentMethod;
  payeeDetails: string; // Venmo handle/ID
  status: ZKP2PIntentStatus;
  timestamp: bigint;
}

// Quote from a ZKP2P maker
export interface ZKP2PQuote {
  depositId: `0x${string}`;
  maker: `0x${string}`;
  availableUsdc: bigint; // USDC available (6 decimals)
  usdRate: number; // USD per USDC (e.g., 1.0 = $1 per USDC)
  paymentMethod: ZKP2PPaymentMethod;
  minUsd: number; // Minimum USD amount
}

// Helper to calculate USDC output from USD input
export function calculateUsdcFromUsd(usdAmount: number, usdRate: number): bigint {
  // usdRate is USD per USDC
  // USDC has 6 decimals
  const usdcAmount = usdAmount / usdRate;
  return BigInt(Math.floor(usdcAmount * 1_000_000));
}

// Helper to calculate USD needed for USDC output
export function calculateUsdFromUsdc(usdcAmount: bigint, usdRate: number): number {
  // USDC has 6 decimals
  const usdc = Number(usdcAmount) / 1_000_000;
  return usdc * usdRate;
}

// Payment method labels
export const PAYMENT_METHOD_LABELS: Record<ZKP2PPaymentMethod, string> = {
  [ZKP2PPaymentMethod.VENMO]: "Venmo",
  [ZKP2PPaymentMethod.PAYPAL]: "PayPal",
  [ZKP2PPaymentMethod.WISE]: "Wise",
  [ZKP2PPaymentMethod.ZELLE]: "Zelle",
  [ZKP2PPaymentMethod.CASHAPP]: "Cash App",
  [ZKP2PPaymentMethod.REVOLUT]: "Revolut",
  [ZKP2PPaymentMethod.MERCADOPAGO]: "MercadoPago",
  [ZKP2PPaymentMethod.MONZO]: "Monzo",
};
