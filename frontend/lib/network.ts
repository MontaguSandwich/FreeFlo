// Network configuration - switch between mainnet and testnet via NEXT_PUBLIC_NETWORK env var
//
// Usage:
//   NEXT_PUBLIC_NETWORK=testnet  → Base Sepolia (84532)
//   NEXT_PUBLIC_NETWORK=mainnet  → Base Mainnet (8453) [default]

import { base, baseSepolia } from "viem/chains";

export type NetworkName = "mainnet" | "testnet";

export const NETWORK: NetworkName =
  (process.env.NEXT_PUBLIC_NETWORK as NetworkName) === "testnet"
    ? "testnet"
    : "mainnet";

// Address maps per network
const ADDRESSES = {
  mainnet: {
    OFFRAMP_V3: "0x5072175059DF310F9D5A3F97d2Fb36B87CD2083D" as const,
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    PAYMENT_VERIFIER: "0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905" as const,
  },
  testnet: {
    OFFRAMP_V3: "0x34249F4AB741F0661A38651A08213DDe1469b60f" as const,
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
    PAYMENT_VERIFIER: "0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe" as const,
  },
} as const;

const RPC_URLS = {
  mainnet: "https://mainnet.base.org",
  testnet: "https://base-sepolia-rpc.publicnode.com",
} as const;

const CHAINS = {
  mainnet: base,
  testnet: baseSepolia,
} as const;

// Exports for the active network
export const NETWORK_ADDRESSES = ADDRESSES[NETWORK];
export const NETWORK_CHAIN = CHAINS[NETWORK];
export const NETWORK_RPC_URL = RPC_URLS[NETWORK];

export const isTestnet = NETWORK === "testnet";
export const isMainnet = NETWORK === "mainnet";
