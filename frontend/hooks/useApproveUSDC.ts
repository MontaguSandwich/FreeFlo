import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseUnits, type Address } from "viem";
import { OFFRAMP_V2_ADDRESS, USDC_ADDRESS, ERC20_ABI } from "@/lib/contracts";

export function useApproveUSDC(userAddress?: Address) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, OFFRAMP_V2_ADDRESS] : undefined,
  });

  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
  });

  const approve = useCallback(
    (amount: string) => {
      const usdcAmountWei = parseUnits(amount, 6);
      writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [OFFRAMP_V2_ADDRESS, usdcAmountWei],
      });
    },
    [writeContract]
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
