import { createLogger } from "./logger.js";

const log = createLogger("retry");

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable based on its message
 */
function isRetryableError(error: unknown, retryablePatterns?: string[]): boolean {
  const message = error instanceof Error ? error.message : String(error);
  
  // Default retryable patterns (network issues, rate limits, etc.)
  const defaultPatterns = [
    "timeout",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "socket hang up",
    "network",
    "rate limit",
    "429",
    "503",
    "502",
    "504",
    "temporarily unavailable",
    "try again",
  ];

  const patterns = [...defaultPatterns, ...(retryablePatterns || [])];
  
  return patterns.some((pattern) => 
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context?: string
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = isRetryableError(error, opts.retryableErrors);
      
      if (attempt === opts.maxAttempts || !isRetryable) {
        log.error(
          { 
            error: errorMessage, 
            attempt, 
            maxAttempts: opts.maxAttempts,
            context,
            isRetryable,
          },
          "Operation failed (no more retries)"
        );
        throw error;
      }

      log.warn(
        {
          error: errorMessage,
          attempt,
          maxAttempts: opts.maxAttempts,
          nextRetryMs: delay,
          context,
        },
        "Operation failed, retrying..."
      );

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultOptions: Partial<RetryOptions> = {}) {
  return <T>(fn: () => Promise<T>, options?: Partial<RetryOptions>, context?: string) =>
    withRetry(fn, { ...defaultOptions, ...options }, context);
}

/**
 * Retry wrapper specifically for chain operations
 */
export const chainRetry = createRetryWrapper({
  maxAttempts: 5,
  initialDelayMs: 2000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  retryableErrors: [
    "nonce",
    "replacement transaction underpriced",
    "transaction underpriced",
    "already known",
    "insufficient funds",
  ],
});

/**
 * Retry wrapper specifically for API operations
 */
export const apiRetry = createRetryWrapper({
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
});




