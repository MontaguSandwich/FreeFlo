import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseUnits, type Address } from "viem";
import { ERC20_ABI } from "@/lib/contracts";
import { useNetworkAddresses } from "./useNetworkAddresses";

export function useApproveUSDC(userAddress?: Address) {
  const { OFFRAMP_V3: offrampAddress, USDC: usdcAddress } = useNetworkAddresses();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, offrampAddress] : undefined,
  });

  const { data: balance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
  });

  const approve = useCallback(
    (amount: string) => {
      const usdcAmountWei = parseUnits(amount, 6);
      writeContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [offrampAddress, usdcAmountWei],
      });
    },
    [writeContract, usdcAddress, offrampAddress]
  );

  const needsApproval = (amount: string): boolean => {
    const usdcAmountWei = parseUnits(amount, 6);
    return !allowance || (allowance as bigint) < usdcAmountWei;
  };

  return {
    approve,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    allowance: allowance as bigint | undefined,
    balance: balance as bigint | undefined,
    refetchAllowance,
    needsApproval,
    error,
    reset,
  };
}
