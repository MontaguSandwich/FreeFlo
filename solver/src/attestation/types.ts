/**
 * Types for zkTLS attestation and on-chain verification
 */

import type { Hex } from "viem";

/**
 * Payment attestation struct matching PaymentVerifier.sol
 */
export interface PaymentAttestation {
  /** Hash of the intent this payment is for */
  intentHash: Hex;
  /** Amount in smallest currency unit (cents) */
  amount: bigint;
  /** TLS session timestamp */
  timestamp: bigint;
  /** Unique payment/transfer ID (used as nullifier) */
  paymentId: string;
  /** Hash of the raw response data */
  dataHash: Hex;
}

/**
 * Proof data for on-chain verification
 */
export interface ProofData {
  /** The payment attestation struct */
  attestation: PaymentAttestation;
  /** EIP-712 signature from the attestation service */
  signature: Hex;
}

/**
 * Result from TLSNotary proof generation
 */
export interface TlsNotaryProofResult {
  /** Base64-encoded presentation */
  presentation: string;
  /** Transaction ID found in the proof */
  transactionId: string;
  /** Amount in cents */
  amountCents: number;
  /** Beneficiary IBAN */
  beneficiaryIban: string;
}

