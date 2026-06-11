import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { OFFRAMP_V2_ABI, IntentStatus } from "@/lib/contracts";
import { useNetworkAddresses } from "./useNetworkAddresses";

export interface CancelEligibility {
  /** True once the contract will accept cancelIntent (past the relevant window). */
  canCancel: boolean;
  /** Seconds until cancellable (0 if already eligible). */
  secondsUntilEligible: number;
  /** Short human-readable reason / state. */
  reason: string;
}

/**
 * Mirror of the contract's cancel gating:
 * - PENDING_QUOTE: cancellable after createdAt + QUOTE_WINDOW + SELECTION_WINDOW
 * - COMMITTED:     cancellable after committedAt + FULFILLMENT_WINDOW
 * - otherwise (NONE/FULFILLED/CANCELLED/EXPIRED): not cancellable
 * Pure function (no React) so it can be unit-tested and reused.
 */
export function computeCancelEligibility(
  status: number,
  createdAtSec: number,
  committedAtSec: number,
  windows: { quote: number; selection: number; fulfillment: number },
  nowSec: number
): CancelEligibility {
  if (status === IntentStatus.PENDING_QUOTE) {
    const remaining = createdAtSec + windows.quote + windows.selection - nowSec;
    return remaining <= 0
      ? { canCancel: true, secondsUntilEligible: 0, reason: "Reclaim available" }
      : { canCancel: false, secondsUntilEligible: remaining, reason: "Quote/selection window open" };
  }
  if (status === IntentStatus.COMMITTED) {
    const remaining = committedAtSec + windows.fulfillment - nowSec;
    return remaining <= 0
      ? { canCancel: true, secondsUntilEligible: 0, reason: "Reclaim available" }
      : { canCancel: false, secondsUntilEligible: remaining, reason: "Solver still has time to fulfill" };
  }
  return { canCancel: false, secondsUntilEligible: 0, reason: "Not cancellable" };
}

/** cancelIntent(intentId) on OffRampV3, following the existing write-hook pattern. */
export function useCancelIntent() {
  const { OFFRAMP_V3: offrampAddress } = useNetworkAddresses();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancelIntent = useCallback(
    // `offramp` overrides the target contract so legacy/sandbox intents are cancelled on their
    // OWN deployment (not the current one); defaults to the active OffRampV3.
    (intentId: `0x${string}`, offramp?: `0x${string}`) => {
      writeContract({
        address: offramp ?? offrampAddress,
        abi: OFFRAMP_V2_ABI,
        functionName: "cancelIntent",
        args: [intentId],
      });
    },
    [writeContract, offrampAddress]
  );

  return { cancelIntent, hash, isPending, isConfirming, isSuccess, error, reset };
}
