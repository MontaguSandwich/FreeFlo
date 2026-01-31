import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";
import { NETWORK_CHAIN, isTestnet } from "./network";

// Default chain is determined by NEXT_PUBLIC_NETWORK env var.
// Both chains remain available so users can switch in wallet if needed.
export const config = getDefaultConfig({
  appName: "Wise Off-Ramp",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: isTestnet ? [baseSepolia, base] : [base, baseSepolia],
  ssr: true,
});
