#!/usr/bin/env npx tsx
/**
 * CLI Debug Tool for Intent Lifecycle
 *
 * Usage:
 *   npm run debug <intentId>     - Full timeline and error analysis
 *   npm run debug:retry <intentId> - Manually trigger retry
 *   npm run debug:status         - Summary of all intents by status
 */

import Database from "better-sqlite3";
import { classifyError } from "../src/types/errors.js";

// Load environment
const envFile = process.env.ENV_FILE || ".env";
const dotenv = await import("dotenv");
dotenv.config({ path: envFile });

// Database path
const dbPath = (process.env.DB_PATH || "./data/solver.db").replace(".db", "-v3.db");

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatUsdcAmount(amount: string): string {
  return (Number(amount) / 1_000_000).toFixed(2);
}

function formatFiatAmount(amount: string): string {
  return (Number(amount) / 100).toFixed(2);
}

const CURRENCY_NAMES: Record<number, string> = {
  0: "EUR",
  1: "GBP",
  2: "USD",
  3: "BRL",
  4: "INR",
};

const RTPN_NAMES: Record<number, string> = {
  0: "SEPA_INSTANT",
  1: "SEPA_STANDARD",
  2: "FPS",
  3: "BACS",
  4: "PIX",
  5: "TED",
  6: "UPI",
  7: "IMPS",
  8: "FEDNOW",
  9: "ACH",
};

interface Intent {
  intent_id: string;
  depositor: string;
  usdc_amount: string;
  currency: number;
  status: string;
  created_at: number;
  committed_at: number | null;
  selected_solver: string | null;
  selected_rtpn: number | null;
  selected_fiat_amount: string | null;
  receiving_info: string | null;
  recipient_name: string | null;
  quotes_submitted: number;
  fulfillment_tx_hash: string | null;
  provider_transfer_id: string | null;
  error: string | null;
  retry_count: number;
  next_retry_at: number | null;
  updated_at: number;
}

function printIntentDebug(db: Database.Database, intentId: string): void {
  const stmt = db.prepare("SELECT * FROM intents WHERE intent_id = ?");
  const intent = stmt.get(intentId) as Intent | undefined;

  if (!intent) {
    console.log(`${colors.red}Intent not found: ${intentId}${colors.reset}`);
    process.exit(1);
  }

  const statusColors: Record<string, string> = {
    pending_quote: colors.yellow,
    committed: colors.blue,
    pending_retry: colors.yellow,
    fulfilled: colors.green,
    failed: colors.red,
  };

  const statusColor = statusColors[intent.status] || colors.reset;

  console.log("");
  console.log(`${colors.bold}${"=".repeat(60)}${colors.reset}`);
  console.log(`${colors.bold}Intent: ${intent.intent_id}${colors.reset}`);
  console.log(`${colors.bold}${"=".repeat(60)}${colors.reset}`);
  console.log("");

  // Status
  const retryInfo = intent.retry_count > 0 ? ` (retry ${intent.retry_count}/5)` : "";
  console.log(`${colors.bold}Status:${colors.reset} ${statusColor}${intent.status}${retryInfo}${colors.reset}`);
  console.log(`${colors.bold}Created:${colors.reset} ${formatTimestamp(intent.created_at * 1000)} (${formatTimeAgo(intent.created_at * 1000)})`);

  // Amount
  const currencyName = CURRENCY_NAMES[intent.currency] || "?";
  const rtpnName = intent.selected_rtpn !== null ? RTPN_NAMES[intent.selected_rtpn] || "?" : "-";
  const fiatAmount = intent.selected_fiat_amount ? formatFiatAmount(intent.selected_fiat_amount) : "-";
  console.log(`${colors.bold}Amount:${colors.reset} ${formatUsdcAmount(intent.usdc_amount)} USDC -> ${fiatAmount} ${currencyName} (${rtpnName})`);
  console.log(`${colors.bold}Depositor:${colors.reset} ${intent.depositor}`);

  // Timeline
  console.log("");
  console.log(`${colors.bold}Timeline:${colors.reset}`);

  const checkMark = `${colors.green}✓${colors.reset}`;
  const crossMark = `${colors.red}✗${colors.reset}`;
  const pendingMark = `${colors.yellow}⟳${colors.reset}`;

  // Created
  console.log(`  ${checkMark} Created          ${formatTimestamp(intent.created_at * 1000)}`);

  // Quote selected
  if (intent.committed_at) {
    console.log(`  ${checkMark} Quote selected   ${formatTimestamp(intent.committed_at * 1000)}`);
  }

  // Fiat sent
  if (intent.provider_transfer_id) {
    const ts = intent.committed_at ? intent.committed_at * 1000 + 30000 : intent.updated_at;
    console.log(`  ${checkMark} Fiat sent        ${formatTimestamp(ts)}  ${colors.dim}(${intent.provider_transfer_id})${colors.reset}`);
  }

  // Final state
  if (intent.status === "fulfilled" && intent.fulfillment_tx_hash) {
    console.log(`  ${checkMark} Fulfilled        ${formatTimestamp(intent.updated_at)}  ${colors.dim}(${intent.fulfillment_tx_hash})${colors.reset}`);
  } else if (intent.status === "failed" && intent.error) {
    console.log(`  ${crossMark} Failed           ${formatTimestamp(intent.updated_at)}`);
  } else if (intent.status === "pending_retry" && intent.error) {
    console.log(`  ${crossMark} Error            ${formatTimestamp(intent.updated_at)}`);
    if (intent.next_retry_at) {
      const nextRetry = new Date(intent.next_retry_at);
      const isInFuture = nextRetry.getTime() > Date.now();
      console.log(`  ${pendingMark} Retry scheduled  ${formatTimestamp(intent.next_retry_at)}${isInFuture ? " (pending)" : " (ready)"}`);
    }
  }

  // Error analysis
  if (intent.error) {
    console.log("");
    console.log(`${colors.bold}Error:${colors.reset} ${intent.error}`);

    const classified = classifyError(intent.error);
    console.log(`${colors.bold}Category:${colors.reset} ${classified.category.toUpperCase()}`);
    console.log(`${colors.bold}Severity:${colors.reset} ${classified.severity.toUpperCase()}`);
    console.log(`${colors.bold}Retryable:${colors.reset} ${classified.retryable ? "Yes" : "No"}`);

    if (classified.suggestedActions.length > 0) {
      console.log("");
      console.log(`${colors.bold}Suggested Actions:${colors.reset}`);
      classified.suggestedActions.forEach((action, i) => {
        console.log(`  ${i + 1}. ${action}`);
      });
    }
  }

  // Quick commands
  console.log("");
  console.log(`${colors.bold}Quick Commands:${colors.reset}`);
  if (intent.status === "pending_retry" || intent.status === "failed") {
    console.log(`  Retry now: ${colors.cyan}npm run debug:retry ${intent.intent_id}${colors.reset}`);
  }
  if (intent.fulfillment_tx_hash) {
    console.log(`  View TX: ${colors.cyan}https://basescan.org/tx/${intent.fulfillment_tx_hash}${colors.reset}`);
  }
  console.log(`  Query API: ${colors.cyan}curl http://127.0.0.1:8080/intent/${intent.intent_id}${colors.reset}`);

  console.log("");
}

function printStatus(db: Database.Database): void {
  const stats = db
    .prepare("SELECT status, COUNT(*) as count FROM intents GROUP BY status")
    .all() as Array<{ status: string; count: number }>;

  console.log("");
  console.log(`${colors.bold}Intent Status Summary${colors.reset}`);
  console.log("=".repeat(40));

  const statusOrder = ["pending_quote", "committed", "pending_retry", "fulfilled", "failed"];
  const statusColors: Record<string, string> = {
    pending_quote: colors.yellow,
    committed: colors.blue,
    pending_retry: colors.yellow,
    fulfilled: colors.green,
    failed: colors.red,
  };

  let total = 0;
  for (const status of statusOrder) {
    const stat = stats.find((s) => s.status === status);
    const count = stat?.count || 0;
    total += count;
    const color = statusColors[status] || colors.reset;
    console.log(`  ${color}${status.padEnd(15)}${colors.reset} ${count}`);
  }

  console.log("-".repeat(40));
  console.log(`  ${"Total".padEnd(15)} ${total}`);

  // Show stuck intents
  const stuck = db
    .prepare("SELECT * FROM intents WHERE status IN ('failed', 'pending_retry') ORDER BY updated_at DESC LIMIT 5")
    .all() as Intent[];

  if (stuck.length > 0) {
    console.log("");
    console.log(`${colors.bold}Recent Stuck Intents:${colors.reset}`);
    for (const intent of stuck) {
      const shortId = `${intent.intent_id.slice(0, 10)}...${intent.intent_id.slice(-6)}`;
      const statusColor = statusColors[intent.status] || colors.reset;
      const errorShort = intent.error ? intent.error.substring(0, 40) + "..." : "-";
      console.log(`  ${statusColor}${intent.status.padEnd(14)}${colors.reset} ${shortId}  ${colors.dim}${errorShort}${colors.reset}`);
    }
    console.log("");
    console.log(`  Debug: ${colors.cyan}npm run debug <intentId>${colors.reset}`);
  }

  console.log("");
}

function retryIntent(db: Database.Database, intentId: string): void {
  const stmt = db.prepare("SELECT * FROM intents WHERE intent_id = ?");
  const intent = stmt.get(intentId) as Intent | undefined;

  if (!intent) {
    console.log(`${colors.red}Intent not found: ${intentId}${colors.reset}`);
    process.exit(1);
  }

  if (intent.status !== "pending_retry" && intent.status !== "failed") {
    console.log(`${colors.red}Cannot retry intent in status: ${intent.status}${colors.reset}`);
    console.log("Only intents in 'pending_retry' or 'failed' status can be retried.");
    process.exit(1);
  }

  if (!intent.provider_transfer_id) {
    console.log(`${colors.red}Cannot retry: No fiat transfer completed for this intent${colors.reset}`);
    console.log("Retrying is only safe when fiat has already been sent.");
    process.exit(1);
  }

  // Reset to committed status for retry
  const updateStmt = db.prepare(`
    UPDATE intents
    SET status = 'committed',
        error = NULL,
        next_retry_at = NULL,
        updated_at = ?
    WHERE intent_id = ?
  `);

  updateStmt.run(Date.now(), intentId);

  console.log(`${colors.green}Intent ${intentId} marked for retry${colors.reset}`);
  console.log("The solver will pick it up on the next poll cycle.");
  console.log("");
  console.log(`Monitor: ${colors.cyan}pm2 logs zkp2p-solver${colors.reset}`);
}

// Main
const args = process.argv.slice(2);
const command = args[0];

let db: Database.Database;
try {
  db = new Database(dbPath, { readonly: command !== "retry" });
} catch (error) {
  console.log(`${colors.red}Failed to open database: ${dbPath}${colors.reset}`);
  console.log("Make sure the solver has been run at least once to create the database.");
  process.exit(1);
}

if (!command) {
  console.log("Usage:");
  console.log("  npm run debug <intentId>       - Full timeline and error analysis");
  console.log("  npm run debug:retry <intentId> - Manually trigger retry");
  console.log("  npm run debug:status           - Summary of all intents by status");
  process.exit(0);
}

if (command === "status") {
  printStatus(db);
} else if (command === "retry") {
  const intentId = args[1];
  if (!intentId) {
    console.log(`${colors.red}Usage: npm run debug:retry <intentId>${colors.reset}`);
    process.exit(1);
  }
  retryIntent(db, intentId);
} else {
  // Assume it's an intent ID
  printIntentDebug(db, command);
}

db.close();
