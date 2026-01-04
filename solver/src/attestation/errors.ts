/**
 * Structured error types for attestation service
 *
 * Provides actionable error messages with stage information and suggestions
 * to help operators quickly diagnose and fix attestation failures.
 */

/**
 * Stages of the attestation process where errors can occur
 */
export enum AttestationStage {
  /** Connecting to attestation service */
  CONNECTION = "CONNECTION",
  /** Submitting proof to service */
  PROOF_SUBMISSION = "PROOF_SUBMISSION",
  /** Verifying TLSNotary proof */
  VERIFICATION = "VERIFICATION",
  /** Signing EIP-712 attestation */
  SIGNING = "SIGNING",
}

/**
 * Enhanced error class for attestation failures
 * Includes stage, original error, and actionable suggestions
 */
export class AttestationServiceError extends Error {
  /** Stage of attestation where failure occurred */
  public readonly stage: AttestationStage;
  /** Original error message from service or network */
  public readonly originalError: string;
  /** Actionable suggestion for fixing the issue */
  public readonly suggestion: string;
  /** HTTP status code if available */
  public readonly httpCode?: number;
  /** Intent hash for correlation in logs */
  public readonly intentHash?: string;

  constructor(params: {
    stage: AttestationStage;
    originalError: string;
    suggestion: string;
    httpCode?: number;
    intentHash?: string;
  }) {
    const message = `Attestation failed at ${params.stage}: ${params.originalError}. Suggestion: ${params.suggestion}`;
    super(message);
    this.name = "AttestationServiceError";
    this.stage = params.stage;
    this.originalError = params.originalError;
    this.suggestion = params.suggestion;
    this.httpCode = params.httpCode;
    this.intentHash = params.intentHash;
  }

  /**
   * Returns a structured object for logging
   */
  toLogContext(): Record<string, unknown> {
    return {
      errorType: this.name,
      stage: this.stage,
      originalError: this.originalError,
      suggestion: this.suggestion,
      httpCode: this.httpCode,
      intentHash: this.intentHash,
    };
  }
}

/**
 * Error patterns and their actionable suggestions
 */
const ERROR_SUGGESTIONS: Array<{
  pattern: RegExp;
  stage: AttestationStage;
  suggestion: string;
}> = [
  // Connection errors
  {
    pattern: /ECONNREFUSED|connection refused/i,
    stage: AttestationStage.CONNECTION,
    suggestion: "Attestation service not running. Start with: docker compose up attestation-service",
  },
  {
    pattern: /ENOTFOUND|getaddrinfo|DNS/i,
    stage: AttestationStage.CONNECTION,
    suggestion: "Cannot resolve attestation service hostname. Check ATTESTATION_SERVICE_URL in .env",
  },
  {
    pattern: /ETIMEDOUT|timeout|aborted/i,
    stage: AttestationStage.CONNECTION,
    suggestion: "Request timed out. Check network connectivity and attestation service health",
  },
  {
    pattern: /ECONNRESET|socket hang up/i,
    stage: AttestationStage.CONNECTION,
    suggestion: "Connection reset by server. Attestation service may have crashed or restarted",
  },

  // Proof submission errors (400 Bad Request)
  {
    pattern: /Invalid presentation/i,
    stage: AttestationStage.PROOF_SUBMISSION,
    suggestion: "TLSNotary proof format invalid. Regenerate proof with the TLSNotary prover",
  },
  {
    pattern: /Deserialization error/i,
    stage: AttestationStage.PROOF_SUBMISSION,
    suggestion: "Proof data corrupted or malformed. Regenerate TLSNotary proof",
  },
  {
    pattern: /Missing required field/i,
    stage: AttestationStage.PROOF_SUBMISSION,
    suggestion: "Proof missing required data fields. Ensure proof includes all payment details",
  },

  // Verification errors
  {
    pattern: /Verification failed/i,
    stage: AttestationStage.VERIFICATION,
    suggestion: "TLSNotary proof verification failed. Proof may be expired or tampered",
  },
  {
    pattern: /Server not found|ServerNotFound/i,
    stage: AttestationStage.VERIFICATION,
    suggestion: "Server info not in proof. Ensure proof was captured from allowed banking API",
  },
  {
    pattern: /Unexpected server/i,
    stage: AttestationStage.VERIFICATION,
    suggestion: "Proof server mismatch. Check ALLOWED_SERVERS config includes the bank API domain",
  },
  {
    pattern: /Transcript not found|TranscriptNotFound/i,
    stage: AttestationStage.VERIFICATION,
    suggestion: "Proof missing transcript data. TLSNotary session may not have captured response",
  },
  {
    pattern: /Invalid payment data/i,
    stage: AttestationStage.VERIFICATION,
    suggestion: "Payment details in proof don't match expected values. Verify amount and IBAN",
  },

  // Signing errors (500 Internal Server Error)
  {
    pattern: /Signing error/i,
    stage: AttestationStage.SIGNING,
    suggestion: "EIP-712 signing failed. Check witness private key configuration",
  },
  {
    pattern: /0x41110897|NotAuthorizedWitness/i,
    stage: AttestationStage.SIGNING,
    suggestion: "Witness not authorized on-chain. Register witness address in PaymentVerifier contract",
  },

  // Generic errors
  {
    pattern: /Internal error/i,
    stage: AttestationStage.SIGNING,
    suggestion: "Internal attestation service error. Check service logs for details",
  },
];

/**
 * Maps raw error messages to structured AttestationServiceError
 * Classifies error by stage and provides actionable suggestions
 */
export function classifyAttestationError(
  rawError: string,
  httpCode?: number,
  intentHash?: string
): AttestationServiceError {
  // Match against known error patterns
  for (const { pattern, stage, suggestion } of ERROR_SUGGESTIONS) {
    if (pattern.test(rawError)) {
      return new AttestationServiceError({
        stage,
        originalError: rawError,
        suggestion,
        httpCode,
        intentHash,
      });
    }
  }

  // Fallback classification based on HTTP code
  let stage = AttestationStage.CONNECTION;
  let suggestion = "Unknown error. Check attestation service logs for details";

  if (httpCode) {
    if (httpCode === 400) {
      stage = AttestationStage.PROOF_SUBMISSION;
      suggestion = "Bad request. Check proof format and request payload";
    } else if (httpCode >= 500) {
      stage = AttestationStage.SIGNING;
      suggestion = "Server error. Check attestation service logs";
    }
  }

  return new AttestationServiceError({
    stage,
    originalError: rawError,
    suggestion,
    httpCode,
    intentHash,
  });
}

/**
 * Creates a connection error for network-level failures
 */
export function createConnectionError(
  error: Error,
  intentHash?: string
): AttestationServiceError {
  const rawError = error.message || String(error);

  // Check for known network error patterns
  const classified = classifyAttestationError(rawError, undefined, intentHash);

  // If not classified as connection, force it
  if (classified.stage !== AttestationStage.CONNECTION) {
    return new AttestationServiceError({
      stage: AttestationStage.CONNECTION,
      originalError: rawError,
      suggestion: "Network error connecting to attestation service. Check service availability",
      intentHash,
    });
  }

  return classified;
}
