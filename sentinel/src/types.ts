export type Severity = "info" | "warning" | "critical";

export type IncidentClass =
  | "router-pending-timed-out" //   PENDING slot past COMMIT_TIMEOUT → user can cancel/rescueTimedOut (refund)
  | "router-committed-stuck" //     COMMITTED slot, OffRampV3 intent dead past FULFILLMENT_WINDOW → rescueCommitted (refund)
  | "router-committed-inflight" //  COMMITTED slot, offramp still within its window → watch only
  | "router-pending-waiting" //     PENDING slot still within commit window → watch only
  | "solver-down" //                health endpoint unreachable
  | "solver-degraded" //            health reports degraded/unhealthy
  | "solver-stuck-backlog" //       /intents/stuck growing or aging
  | "unknown";

export interface Incident {
  /** Stable dedupe key so a sweep loop alerts once, not every tick. */
  id: string;
  class: IncidentClass;
  severity: Severity;
  /** The user / intent / service the incident concerns. */
  subject: string;
  /** Human-readable description of the stuck state. */
  detail: string;
  /** What clears it (a UI button, a rescue fn + window, or an ops action). */
  recovery: string;
  /**
   * May the Keeper act on this WITHOUT human approval? True ONLY for non-refund
   * infra self-healing (restart, token refresh, retry). Refund/rescue actions and
   * anything novel are always false → detect + alert + (for novel) AI-propose.
   */
  autonomous: boolean;
  ts: number;
}
