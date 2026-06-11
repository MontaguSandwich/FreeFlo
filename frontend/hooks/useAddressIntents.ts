"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { parseAbiItem, formatUnits } from "viem";
import { getPublicClient } from "@/lib/quotes";
import { getAddressesForChain } from "@/lib/network";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { useIntentsStore } from "@/stores/intentsStore";
import { Currency } from "@/lib/contracts";

const INTENT_CREATED = parseAbiItem(
  "event IntentCreated(bytes32 indexed intentId, address indexed depositor, uint256 usdcAmount, uint8 currency)"
);

// Bounds the scan when a network's deployBlock is unknown (e.g. testnet) so we never
// walk from genesis. On mainnet the (later) deployBlock wins, keeping the scan tiny.
const MAX_LOOKBACK = BigInt(2000000);
const CHUNK = BigInt(9000);
const ONE = BigInt(1);

interface Deployment {
  address: `0x${string}`;
  deployBlock: bigint;
  label?: string;
}

export interface AddressIntent {
  intentId: `0x${string}`;
  offramp: `0x${string}`; // the OffRampV3 deployment this intent lives on
  deploymentLabel?: string; // set for legacy/non-current deployments (e.g. "Sandbox (E2E)")
  blockNumber: bigint;
  createdAtMs?: number;
  amountUsdc: string;
  currency: string;
  receivingInfo?: string;
  recipientName?: string;
  source: "chain" | "store" | "both";
}

// Dedup/identity key — an intentId is only unique within a single deployment.
const keyOf = (offramp: string, intentId: string) => `${offramp.toLowerCase()}:${intentId.toLowerCase()}`;

function currencyLabel(n: number): string {
  return (Currency[n] as string | undefined) ?? String(n);
}

interface ChainRow {
  intentId: `0x${string}`;
  offramp: `0x${string}`;
  deploymentLabel?: string;
  blockNumber: bigint;
  amountUsdc: string;
  currency: string;
}

/** Scan one deployment's IntentCreated logs for `depositor`, chunked + halving-retry on range errors. */
async function scanDeployment(
  chainId: number | undefined,
  depositor: `0x${string}`,
  dep: Deployment
): Promise<ChainRow[]> {
  const client = getPublicClient(chainId);
  const latest = await client.getBlockNumber();
  const lookbackFloor = latest > MAX_LOOKBACK ? latest - MAX_LOOKBACK : BigInt(0);
  const fromBlock = dep.deployBlock > lookbackFloor ? dep.deployBlock : lookbackFloor;

  const rows: ChainRow[] = [];
  let from = fromBlock;
  let span = CHUNK;
  while (from <= latest) {
    const end = from + span - ONE;
    const to = end > latest ? latest : end;
    try {
      const logs = await client.getLogs({
        address: dep.address,
        event: INTENT_CREATED,
        args: { depositor },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const a = log.args as { intentId?: `0x${string}`; usdcAmount?: bigint; currency?: number };
        if (!a.intentId) continue;
        rows.push({
          intentId: a.intentId,
          offramp: dep.address,
          deploymentLabel: dep.label,
          blockNumber: log.blockNumber ?? BigInt(0),
          amountUsdc: a.usdcAmount != null ? formatUnits(a.usdcAmount, 6) : "0",
          currency: currencyLabel(Number(a.currency ?? 0)),
        });
      }
      from = to + ONE;
      if (span < CHUNK) {
        const grown = span * BigInt(2);
        span = grown > CHUNK ? CHUNK : grown;
      }
    } catch (err) {
      if (span > ONE) {
        span = span / BigInt(2);
        continue; // retry this segment with a smaller range
      }
      throw err;
    }
  }
  return rows;
}

/**
 * The connected wallet's offramp intents across ALL OffRampV3 deployments (the active contract
 * plus any legacy/sandbox ones), sourced from on-chain IntentCreated logs (indexed depositor) and
 * merged with the localStorage cache. Each intent carries the contract it lives on so the consumer
 * can read status + reclaim against the right deployment.
 */
export function useAddressIntents(
  address?: `0x${string}`,
  opts?: { enabled?: boolean }
): { intents: AddressIntent[]; isLoading: boolean; error: Error | null; refetch: () => void } {
  const chainId = useChainId();
  const { OFFRAMP_V3: offramp, deployBlock, legacyOffRamps } = getAddressesForChain(chainId);
  const storeIntents = useIntentsStore((s) => s.intents);

  const enabled = !!address && (opts?.enabled ?? true);

  // Active contract (no label → no tag) + any legacy deployments (labelled).
  const deployments = useMemo<Deployment[]>(
    () => [{ address: offramp, deployBlock }, ...legacyOffRamps],
    [offramp, deployBlock, legacyOffRamps]
  );

  const { data: chainRows, isLoading, error, refetch } = useQuery({
    queryKey: ["addressIntents", chainId, address, deployments.map((d) => d.address).join(",")],
    enabled,
    staleTime: 30000,
    queryFn: async () => {
      const results = await Promise.all(deployments.map((d) => scanDeployment(chainId, address as `0x${string}`, d)));
      return results.flat();
    },
  });

  const intents = useMemo<AddressIntent[]>(() => {
    const byKey = new Map<string, AddressIntent>();
    for (const r of chainRows ?? []) {
      byKey.set(keyOf(r.offramp, r.intentId), { ...r, source: "chain" });
    }
    // Store intents belong to the active contract.
    for (const s of storeIntents) {
      const k = keyOf(offramp, s.intentId);
      const existing = byKey.get(k);
      if (existing) {
        byKey.set(k, {
          ...existing,
          source: "both",
          createdAtMs: s.createdAt,
          receivingInfo: s.receivingInfo ?? existing.receivingInfo,
          recipientName: s.recipientName ?? existing.recipientName,
        });
      } else {
        byKey.set(k, {
          intentId: s.intentId,
          offramp,
          blockNumber: BigInt(0),
          createdAtMs: s.createdAt,
          amountUsdc: s.amountUsdc,
          currency: s.currency,
          receivingInfo: s.receivingInfo,
          recipientName: s.recipientName,
          source: "store",
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => {
      const aOnChain = a.source !== "store";
      const bOnChain = b.source !== "store";
      if (aOnChain !== bOnChain) return aOnChain ? 1 : -1; // store-only (newest) on top
      if (aOnChain) return a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0;
      return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    });
  }, [chainRows, storeIntents, offramp]);

  return { intents, isLoading, error: (error as Error | null) ?? null, refetch: () => void refetch() };
}
