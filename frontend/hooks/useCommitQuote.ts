import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { OFFRAMP_V2_ABI } from "@/lib/contracts";
import { STRING_RTPN_TO_CONTRACT, type RTPN } from "@/lib/quotes";
import { useNetworkAddresses } from "./useNetworkAddresses";

export function useCommitQuote() {
  const { OFFRAMP_V3: offrampAddress } = useNetworkAddresses();
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
        address: offrampAddress,
        abi: OFFRAMP_V2_ABI,
        functionName: "selectQuoteAndCommit",
        args: [intentId, solverAddress, STRING_RTPN_TO_CONTRACT[rtpn], receivingInfo, recipientName],
      });
    },
    [writeContract, offrampAddress]
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
