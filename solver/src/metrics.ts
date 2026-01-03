import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

// Create a custom registry
export const registry = new Registry();

// Set default labels
registry.setDefaultLabels({
  app: "freeflo_solver",
});

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// =============================================================================
// COUNTERS
// =============================================================================

export const intentsSeenTotal = new Counter({
  name: "freeflo_intents_seen_total",
  help: "Total number of intents seen by the solver",
  labelNames: ["currency"] as const,
  registers: [registry],
});

export const quotesSubmittedTotal = new Counter({
  name: "freeflo_quotes_submitted_total",
  help: "Total number of quotes submitted by the solver",
  labelNames: ["rtpn", "currency"] as const,
  registers: [registry],
});

export const intentsFulfilledTotal = new Counter({
  name: "freeflo_intents_fulfilled_total",
  help: "Total number of intents fulfilled by the solver",
  labelNames: ["rtpn"] as const,
  registers: [registry],
});

export const intentsFailedTotal = new Counter({
  name: "freeflo_intents_failed_total",
  help: "Total number of intents that failed during fulfillment",
  labelNames: ["rtpn", "reason"] as const,
  registers: [registry],
});

// =============================================================================
// HISTOGRAMS
// =============================================================================

export const transferDurationSeconds = new Histogram({
  name: "freeflo_transfer_duration_seconds",
  help: "Duration of fiat transfers in seconds",
  labelNames: ["rtpn", "status"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const attestationDurationSeconds = new Histogram({
  name: "freeflo_attestation_duration_seconds",
  help: "Duration of attestation requests in seconds",
  labelNames: ["status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Get content type for metrics response
 */
export function getContentType(): string {
  return registry.contentType;
}
