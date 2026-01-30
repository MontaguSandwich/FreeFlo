import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { OFFRAMP_V2_ADDRESS, OFFRAMP_V2_ABI } from "@/lib/contracts";
import { STRING_RTPN_TO_CONTRACT, type RTPN } from "@/lib/quotes";

export function useCommitQuote() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const commit = useCallback(
    (
      intentId: `0x${string}`,
      solverAddress: Address,
      rtpn: RTPN,
      receivingInfo: string,
      recipientName: string
    ) => {
      writeContract({
        address: OFFRAMP_V2_ADDRESS,
        abi: OFFRAMP_V2_ABI,
        functionName: "selectQuoteAndCommit",
        args: [intentId, solverAddress, STRING_RTPN_TO_CONTRACT[rtpn], receivingInfo, recipientName],
      });
    },
    [writeContract]
  );

  return {
    commit,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}
