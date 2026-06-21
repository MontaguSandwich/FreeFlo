// Friendly decoding for on-chain reverts surfaced in the fiat-to-fiat flow.
//
// The ZKP2P client (and wagmi) can only decode errors that live in the ABI they were
// given, so a revert thrown by FiatToFiatRouter or OffRampV3 during ZKP2P's
// fulfillIntent comes back as an undecodable blob ("...reverted with the following
// signature: 0x4c0b07ac. Unable to decode signature ... not found on the provided
// ABI"). We match on the raw 4-byte selector (and the error name, when present) and
// map it to plain language plus the recovery action the UI should offer.

/** What the UI should let the user do next in response to an error. */
export type TxRecovery =
  | "reclaim" // a prior router transfer is blocking — offer to reclaim it
  | "restart" // this order is dead — offer to start over
  | "retry" //   transient/too-early — offer to try again
  | "none"; //   nothing the user can self-serve (e.g. a config/witness issue)

export interface FriendlyTxError {
  /** Human-readable, safe to render directly. */
  message: string;
  /** Recovery action the UI should surface. */
  recovery: TxRecovery;
  /** The 4-byte selector we matched (or detected), for logging/debug. */
  selector?: string;
}

interface KnownError {
  selector: string;
  names: string[];
  message: string;
  recovery: TxRecovery;
}

// Selectors verified with `cast sig` against the deployed contracts.
const KNOWN: KnownError[] = [
  {
    selector: "0x4c0b07ac",
    names: ["UserAlreadyHasPendingTransfer"],
    message:
      "You have an unfinished transfer from a previous attempt. Reclaim it to free your wallet, then start again.",
    recovery: "reclaim",
  },
  {
    selector: "0x567d794b",
    names: ["CannotCancelYet"],
    message:
      "Your previous transfer is still within its processing window. You'll be able to reclaim it once that window passes — try again in a few minutes.",
    recovery: "retry",
  },
  {
    selector: "0x1e48ced8",
    names: ["NotTimedOutYet"],
    message:
      "This transfer hasn't timed out yet. You'll be able to reclaim it once its window passes — try again shortly.",
    recovery: "retry",
  },
  {
    selector: "0x466af7c8",
    names: ["TransferNotPending"],
    message: "This transfer can no longer be cancelled — it already moved past the pending stage.",
    recovery: "none",
  },
  {
    selector: "0xedfac6fa",
    names: ["TransferNotCommitted"],
    message: "This transfer isn't in a committed state, so it can't be reclaimed this way.",
    recovery: "none",
  },
  {
    selector: "0xd5e80fb4",
    names: ["NoPendingTransfer"],
    message: "No unfinished transfer was found — you're clear to start a new one.",
    recovery: "restart",
  },
  {
    selector: "0x71c4efed",
    names: ["SlippageExceeded"],
    message:
      "No solver quote met your price floor — the amount may be below the solver's minimum. Try a larger amount.",
    recovery: "restart",
  },
  {
    selector: "0xcf533f49",
    names: ["QuoteNotFound"],
    message: "No on-chain quote was found for this order yet. Wait a moment, then retry.",
    recovery: "retry",
  },
  {
    selector: "0x9481f8b9",
    names: ["IntentNotFound"],
    message: "That order was already cancelled or completed. Starting fresh.",
    recovery: "restart",
  },
  {
    selector: "0xcad2ae02",
    names: ["NullifierAlreadyUsed"],
    message: "This payment was already used to fulfil another order and can't be reused.",
    recovery: "restart",
  },
  {
    selector: "0x88366b0a",
    names: ["QuoteWindowClosed"],
    message: "The quote window expired (5 minutes). Please start a new order.",
    recovery: "restart",
  },
  {
    selector: "0x41110897",
    names: ["NotAuthorizedWitness"],
    message: "The verification service rejected the proof (a signing-key/domain mismatch). Please contact support.",
    recovery: "none",
  },
];

const SELECTOR_RE = /0x[0-9a-fA-F]{8}\b/g;

function rawText(err: unknown): string {
  if (typeof err === "string") return err;
  const e = err as { shortMessage?: string; details?: string; message?: string } | undefined;
  return String(e?.shortMessage ?? e?.message ?? e?.details ?? err ?? "");
}

/**
 * Turn any thrown tx/revert into a friendly message + recovery hint. Falls back to a
 * cleaned first line (never the raw multi-line viem dump) when the selector is unknown.
 */
export function friendlyTxError(err: unknown, fallback = "Something went wrong. Please try again."): FriendlyTxError {
  const text = rawText(err);
  const lower = text.toLowerCase();

  for (const k of KNOWN) {
    if (lower.includes(k.selector) || k.names.some((n) => lower.includes(n.toLowerCase()))) {
      return { message: k.message, recovery: k.recovery, selector: k.selector };
    }
  }

  // Unknown error: surface a single clean line, never the hex/argument dump.
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const isNoise = !firstLine || /unable to decode signature|execution reverted|reverted with/i.test(firstLine);
  const selector = text.match(SELECTOR_RE)?.find((s) => s.toLowerCase() !== "0x00000000");
  return { message: isNoise ? fallback : firstLine.slice(0, 200), recovery: "retry", selector };
}
