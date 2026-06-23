import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Incident } from "./types.js";

const STATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../state");
const STATE_FILE = resolve(STATE_DIR, "incidents.json");

export interface StoredIncident extends Incident {
  firstSeen: number;
  lastSeen: number;
}

export interface SentinelState {
  open: Record<string, StoredIncident>;
  updatedAt: number;
}

export function loadState(): SentinelState {
  if (!existsSync(STATE_FILE)) return { open: {}, updatedAt: 0 };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SentinelState;
  } catch {
    return { open: {}, updatedAt: 0 };
  }
}

export function saveState(s: SentinelState): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}

/**
 * Reconcile this sweep's incidents against persisted open incidents.
 * - `newly`: incidents not seen last sweep → alert on these (dedup prevents re-alerting).
 * - `resolved`: previously-open incidents absent this sweep → they cleared.
 * This file is also the durable incident log the AI fix-builder routine reads.
 */
export function reconcile(state: SentinelState, current: Incident[], nowSec: number) {
  const currentIds = new Set(current.map((i) => i.id));
  const newly: Incident[] = [];

  for (const inc of current) {
    const ex = state.open[inc.id];
    if (!ex) {
      state.open[inc.id] = { ...inc, firstSeen: nowSec, lastSeen: nowSec };
      newly.push(inc);
    } else {
      ex.lastSeen = nowSec;
      ex.severity = inc.severity;
      ex.detail = inc.detail;
    }
  }

  const resolved: StoredIncident[] = [];
  for (const id of Object.keys(state.open)) {
    if (!currentIds.has(id)) {
      resolved.push(state.open[id]);
      delete state.open[id];
    }
  }

  state.updatedAt = nowSec;
  return { newly, resolved };
}

// ---- Trade-tracker cursor (last processed block) — separate from the incident store. ----
const CURSOR_FILE = resolve(STATE_DIR, "tracker-cursor.json");

export function loadCursor(): bigint | null {
  if (!existsSync(CURSOR_FILE)) return null;
  try {
    const j = JSON.parse(readFileSync(CURSOR_FILE, "utf8")) as { block?: string };
    return j.block != null ? BigInt(j.block) : null;
  } catch {
    return null;
  }
}

export function saveCursor(block: bigint): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CURSOR_FILE, JSON.stringify({ block: block.toString(), updatedAt: Math.floor(Date.now() / 1000) }, null, 2) + "\n");
}
