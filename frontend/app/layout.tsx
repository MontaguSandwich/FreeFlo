import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "FreeFlo - USDC to Fiat",
  description: "Convert USDC to fiat instantly via real-time payment rails",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the Peer (PeerAuth/TEE) extension injects a
    // `data-peer-injected` attribute onto <html> before React hydrates. Without this,
    // the root-element attribute mismatch breaks App Router hydration, leaving the app
    // non-interactive (wallet shows disconnected, clicks dead).
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
