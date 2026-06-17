/**
 * Qonto Provider
 * 
 * SEPA INSTANT ONLY payment provider using Qonto's Business API.
 * 
 * This provider is designed for real-time off-ramp and does NOT support
 * SEPA Standard. Transfers that cannot be processed as instant are rejected.
 * 
 * Limits:
 * - Max €10,000 per transfer (Qonto's SEPA Instant limit for trusted beneficiaries)
 * - Transfers above this limit are REJECTED, not queued for standard
 * 
 * Prerequisites:
 * - Qonto business account with API access
 * - OAuth access token with payment.write and organization.read scopes
 * - Beneficiaries marked as "trusted" in Qonto app for fully automated transfers
 * 
 * @see https://docs.qonto.com/api-reference/business-api/
 */

import * as fs from "fs";
import * as path from "path";
import { BaseProvider } from "./base.js";
import { QontoClient, QontoApiError } from "./qonto-client.js";
import {
  QontoProviderConfig,
  DEFAULT_QONTO_CONFIG,
  QontoTransferStatus,
  VopMatchResult,
} from "./qonto-types.js";
import {
  RTPN,
  Currency,
  QuoteRequest,
  Quote,
  TransferRequest,
  TransferResult,
  TransferStatus,
} from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("qonto-provider");

// SEPA Instant timing
const SEPA_INSTANT_TIME_SECONDS = 10; // ~10 seconds for instant

// Instant transfer limit (Qonto's limit for trusted beneficiaries)
// Transfers above this CANNOT be instant - we reject them
const INSTANT_TRANSFER_LIMIT_EUR = 10000_00; // €10,000 in cents

export class QontoProvider extends BaseProvider {
  readonly id = "qonto";
  readonly name = "Qonto";
  readonly supportedRtpns = [RTPN.SEPA_INSTANT]; // Instant only - no fallback to standard
  readonly supportedCurrencies = [Currency.EUR];

  private client: QontoClient;
  private config: QontoProviderConfig;
  private solverAddress: string;

  constructor(config: QontoProviderConfig, solverAddress: string) {
    super();
    
    // Merge with defaults
    this.config = {
      ...DEFAULT_QONTO_CONFIG,
      ...config,
    } as QontoProviderConfig;
    
    this.solverAddress = solverAddress;
    this.client = new QontoClient(this.config);

    log.info(
      {
        bankAccountId: this.config.bankAccountId,
        feeBps: this.config.feeBps,
        sandbox: this.config.useSandbox,
      },
      "Qonto provider initialized"
    );
  }

  // ============ Quote Generation ============

  async getQuote(request: QuoteRequest): Promise<Quote> {
    const { intentId, usdcAmount, currency, rtpn } = request;

    // Validate inputs
    if (currency !== Currency.EUR) {
      throw new Error(`Qonto only supports EUR, got ${this.getCurrencyName(currency)}`);
    }
    if (rtpn !== RTPN.SEPA_INSTANT) {
      throw new Error(`Qonto provider only supports SEPA Instant, got ${this.getRtpnName(rtpn)}`);
    }

    // Get current USDC/EUR rate
    const rate = await this.getUsdcEurRate();

    // Calculate fiat amount (USDC has 6 decimals, fiat has 2)
    // usdcAmount is in base units (6 decimals)
    // fiatAmount should be in cents (2 decimals)
    const usdcFloat = Number(usdcAmount) / 1_000_000;
    const eurFloat = usdcFloat * rate;
    const eurCents = Math.floor(eurFloat * 100);

    // Calculate fee in USDC (6 decimals)
    const feeFloat = usdcFloat * (this.config.feeBps / 10000);
    const feeUsdc = BigInt(Math.floor(feeFloat * 1_000_000));

    // Subtract fee from fiat amount
    const feeEurCents = Math.floor(feeFloat * rate * 100);
    const netEurCents = eurCents - feeEurCents;

    // STRICT: Reject if amount exceeds SEPA Instant limit
    // We don't fall back to standard - real-time is non-negotiable
    if (netEurCents > INSTANT_TRANSFER_LIMIT_EUR) {
      throw new Error(
        `Amount €${(netEurCents / 100).toFixed(2)} exceeds SEPA Instant limit of €${INSTANT_TRANSFER_LIMIT_EUR / 100}. ` +
        `Reduce amount or use a different provider.`
      );
    }

    const estimatedTime = SEPA_INSTANT_TIME_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + this.config.quoteValiditySecs;

    const quote: Quote = {
      intentId,
      solver: this.solverAddress,
      rtpn: RTPN.SEPA_INSTANT,
      fiatAmount: BigInt(netEurCents),
      fee: feeUsdc,
      estimatedTime,
      expiresAt,
    };

    log.info(
      {
        intentId,
        usdcAmount: this.formatUsdc(usdcAmount),
        eurAmount: (netEurCents / 100).toFixed(2),
        fee: this.formatUsdc(feeUsdc),
        rate,
        rtpn: "SEPA_INSTANT",
      },
      "Quote generated"
    );

    return quote;
  }

  // ============ Transfer Execution ============

  async executeTransfer(request: TransferRequest): Promise<TransferResult> {
    const {
      intentId,
      usdcAmount,
      fiatAmount,
      currency,
      rtpn,
      receivingInfo,
      recipientName,
    } = request;

    log.info(
      {
        intentId,
        usdcAmount: this.formatUsdc(usdcAmount),
        fiatAmount: this.formatFiat(fiatAmount, currency),
        rtpn: this.getRtpnName(rtpn),
        iban: receivingInfo.substring(0, 10) + "...",
        recipientName,
      },
      "Executing transfer"
    );

    try {
      // Step 1: Verify payee (VoP check)
      const iban = receivingInfo.replace(/\s/g, "").toUpperCase();
      
      log.debug({ iban, recipientName }, "Verifying payee");
      
      const vopResult = await this.client.verifyPayee({
        iban,
        beneficiary_name: recipientName,
      });

      log.info(
        {
          matchResult: vopResult.match_result,
          matchedName: vopResult.matched_name,
        },
        "VoP check completed"
      );

      // Handle VoP results
      if (!this.shouldProceedWithVop(vopResult.match_result)) {
        return {
          success: false,
          transferId: "",
          fiatSent: 0n,
          error: `VoP check failed: ${vopResult.match_result}`,
        };
      }

      // Pre-flight trust check (production only). An unattended solver cannot complete
      // Qonto SCA (device approval), so a NON-trusted beneficiary 428s and strands the
      // transfer (no fiat sent, USDC stuck COMMITTED until the user reclaims). Fail FAST
      // with a clear, actionable reason instead of attempting a doomed send. Fails OPEN:
      // only a DEFINITIVE "not trusted" (false) blocks; an inconclusive lookup (null) or
      // a trusted match (true) proceeds, so a transient API blip never blocks a real
      // trusted transfer — the client's prod-SCA fail-fast is the backstop. Sandbox uses
      // mock SCA, so it's exempt.
      if (!this.config.useSandbox) {
        const trusted = await this.client.checkBeneficiaryTrusted(iban);
        if (trusted === false) {
          log.error(
            { iban: iban.substring(0, 8) + "...", recipientName },
            "Beneficiary is not a trusted Qonto beneficiary — SCA would be required; failing fast"
          );
          return {
            success: false,
            transferId: "",
            fiatSent: 0n,
            error:
              `Recipient "${recipientName}" (${iban.substring(0, 4)}…${iban.slice(-4)}) is not a trusted ` +
              `Qonto beneficiary. Add it as a trusted beneficiary in Qonto (Settings → Beneficiaries) and ` +
              `retry — unattended payouts to untrusted beneficiaries require SCA, which can't be auto-approved.`,
          };
        }
      }

      // Step 2: Create the transfer
      const amountEur = (Number(fiatAmount) / 100).toFixed(2);
      const reference = `OFFRAMP-${intentId.substring(0, 8)}`;

      // Deterministic idempotency key derived from the on-chain intent id. Qonto caches the first
      // successful response per X-Qonto-Idempotency-Key (~24h window) and replays it for any later
      // request with the same key, so a retry after the solver crashes between Qonto accepting the
      // transfer and persisting the transferId returns the ORIGINAL transfer instead of sending a
      // second real EUR payment. The key MUST stay stable across retries of the same intent, so it
      // is derived solely from intentId (unique per intent) — never randomized.
      const idempotencyKey = `offramp-${intentId}`;

      // Always use beneficiary object with name/IBAN to match VoP token
      // (beneficiary_id would cause VoP signature mismatch)
      const transferResponse = await this.client.createTransfer(
        {
          vop_proof_token: vopResult.proof_token.token,
          transfer: {
            bank_account_id: this.config.bankAccountId,
            beneficiary: {
              name: recipientName,
              iban,
            },
            amount: amountEur,
            reference,
            note: `Off-ramp intent ${intentId}`,
          },
        },
        idempotencyKey
      );

      const transfer = transferResponse.transfer;
      log.info(
        {
          transferId: transfer.id,
          status: transfer.status,
          amount: transfer.amount,
        },
        "Transfer created"
      );

      // Step 4: Wait for transfer to complete
      // For SEPA Instant, this should be ~10 seconds
      // If it takes longer, Qonto may have fallen back to standard - we treat this as failure
      const finalStatus = await this.waitForTransferCompletion(transfer.id);

      if (finalStatus === "settled") {
        log.info(
          { transferId: transfer.id, intentId },
          "SEPA Instant transfer settled successfully"
        );
        return {
          success: true,
          transferId: transfer.id,
          fiatSent: fiatAmount,
        };
      } else if (finalStatus === "declined" || finalStatus === "canceled") {
        const statusCheck = await this.client.getTransfer(transfer.id);
        return {
          success: false,
          transferId: transfer.id,
          fiatSent: 0n,
          error: `Transfer ${finalStatus}: ${statusCheck.transfer.declined_reason || "unknown reason"}`,
        };
      } else {
        // Transfer did not reach a terminal state within our SEPA Instant
        // window. This likely means Qonto fell back to SEPA Standard, which we
        // do not accept for real-time off-ramp.
        log.error(
          { transferId: transfer.id, status: finalStatus },
          "Transfer did not settle in time - attempting cancel"
        );

        // Try to cancel, then RE-VERIFY the status. Neither the cancel call
        // succeeding nor failing tells us whether the instant payment already
        // settled, so we must confirm a terminal state before assuming the fiat
        // is safe.
        let observedStatus: QontoTransferStatus = finalStatus;
        let confirmedTerminal = false;
        try {
          await this.client.cancelTransfer(transfer.id);
          const recheck = await this.client.getTransfer(transfer.id);
          observedStatus = recheck.transfer.status;
          if (observedStatus === "canceled" || observedStatus === "declined") {
            // Cancel took effect before any settlement - fiat is safe.
            confirmedTerminal = true;
          }
        } catch (cancelError) {
          log.warn(
            { transferId: transfer.id, error: cancelError },
            "Failed to cancel/verify transfer - outcome unknown"
          );
        }

        if (confirmedTerminal) {
          log.info(
            { transferId: transfer.id, status: observedStatus },
            "Non-instant transfer cancelled and confirmed terminal"
          );
          return {
            success: false,
            transferId: transfer.id,
            fiatSent: 0n,
            error: `Transfer did not complete as SEPA Instant and was cancelled (status: ${observedStatus}). Real-time settlement required.`,
          };
        }

        // Could NOT confirm the transfer is dead: the fiat may still settle as
        // SEPA Standard. Flag for manual reconciliation - the caller records the
        // transfer id, alerts, and must never re-send for this intent.
        log.error(
          { transferId: transfer.id, status: observedStatus },
          "Transfer outcome UNKNOWN after instant window - fiat may still settle, manual reconciliation required"
        );
        return {
          success: false,
          transferId: transfer.id,
          fiatSent: 0n,
          requiresReconciliation: true,
          error: `Transfer did not settle as SEPA Instant and could not be confirmed cancelled (status: ${observedStatus}). Fiat may still settle - manual reconciliation required.`,
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      log.error(
        { intentId, error: errorMessage },
        "Transfer execution failed"
      );

      // Handle specific Qonto errors
      if (error instanceof QontoApiError) {
        return {
          success: false,
          transferId: "",
          fiatSent: 0n,
          error: `Qonto API error: ${error.errorCode || error.statusCode} - ${error.details || error.message}`,
        };
      }

      return {
        success: false,
        transferId: "",
        fiatSent: 0n,
        error: errorMessage,
      };
    }
  }

  // ============ Transfer Status ============

  async getTransferStatus(transferId: string): Promise<TransferStatus> {
    try {
      const response = await this.client.getTransfer(transferId);
      return this.mapQontoStatus(response.transfer.status);
    } catch (error) {
      log.error({ transferId, error }, "Failed to get transfer status");
      throw error;
    }
  }

  // ============ Balance ============

  async getBalance(currency: Currency): Promise<number> {
    if (currency !== Currency.EUR) {
      throw new Error(`Qonto only supports EUR, got ${this.getCurrencyName(currency)}`);
    }

    try {
      const response = await this.client.getBankAccount(this.config.bankAccountId);
      const balanceEur = response.bank_account.balance;
      
      log.debug({ balanceEur }, "Retrieved balance");
      
      return balanceEur;
    } catch (error) {
      log.error({ error }, "Failed to get balance");
      throw error;
    }
  }

  // ============ Health Check ============

  async healthCheck(): Promise<boolean> {
    try {
      // Check API connectivity
      const apiHealthy = await this.client.healthCheck();
      if (!apiHealthy) {
        return false;
      }

      // Check bank account exists and is active
      const account = await this.client.getBankAccount(this.config.bankAccountId);
      if (account.bank_account.status !== "active") {
        log.warn({ status: account.bank_account.status }, "Bank account not active");
        return false;
      }

      // Check we have sufficient balance (at least €100)
      if (account.bank_account.balance < 100) {
        log.warn({ balance: account.bank_account.balance }, "Low balance warning");
        // Don't fail health check for low balance, just warn
      }

      return true;
    } catch (error) {
      log.error({ error }, "Health check failed");
      return false;
    }
  }

  // ============ Private Helpers ============

  // Cache for exchange rate to avoid hitting API too frequently
  private cachedRate: { rate: number; timestamp: number } | null = null;
  private static readonly RATE_CACHE_TTL_MS = 60_000; // 1 minute cache

  /**
   * Get current USDC/EUR exchange rate from CoinGecko
   * Falls back to cached rate or default if API fails
   */
  private async getUsdcEurRate(): Promise<number> {
    // If a fixed rate is configured, use it
    if (this.config.usdcEurRate) {
      return this.config.usdcEurRate;
    }

    // Check cache first
    if (this.cachedRate && Date.now() - this.cachedRate.timestamp < QontoProvider.RATE_CACHE_TTL_MS) {
      log.debug({ rate: this.cachedRate.rate, cached: true }, "Using cached USDC/EUR rate");
      return this.cachedRate.rate;
    }

    try {
      // Fetch from CoinGecko free API (no API key required)
      // Gets USDC price in EUR
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=eur",
        { 
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(5000), // 5 second timeout
        }
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json() as { "usd-coin"?: { eur?: number } };
      const rate = data["usd-coin"]?.eur;

      if (!rate || typeof rate !== "number") {
        throw new Error("Invalid rate data from CoinGecko");
      }

      // Cache the rate
      this.cachedRate = { rate, timestamp: Date.now() };
      
      log.info({ rate, source: "coingecko" }, "Fetched live USDC/EUR rate");
      return rate;
    } catch (error) {
      log.warn({ error }, "Failed to fetch live rate, using fallback");
      
      // Use cached rate if available (even if stale)
      if (this.cachedRate) {
        log.debug({ rate: this.cachedRate.rate, stale: true }, "Using stale cached rate");
        return this.cachedRate.rate;
      }
      
      // Last resort: hardcoded fallback
      const fallbackRate = 0.92;
      log.debug({ rate: fallbackRate, fallback: true }, "Using fallback USDC/EUR rate");
      return fallbackRate;
    }
  }

  /**
   * Determine if we should proceed based on VoP result
   */
  private shouldProceedWithVop(matchResult: VopMatchResult): boolean {
    switch (matchResult) {
      case "MATCH_RESULT_MATCH":
        // Perfect match - proceed
        return true;
      
      case "MATCH_RESULT_CLOSE_MATCH":
        // Close match - proceed with caution
        // In a real system, you might want human review
        log.warn("VoP returned close match - proceeding with caution");
        return true;
      
      case "MATCH_RESULT_NO_MATCH":
        // No match - high risk of misdirected payment
        log.error("VoP returned no match - aborting transfer");
        return false;
      
      case "MATCH_RESULT_NOT_POSSIBLE":
        // Verification not possible - proceed with caution
        log.warn("VoP verification not possible - proceeding");
        return true;
      
      default:
        log.error({ matchResult }, "Unknown VoP result");
        return false;
    }
  }

  /**
   * Wait for a transfer to reach a terminal state
   */
  private async waitForTransferCompletion(
    transferId: string
  ): Promise<QontoTransferStatus> {
    const startTime = Date.now();
    const maxWait = this.config.maxTransferWaitMs;
    const pollInterval = this.config.statusPollIntervalMs;

    while (Date.now() - startTime < maxWait) {
      const response = await this.client.getTransfer(transferId);
      const status = response.transfer.status;

      log.debug({ transferId, status }, "Polling transfer status");

      // Terminal states
      if (status === "settled" || status === "declined" || status === "canceled") {
        return status;
      }

      // Still processing - wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - return current status
    const finalResponse = await this.client.getTransfer(transferId);
    return finalResponse.transfer.status;
  }

  /**
   * Map Qonto transfer status to our internal status
   */
  private mapQontoStatus(qontoStatus: QontoTransferStatus): TransferStatus {
    switch (qontoStatus) {
      case "pending":
        return "pending";
      case "processing":
        return "processing";
      case "settled":
        return "completed";
      case "declined":
        return "failed";
      case "canceled":
        return "cancelled";
      default:
        return "pending";
    }
  }
}

// ============ Token Persistence ============

/**
 * Persist refreshed OAuth tokens to .env file
 * This ensures tokens survive solver restarts
 */
function persistTokensToEnv(accessToken: string, refreshToken: string, useSandbox: boolean = false): void {
  try {
    // Persist back to whichever env file we actually loaded (ENV_FILE), so a
    // refreshed rotating token survives restarts. Falls back to the old
    // sandbox->.env.testnet / prod->.env mapping when ENV_FILE is unset.
    const envFileName = process.env.ENV_FILE || (useSandbox ? ".env.testnet" : ".env");
    // ENV_FILE may be ABSOLUTE — e.g. the Docker bind-mount /app/solver.env. The old
    // path.join(cwd, envFileName) mangled an absolute path (/app + /app/solver.env ->
    // /app/app/solver.env), so the file was never found and rotated Qonto tokens silently
    // failed to persist ("Could not find .env file to persist tokens") — which broke Qonto
    // auth on the next container restart (it reloaded a long-consumed refresh token →
    // invalid_grant). Honor an absolute path as-is; only fall back to the solver/ subdir for
    // a RELATIVE name (local dev run from the repo root).
    let envPath = path.isAbsolute(envFileName)
      ? envFileName
      : path.join(process.cwd(), envFileName);
    if (!fs.existsSync(envPath) && !path.isAbsolute(envFileName)) {
      envPath = path.join(process.cwd(), "solver", envFileName);
    }
    if (!fs.existsSync(envPath)) {
      log.warn({ envFileName, envPath }, "Could not find .env file to persist tokens");
      return;
    }

    let envContent = fs.readFileSync(envPath, "utf-8");

    // Update or add QONTO_ACCESS_TOKEN
    if (envContent.includes("QONTO_ACCESS_TOKEN=")) {
      envContent = envContent.replace(
        /^QONTO_ACCESS_TOKEN=.*/m,
        `QONTO_ACCESS_TOKEN=${accessToken}`
      );
    } else {
      envContent += `\nQONTO_ACCESS_TOKEN=${accessToken}`;
    }

    // Update or add QONTO_REFRESH_TOKEN
    if (envContent.includes("QONTO_REFRESH_TOKEN=")) {
      envContent = envContent.replace(
        /^QONTO_REFRESH_TOKEN=.*/m,
        `QONTO_REFRESH_TOKEN=${refreshToken}`
      );
    } else {
      envContent += `\nQONTO_REFRESH_TOKEN=${refreshToken}`;
    }

    fs.writeFileSync(envPath, envContent);
    log.info({ envPath }, "✅ OAuth tokens persisted to .env file");
  } catch (error) {
    log.error({ error }, "Failed to persist tokens to .env file");
    // Still log the tokens so user can manually update
    console.log("\n" + "=".repeat(60));
    console.log("🔑 NEW TOKENS - Manual update required:");
    console.log("=".repeat(60));
    console.log(`QONTO_ACCESS_TOKEN=${accessToken}`);
    console.log(`QONTO_REFRESH_TOKEN=${refreshToken}`);
    console.log("=".repeat(60) + "\n");
  }
}

// ============ Factory Function ============

export interface QontoEnvConfig {
  // Auth method: 'api_key' or 'oauth' (oauth recommended for transfers)
  QONTO_AUTH_METHOD?: 'api_key' | 'oauth';
  // API Key auth
  QONTO_API_KEY_LOGIN?: string;
  QONTO_API_KEY_SECRET?: string;
  // OAuth auth (recommended for transfers)
  QONTO_ACCESS_TOKEN?: string;
  QONTO_REFRESH_TOKEN?: string;
  QONTO_CLIENT_ID?: string;
  QONTO_CLIENT_SECRET?: string;
  // Common
  QONTO_BANK_ACCOUNT_ID: string;
  QONTO_USE_SANDBOX?: string;
  QONTO_STAGING_TOKEN?: string;
  QONTO_FEE_BPS?: string;
  QONTO_USDC_EUR_RATE?: string;
  QONTO_QUOTE_VALIDITY_SECS?: string;
  QONTO_MAX_RETRIES?: string;
  QONTO_STATUS_POLL_INTERVAL_MS?: string;
  QONTO_MAX_TRANSFER_WAIT_MS?: string;
}

/**
 * Create a QontoProvider from environment variables
 * Supports both API Key and OAuth authentication
 */
export function createQontoProvider(
  env: QontoEnvConfig,
  solverAddress: string
): QontoProvider {
  // Determine auth method
  const hasApiKey = env.QONTO_API_KEY_LOGIN && env.QONTO_API_KEY_SECRET;
  const hasOAuth = env.QONTO_ACCESS_TOKEN;
  const explicitAuthMethod = env.QONTO_AUTH_METHOD;

  if (!hasApiKey && !hasOAuth) {
    throw new Error("Either QONTO_API_KEY_LOGIN + QONTO_API_KEY_SECRET or QONTO_ACCESS_TOKEN is required");
  }
  if (!env.QONTO_BANK_ACCOUNT_ID) {
    throw new Error("QONTO_BANK_ACCOUNT_ID is required");
  }

  // Use explicit auth method if set, otherwise auto-detect (prefer OAuth for transfers)
  let authMethod: 'api_key' | 'oauth';
  if (explicitAuthMethod) {
    authMethod = explicitAuthMethod;
  } else {
    authMethod = hasOAuth ? 'oauth' : 'api_key';
  }

  // Set up token refresh callback to persist new tokens
  const isSandbox = env.QONTO_USE_SANDBOX === "true";
  const onTokenRefresh = (accessToken: string, refreshToken: string) => {
    // Update environment variables in memory
    process.env.QONTO_ACCESS_TOKEN = accessToken;
    process.env.QONTO_REFRESH_TOKEN = refreshToken;

    log.info(
      {
        accessTokenPrefix: accessToken.substring(0, 20) + "...",
        refreshTokenPrefix: refreshToken.substring(0, 20) + "...",
      },
      "🔄 Tokens refreshed"
    );

    // Persist to correct .env file (.env.testnet for sandbox)
    persistTokensToEnv(accessToken, refreshToken, isSandbox);
  };

  const config: QontoProviderConfig = {
    authMethod,
    apiKeyLogin: env.QONTO_API_KEY_LOGIN,
    apiKeySecret: env.QONTO_API_KEY_SECRET,
    accessToken: env.QONTO_ACCESS_TOKEN,
    refreshToken: env.QONTO_REFRESH_TOKEN,
    clientId: env.QONTO_CLIENT_ID,
    clientSecret: env.QONTO_CLIENT_SECRET,
    onTokenRefresh: (env.QONTO_REFRESH_TOKEN && env.QONTO_CLIENT_ID && env.QONTO_CLIENT_SECRET) 
      ? onTokenRefresh 
      : undefined,
    bankAccountId: env.QONTO_BANK_ACCOUNT_ID,
    useSandbox: env.QONTO_USE_SANDBOX === "true",
    stagingToken: env.QONTO_STAGING_TOKEN,
    feeBps: env.QONTO_FEE_BPS ? parseInt(env.QONTO_FEE_BPS, 10) : 50,
    usdcEurRate: env.QONTO_USDC_EUR_RATE ? parseFloat(env.QONTO_USDC_EUR_RATE) : undefined,
    quoteValiditySecs: env.QONTO_QUOTE_VALIDITY_SECS 
      ? parseInt(env.QONTO_QUOTE_VALIDITY_SECS, 10) 
      : 300,
    maxRetries: env.QONTO_MAX_RETRIES 
      ? parseInt(env.QONTO_MAX_RETRIES, 10) 
      : 3,
    statusPollIntervalMs: env.QONTO_STATUS_POLL_INTERVAL_MS 
      ? parseInt(env.QONTO_STATUS_POLL_INTERVAL_MS, 10) 
      : 2000,
    maxTransferWaitMs: env.QONTO_MAX_TRANSFER_WAIT_MS 
      ? parseInt(env.QONTO_MAX_TRANSFER_WAIT_MS, 10) 
      : 120000,
  };

  const hasAutoRefresh = !!(env.QONTO_REFRESH_TOKEN && env.QONTO_CLIENT_ID && env.QONTO_CLIENT_SECRET);
  log.info({ 
    authMethod: config.authMethod,
    autoTokenRefresh: hasAutoRefresh,
  }, "Creating Qonto provider");
  
  if (!hasAutoRefresh && authMethod === 'oauth') {
    log.warn("OAuth without auto-refresh: tokens will expire after ~1 hour. Add QONTO_REFRESH_TOKEN, QONTO_CLIENT_ID, and QONTO_CLIENT_SECRET for automatic refresh.");
  }

  return new QontoProvider(config, solverAddress);
}
