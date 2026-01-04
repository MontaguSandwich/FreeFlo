/**
 * Attestation Service Client
 * 
 * Communicates with the attestation service to get EIP-712 signed proofs
 * for verified TLSNotary presentations.
 */

import { createLogger } from "../utils/logger.js";
import { attestationDurationSeconds } from "../metrics.js";
import {
  AttestationServiceError,
  AttestationStage,
  classifyAttestationError,
  createConnectionError,
} from "./errors.js";

const log = createLogger("attestation-client");

export interface AttestationRequest {
  /** Base64-encoded TLSNotary presentation */
  presentation: string;
  /** Intent hash this payment is for */
  intentHash: string;
  /** Expected amount in cents (for validation) */
  expectedAmountCents: number;
  /** Expected beneficiary IBAN (for validation) */
  expectedBeneficiaryIban: string;
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
}

/**
 * Client for the Attestation Service
 */
export class AttestationClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: AttestationClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Check if the attestation service is healthy
   */
  async healthCheck(): Promise<HealthResponse> {
    let response: Response;
    try {
      response = await this.fetch("/api/v1/health", {
        method: "GET",
      });
    } catch (error) {
      throw createConnectionError(
        error instanceof Error ? error : new Error(String(error))
      );
    }

    if (!response.ok) {
      throw new AttestationServiceError({
        stage: AttestationStage.CONNECTION,
        originalError: `Health check failed with status ${response.status}`,
        suggestion: "Attestation service unhealthy. Check service logs and restart if needed",
        httpCode: response.status,
      });
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

    let response: Response;
    try {
      response = await this.fetch("/api/v1/attest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          presentation: request.presentation,
          intent_hash: request.intentHash,
          expected_amount_cents: request.expectedAmountCents,
          expected_beneficiary_iban: request.expectedBeneficiaryIban,
        }),
      });
    } catch (error) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      attestationDurationSeconds.observe({ status: "error" }, durationSeconds);

      const connectionError = createConnectionError(
        error instanceof Error ? error : new Error(String(error)),
        request.intentHash
      );
      log.error(connectionError.toLogContext(), "Attestation connection failed");
      throw connectionError;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    const durationSeconds = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const errorResponse = data as AttestationError;
      const classifiedError = classifyAttestationError(
        errorResponse.error,
        errorResponse.code,
        request.intentHash
      );
      log.error(classifiedError.toLogContext(), "Attestation request failed");
      attestationDurationSeconds.observe({ status: "error" }, durationSeconds);
      throw classifiedError;
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
export function createAttestationClient(baseUrl: string): AttestationClient {
  return new AttestationClient({ baseUrl });
}

