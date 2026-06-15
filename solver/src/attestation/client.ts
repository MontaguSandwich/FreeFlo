/**
 * Attestation Service Client
 * 
 * Communicates with the attestation service to get EIP-712 signed proofs
 * for verified TLSNotary presentations.
 */

import { createLogger } from "../utils/logger.js";
import { attestationDurationSeconds } from "../metrics.js";

const log = createLogger("attestation-client");

/** The user's signed Mandate (snake_case = the attestation service's wire schema). */
export interface CompactMandatePayload {
  receiving_info: string;
  recipient_name: string;
  min_eur_amount: number;
  currency: number;
  expiry: number;
}

/** TIER-1 sign-once binding. When present, the service binds the proven IBAN to the mandate and
 * signs `intentHash = keccak(claimHash, filler)` instead of an OffRampV3 intent id. */
export interface CompactBindingPayload {
  sponsor: string;
  nonce: string; // uint256 (decimal or 0x-hex)
  expires: number;
  id: string; // uint256 resource-lock id
  allocated_amount: string; // uint256 USDC (6dp)
  filler: string;
  mandate: CompactMandatePayload;
}

export interface AttestationRequest {
  /** Base64-encoded TLSNotary presentation of the transfer (status + amount) */
  presentation: string;
  /** Base64-encoded TLSNotary presentation of the beneficiary (recipient IBAN) */
  beneficiaryPresentation: string;
  /** Intent hash this payment is for (ignored for the Compact flow — see `compact`) */
  intentHash: string;
  /** Expected amount in cents (for validation) */
  expectedAmountCents: number;
  /** Expected beneficiary IBAN (for validation) */
  expectedBeneficiaryIban: string;
  /** TIER-1 sign-once binding (optional). */
  compact?: CompactBindingPayload;
}

export interface PaymentDetails {
  transactionId: string | null;
  amountCents: number;
  beneficiaryIban: string;
  timestamp: number;
  server: string;
}

export interface AttestationResponse {
  success: boolean;
  /** EIP-712 signature (hex string with 0x prefix) */
  signature: string;
  /** The digest that was signed (hex string with 0x prefix) */
  digest: string;
  /** Hash of the attestation data (hex string with 0x prefix) */
  dataHash: string;
  /** Verified payment details */
  payment: PaymentDetails;
}

export interface AttestationError {
  error: string;
  code: number;
}

export interface HealthResponse {
  status: string;
  witnessAddress: string;
  chainId: number;
}

export interface AttestationClientConfig {
  /** Base URL of the attestation service */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** API key for authentication (optional, required if attestation service has auth enabled) */
  apiKey?: string;
}

/**
 * Client for the Attestation Service
 */
export class AttestationClient {
  private baseUrl: string;
  private timeout: number;
  private apiKey?: string;

  constructor(config: AttestationClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeout = config.timeout ?? 30000;
    this.apiKey = config.apiKey;
  }

  /**
   * Check if the attestation service is healthy
   */
  async healthCheck(): Promise<HealthResponse> {
    const response = await this.fetch("/api/v1/health", {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    return {
      status: data.status as string,
      witnessAddress: data.witness_address as string,
      chainId: data.chain_id as number,
    };
  }

  /**
   * Request an attestation for a TLSNotary presentation
   */
  async attest(request: AttestationRequest): Promise<AttestationResponse> {
    log.info(
      {
        intentHash: request.intentHash,
        expectedAmount: request.expectedAmountCents,
      },
      "Requesting attestation"
    );

    const startTime = Date.now();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-Solver-API-Key"] = this.apiKey;
    }

    const response = await this.fetch("/api/v1/attest", {
      method: "POST",
      headers,
      body: JSON.stringify({
        presentation: request.presentation,
        beneficiary_presentation: request.beneficiaryPresentation,
        intent_hash: request.intentHash,
        expected_amount_cents: request.expectedAmountCents,
        expected_beneficiary_iban: request.expectedBeneficiaryIban,
        ...(request.compact ? { compact: request.compact } : {}),
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    const durationSeconds = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const error = data as AttestationError;
      log.error(
        { intentHash: request.intentHash, error: error.error, code: error.code },
        "Attestation request failed"
      );
      attestationDurationSeconds.observe({ status: "error" }, durationSeconds);
      throw new Error(`Attestation failed: ${error.error}`);
    }

    const attestation: AttestationResponse = {
      success: data.success as boolean,
      signature: data.signature as string,
      digest: data.digest as string,
      dataHash: data.data_hash as string,
      payment: {
        transactionId: data.payment.transaction_id as string | null,
        amountCents: data.payment.amount_cents as number,
        beneficiaryIban: data.payment.beneficiary_iban as string,
        timestamp: data.payment.timestamp as number,
        server: data.payment.server as string,
      },
    };

    attestationDurationSeconds.observe({ status: "success" }, durationSeconds);

    log.info(
      {
        intentHash: request.intentHash,
        transactionId: attestation.payment.transactionId,
        amountCents: attestation.payment.amountCents,
      },
      "Attestation received"
    );

    return attestation;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create an attestation client from configuration
 */
export function createAttestationClient(baseUrl: string, apiKey?: string): AttestationClient {
  return new AttestationClient({ baseUrl, apiKey });
}

