import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, base } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Wise Off-Ramp",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [baseSepolia, base],
  ssr: true,
});
