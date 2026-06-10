/**
 * Alert Service
 *
 * Central orchestration for all alerting functionality.
 * Provides a simple interface for the solver to report errors.
 */

import { createLogger } from "../utils/logger.js";
import {
  classifyError,
  shouldAlert,
  formatErrorForLog,
  type ClassifiedError,
  type ErrorStage,
} from "../types/errors.js";
import {
  createTelegramClient,
  type TelegramClient,
  type SystemAlertParams,
} from "./telegram.js";

const log = createLogger("alerts");

export interface AlertService {
  /**
   * Report an intent error. Will classify and alert if appropriate.
   */
  reportIntentError: (params: IntentErrorParams) => Promise<void>;

  /**
   * Report a successful intent fulfillment.
   */
  reportIntentSuccess: (params: IntentSuccessParams) => Promise<void>;

  /**
   * Report a system-level error (witness auth, provider health, etc.)
   */
  reportSystemError: (params: SystemAlertParams) => Promise<void>;

  /**
   * Send a test alert to verify configuration
   */
  sendTestAlert: () => Promise<void>;

  /**
   * Get the Telegram client for direct access
   */
  getTelegramClient: () => TelegramClient;
}

export interface IntentErrorParams {
  intentId: string;
  error: string | Error;
  stage: ErrorStage;
  retryCount?: number;
  maxRetries?: number;
  transferId?: string | null;
}

export interface IntentSuccessParams {
  intentId: string;
  usdcAmount: string;
  fiatAmount: string;
  currency: string;
  transferId: string;
  txHash: string;
}

// Singleton alert service
let alertService: AlertService | null = null;

/**
 * Initialize the alert service (call once at startup)
 */
export function initAlertService(): AlertService {
  if (alertService) {
    return alertService;
  }

  const telegram = createTelegramClient();

  // Track recent alerts to avoid spam (per intent)
  const recentAlerts = new Map<string, number>();
  const ALERT_COOLDOWN_MS = 60_000; // 1 minute cooldown per intent

  alertService = {
    reportIntentError: async (params: IntentErrorParams): Promise<void> => {
      const { intentId, error, stage, retryCount, maxRetries, transferId } = params;

      // Classify the error
      const errorMessage = error instanceof Error ? error.message : error;
      const classified = classifyError(errorMessage, stage);

      // Log the classified error
      log.error(
        {
          intentId,
          ...formatErrorForLog(classified),
          retryCount,
          transferId,
        },
        `Intent error: ${classified.message}`
      );

      // Check if we should alert
      if (!shouldAlert(classified)) {
        log.debug({ intentId }, "Error does not require alert");
        return;
      }

      // Check cooldown to avoid spam
      const lastAlert = recentAlerts.get(intentId);
      const now = Date.now();
      if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
        log.debug({ intentId }, "Alert cooldown active, skipping");
        return;
      }

      // Send alert
      recentAlerts.set(intentId, now);

      await telegram.sendIntentAlert({
        intentId,
        stage,
        error: classified,
        retryCount,
        maxRetries,
        transferId,
      });

      // Cleanup old cooldown entries
      for (const [id, time] of recentAlerts.entries()) {
        if (now - time > ALERT_COOLDOWN_MS * 5) {
          recentAlerts.delete(id);
        }
      }
    },

    reportIntentSuccess: async (params: IntentSuccessParams): Promise<void> => {
      log.info(
        {
          intentId: params.intentId,
          usdcAmount: params.usdcAmount,
          fiatAmount: params.fiatAmount,
          currency: params.currency,
          txHash: params.txHash,
        },
        "Intent fulfilled successfully"
      );
      await telegram.sendIntentSuccess(params);
    },

    reportSystemError: async (params: SystemAlertParams): Promise<void> => {
      log.error({ type: params.type, details: params.details }, params.message);
      await telegram.sendSystemAlert(params);
    },

    sendTestAlert: async (): Promise<void> => {
      await telegram.sendTestAlert();
    },

    getTelegramClient: () => telegram,
  };

  return alertService;
}

/**
 * Get the alert service (must call initAlertService first)
 */
export function getAlertService(): AlertService {
  if (!alertService) {
    throw new Error("Alert service not initialized. Call initAlertService() first.");
  }
  return alertService;
}

// Re-export types for convenience
export type { TelegramClient, SystemAlertParams } from "./telegram.js";
export type { ClassifiedError, ErrorStage, ErrorCategory, ErrorSeverity } from "../types/errors.js";
