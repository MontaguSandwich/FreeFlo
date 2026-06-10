import http from "http";
import { URL } from "url";
import { createLogger } from "./utils/logger.js";
import { getMetrics, getContentType } from "./metrics.js";
import type { IntentDatabase } from "./db/intents.js";
import { getAlertService } from "./alerts/index.js";

const log = createLogger("health");

// Database reference (set by orchestrator after initialization)
let dbRef: IntentDatabase | null = null;

/**
 * Set the database reference for intent status endpoints
 */
export function setHealthDatabase(db: IntentDatabase): void {
  dbRef = db;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    chain: HealthCheck;
    database: HealthCheck;
    providers: HealthCheck;
    attestation: HealthCheck;
  };
}

export interface HealthCheck {
  status: "ok" | "warning" | "error";
  message?: string;
  lastCheck?: string;
}

// Global health state (updated by orchestrator)
let healthState: HealthStatus = {
  status: "healthy",
  timestamp: new Date().toISOString(),
  uptime: 0,
  version: "1.0.0",
  checks: {
    chain: { status: "ok" },
    database: { status: "ok" },
    providers: { status: "ok" },
    attestation: { status: "ok" },
  },
};

const startTime = Date.now();

/**
 * Update a specific health check
 */
export function updateHealthCheck(
  check: keyof HealthStatus["checks"],
  status: HealthCheck["status"],
  message?: string
): void {
  healthState.checks[check] = {
    status,
    message,
    lastCheck: new Date().toISOString(),
  };
  
  // Update overall status based on checks
  const checks = Object.values(healthState.checks);
  if (checks.some((c) => c.status === "error")) {
    healthState.status = "unhealthy";
  } else if (checks.some((c) => c.status === "warning")) {
    healthState.status = "degraded";
  } else {
    healthState.status = "healthy";
  }
}

/**
 * Get current health status
 */
export function getHealthStatus(): HealthStatus {
  return {
    ...healthState,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
}

/**
 * Start a simple HTTP health check server
 */
export function startHealthServer(port: number = 8080): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" || req.url === "/") {
      const health = getHealthStatus();
      const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
      
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health, null, 2));
      return;
    }

    if (req.url === "/ready") {
      const health = getHealthStatus();
      const isReady = health.status !== "unhealthy";
      
      res.writeHead(isReady ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready: isReady }));
      return;
    }

    if (req.url === "/live") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive: true }));
      return;
    }

    // Stats endpoint
    if (req.url === "/stats") {
      const health = getHealthStatus();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        uptime: health.uptime,
        uptimeHuman: formatUptime(health.uptime),
        status: health.status,
        version: health.version,
      }, null, 2));
      return;
    }

    // Prometheus metrics endpoint
    if (req.url === "/metrics") {
      try {
        const metrics = await getMetrics();
        res.writeHead(200, { "Content-Type": getContentType() });
        res.end(metrics);
      } catch (error) {
        log.error({ error }, "Failed to collect metrics");
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error collecting metrics");
      }
      return;
    }

    // Test alert endpoint
    if (req.url === "/test-alert" && req.method === "POST") {
      try {
        const alerts = getAlertService();
        await alerts.sendTestAlert();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Test alert sent" }));
      } catch (error) {
        log.error({ error }, "Failed to send test alert");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Alert service not configured" }));
      }
      return;
    }

    // Intent status endpoints (require database)
    if (req.url?.startsWith("/intent")) {
      if (!dbRef) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Database not initialized" }));
        return;
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

      // GET /intent/:id - Get specific intent status
      const intentMatch = parsedUrl.pathname.match(/^\/intent\/(.+)$/);
      if (intentMatch && req.method === "GET") {
        const intentId = intentMatch[1];
        const intent = dbRef.getIntent(intentId);

        if (!intent) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Intent not found" }));
          return;
        }

        const retryInfo = dbRef.getRetryInfo(intentId);
        const timeline = buildIntentTimeline(intent);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          intentId: intent.intentId,
          status: intent.status,
          depositor: intent.depositor,
          usdcAmount: intent.usdcAmount,
          currency: intent.currency,
          selectedRtpn: intent.selectedRtpn,
          selectedFiatAmount: intent.selectedFiatAmount,
          receivingInfo: intent.receivingInfo ? maskIban(intent.receivingInfo) : null,
          timeline,
          retryCount: retryInfo?.retryCount ?? 0,
          nextRetryAt: retryInfo?.nextRetryAt,
          error: intent.error,
          transferId: intent.providerTransferId,
          fulfillmentTxHash: intent.fulfillmentTxHash,
        }, null, 2));
        return;
      }

      // GET /intents/stuck - Get all stuck intents
      if (parsedUrl.pathname === "/intents/stuck" && req.method === "GET") {
        const stuckIntents = dbRef.getStuckIntents();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          count: stuckIntents.length,
          intents: stuckIntents.map(intent => ({
            intentId: intent.intentId,
            status: intent.status,
            error: intent.error,
            retryCount: dbRef!.getRetryInfo(intent.intentId)?.retryCount ?? 0,
            transferId: intent.providerTransferId,
            createdAt: intent.createdAt,
            updatedAt: intent.updatedAt,
          })),
        }, null, 2));
        return;
      }

      // GET /intents/recent - Get recent intents
      if (parsedUrl.pathname === "/intents/recent" && req.method === "GET") {
        const limit = parseInt(parsedUrl.searchParams.get("limit") || "50", 10);
        const recentIntents = dbRef.getRecentIntents(Math.min(limit, 100));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          count: recentIntents.length,
          intents: recentIntents.map(intent => ({
            intentId: intent.intentId,
            status: intent.status,
            usdcAmount: intent.usdcAmount,
            currency: intent.currency,
            error: intent.error,
            createdAt: intent.createdAt,
            updatedAt: intent.updatedAt,
          })),
        }, null, 2));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    log.info({ port }, "Health check server started");
  });

  return server;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

interface TimelineEntry {
  stage: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * Build a timeline of events for an intent
 */
function buildIntentTimeline(intent: {
  createdAt: number;
  committedAt: number | null;
  status: string;
  error: string | null;
  providerTransferId: string | null;
  fulfillmentTxHash: string | null;
  updatedAt: number;
}): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  // Created
  timeline.push({
    stage: "created",
    timestamp: intent.createdAt,
  });

  // Committed (quote selected)
  if (intent.committedAt) {
    timeline.push({
      stage: "committed",
      timestamp: intent.committedAt,
    });
  }

  // Fiat sent (has transfer ID)
  if (intent.providerTransferId) {
    timeline.push({
      stage: "fiat_sent",
      timestamp: intent.committedAt ? intent.committedAt + 30 : intent.updatedAt, // Approximate
      details: { transferId: intent.providerTransferId },
    });
  }

  // Final state
  if (intent.status === "fulfilled" && intent.fulfillmentTxHash) {
    timeline.push({
      stage: "fulfilled",
      timestamp: intent.updatedAt,
      details: { txHash: intent.fulfillmentTxHash },
    });
  } else if (intent.status === "failed" && intent.error) {
    timeline.push({
      stage: "failed",
      timestamp: intent.updatedAt,
      details: { error: intent.error },
    });
  } else if (intent.status === "pending_retry" && intent.error) {
    timeline.push({
      stage: "error",
      timestamp: intent.updatedAt,
      details: { error: intent.error },
    });
  }

  return timeline;
}

/**
 * Mask an IBAN for privacy (show first 4 and last 4 characters)
 */
function maskIban(iban: string): string {
  if (iban.length <= 8) return iban;
  return `${iban.slice(0, 4)}...${iban.slice(-4)}`;
}




