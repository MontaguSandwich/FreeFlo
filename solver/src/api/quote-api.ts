/**
 * Quote API Server
 * 
 * Provides real-time quotes from registered providers before intent creation.
 * This allows the frontend to show accurate quotes without creating an intent first.
 */

import http from "http";
import { URL } from "url";
import { createLogger } from "../utils/logger.js";
import { ProviderRegistry } from "../providers/registry.js";
import { RTPN, Currency, getRtpnsForCurrency, RTPN_NAMES } from "../types/index.js";

const log = createLogger("quote-api");

export interface QuoteApiRequest {
  usdcAmount: number;  // Amount in USDC (e.g., 100.50)
  currency: Currency;  // Target currency (e.g., EUR)
}

export interface QuoteApiResponse {
  quotes: Array<{
    rtpn: number;
    rtpnName: string;
    fiatAmount: number;      // Amount in fiat currency (e.g., 92.50)
    fiatAmountCents: number; // Amount in cents (e.g., 9250)
    fee: number;             // Fee in USDC
    feeBps: number;          // Fee in basis points
    exchangeRate: number;    // USDC to fiat rate
    estimatedTime: number;   // Seconds to complete
    solver: {
      address: string;
      name: string;
    };
    expiresAt: number;       // Unix timestamp
  }>;
  timestamp: number;
}

// Map string currency codes to Currency enum
const CURRENCY_STRING_TO_ENUM: Record<string, Currency> = {
  "EUR": Currency.EUR,
  "GBP": Currency.GBP,
  "USD": Currency.USD,
  "BRL": Currency.BRL,
  "INR": Currency.INR,
};

/**
 * Create a quote API server that provides real quotes from registered providers
 */
export function createQuoteApiServer(
  registry: ProviderRegistry,
  solverAddress: string,
  solverName: string = "ZKP2P Solver"
): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse URL
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // GET /api/quote?amount=100&currency=EUR
    if (url.pathname === "/api/quote" && req.method === "GET") {
      const amountStr = url.searchParams.get("amount");
      const currencyStr = url.searchParams.get("currency");

      if (!amountStr || !currencyStr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing amount or currency parameter" }));
        return;
      }

      const usdcAmount = parseFloat(amountStr);
      if (isNaN(usdcAmount) || usdcAmount <= 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid amount" }));
        return;
      }

      const currencyUpper = currencyStr.toUpperCase();
      if (!["EUR", "GBP", "USD", "BRL", "INR"].includes(currencyUpper)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid currency" }));
        return;
      }
      const currency = CURRENCY_STRING_TO_ENUM[currencyUpper];

      try {
        const quotes = await getQuotes(registry, solverAddress, solverName, usdcAmount, currency);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(quotes, null, 2));
      } catch (error) {
        log.error({ error }, "Error generating quotes");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    // GET /api/supported - List supported currencies and RTPNs
    if (url.pathname === "/api/supported" && req.method === "GET") {
      const supported = getSupportedRtpns(registry);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(supported, null, 2));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return server;
}

/**
 * Get quotes from all registered providers for a given amount and currency
 */
async function getQuotes(
  registry: ProviderRegistry,
  solverAddress: string,
  solverName: string,
  usdcAmount: number,
  currency: Currency
): Promise<QuoteApiResponse> {
  const quotes: QuoteApiResponse["quotes"] = [];
  const usdcAmountBigInt = BigInt(Math.round(usdcAmount * 1_000_000)); // Convert to 6 decimals

  // Get RTPNs for this currency
  const rtpnsForCurrency = getRtpnsForCurrency(currency);

  for (const rtpn of rtpnsForCurrency) {
    const providers = registry.getProvidersForRtpn(rtpn);
    
    for (const provider of providers) {
      try {
        const quote = await provider.getQuote({
          intentId: "0x0000000000000000000000000000000000000000000000000000000000000000", // Preview quote
          usdcAmount: usdcAmountBigInt,
          currency,
          rtpn,
        });

        if (quote) {
          const fiatAmountCents = Number(quote.fiatAmount);
          const fiatAmount = fiatAmountCents / 100;
          const feeUsdc = Number(quote.fee) / 1_000_000;
          const effectiveRate = fiatAmount / (usdcAmount - feeUsdc);

          quotes.push({
            rtpn: quote.rtpn,
            rtpnName: RTPN_NAMES[quote.rtpn] || `RTPN_${quote.rtpn}`,
            fiatAmount,
            fiatAmountCents,
            fee: feeUsdc,
            feeBps: Math.round((feeUsdc / usdcAmount) * 10000),
            exchangeRate: effectiveRate,
            estimatedTime: quote.estimatedTime,
            solver: {
              address: solverAddress,
              name: solverName,
            },
            // Convert expiresAt from seconds to milliseconds for frontend compatibility
            expiresAt: quote.expiresAt * 1000,
          });
        }
      } catch (error) {
        log.warn({ rtpn, provider: provider.name, error }, "Failed to get quote from provider");
      }
    }
  }

  // Sort by fiat amount (best first)
  quotes.sort((a, b) => b.fiatAmount - a.fiatAmount);

  return {
    quotes,
    timestamp: Date.now(),
  };
}

/**
 * Get list of supported currencies and RTPNs
 */
function getSupportedRtpns(registry: ProviderRegistry): {
  currencies: Array<{
    code: string;
    name: string;
    rtpns: Array<{
      id: number;
      name: string;
      speed: string;
    }>;
  }>;
} {
  const currencyConfig: Array<{ code: string; currency: Currency; name: string; rtpns: { id: RTPN; name: string; speed: string }[] }> = [
    {
      code: "EUR",
      currency: Currency.EUR,
      name: "Euro",
      rtpns: [
        { id: RTPN.SEPA_INSTANT, name: "SEPA Instant", speed: "instant" },
        { id: RTPN.SEPA_STANDARD, name: "SEPA Standard", speed: "standard" },
      ],
    },
    {
      code: "GBP",
      currency: Currency.GBP,
      name: "British Pound",
      rtpns: [
        { id: RTPN.FPS, name: "Faster Payments", speed: "instant" },
        { id: RTPN.BACS, name: "BACS", speed: "standard" },
      ],
    },
    {
      code: "USD",
      currency: Currency.USD,
      name: "US Dollar",
      rtpns: [
        { id: RTPN.FEDNOW, name: "FedNow", speed: "instant" },
        { id: RTPN.ACH, name: "ACH", speed: "standard" },
      ],
    },
    {
      code: "BRL",
      currency: Currency.BRL,
      name: "Brazilian Real",
      rtpns: [
        { id: RTPN.PIX, name: "PIX", speed: "instant" },
        { id: RTPN.TED, name: "TED", speed: "fast" },
      ],
    },
    {
      code: "INR",
      currency: Currency.INR,
      name: "Indian Rupee",
      rtpns: [
        { id: RTPN.UPI, name: "UPI", speed: "instant" },
        { id: RTPN.IMPS, name: "IMPS", speed: "instant" },
      ],
    },
  ];

  const currencies = currencyConfig.map((config) => {
    // Filter to only RTPNs that have registered providers
    const availableRtpns = config.rtpns.filter(
      (rtpn) => registry.getProvidersForRtpn(rtpn.id).length > 0
    );

    return {
      code: config.code,
      name: config.name,
      rtpns: availableRtpns.map((r) => ({
        id: r.id,
        name: r.name,
        speed: r.speed,
      })),
    };
  }).filter((c) => c.rtpns.length > 0);

  return { currencies };
}

