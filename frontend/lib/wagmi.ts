import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base, foundry } from "wagmi/chains";
import { isTestnet } from "./network";

// Default chain is determined by NEXT_PUBLIC_NETWORK env var.
// All chains (incl. local anvil) remain available so users can switch in wallet.
const isLocal = process.env.NEXT_PUBLIC_NETWORK === "local";

export const config = getDefaultConfig({
  appName: "Wise Off-Ramp",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: isLocal
    ? [foundry, base, baseSepolia]
    : isTestnet
      ? [baseSepolia, base, foundry]
      : [base, baseSepolia, foundry],
  ssr: true,
});
