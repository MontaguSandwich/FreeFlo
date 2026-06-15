"use client";

// useSignOnceOfframp — headless logic for the TIER-1 "sign-once" USDC→SEPA offramp.
//
// Collapses the offramp into ONE gasless signature (Permit2 deposit-and-register):
//   1. approve   USDC.approve(PERMIT2, maxUint256)   ONE-TIME-ever per wallet (skipped after)
//   2. sign      ONE EIP-712 Permit2 "Activation" witness (no tx) — the ONLY happy-path signature
//   3. submit    POST the order to /api/compact-fill (proxied to the solver)
//
// The relayer then submits depositERC20AndRegisterViaPermit2 (pulls USDC + registers the
// compact) AND the fill — the user pays NO gas after the one-time approval. A solver sends
// SEPA EUR, gets the witness-signed attestation, and calls fill() to withdraw the locked USDC.
// Mirrors the headless style of useFiatToFiatFlow (state machine in, presentational shell
// consumes the API object).
//
// Addresses / ABIs / EIP-712 all live in lib/compact-contracts.ts (single source of truth).

import { useCallback, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { base } from "viem/chains";
import {
  COMPACT_ARBITER_ABI,
  COMPACT_ARBITER_ADDRESS,
  COMPACT_LOCK_ID,
  ERC20_APPROVE_ABI,
  PERMIT2_ADDRESS,
  USDC_BASE,
  buildPermit2ActivationSignRequest,
  isCompactDeployed,
  type Mandate,
} from "@/lib/compact-contracts";

// ============ Constants ============

const CURRENCY_EUR = 0; // Mandate.currency enum: 0 = EUR
// One shared deadline binds the Permit2 transfer, the Compact `expires`, and the mandate
// `expiry`. The solver must register + fulfil within this window.
const ORDER_TTL_SECONDS = 60 * 60; // 1h

// ---- Async fill polling ----
// The solver acks the order immediately (202 {orderId}) then works asynchronously; we poll its
// status endpoint until it reports a terminal state.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000; // ~3min overall cap before we treat the order as failed

// ============ Types ============

export type SignOnceStep =
  | "idle"
  | "approving"
  | "signing"
  | "submitting"
  // Order acked by the solver; we're polling its async fill status (deposit→pay→prove→release).
  | "processing"
  | "done"
  | "error";

/** Solver async fill states (matches the /api/compact/status contract exactly). */
export type CompactFillStatus =
  | "received"
  | "depositing"
  | "paying"
  | "proving"
  | "releasing"
  | "complete"
  | "failed";

/** Shape of the solver's status response (proxied via /api/compact-status). */
interface CompactStatusResponse {
  status: CompactFillStatus;
  depositTxHash?: string;
  transferId?: string;
  fillTxHash?: string;
  eurCents?: number;
  error?: string;
}

/** Human progress line for each non-terminal fill state shown while polling. */
const PROGRESS_LABELS: Partial<Record<CompactFillStatus, string>> = {
  received: "Order received",
  depositing: "Funding the lock…",
  paying: "Paying SEPA Instant…",
  proving: "Proving the payment…",
  releasing: "Releasing your USDC…",
};

/** The concrete on-this-tab timeline steps (approve → sign → submit), in order. */
const TIMELINE_ORDER = ["approving", "signing", "submitting"] as const;

/** Per-step status for the timeline UI. */
export type StepState = "pending" | "active" | "done";

export interface SignOnceResult {
  /** Whatever the solver returned from /api/compact-fill (e.g. an order id / ack). */
  orderId?: string;
  /** The on-chain fill tx — proof the solver paid SEPA and released the USDC. */
  txHash?: string;
  /** EUR sent to the recipient via SEPA Instant (cents). */
  eurCents?: bigint;
  /** Destination IBAN. */
  iban?: string;
  raw?: unknown;
}

export interface SignOnceOfframpApi {
  // ---- Controlled inputs ----
  iban: string;
  recipientName: string;
  usdcAmount: string;
  /** Manual EUR floor (whole euros) — only used when the quote can't be fetched. */
  minEurManual: string;
  setIban: (v: string) => void;
  setRecipientName: (v: string) => void;
  setUsdcAmount: (v: string) => void;
  setMinEurManual: (v: string) => void;

  // ---- State machine ----
  step: SignOnceStep;
  /** True while any async step is in flight (approve/sign/submit/processing). */
  busy: boolean;
  error: string | null;
  result: SignOnceResult | null;
  /** Live human progress line while the solver fills the order (null when not polling). */
  progress: string | null;

  // ---- Derived ----
  /** Wallet on Base mainnet — the only chain the Compact stack is deployed on. */
  onCorrectChain: boolean;
  /** The Compact stack is deployed + wired into this build. */
  deployed: boolean;
  /** Inputs are well-formed enough to start. */
  canSubmit: boolean;
  /** Quoted EUR floor in cents (undefined until a quote resolves / when using manual). */
  quotedMinEurCents: bigint | null;

  // ---- Per-step status for the timeline (approve → sign → submit) ----
  stepStatus: (s: (typeof TIMELINE_ORDER)[number]) => StepState;

  // ---- Actions ----
  run: () => Promise<void>;
  reset: () => void;
}

// ============ Helpers ============

/** A random uint256 nonce sourced from 32 bytes of CSPRNG. */
function randomNonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Extract a human message from a thrown error (viem/wagmi or plain). */
function errMessage(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | undefined;
  return e?.shortMessage || e?.message || String(err ?? "Unknown error");
}

/**
 * Fetch a conservative EUR floor (in cents) for `usdc` from the existing quote API.
 * Takes the best (highest) quoted fiat amount and floors it to whole cents. Returns
 * null when no quote is available so the caller can fall back to a manual minimum.
 */
async function fetchEurFloorCents(usdc: string): Promise<bigint | "below-min" | null> {
  try {
    const res = await fetch(`/api/quote?amount=${encodeURIComponent(usdc)}&currency=EUR`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      quotes?: Array<{ fiatAmount?: number }>;
      belowMinimum?: boolean;
    };
    const best = (data.quotes ?? [])
      .map((q) => q.fiatAmount)
      .filter((n): n is number => typeof n === "number" && n > 0)
      .sort((a, b) => b - a)[0];
    if (best !== undefined) return BigInt(Math.floor(best * 100)); // EUR figure -> whole cents
    // Empty quotes + belowMinimum is an EXPECTED case (amount under the solver minimum), not a
    // service failure — report it distinctly so the user isn't told the quote "couldn't be fetched".
    return data.belowMinimum ? "below-min" : null;
  } catch {
    return null;
  }
}

/** Resolve after `ms`, or reject if `signal` aborts first. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/**
 * Poll `/api/compact-status?orderId=` every POLL_INTERVAL_MS until the solver reports a terminal
 * state ("complete" | "failed"), invoking `onProgress` with each non-terminal status, and giving
 * up after POLL_TIMEOUT_MS (treated as a failure). Transient fetch/parse errors are swallowed and
 * retried so a single dropped poll doesn't abort an in-flight order; only the overall timeout ends
 * the loop. Returns the terminal status payload.
 */
async function pollFillStatus(
  orderId: string,
  onProgress: (status: CompactFillStatus) => void
): Promise<CompactStatusResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`/api/compact-status?orderId=${encodeURIComponent(orderId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(POLL_INTERVAL_MS * 2),
      });
      const data = (await res.json().catch(() => null)) as
        | (CompactStatusResponse & { error?: string })
        | null;

      if (res.ok && data?.status) {
        if (data.status === "complete" || data.status === "failed") return data;
        onProgress(data.status);
        lastError = undefined;
      } else {
        // Non-2xx or malformed body — remember the message and retry until the timeout.
        lastError = data?.error;
      }
    } catch {
      // Network blip / per-poll timeout — keep polling.
    }
    await delay(POLL_INTERVAL_MS);
  }

  return {
    status: "failed",
    error:
      lastError ?? "Timed out waiting for the solver — check the order status later",
  };
}

// ============ Hook ============

export function useSignOnceOfframp(): SignOnceOfframpApi {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  // ---- Controlled inputs ----
  const [iban, setIban] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [minEurManual, setMinEurManual] = useState("");

  // ---- State machine ----
  const [step, setStep] = useState<SignOnceStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignOnceResult | null>(null);
  const [quotedMinEurCents, setQuotedMinEurCents] = useState<bigint | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const deployed = isCompactDeployed();
  const onCorrectChain = chainId === base.id;

  const busy =
    step === "approving" ||
    step === "signing" ||
    step === "submitting" ||
    step === "processing";

  // ---- Validation ----
  const cleanIban = iban.replace(/\s+/g, "").toUpperCase();
  const amountValid = (() => {
    const n = Number(usdcAmount);
    return Number.isFinite(n) && n > 0;
  })();
  const canSubmit =
    deployed &&
    onCorrectChain &&
    !!address &&
    cleanIban.length >= 15 &&
    recipientName.trim().length >= 2 &&
    amountValid &&
    !busy;

  // ---- Per-step timeline status ----
  const stepStatus = useCallback(
    (s: (typeof TIMELINE_ORDER)[number]): StepState => {
      // Once the order is submitted (now polling) or done, every timeline step is complete —
      // the approve/sign/submit phases are all behind us; live progress moves to `progress`.
      if (step === "done" || step === "processing") return "done";
      const current = TIMELINE_ORDER.indexOf(step as (typeof TIMELINE_ORDER)[number]);
      const target = TIMELINE_ORDER.indexOf(s);
      if (current === -1) return "pending"; // idle / error → nothing active
      if (target < current) return "done";
      if (target === current) return "active";
      return "pending";
    },
    [step]
  );

  // ---- Reset ----
  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setResult(null);
    setQuotedMinEurCents(null);
    setProgress(null);
  }, []);

  // ---- The single end-to-end action ----
  const run = useCallback(async () => {
    if (busy) return;
    setError(null);
    setResult(null);
    setProgress(null);

    if (!deployed) {
      setError("The sign-once stack isn't deployed in this build.");
      setStep("error");
      return;
    }
    if (!publicClient || !address) {
      setError("Connect your wallet first.");
      setStep("error");
      return;
    }
    if (!onCorrectChain) {
      setError("Switch your wallet to Base mainnet.");
      setStep("error");
      return;
    }

    let amount: bigint;
    try {
      amount = parseUnits(usdcAmount, 6);
    } catch {
      setError("Enter a valid USDC amount.");
      setStep("error");
      return;
    }
    if (amount <= BigInt(0)) {
      setError("Enter a USDC amount greater than zero.");
      setStep("error");
      return;
    }

    // Resolve the EUR floor (cents). Prefer a live quote; fall back to the manual field.
    const floor = await fetchEurFloorCents(usdcAmount);
    if (floor === "below-min") {
      setError("Amount is below the 0.1 USDC minimum — enter at least 0.1 USDC.");
      setStep("error");
      return;
    }
    let minEurAmount: bigint | null = floor;
    setQuotedMinEurCents(minEurAmount);
    if (minEurAmount === null) {
      const manual = Number(minEurManual);
      if (!Number.isFinite(manual) || manual <= 0) {
        setError(
          "Couldn't reach the quote service — enter the minimum EUR you'll accept to continue."
        );
        setStep("error");
        return;
      }
      minEurAmount = BigInt(Math.floor(manual * 100));
    }

    try {
      // ---- 1. One-time Permit2 approval (skipped once allowance covers `amount`) ----
      // Most repeat users have NO transaction here — Permit2 holds an unlimited allowance.
      setStep("approving");
      // Fail fast: the wallet must actually hold the USDC, else the relayer's deposit reverts
      // TRANSFER_FROM_FAILED for funds that aren't there (wasting gas + a confusing raw error).
      const balance = (await publicClient.readContract({
        address: USDC_BASE as Address,
        abi: ERC20_APPROVE_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (balance < amount) {
        setError(
          `Insufficient USDC: this wallet holds ${formatUnits(balance, 6)} but needs ${usdcAmount}. Fund it on Base and retry.`
        );
        setStep("error");
        return;
      }
      const allowance = (await publicClient.readContract({
        address: USDC_BASE as Address,
        abi: ERC20_APPROVE_ABI,
        functionName: "allowance",
        args: [address, PERMIT2_ADDRESS as Address],
      })) as bigint;

      if (allowance < amount) {
        const approveHash = await writeContractAsync({
          address: USDC_BASE as Address,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [PERMIT2_ADDRESS as Address, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // ---- 2. Build the mandate (expiry == the shared deadline) ----
      // The mandate object MUST be byte-identical to the one in the POST body so the
      // solver's recomputed claim hash matches this signature.
      const deadline = BigInt(nowSeconds() + ORDER_TTL_SECONDS);
      const mandate: Mandate = {
        receivingInfo: cleanIban,
        recipientName: recipientName.trim(),
        minEurAmount,
        currency: CURRENCY_EUR,
        expiry: deadline,
      };

      // The witness the solver/arbiter recompute the claim hash against.
      const witness = (await publicClient.readContract({
        address: COMPACT_ARBITER_ADDRESS as Address,
        abi: COMPACT_ARBITER_ABI,
        functionName: "hashMandate",
        args: [mandate],
      })) as `0x${string}`;

      // ---- 3. The ONE gasless signature (Permit2 Activation witness) ----
      const compactNonce = randomNonce();
      const permit2Nonce = randomNonce();
      setStep("signing");
      const signature = await signTypedDataAsync(
        buildPermit2ActivationSignRequest({
          sponsor: address,
          nonce: compactNonce,
          permit2Nonce,
          deadline,
          amount,
          mandate,
        })
      );

      // ---- 4. Submit the order to the solver (via the Next proxy) ----
      // NO sponsorSignature: the relayer registers the compact via Permit2; the `permit2`
      // block carries the single signature it submits.
      setStep("submitting");
      const body = {
        claim: {
          sponsor: address,
          nonce: compactNonce.toString(),
          expires: deadline.toString(),
          witness,
          id: BigInt(COMPACT_LOCK_ID).toString(),
          allocatedAmount: amount.toString(),
        },
        mandate: {
          receivingInfo: cleanIban,
          recipientName: recipientName.trim(),
          minEurAmount: minEurAmount.toString(),
          currency: CURRENCY_EUR,
          expiry: deadline.toString(),
        },
        permit2: {
          nonce: permit2Nonce.toString(),
          deadline: deadline.toString(),
          signature,
        },
      };

      // The POST is now an ACK: the solver validates the order and returns 202 {orderId}
      // immediately, then fills it asynchronously. We poll its status endpoint for progress.
      const res = await fetch("/api/compact-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { orderId?: string; error?: string; details?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          json?.error || json?.details || `Solver rejected the order (${res.status}).`
        );
      }
      const orderId = json?.orderId;
      if (!orderId) {
        throw new Error("Solver accepted the order but returned no order id.");
      }

      // ---- 5. Poll the solver's async fill status until it's terminal ----
      setStep("processing");
      setProgress(PROGRESS_LABELS.received ?? null);
      const status = await pollFillStatus(orderId, (s) => {
        setProgress(PROGRESS_LABELS[s] ?? null);
      });

      if (status.status === "failed") {
        setProgress(null);
        setError(status.error || "The solver could not complete the order.");
        setStep("error");
        return;
      }

      // complete: the SEPA payment settled and the USDC was released on-chain. Prefer the EUR the
      // solver actually sent (eurCents); fall back to the committed floor. Surface the fill tx.
      setProgress(null);
      setResult({
        orderId,
        txHash: status.fillTxHash,
        eurCents: status.eurCents != null ? BigInt(status.eurCents) : minEurAmount,
        iban: cleanIban,
        raw: status,
      });
      setStep("done");
    } catch (err) {
      setProgress(null);
      setError(errMessage(err));
      setStep("error");
    }
  }, [
    busy,
    deployed,
    publicClient,
    address,
    onCorrectChain,
    usdcAmount,
    minEurManual,
    cleanIban,
    recipientName,
    writeContractAsync,
    signTypedDataAsync,
  ]);

  return useMemo<SignOnceOfframpApi>(
    () => ({
      iban,
      recipientName,
      usdcAmount,
      minEurManual,
      setIban,
      setRecipientName,
      setUsdcAmount,
      setMinEurManual,
      step,
      busy,
      error,
      result,
      progress,
      onCorrectChain,
      deployed,
      canSubmit,
      quotedMinEurCents,
      stepStatus,
      run,
      reset,
    }),
    [
      iban,
      recipientName,
      usdcAmount,
      minEurManual,
      step,
      busy,
      error,
      result,
      progress,
      onCorrectChain,
      deployed,
      canSubmit,
      quotedMinEurCents,
      stepStatus,
      run,
      reset,
    ]
  );
}
