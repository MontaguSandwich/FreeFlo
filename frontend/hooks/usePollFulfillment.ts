import { useEffect, useRef } from "react";
import { useReadContract, useWatchContractEvent } from "wagmi";
import { OFFRAMP_V2_ADDRESS, OFFRAMP_V2_ABI, IntentStatus } from "@/lib/contracts";

export function usePollFulfillment(
  intentId: `0x${string}` | null,
  enabled: boolean,
  onFulfilled: () => void
) {
  const fulfilledRef = useRef(false);

  // Read intent status from contract
  const { refetch: refetchIntent } = useReadContract({
    address: OFFRAMP_V2_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    functionName: "getIntent",
    args: intentId ? [intentId] : undefined,
    query: { enabled: !!intentId && enabled },
  });

  // Watch for IntentFulfilled events
  useWatchContractEvent({
    address: OFFRAMP_V2_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    eventName: "IntentFulfilled",
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { intentId: `0x${string}` };
        if (args.intentId === intentId && !fulfilledRef.current) {
          fulfilledRef.current = true;
          onFulfilled();
        }
      }
    },
  });

  // Poll as backup
  useEffect(() => {
    if (!intentId || !enabled || fulfilledRef.current) return;

    let cancelled = false;

    const checkStatus = async () => {
      if (cancelled || fulfilledRef.current) return;
      try {
        const result = await refetchIntent();
        const intent = result.data as { status: number | bigint } | undefined;
        if (intent && Number(intent.status) === IntentStatus.FULFILLED) {
          if (!fulfilledRef.current) {
            fulfilledRef.current = true;
            onFulfilled();
          }
          return;
        }
      } catch (err) {
        console.error("Error polling fulfillment:", err);
      }
      if (!cancelled && !fulfilledRef.current) {
        setTimeout(checkStatus, 3000);
      }
    };

    const timer = setTimeout(checkStatus, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [intentId, enabled, refetchIntent, onFulfilled]);

  // Reset on new intent
  useEffect(() => {
    fulfilledRef.current = false;
  }, [intentId]);
}
