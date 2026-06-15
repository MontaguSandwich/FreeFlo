/**
 * Quote API Server
 * 
 * Provides real-time quotes from registered providers before intent creation.
 * This allows the frontend to show accurate quotes without creating an intent first.
 */

import http from "http";
import { URL } from "url";
import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger.js";
import { ProviderRegistry } from "../providers/registry.js";
import { RTPN, Currency, getRtpnsForCurrency, RTPN_NAMES } from "../types/index.js";

const log = createLogger("quote-api");

/**
 * In-memory status of a single async Compact fill, keyed by the orderId we hand back from
 * POST /api/compact/fill and that the frontend polls via GET /api/compact/status. The `status`
 * tracks the pipeline (received → depositing → paying → proving → releasing → complete | failed);
 * the optional fields are filled in as each step reports progress. Best-effort and ephemeral —
 * records are evicted ~10 min after their last update (see ORDER_TTL_MS).
 */
interface OrderRecord {
  status: string; // "received" | "depositing" | "paying" | "proving" | "releasing" | "complete" | "failed"
  depositTxHash?: string;
  transferId?: string;
  fillTxHash?: string;
  eurCents?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Evict Compact order-status records this long after their last update so the Map can't grow forever. */
const ORDER_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Inbound hardening knobs for the Compact fill endpoint (auth + rate limit + concurrency cap). */
export interface QuoteApiOptions {
  /** When set, POST /api/compact/fill + GET /api/compact/status require this exact X-Solver-API-Key. */
  compactFillApiKey?: string;
  /** Per-client-IP fixed-window rate limit for the fill endpoint. */
  compactFillRate?: { windowMs: number; max: number };
  /** Hard cap on concurrent (non-terminal) Compact orders — memory + abuse guard. */
  compactFillMaxInflight?: number;
}

/** Best-effort client IP: the first hop in X-Forwarded-For (set by our Next proxy / Vercel), else the socket. */
function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

/** Dependency-free fixed-window rate limiter. Returns a predicate: (key) => allowed? */
function makeFixedWindowLimiter(opts: { windowMs: number; max: number }): (key: string) => boolean {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now >= rec.resetAt) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
      return true;
    }
    if (rec.count >= opts.max) return false;
    rec.count += 1;
    return true;
  };
}

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
  /** Solver offramp minimum (USDC base units, 6 decimals) — for the UI to gate input. */
  minUsdcAmount?: number;
  /** True when the requested amount is below the minimum (quotes will be empty). */
  belowMinimum?: boolean;
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
 * Create a quote API server that provides real quotes from registered providers.
 *
 * `compactFill` (optional) wires the TIER-1 sign-once Compact path. When provided, the server
 * exposes the ASYNC Compact fill protocol:
 *   - POST /api/compact/fill light-checks the posted order, kicks off `compactFill(order, onProgress)`
 *     in the background (NOT awaited), and returns 202 {orderId} immediately.
 *   - GET /api/compact/status?orderId=... returns the order's live status record (200) or 404.
 * The `onProgress` callback handed to `compactFill` updates the in-memory status as the fill
 * advances through deposit → SEPA → proof → fill. When `compactFill` is undefined, both routes
 * return 503 (Compact path disabled). Quoting and /api/supported behave identically regardless —
 * this is purely additive.
 */
export function createQuoteApiServer(
  registry: ProviderRegistry,
  solverAddress: string,
  solverName: string = "ZKP2P Solver",
  minUsdcAmount?: bigint,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compactFill?: (order: any, onProgress: (u: any) => void) => Promise<{ txHash: string }>,
  options: QuoteApiOptions = {},
): http.Server {
  // In-memory store of async Compact fill statuses, keyed by orderId. Single-process service, so a
  // plain Map is fine; entries are evicted after ORDER_TTL_MS (swept lazily on each status GET).
  const orders = new Map<string, OrderRecord>();

  // Lazily drop any order records older than the TTL so the Map doesn't grow unbounded. Called on
  // each status GET — cheap, and avoids a dangling setInterval keeping the process alive.
  const sweepExpiredOrders = (): void => {
    const cutoff = Date.now() - ORDER_TTL_MS;
    for (const [id, rec] of orders) {
      if (rec.updatedAt < cutoff) orders.delete(id);
    }
  };

  // Inbound hardening for the Compact fill endpoint (see QuoteApiOptions). Auth + per-IP rate limit
  // + a concurrent-order cap. The pre-fiat gate is the fund-safety guard; these stop resource abuse.
  const fillApiKey = (options.compactFillApiKey ?? "").trim();
  const fillRate = options.compactFillRate ?? { windowMs: 60_000, max: 5 };
  const fillMaxInflight = options.compactFillMaxInflight ?? 50;
  const fillRateLimiter = makeFixedWindowLimiter(fillRate);
  if (compactFill && !fillApiKey) {
    log.warn(
      "POST /api/compact/fill is UNAUTHENTICATED (COMPACT_FILL_API_KEY unset). The pre-fiat gate " +
        "prevents fund loss, but set a key before broad exposure to stop gas/Qonto-slot spam."
    );
  }

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
        const quotes = await getQuotes(registry, solverAddress, solverName, usdcAmount, currency, minUsdcAmount);
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

    // POST /api/compact/fill - TIER-1 sign-once Compact fill (ASYNC). The frontend POSTs a
    // user-signed order ({ claim, mandate, permit2 }); we light-check it, return 202 {orderId}
    // immediately, and run the deposit → SEPA → proof → fill pipeline in the background, updating an
    // in-memory status the frontend polls via GET /api/compact/status. The fill itself (and the
    // deposit-before-SEPA safety ordering) is unchanged — only the HTTP response is now non-blocking.
    if (url.pathname === "/api/compact/fill" && req.method === "POST") {
      if (!compactFill) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Compact flow not enabled" }));
        return;
      }

      // Auth: when a key is configured, require it (the Next /api/compact-fill proxy injects it server-side).
      if (fillApiKey && req.headers["x-solver-api-key"] !== fillApiKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      // Per-IP rate limit (client IP forwarded by our proxy).
      if (!fillRateLimiter(clientIp(req))) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limited, slow down" }));
        return;
      }
      // Concurrent-order cap (count only non-terminal records so completed/failed don't wedge it).
      let inflight = 0;
      for (const rec of orders.values()) {
        if (rec.status !== "complete" && rec.status !== "failed") inflight += 1;
      }
      if (inflight >= fillMaxInflight) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "server busy, try again shortly" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let order: { claim?: unknown; mandate?: unknown; permit2?: unknown };
        try {
          order = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        // Light shape-check only: the orchestrator does the real validation (and the on-chain
        // deposit is the actual safety gate). Reject obviously malformed orders so a bad request
        // fails fast with 400 instead of spinning up a background job that errors immediately.
        if (!order || !order.claim || !order.mandate || !order.permit2) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing claim, mandate, or permit2" }));
          return;
        }

        const orderId = randomUUID();
        const now = Date.now();
        orders.set(orderId, { status: "received", createdAt: now, updatedAt: now });

        // Kick off the fill WITHOUT awaiting; progress + terminal state land in the status record.
        // The onProgress callback merges partial updates onto the existing record.
        compactFill(order, (u) => {
          const prev = orders.get(orderId);
          if (!prev) return; // evicted (shouldn't happen mid-flight, but be defensive)
          orders.set(orderId, { ...prev, ...u, updatedAt: Date.now() });
        }).catch((e) => {
          const message = e instanceof Error ? e.message : String(e);
          log.error({ orderId, error: message }, "Compact fill failed");
          const prev = orders.get(orderId);
          orders.set(orderId, {
            ...(prev ?? { status: "failed", createdAt: now }),
            status: "failed",
            error: message,
            updatedAt: Date.now(),
          });
        });

        log.info({ orderId }, "Compact fill accepted (processing in background)");
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ orderId }));
      });
      return;
    }

    // GET /api/compact/status?orderId=... - poll the live status of an async Compact fill.
    if (url.pathname === "/api/compact/status" && req.method === "GET") {
      if (!compactFill) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Compact flow not enabled" }));
        return;
      }

      // Auth (same key as the fill endpoint; the proxy injects it). The orderId is already an
      // unguessable capability, but gating status too keeps the surface uniform.
      if (fillApiKey && req.headers["x-solver-api-key"] !== fillApiKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      sweepExpiredOrders();

      const orderId = url.searchParams.get("orderId");
      const record = orderId ? orders.get(orderId) : undefined;
      if (!record) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown order" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: record.status,
          depositTxHash: record.depositTxHash,
          transferId: record.transferId,
          fillTxHash: record.fillTxHash,
          eurCents: record.eurCents,
          error: record.error,
        })
      );
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
  currency: Currency,
  minUsdcAmount?: bigint
): Promise<QuoteApiResponse> {
  const quotes: QuoteApiResponse["quotes"] = [];
  const usdcAmountBigInt = BigInt(Math.round(usdcAmount * 1_000_000)); // Convert to 6 decimals
  const minBase = minUsdcAmount !== undefined ? Number(minUsdcAmount) : undefined;

  // Enforce the solver's offramp minimum. The on-chain solver SKIPS quoting below
  // MIN_USDC_AMOUNT, so returning a quote here would let the UI start a transfer that
  // then strands at commit (no on-chain quote -> SlippageExceeded). Return no quotes
  // and a clear belowMinimum signal so the UI can gate the amount up front.
  if (minUsdcAmount !== undefined && usdcAmountBigInt < minUsdcAmount) {
    return { quotes: [], timestamp: Date.now(), minUsdcAmount: minBase, belowMinimum: true };
  }

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
    minUsdcAmount: minBase,
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

