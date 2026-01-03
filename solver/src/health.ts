import http from "http";
import { createLogger } from "./utils/logger.js";
import { getMetrics, getContentType } from "./metrics.js";

const log = createLogger("health");

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




