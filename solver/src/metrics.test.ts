import { describe, it, expect, beforeEach } from "vitest";
import {
  registry,
  intentsSeenTotal,
  quotesSubmittedTotal,
  intentsFulfilledTotal,
  intentsFailedTotal,
  transferDurationSeconds,
  attestationDurationSeconds,
  getMetrics,
  getContentType,
} from "./metrics.js";

describe("Prometheus Metrics", () => {
  beforeEach(async () => {
    // Reset all custom metrics before each test
    registry.resetMetrics();
  });

  describe("Counters", () => {
    it("should increment intents seen counter", async () => {
      intentsSeenTotal.inc({ currency: "EUR" });
      intentsSeenTotal.inc({ currency: "EUR" });
      intentsSeenTotal.inc({ currency: "USD" });

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_intents_seen_total");
      expect(metrics).toContain('currency="EUR"');
      expect(metrics).toContain('currency="USD"');
    });

    it("should increment quotes submitted counter", async () => {
      quotesSubmittedTotal.inc({ rtpn: "SEPA_INSTANT", currency: "EUR" });

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_quotes_submitted_total");
      expect(metrics).toContain('rtpn="SEPA_INSTANT"');
    });

    it("should increment intents fulfilled counter", async () => {
      intentsFulfilledTotal.inc({ rtpn: "SEPA_INSTANT" });

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_intents_fulfilled_total");
    });

    it("should increment intents failed counter with reason", async () => {
      intentsFailedTotal.inc({ rtpn: "PIX", reason: "transfer_failed" });
      intentsFailedTotal.inc({ rtpn: "PIX", reason: "no_provider" });

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_intents_failed_total");
      expect(metrics).toContain('reason="transfer_failed"');
      expect(metrics).toContain('reason="no_provider"');
    });
  });

  describe("Histograms", () => {
    it("should observe transfer duration", async () => {
      transferDurationSeconds.observe({ rtpn: "SEPA_INSTANT", status: "success" }, 5.5);

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_transfer_duration_seconds");
      expect(metrics).toContain('rtpn="SEPA_INSTANT"');
      expect(metrics).toContain('status="success"');
    });

    it("should observe attestation duration", async () => {
      attestationDurationSeconds.observe({ status: "success" }, 1.2);
      attestationDurationSeconds.observe({ status: "error" }, 0.5);

      const metrics = await getMetrics();
      expect(metrics).toContain("freeflo_attestation_duration_seconds");
      expect(metrics).toContain('status="success"');
      expect(metrics).toContain('status="error"');
    });
  });

  describe("Metrics endpoint", () => {
    it("should return metrics in Prometheus format", async () => {
      const metrics = await getMetrics();

      // Should contain default Node.js metrics
      expect(metrics).toContain("nodejs_");
      expect(metrics).toContain("process_");

      // Should contain app label
      expect(metrics).toContain('app="freeflo_solver"');
    });

    it("should return correct content type", () => {
      const contentType = getContentType();
      expect(contentType).toContain("text/plain");
    });
  });
});
