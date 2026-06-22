import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.js";
import type { Incident } from "./types.js";

const exec = promisify(execFile);

/**
 * Non-refund infra self-healing ONLY. Acts on incidents flagged `autonomous` — never on
 * refund/rescue (fund-moving) or novel incidents. Gated behind SENTINEL_AUTOHEAL (default
 * off) so a fresh deploy runs detect+alert first; flip it on once it's proven stable.
 *
 * Currently handles: solver-down → `docker compose restart solver` (requires the keeper to
 * run on the box with docker access). Returns log lines describing what it did / would do.
 */
export async function selfHeal(cfg: Config, incidents: Incident[]): Promise<string[]> {
  const log: string[] = [];
  for (const inc of incidents.filter((i) => i.autonomous)) {
    if (inc.class === "solver-down") {
      if (!cfg.autoheal) {
        log.push(`[autoheal OFF] would restart solver container (${inc.id})`);
        continue;
      }
      try {
        await exec("docker", ["compose", "-f", cfg.composeFile, "restart", "solver"], { timeout: 60_000 });
        log.push("[autoheal] restarted solver container");
      } catch (err) {
        log.push(`[autoheal] solver restart FAILED: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }
  return log;
}
