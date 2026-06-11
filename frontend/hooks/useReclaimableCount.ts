"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import { OFFRAMP_V2_ABI } from "@/lib/contracts";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { useIntentsStore } from "@/stores/intentsStore";
import { computeCancelEligibility } from "@/hooks/useCancelIntent";
import { DEFAULT_WINDOWS, ZERO_ADDRESS, type OnchainIntent } from "@/components/offramp/IntentRow";

/**
 * Count of the connected wallet's locally-tracked intents that are currently reclaimable.
 * Drives the badge dot on the history icon. Scoped to the store (the user's own-device
 * intents — the realistic "stuck" case) to keep the always-on cost to one small multicall.
 */
export function useReclaimableCount(address?: `0x${string}`): number {
  const { OFFRAMP_V3: offramp } = useNetworkAddresses();
  const storeIntents = useIntentsStore((s) => s.intents);
  const ids = useMemo(() => storeIntents.map((i) => i.intentId), [storeIntents]);

  const { data } = useReadContracts({
    contracts: ids.map((id) => ({
      address: offramp,
      abi: OFFRAMP_V2_ABI,
      functionName: "getIntent",
      args: [id],
    })),
    query: { enabled: !!address && ids.length > 0, refetchInterval: 30000 },
  });

  // Eligibility is time-gated, so re-evaluate periodically even without a data change.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    if (!data) return 0;
    let count = 0;
    for (const r of data) {
      if (r.status !== "success" || !r.result) continue;
      const oc = r.result as unknown as OnchainIntent;
      if (oc.depositor.toLowerCase() === ZERO_ADDRESS) continue;
      const elig = computeCancelEligibility(
        Number(oc.status),
        Number(oc.createdAt),
        Number(oc.committedAt),
        DEFAULT_WINDOWS,
        nowSec
      );
      if (elig.canCancel) count++;
    }
    return count;
  }, [data, nowSec]);
}
