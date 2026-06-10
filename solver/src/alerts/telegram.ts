/**
 * Telegram Alert Client
 *
 * Sends alerts to a Telegram channel using the Bot API.
 * Uses native HTTPS - no external dependencies required.
 */

import https from "https";
import { createLogger } from "../utils/logger.js";
import type { ClassifiedError, ErrorStage } from "../types/errors.js";

const log = createLogger("telegram");

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

export interface TelegramClient {
  sendIntentAlert: (params: IntentAlertParams) => Promise<void>;
  sendIntentSuccess: (params: IntentSuccessParams) => Promise<void>;
  sendSystemAlert: (params: SystemAlertParams) => Promise<void>;
  sendTestAlert: () => Promise<void>;
}

export interface IntentAlertParams {
  intentId: string;
  stage: ErrorStage;
  error: ClassifiedError;
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

export interface SystemAlertParams {
  type: "witness_unauthorized" | "provider_degraded" | "solver_unhealthy" | "max_retries_exceeded";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Create a Telegram client from environment variables
 */
export function createTelegramClient(): TelegramClient {
  const config: TelegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    enabled: process.env.TELEGRAM_ALERTS_ENABLED !== "false",
  };

  if (!config.botToken || !config.chatId) {
    log.warn("Telegram alerts disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    return createNoopClient();
  }

  if (!config.enabled) {
    log.info("Telegram alerts disabled via TELEGRAM_ALERTS_ENABLED=false");
    return createNoopClient();
  }

  log.info({ chatId: config.chatId }, "Telegram alerts enabled");
  return createActiveClient(config);
}

/**
 * Create a no-op client when Telegram is not configured
 */
function createNoopClient(): TelegramClient {
  return {
    sendIntentAlert: async () => {},
    sendIntentSuccess: async () => {},
    sendSystemAlert: async () => {},
    sendTestAlert: async () => {
      log.warn("Test alert skipped: Telegram not configured");
    },
  };
}

/**
 * Create an active Telegram client
 */
function createActiveClient(config: TelegramConfig): TelegramClient {
  const sendMessage = async (text: string, parseMode: "MarkdownV2" | "HTML" = "HTML"): Promise<void> => {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

    const body = JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              log.debug("Telegram alert sent successfully");
              resolve();
            } else {
              log.error({ statusCode: res.statusCode, response: data }, "Telegram API error");
              reject(new Error(`Telegram API error: ${res.statusCode}`));
            }
          });
        }
      );

      req.on("error", (err) => {
        log.error({ error: err.message }, "Failed to send Telegram alert");
        reject(err);
      });

      req.write(body);
      req.end();
    });
  };

  return {
    sendIntentAlert: async (params: IntentAlertParams): Promise<void> => {
      const { intentId, stage, error, retryCount, maxRetries, transferId } = params;
      const shortId = `${intentId.slice(0, 10)}...${intentId.slice(-6)}`;

      const severityEmoji = {
        warning: "⚠️",
        error: "🚨",
        critical: "🔴",
      }[error.severity];

      const stageLabel = {
        quoting: "Quoting",
        fiat_transfer: "Fiat Transfer",
        proof_generation: "Proof Generation",
        attestation: "Attestation",
        on_chain_fulfillment: "On-Chain Fulfillment",
        retry: "Retry",
        unknown: "Unknown",
      }[stage];

      let message = `${severityEmoji} <b>INTENT FAILED</b>\n\n`;
      message += `<b>Intent:</b> <code>${shortId}</code>\n`;
      message += `<b>Stage:</b> ${stageLabel}\n`;
      message += `<b>Category:</b> ${error.category.toUpperCase()}\n`;

      if (error.code) {
        message += `<b>Error:</b> ${error.message} (${error.code})\n`;
      } else {
        message += `<b>Error:</b> ${escapeHtml(error.message)}\n`;
      }

      if (retryCount !== undefined && maxRetries !== undefined) {
        message += `<b>Retry:</b> ${retryCount}/${maxRetries}\n`;
      }

      if (transferId) {
        message += `<b>Transfer ID:</b> <code>${transferId}</code>\n`;
      }

      message += `\n<b>Debug:</b> <code>npm run debug ${intentId}</code>`;

      try {
        await sendMessage(message);
      } catch (err) {
        // Don't throw - alerting failure shouldn't block the main flow
        log.error({ intentId, error: err }, "Failed to send intent alert");
      }
    },

    sendIntentSuccess: async (params: IntentSuccessParams): Promise<void> => {
      const { intentId, usdcAmount, fiatAmount, currency, transferId, txHash } = params;
      const shortId = `${intentId.slice(0, 10)}...${intentId.slice(-6)}`;
      const shortTxHash = `${txHash.slice(0, 10)}...${txHash.slice(-6)}`;

      const usdcFormatted = (Number(usdcAmount) / 1_000_000).toFixed(2);
      const fiatFormatted = (Number(fiatAmount) / 100).toFixed(2);

      let message = `✅ <b>INTENT FULFILLED</b>\n\n`;
      message += `<b>Intent:</b> <code>${shortId}</code>\n`;
      message += `<b>Amount:</b> ${usdcFormatted} USDC → ${fiatFormatted} ${currency}\n`;
      message += `<b>Transfer ID:</b> <code>${transferId}</code>\n`;
      message += `<b>TX:</b> <a href="https://basescan.org/tx/${txHash}">${shortTxHash}</a>`;

      try {
        await sendMessage(message);
      } catch (err) {
        log.error({ intentId, error: err }, "Failed to send success alert");
      }
    },

    sendSystemAlert: async (params: SystemAlertParams): Promise<void> => {
      const { type, message: alertMessage, details } = params;

      const typeConfig = {
        witness_unauthorized: { emoji: "🔴", title: "WITNESS UNAUTHORIZED" },
        provider_degraded: { emoji: "⚠️", title: "PROVIDER DEGRADED" },
        solver_unhealthy: { emoji: "🔴", title: "SOLVER UNHEALTHY" },
        max_retries_exceeded: { emoji: "🚨", title: "MAX RETRIES EXCEEDED" },
      }[type];

      let message = `${typeConfig.emoji} <b>${typeConfig.title}</b>\n\n`;
      message += `${escapeHtml(alertMessage)}\n`;

      if (details) {
        message += "\n<b>Details:</b>\n";
        for (const [key, value] of Object.entries(details)) {
          message += `  ${key}: ${escapeHtml(String(value))}\n`;
        }
      }

      try {
        await sendMessage(message);
      } catch (err) {
        log.error({ type, error: err }, "Failed to send system alert");
      }
    },

    sendTestAlert: async (): Promise<void> => {
      const message = `✅ <b>TEST ALERT</b>\n\nFreeFlo solver alerts are working!\n\nTimestamp: ${new Date().toISOString()}`;

      try {
        await sendMessage(message);
        log.info("Test alert sent successfully");
      } catch (err) {
        log.error({ error: err }, "Failed to send test alert");
        throw err;
      }
    },
  };
}

/**
 * Escape HTML special characters for Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
