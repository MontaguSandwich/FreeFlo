import Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { DbIntent, DbQuote, IntentStatus, RTPN } from "../types/index.js";

const log = createLogger("db");

/**
 * Database for OffRamp intents and quotes
 */
export class IntentDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      -- Intents table
      CREATE TABLE IF NOT EXISTS intents (
        intent_id TEXT PRIMARY KEY,
        depositor TEXT NOT NULL,
        usdc_amount TEXT NOT NULL,
        currency INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_quote',
        created_at INTEGER NOT NULL,
        committed_at INTEGER,
        selected_solver TEXT,
        selected_rtpn INTEGER,
        selected_fiat_amount TEXT,
        receiving_info TEXT,
        recipient_name TEXT,
        -- Local tracking
        quotes_submitted INTEGER NOT NULL DEFAULT 0,
        fulfillment_tx_hash TEXT,
        provider_transfer_id TEXT,
        error TEXT,
        -- Retry tracking
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
      CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at);
      CREATE INDEX IF NOT EXISTS idx_intents_retry ON intents(next_retry_at);
    `);

    // Migration: add retry columns if they don't exist
    this.migrateRetryColumns();

    this.db.exec(`

      -- Quotes table (our submitted quotes)
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        rtpn INTEGER NOT NULL,
        fiat_amount TEXT NOT NULL,
        fee TEXT NOT NULL,
        estimated_time INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        submitted_on_chain INTEGER NOT NULL DEFAULT 0,
        tx_hash TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES intents(intent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_quotes_intent ON quotes(intent_id);

      -- Solver state
      CREATE TABLE IF NOT EXISTS solver_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    log.info("Database initialized");
  }

  /**
   * Add retry columns to existing databases
   */
  private migrateRetryColumns(): void {
    try {
      // Check if columns exist
      const columns = this.db.pragma("table_info(intents)") as Array<{ name: string }>;
      const columnNames = columns.map(c => c.name);

      if (!columnNames.includes("retry_count")) {
        this.db.exec("ALTER TABLE intents ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
        log.info("Added retry_count column");
      }

      if (!columnNames.includes("next_retry_at")) {
        this.db.exec("ALTER TABLE intents ADD COLUMN next_retry_at INTEGER");
        log.info("Added next_retry_at column");
      }
    } catch (error) {
      // Columns might already exist, ignore
      log.debug({ error }, "Migration check (safe to ignore)");
    }
  }

  // ============ Intent Operations ============

  insertIntent(intent: {
    intentId: string;
    depositor: string;
    usdcAmount: bigint;
    currency: number;
    createdAt: number;
  }): void {
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO intents (
        intent_id, depositor, usdc_amount, currency, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      intent.intentId,
      intent.depositor,
      intent.usdcAmount.toString(),
      intent.currency,
      "pending_quote",
      intent.createdAt,
      now
    );
  }

  getIntent(intentId: string): DbIntent | null {
    const stmt = this.db.prepare("SELECT * FROM intents WHERE intent_id = ?");
    const row = stmt.get(intentId);
    return row ? this.rowToIntent(row) : null;
  }

  /**
   * Get intents that need quotes submitted
   */
  getIntentsNeedingQuotes(): DbIntent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM intents 
      WHERE status = 'pending_quote' 
      AND quotes_submitted = 0
      ORDER BY created_at ASC
    `);
    return stmt.all().map(this.rowToIntent);
  }

  /**
   * Get committed intents that need fulfillment
   */
  getCommittedIntents(solverAddress: string): DbIntent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM intents 
      WHERE status = 'committed'
      AND selected_solver = ?
      AND fulfillment_tx_hash IS NULL
      ORDER BY committed_at ASC
    `);
    return stmt.all(solverAddress.toLowerCase()).map(this.rowToIntent);
  }

  markQuotesSubmitted(intentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET quotes_submitted = 1, updated_at = ?
      WHERE intent_id = ?
    `);
    stmt.run(Date.now(), intentId);
  }

  updateIntentCommitted(intentId: string, data: {
    selectedSolver: string;
    selectedRtpn: number;
    selectedFiatAmount: bigint;
    receivingInfo: string;
    recipientName: string;
    committedAt: number;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET status = 'committed',
          committed_at = ?,
          selected_solver = ?,
          selected_rtpn = ?,
          selected_fiat_amount = ?,
          receiving_info = ?,
          recipient_name = ?,
          updated_at = ?
      WHERE intent_id = ?
    `);

    stmt.run(
      data.committedAt,
      data.selectedSolver.toLowerCase(),
      data.selectedRtpn,
      data.selectedFiatAmount.toString(),
      data.receivingInfo,
      data.recipientName,
      Date.now(),
      intentId
    );
  }

  markFulfilled(intentId: string, txHash: string, providerTransferId: string): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET status = 'fulfilled',
          fulfillment_tx_hash = ?,
          provider_transfer_id = ?,
          updated_at = ?
      WHERE intent_id = ?
    `);
    stmt.run(txHash, providerTransferId, Date.now(), intentId);
  }

  /**
   * Mark an intent as failed. If it has a transfer ID (fiat already sent),
   * schedule it for retry instead of permanently failing.
   * 
   * @param intentId - The intent ID
   * @param error - The error message
   * @param canRetry - Whether this failure is retryable (default: auto-detect based on transfer ID)
   */
  markFailed(intentId: string, error: string, canRetry?: boolean): void {
    const now = Date.now();
    
    // Check if fiat transfer already completed - if so, we should retry
    const transferId = this.getTransferId(intentId);
    const shouldRetry = canRetry ?? (transferId !== null);
    
    if (shouldRetry) {
      // Schedule for retry with exponential backoff
      this.scheduleRetry(intentId, error);
    } else {
      // Permanently failed (no fiat was sent)
      const stmt = this.db.prepare(`
        UPDATE intents 
        SET status = 'failed',
            error = ?,
            updated_at = ?
        WHERE intent_id = ?
      `);
      stmt.run(error, now, intentId);
    }
  }

  /**
   * Schedule an intent for retry with exponential backoff
   * Max 5 retries: 1min, 2min, 4min, 8min, 16min
   */
  private scheduleRetry(intentId: string, error: string): void {
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 60_000; // 1 minute
    
    // Get current retry count
    const stmt = this.db.prepare(`SELECT retry_count FROM intents WHERE intent_id = ?`);
    const row = stmt.get(intentId) as { retry_count: number } | undefined;
    const currentRetries = row?.retry_count ?? 0;
    
    if (currentRetries >= MAX_RETRIES) {
      // Max retries exceeded - permanently fail
      log.error({ intentId, retries: currentRetries }, "Max retries exceeded, permanently failing");
      const failStmt = this.db.prepare(`
        UPDATE intents 
        SET status = 'failed',
            error = ?,
            updated_at = ?
        WHERE intent_id = ?
      `);
      failStmt.run(`Max retries (${MAX_RETRIES}) exceeded. Last error: ${error}`, Date.now(), intentId);
      return;
    }

    // Calculate next retry time with exponential backoff
    const delayMs = BASE_DELAY_MS * Math.pow(2, currentRetries);
    const nextRetryAt = Date.now() + delayMs;
    
    log.info(
      { intentId, retryCount: currentRetries + 1, nextRetryIn: `${delayMs / 1000}s` },
      "Scheduling intent for retry"
    );

    const updateStmt = this.db.prepare(`
      UPDATE intents 
      SET status = 'pending_retry',
          error = ?,
          retry_count = retry_count + 1,
          next_retry_at = ?,
          updated_at = ?
      WHERE intent_id = ?
    `);
    updateStmt.run(error, nextRetryAt, Date.now(), intentId);
  }

  /**
   * Get intents that are ready for retry
   */
  getRetryableIntents(solverAddress: string): DbIntent[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM intents 
      WHERE status = 'pending_retry'
      AND selected_solver = ?
      AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
    `);
    return stmt.all(solverAddress.toLowerCase(), now).map(this.rowToIntent);
  }

  /**
   * Move a retryable intent back to committed status for processing
   */
  markForRetry(intentId: string): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET status = 'committed',
          error = NULL,
          updated_at = ?
      WHERE intent_id = ?
    `);
    stmt.run(Date.now(), intentId);
  }

  /**
   * Save the provider transfer ID after fiat transfer completes.
   * This allows resuming from Step 2 (proof generation) if later steps fail.
   */
  saveTransferId(intentId: string, transferId: string): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET provider_transfer_id = ?,
          updated_at = ?
      WHERE intent_id = ?
    `);
    stmt.run(transferId, Date.now(), intentId);
  }

  /**
   * Get the provider transfer ID for an intent (if fiat transfer already completed)
   */
  getTransferId(intentId: string): string | null {
    const stmt = this.db.prepare(`
      SELECT provider_transfer_id FROM intents WHERE intent_id = ?
    `);
    const row = stmt.get(intentId) as { provider_transfer_id: string | null } | undefined;
    return row?.provider_transfer_id || null;
  }

  // ============ Quote Operations ============

  insertQuote(quote: {
    id: string;
    intentId: string;
    rtpn: number;
    fiatAmount: bigint;
    fee: bigint;
    estimatedTime: number;
    expiresAt: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO quotes (
        id, intent_id, rtpn, fiat_amount, fee,
        estimated_time, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      quote.id,
      quote.intentId,
      quote.rtpn,
      quote.fiatAmount.toString(),
      quote.fee.toString(),
      quote.estimatedTime,
      quote.expiresAt,
      Date.now()
    );
  }

  markQuoteSubmittedOnChain(quoteId: string, txHash: string): void {
    const stmt = this.db.prepare(`
      UPDATE quotes 
      SET submitted_on_chain = 1, tx_hash = ?
      WHERE id = ?
    `);
    stmt.run(txHash, quoteId);
  }

  getQuotesForIntent(intentId: string): DbQuote[] {
    const stmt = this.db.prepare("SELECT * FROM quotes WHERE intent_id = ?");
    return stmt.all(intentId).map(this.rowToQuote);
  }

  // ============ State Operations ============

  getLastBlock(): bigint {
    const stmt = this.db.prepare("SELECT value FROM solver_state WHERE key = ?");
    const row = stmt.get("last_block") as { value: string } | undefined;
    return row ? BigInt(row.value) : 0n;
  }

  setLastBlock(blockNumber: bigint): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO solver_state (key, value) VALUES (?, ?)
    `);
    stmt.run("last_block", blockNumber.toString());
  }

  // ============ Stats ============

  getStats(): {
    pendingQuote: number;
    committed: number;
    pendingRetry: number;
    fulfilled: number;
    failed: number;
    totalQuotesSubmitted: number;
  } {
    const intentStmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM intents GROUP BY status
    `);
    const intentRows = intentStmt.all() as Array<{ status: string; count: number }>;
    
    const quoteStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM quotes WHERE submitted_on_chain = 1
    `);
    const quoteRow = quoteStmt.get() as { count: number };
    
    const stats = {
      pendingQuote: 0,
      committed: 0,
      pendingRetry: 0,
      fulfilled: 0,
      failed: 0,
      totalQuotesSubmitted: quoteRow.count,
    };

    for (const row of intentRows) {
      if (row.status === "pending_quote") stats.pendingQuote = row.count;
      else if (row.status === "committed") stats.committed = row.count;
      else if (row.status === "pending_retry") stats.pendingRetry = row.count;
      else if (row.status === "fulfilled") stats.fulfilled = row.count;
      else if (row.status === "failed") stats.failed = row.count;
    }

    return stats;
  }

  // ============ Helpers ============

  private rowToIntent(row: unknown): DbIntent {
    const r = row as Record<string, unknown>;
    return {
      intentId: r.intent_id as string,
      depositor: r.depositor as string,
      usdcAmount: r.usdc_amount as string,
      currency: r.currency as number,
      status: r.status as string,
      createdAt: r.created_at as number,
      committedAt: r.committed_at as number | null,
      selectedSolver: r.selected_solver as string | null,
      selectedRtpn: r.selected_rtpn as number | null,
      selectedFiatAmount: r.selected_fiat_amount as string | null,
      receivingInfo: r.receiving_info as string | null,
      recipientName: r.recipient_name as string | null,
      quotesSubmitted: Boolean(r.quotes_submitted),
      fulfillmentTxHash: r.fulfillment_tx_hash as string | null,
      providerTransferId: r.provider_transfer_id as string | null,
      error: r.error as string | null,
      updatedAt: r.updated_at as number,
    };
  }

  private rowToQuote(row: unknown): DbQuote {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      intentId: r.intent_id as string,
      rtpn: r.rtpn as number,
      fiatAmount: r.fiat_amount as string,
      fee: r.fee as string,
      estimatedTime: r.estimated_time as number,
      expiresAt: r.expires_at as number,
      submittedOnChain: Boolean(r.submitted_on_chain),
      txHash: r.tx_hash as string | null,
      createdAt: r.created_at as number,
    };
  }

  close(): void {
    this.db.close();
  }
}



