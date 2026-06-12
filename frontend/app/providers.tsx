"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { config } from "@/lib/wagmi";
import theme, { ff } from "@/lib/theme";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

// Bridge the RainbowKit wallet UI to the FreeFlo dark palette so the connect /
// account modals read as one product. accentColor = brand, foreground = onBrand.
const rainbowKitTheme = darkTheme({
  accentColor: ff.brand,
  accentColorForeground: ff.onBrand,
  borderRadius: "medium",
  overlayBlur: "small",
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rainbowKitTheme}>
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
