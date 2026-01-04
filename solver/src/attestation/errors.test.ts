import { describe, it, expect } from "vitest";
import {
  AttestationServiceError,
  AttestationStage,
  classifyAttestationError,
  createConnectionError,
} from "./errors.js";

describe("AttestationServiceError", () => {
  it("should create error with all required fields", () => {
    const error = new AttestationServiceError({
      stage: AttestationStage.VERIFICATION,
      originalError: "Verification failed: Invalid signature",
      suggestion: "Regenerate TLSNotary proof",
      httpCode: 400,
      intentHash: "0x123",
    });

    expect(error.message).toContain("VERIFICATION");
    expect(error.message).toContain("Verification failed: Invalid signature");
    expect(error.message).toContain("Regenerate TLSNotary proof");
    expect(error.stage).toBe(AttestationStage.VERIFICATION);
    expect(error.originalError).toBe("Verification failed: Invalid signature");
    expect(error.suggestion).toBe("Regenerate TLSNotary proof");
    expect(error.httpCode).toBe(400);
    expect(error.intentHash).toBe("0x123");
    expect(error.name).toBe("AttestationServiceError");
  });

  it("should produce structured log context", () => {
    const error = new AttestationServiceError({
      stage: AttestationStage.CONNECTION,
      originalError: "ECONNREFUSED",
      suggestion: "Start attestation service",
      httpCode: undefined,
      intentHash: "0xabc",
    });

    const context = error.toLogContext();
    expect(context.errorType).toBe("AttestationServiceError");
    expect(context.stage).toBe(AttestationStage.CONNECTION);
    expect(context.originalError).toBe("ECONNREFUSED");
    expect(context.suggestion).toBe("Start attestation service");
    expect(context.intentHash).toBe("0xabc");
  });
});

describe("classifyAttestationError", () => {
  describe("connection errors", () => {
    it("should classify ECONNREFUSED", () => {
      const error = classifyAttestationError("ECONNREFUSED", undefined, "0x123");
      expect(error.stage).toBe(AttestationStage.CONNECTION);
      expect(error.suggestion).toContain("docker compose");
    });

    it("should classify timeout errors", () => {
      const error = classifyAttestationError("Request timeout", undefined, "0x123");
      expect(error.stage).toBe(AttestationStage.CONNECTION);
      expect(error.suggestion).toContain("timed out");
    });

    it("should classify DNS errors", () => {
      const error = classifyAttestationError("getaddrinfo ENOTFOUND localhost", undefined, "0x123");
      expect(error.stage).toBe(AttestationStage.CONNECTION);
      expect(error.suggestion).toContain("ATTESTATION_SERVICE_URL");
    });
  });

  describe("proof submission errors", () => {
    it("should classify invalid presentation", () => {
      const error = classifyAttestationError("Invalid presentation: bad format", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.PROOF_SUBMISSION);
      expect(error.suggestion).toContain("Regenerate");
    });

    it("should classify deserialization errors", () => {
      const error = classifyAttestationError("Deserialization error: invalid JSON", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.PROOF_SUBMISSION);
      expect(error.suggestion).toContain("corrupted");
    });

    it("should classify missing field errors", () => {
      const error = classifyAttestationError("Missing required field: amount", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.PROOF_SUBMISSION);
      expect(error.suggestion).toContain("required data");
    });
  });

  describe("verification errors", () => {
    it("should classify verification failed", () => {
      const error = classifyAttestationError("Verification failed: signature mismatch", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.VERIFICATION);
      expect(error.suggestion).toContain("expired or tampered");
    });

    it("should classify unexpected server", () => {
      const error = classifyAttestationError(
        "Unexpected server: expected api.bank.com, got other.com",
        400,
        "0x123"
      );
      expect(error.stage).toBe(AttestationStage.VERIFICATION);
      expect(error.suggestion).toContain("ALLOWED_SERVERS");
    });

    it("should classify server not found", () => {
      const error = classifyAttestationError("Server not found in presentation", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.VERIFICATION);
      expect(error.suggestion).toContain("banking API");
    });

    it("should classify invalid payment data", () => {
      const error = classifyAttestationError("Invalid payment data: amount mismatch", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.VERIFICATION);
      expect(error.suggestion).toContain("amount and IBAN");
    });
  });

  describe("signing errors", () => {
    it("should classify signing errors", () => {
      const error = classifyAttestationError("Signing error: key not found", 500, "0x123");
      expect(error.stage).toBe(AttestationStage.SIGNING);
      expect(error.suggestion).toContain("witness private key");
    });

    it("should classify NotAuthorizedWitness", () => {
      const error = classifyAttestationError("Error 0x41110897: NotAuthorizedWitness", 500, "0x123");
      expect(error.stage).toBe(AttestationStage.SIGNING);
      expect(error.suggestion).toContain("PaymentVerifier contract");
    });
  });

  describe("fallback classification", () => {
    it("should use 400 code to suggest proof submission", () => {
      const error = classifyAttestationError("Unknown error XYZ", 400, "0x123");
      expect(error.stage).toBe(AttestationStage.PROOF_SUBMISSION);
      expect(error.httpCode).toBe(400);
    });

    it("should use 500 code to suggest signing", () => {
      const error = classifyAttestationError("Unknown server error", 500, "0x123");
      expect(error.stage).toBe(AttestationStage.SIGNING);
      expect(error.httpCode).toBe(500);
    });

    it("should default to connection for unknown errors", () => {
      const error = classifyAttestationError("Completely unknown", undefined, "0x123");
      expect(error.stage).toBe(AttestationStage.CONNECTION);
      expect(error.suggestion).toContain("logs");
    });
  });

  it("should include intent hash in error", () => {
    const error = classifyAttestationError("Some error", 400, "0xintentabc");
    expect(error.intentHash).toBe("0xintentabc");
  });
});

describe("createConnectionError", () => {
  it("should wrap Error objects", () => {
    const originalError = new Error("ECONNREFUSED");
    const error = createConnectionError(originalError, "0x123");
    expect(error.stage).toBe(AttestationStage.CONNECTION);
    expect(error.originalError).toBe("ECONNREFUSED");
    expect(error.intentHash).toBe("0x123");
  });

  it("should force CONNECTION stage for unrecognized errors", () => {
    const originalError = new Error("Some weird network thing");
    const error = createConnectionError(originalError, "0x123");
    expect(error.stage).toBe(AttestationStage.CONNECTION);
  });

  it("should handle socket hang up", () => {
    const originalError = new Error("socket hang up");
    const error = createConnectionError(originalError, "0x123");
    expect(error.stage).toBe(AttestationStage.CONNECTION);
    expect(error.suggestion).toContain("crashed or restarted");
  });
});
