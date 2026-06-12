import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Display / headings typeface (§2.3). Body stays DM Sans (loaded in globals.css).
// Exposed as the CSS variable `--font-display`, referenced by theme.ts typography.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

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
    <html lang="en" className={spaceGrotesk.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
