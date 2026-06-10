/**
 * Error Classification for Intent Lifecycle
 *
 * Provides structured error types with severity and category
 * for alerting and debugging purposes.
 */

// ============ Error Categories ============

export enum ErrorCategory {
  NETWORK = "network",           // Transient network issues, auto-retry
  PROVIDER = "provider",         // Qonto/payment provider issues
  ATTESTATION = "attestation",   // TLSNotary/signature issues
  CHAIN = "chain",               // On-chain reverts
  TIMEOUT = "timeout",           // Operation timeouts
  INTERNAL = "internal",         // Solver bugs/unexpected errors
}

export enum ErrorSeverity {
  WARNING = "warning",   // Logged, may self-resolve
  ERROR = "error",       // Needs attention
  CRITICAL = "critical", // Immediate action required
}

// ============ Classified Error ============

export interface ClassifiedError {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;           // Error selector or code (e.g., "0x41110897")
  stage?: ErrorStage;      // Where in the lifecycle the error occurred
  retryable: boolean;
  suggestedActions: string[];
}

export type ErrorStage =
  | "quoting"
  | "fiat_transfer"
  | "proof_generation"
  | "attestation"
  | "on_chain_fulfillment"
  | "retry"
  | "unknown";

// ============ Known Error Codes ============

interface KnownError {
  pattern: RegExp | string;
  code?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  message: string;
  suggestedActions: string[];
}

const KNOWN_ERRORS: KnownError[] = [
  // Reconciliation - fiat may have settled despite a reported failure.
  // Highest-priority operational case: money may have moved with no on-chain
  // claim. Matched first so it is always surfaced as CRITICAL.
  {
    pattern: /manual reconciliation required|reconcile/i,
    category: ErrorCategory.PROVIDER,
    severity: ErrorSeverity.CRITICAL,
    retryable: true,
    message: "Fiat transfer outcome unknown - manual reconciliation required",
    suggestedActions: [
      "Check the transfer status in Qonto for the reported transfer id",
      "If the fiat settled at the recipient, complete fulfillment to claim the USDC",
      "If it did not settle, no funds are at risk - the intent can stay failed",
      "Confirm no duplicate transfer was sent for this intent",
    ],
  },

  // On-chain errors
  {
    pattern: /0x41110897|NotAuthorizedWitness/i,
    code: "0x41110897",
    category: ErrorCategory.ATTESTATION,
    severity: ErrorSeverity.CRITICAL,
    retryable: false,
    message: "Witness not authorized on PaymentVerifier",
    suggestedActions: [
      "Check witness authorization: cast call <verifier> 'authorizedWitnesses(address)' <witness>",
      "Verify EIP-712 domain matches between attestation service and contract",
      "Check attestation service logs for signing errors",
    ],
  },
  {
    pattern: /0x88366b0a|QuoteWindowClosed/i,
    code: "0x88366b0a",
    category: ErrorCategory.CHAIN,
    severity: ErrorSeverity.WARNING,
    retryable: false,
    message: "Quote window expired (5 min timeout)",
    suggestedActions: [
      "Intent expired - no action needed",
      "Consider faster proof generation to avoid timeouts",
    ],
  },
  {
    pattern: /0xcad2ae02|NullifierAlreadyUsed/i,
    code: "0xcad2ae02",
    category: ErrorCategory.CHAIN,
    severity: ErrorSeverity.ERROR,
    retryable: false,
    message: "Payment ID (nullifier) already used",
    suggestedActions: [
      "This transfer was already claimed - check fulfillment_tx_hash in DB",
      "If duplicate intent, verify the fiat was only sent once",
    ],
  },
  {
    pattern: /0x[a-f0-9]{8}.*revert/i,
    code: undefined,
    category: ErrorCategory.CHAIN,
    severity: ErrorSeverity.ERROR,
    retryable: false,
    message: "Contract reverted with unknown error",
    suggestedActions: [
      "Check transaction on basescan for revert reason",
      "Use: cast call --trace <tx_hash> to debug",
    ],
  },

  // Network errors
  {
    pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.WARNING,
    retryable: true,
    message: "Network connection failed",
    suggestedActions: [
      "Check network connectivity",
      "Verify service URLs in .env",
      "Will auto-retry",
    ],
  },
  {
    pattern: /rate.?limit|429|too.?many.?requests/i,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.WARNING,
    retryable: true,
    message: "Rate limited by external service",
    suggestedActions: [
      "Will auto-retry with backoff",
      "Consider reducing request frequency",
    ],
  },
  {
    pattern: /502|503|504|bad.?gateway|service.?unavailable/i,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.WARNING,
    retryable: true,
    message: "External service temporarily unavailable",
    suggestedActions: [
      "Will auto-retry",
      "Check service status pages",
    ],
  },

  // Provider errors
  {
    pattern: /insufficient.?funds|balance/i,
    category: ErrorCategory.PROVIDER,
    severity: ErrorSeverity.CRITICAL,
    retryable: false,
    message: "Insufficient balance for fiat transfer",
    suggestedActions: [
      "Check Qonto account balance",
      "Top up account before retrying",
    ],
  },
  {
    pattern: /invalid.?iban|iban.*invalid/i,
    category: ErrorCategory.PROVIDER,
    severity: ErrorSeverity.ERROR,
    retryable: false,
    message: "Invalid IBAN provided by user",
    suggestedActions: [
      "User provided invalid IBAN - cannot proceed",
      "Intent will fail permanently",
    ],
  },
  {
    pattern: /qonto|thirdparty.*staging|sandbox/i,
    category: ErrorCategory.PROVIDER,
    severity: ErrorSeverity.ERROR,
    retryable: true,
    message: "Qonto API error",
    suggestedActions: [
      "Check Qonto API status",
      "Verify OAuth tokens are valid",
      "Check X-Qonto-Staging-Token for sandbox",
    ],
  },

  // Attestation errors
  {
    pattern: /tlsnotary|proof.*generation|prover/i,
    category: ErrorCategory.ATTESTATION,
    severity: ErrorSeverity.WARNING,
    retryable: true,
    message: "TLSNotary proof generation failed",
    suggestedActions: [
      "Check prover service: curl http://127.0.0.1:8082/health",
      "View prover logs: pm2 logs qonto-prover",
      "Verify TLSN_EXAMPLES_PATH is correct",
    ],
  },
  {
    pattern: /attestation.*service|signature.*failed/i,
    category: ErrorCategory.ATTESTATION,
    severity: ErrorSeverity.ERROR,
    retryable: true,
    message: "Attestation service error",
    suggestedActions: [
      "Check attestation service: curl http://127.0.0.1:3030/health",
      "View attestation logs",
      "Verify witness key is configured",
    ],
  },

  // Timeout errors
  {
    pattern: /timeout|timed.?out|deadline/i,
    category: ErrorCategory.TIMEOUT,
    severity: ErrorSeverity.WARNING,
    retryable: true,
    message: "Operation timed out",
    suggestedActions: [
      "Check if external services are slow",
      "Will auto-retry",
      "Consider increasing PROVER_TIMEOUT if proof generation is slow",
    ],
  },
];

// ============ Error Classification Function ============

/**
 * Classify an error message into a structured error with category and severity
 */
export function classifyError(
  errorMessage: string,
  stage?: ErrorStage
): ClassifiedError {
  const normalizedMessage = errorMessage.toLowerCase();

  // Try to match against known errors
  for (const known of KNOWN_ERRORS) {
    const matches = typeof known.pattern === "string"
      ? normalizedMessage.includes(known.pattern.toLowerCase())
      : known.pattern.test(errorMessage);

    if (matches) {
      return {
        message: known.message,
        category: known.category,
        severity: known.severity,
        code: known.code,
        stage,
        retryable: known.retryable,
        suggestedActions: known.suggestedActions,
      };
    }
  }

  // Default: unknown internal error
  return {
    message: errorMessage.substring(0, 200), // Truncate long messages
    category: ErrorCategory.INTERNAL,
    severity: ErrorSeverity.ERROR,
    stage,
    retryable: false,
    suggestedActions: [
      "Check solver logs for full stack trace",
      "This may be a bug - investigate the error message",
    ],
  };
}

/**
 * Format error for logging
 */
export function formatErrorForLog(error: ClassifiedError): Record<string, unknown> {
  return {
    message: error.message,
    category: error.category,
    severity: error.severity,
    code: error.code,
    stage: error.stage,
    retryable: error.retryable,
  };
}

/**
 * Check if an error should trigger an immediate alert
 */
export function shouldAlert(error: ClassifiedError): boolean {
  // Always alert on critical errors
  if (error.severity === ErrorSeverity.CRITICAL) {
    return true;
  }

  // Alert on non-retryable errors
  if (!error.retryable && error.severity === ErrorSeverity.ERROR) {
    return true;
  }

  return false;
}

/**
 * Get the error stage from fulfillment step number
 */
export function getStageFromStep(step: number): ErrorStage {
  switch (step) {
    case 1:
      return "fiat_transfer";
    case 2:
      return "proof_generation";
    case 3:
      return "attestation";
    case 4:
      return "on_chain_fulfillment";
    default:
      return "unknown";
  }
}
