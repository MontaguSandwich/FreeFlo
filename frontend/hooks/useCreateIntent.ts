import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, decodeEventLog, type Address } from "viem";
import { OFFRAMP_V2_ADDRESS, OFFRAMP_V2_ABI, USDC_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { CURRENCY_TO_CONTRACT, type Currency } from "@/lib/quotes";

export function useCreateIntent() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  const createIntent = useCallback(
    (amount: string, currency: Currency) => {
      const usdcAmountWei = parseUnits(amount, 6);
      writeContract({
        address: OFFRAMP_V2_ADDRESS,
        abi: OFFRAMP_V2_ABI,
        functionName: "createIntent",
        args: [usdcAmountWei, CURRENCY_TO_CONTRACT[currency]],
      });
    },
    [writeContract]
  );

  // Parse intentId from receipt
  const intentId = (() => {
    if (!receipt) return null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: OFFRAMP_V2_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "IntentCreated") {
          return (decoded.args as { intentId: `0x${string}` }).intentId;
        }
      } catch {
        // Not our event
      }
    }
    return null;
  })();

  return {
    createIntent,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    intentId,
    error,
    reset,
  };
}
