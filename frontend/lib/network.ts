// Network configuration — runtime chain detection from wallet + env var fallback
//
// Primary: addresses follow the wallet's connected chain (Base vs Base Sepolia)
// Fallback: NEXT_PUBLIC_NETWORK env var for SSR / non-React contexts

import { base, baseSepolia, type Chain } from "viem/chains";

export type NetworkName = "mainnet" | "testnet";

// Env-var fallback (used at build time / SSR before wallet connects)
export const DEFAULT_NETWORK: NetworkName =
  (process.env.NEXT_PUBLIC_NETWORK as NetworkName) === "testnet"
    ? "testnet"
    : "mainnet";

// ---- Address maps ----

export interface NetworkAddresses {
  OFFRAMP_V3: `0x${string}`;
  USDC: `0x${string}`;
  PAYMENT_VERIFIER: `0x${string}`;
}

const ADDRESSES: Record<NetworkName, NetworkAddresses> = {
  mainnet: {
    OFFRAMP_V3: "0x5072175059DF310F9D5A3F97d2Fb36B87CD2083D",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    PAYMENT_VERIFIER: "0x5eFcB7d3D0f2bE198F36FF87d4feF85b12338905",
  },
  testnet: {
    OFFRAMP_V3: "0x34249F4AB741F0661A38651A08213DDe1469b60f",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    PAYMENT_VERIFIER: "0xd72ddbFAfFc390947CB6fE26afCA8b054abF21fe",
  },
};

const RPC_URLS: Record<NetworkName, string> = {
  mainnet: "https://mainnet.base.org",
  testnet: "https://base-sepolia-rpc.publicnode.com",
};

const CHAINS: Record<NetworkName, Chain> = {
  mainnet: base,
  testnet: baseSepolia,
};

// ---- Chain-ID based lookup (runtime) ----

const CHAIN_ID_TO_NETWORK: Record<number, NetworkName> = {
  [base.id]: "mainnet",        // 8453
  [baseSepolia.id]: "testnet", // 84532
};

/** Resolve network name from a chain ID. Falls back to DEFAULT_NETWORK. */
export function networkForChainId(chainId: number | undefined): NetworkName {
  if (chainId && chainId in CHAIN_ID_TO_NETWORK) {
    return CHAIN_ID_TO_NETWORK[chainId];
  }
  return DEFAULT_NETWORK;
}

/** Get contract addresses for a given chain ID. */
export function getAddressesForChain(chainId: number | undefined): NetworkAddresses {
  return ADDRESSES[networkForChainId(chainId)];
}

/** Get RPC URL for a given chain ID. */
export function getRpcUrlForChain(chainId: number | undefined): string {
  return RPC_URLS[networkForChainId(chainId)];
}

/** Get viem Chain object for a given chain ID. */
export function getChainForChainId(chainId: number | undefined): Chain {
  return CHAINS[networkForChainId(chainId)];
}

// ---- Static exports (env-var based, for SSR / non-React code) ----

export const NETWORK_ADDRESSES = ADDRESSES[DEFAULT_NETWORK];
export const NETWORK_CHAIN = CHAINS[DEFAULT_NETWORK];
export const NETWORK_RPC_URL = RPC_URLS[DEFAULT_NETWORK];

export const isTestnet = DEFAULT_NETWORK === "testnet";
export const isMainnet = DEFAULT_NETWORK === "mainnet";
