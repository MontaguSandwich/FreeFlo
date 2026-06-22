import type { Config } from "../config.js";
import type { Incident } from "../types.js";

/** GET JSON with a timeout. Returns null on network failure, or {__httpError} on non-2xx. */
async function getJson(url: string, timeoutMs = 5000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { __httpError: r.status };
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Watch the solver via its health/observability endpoints (port 8080, internal on the box).
 * - unreachable → solver-down (CRITICAL, autonomous self-heal candidate: restart)
 * - degraded/unhealthy status → solver-degraded
 * - stuck/pending_retry backlog → solver-stuck-backlog
 */
export async function detectSolverHealth(cfg: Config, nowSec: number): Promise<Incident[]> {
  const incidents: Incident[] = [];
  const base = cfg.solverHealthUrl.replace(/\/$/, "");
  if (!base) return incidents; // explicitly disabled

  const health = await getJson(`${base}/health`);

  if (health === null) {
    incidents.push({
      id: "solver-down",
      class: "solver-down",
      severity: "critical",
      subject: base,
      detail: "Solver health endpoint unreachable — solver process down or the box/network is unreachable.",
      recovery: "Non-refund self-heal: restart the solver container (gated by SENTINEL_AUTOHEAL). Else check the EC2 box.",
      autonomous: true, // restart is non-refund infra self-healing
      ts: nowSec,
    });
    return incidents; // nothing else to probe if it's down
  }

  if (health.__httpError) {
    incidents.push({
      id: "solver-degraded",
      class: "solver-degraded",
      severity: "warning",
      subject: base,
      detail: `Solver /health returned HTTP ${health.__httpError}.`,
      recovery: "Inspect solver logs; the service is up but the health route is erroring.",
      autonomous: false,
      ts: nowSec,
    });
  } else if (health.status && health.status !== "healthy") {
    incidents.push({
      id: "solver-degraded",
      class: "solver-degraded",
      severity: health.status === "unhealthy" ? "critical" : "warning",
      subject: base,
      detail: `Solver health = ${health.status}. checks=${JSON.stringify(health.checks ?? {})}`,
      recovery: "Inspect the failing sub-check (chain / db / providers / attestation).",
      autonomous: false,
      ts: nowSec,
    });
  }

  // Stuck / pending_retry backlog (shape-tolerant: array or {intents:[...]}).
  const stuck = await getJson(`${base}/intents/stuck`);
  const list: unknown = Array.isArray(stuck) ? stuck : stuck?.intents;
  if (Array.isArray(list) && list.length > 0) {
    incidents.push({
      id: "solver-stuck-backlog",
      class: "solver-stuck-backlog",
      severity: list.length >= 5 ? "warning" : "info",
      subject: `${list.length} intent(s)`,
      detail: `Solver reports ${list.length} stuck / pending_retry intent(s).`,
      recovery: "Auto-retry (backoff) resumes them; escalate if any age > 2h or the count keeps growing.",
      autonomous: false,
      ts: nowSec,
    });
  }

  return incidents;
}
