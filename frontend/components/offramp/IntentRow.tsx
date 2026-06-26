"use client";

import { useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { useReadContract } from "wagmi";
import { OFFRAMP_V2_ABI, IntentStatus } from "@/lib/contracts";
import { useCancelIntent, computeCancelEligibility } from "@/hooks/useCancelIntent";
import { friendlyTxError } from "@/lib/tx-errors";

// Fallback window values (seconds) matching the contract, used until the on-chain
// constants resolve.
export const DEFAULT_WINDOWS = { quote: 300, selection: 600, fulfillment: 1800 };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type ChipColor = "default" | "warning" | "info" | "success" | "error";
export const STATUS_META: Record<number, { label: string; color: ChipColor }> = {
  [IntentStatus.NONE]: { label: "Unknown", color: "default" },
  [IntentStatus.PENDING_QUOTE]: { label: "Pending quote", color: "warning" },
  [IntentStatus.COMMITTED]: { label: "Committed", color: "info" },
  [IntentStatus.FULFILLED]: { label: "Fulfilled", color: "success" },
  [IntentStatus.CANCELLED]: { label: "Cancelled", color: "default" },
  [IntentStatus.EXPIRED]: { label: "Expired", color: "default" },
};

export function formatDuration(sec: number): string {
  if (sec <= 0) return "now";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export interface OnchainIntent {
  depositor: `0x${string}`;
  status: number;
  createdAt: bigint;
  committedAt: bigint;
}

/** Minimal display shape — satisfied by both TrackedIntent (+ offramp) and AddressIntent. */
export interface IntentRowData {
  intentId: `0x${string}`;
  offramp: `0x${string}`; // the contract this intent lives on (read + reclaim target)
  deploymentLabel?: string; // shown for legacy/non-current deployments
  amountUsdc: string;
  currency: string;
  receivingInfo?: string;
  recipientName?: string;
}

/**
 * One intent row: live status chip + reclaim ("unstuck") button, read/cancelled against the
 * intent's OWN contract (`intent.offramp`) so legacy/sandbox intents work too.
 *
 * - If `onchain` is provided (parent batch-read status via multicall), it is used and the per-row
 *   read is disabled — avoids a duplicate getIntent call per row.
 * - After a successful cancel, refresh via `onReclaimed` (parent) or the own read.
 */
export function IntentRow({
  intent,
  windows,
  nowSec,
  onchain,
  onReclaimed,
}: {
  intent: IntentRowData;
  windows: { quote: number; selection: number; fulfillment: number };
  nowSec: number;
  onchain?: OnchainIntent;
  onReclaimed?: () => void;
}) {
  const { data, refetch, isLoading } = useReadContract({
    address: intent.offramp,
    abi: OFFRAMP_V2_ABI,
    functionName: "getIntent",
    args: [intent.intentId],
    query: { enabled: !onchain },
  });
  const cancel = useCancelIntent();

  // After a successful cancel, re-read so the row reflects CANCELLED/EXPIRED.
  useEffect(() => {
    if (cancel.isSuccess) {
      if (onReclaimed) onReclaimed();
      else void refetch();
    }
  }, [cancel.isSuccess, onReclaimed, refetch]);

  const effective = onchain ?? (data as OnchainIntent | undefined);
  const loading = onchain ? false : isLoading;
  const exists = !!effective && effective.depositor.toLowerCase() !== ZERO_ADDRESS;
  const status = exists ? Number(effective!.status) : IntentStatus.NONE;
  const meta = STATUS_META[status] ?? STATUS_META[IntentStatus.NONE];
  const isActive = status === IntentStatus.PENDING_QUOTE || status === IntentStatus.COMMITTED;
  const elig = exists
    ? computeCancelEligibility(status, Number(effective!.createdAt), Number(effective!.committedAt), windows, nowSec)
    : { canCancel: false, secondsUntilEligible: 0, reason: "" };

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {intent.amountUsdc} USDC &rarr; {intent.currency}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {intent.deploymentLabel && (
            <Chip
              size="small"
              label={intent.deploymentLabel}
              variant="outlined"
              sx={{ height: 20, fontSize: "0.65rem", color: "text.secondary", borderColor: "divider" }}
            />
          )}
          {loading ? (
            <CircularProgress size={14} />
          ) : (
            <Chip size="small" label={meta.label} color={meta.color} variant="outlined" />
          )}
        </Box>
      </Box>

      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", wordBreak: "break-all" }}>
        {intent.intentId.slice(0, 10)}&hellip;{intent.intentId.slice(-6)}
        {intent.receivingInfo ? ` · ${intent.receivingInfo}` : ""}
      </Typography>

      {isActive && (
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={!elig.canCancel || cancel.isPending || cancel.isConfirming}
            onClick={() => cancel.cancelIntent(intent.intentId, intent.offramp)}
            sx={{ textTransform: "none" }}
          >
            {cancel.isPending || cancel.isConfirming
              ? "Cancelling…"
              : elig.canCancel
                ? "Cancel & reclaim USDC"
                : `Reclaim in ${formatDuration(elig.secondsUntilEligible)}`}
          </Button>
          {cancel.error && (
            <Alert severity="error" sx={{ mt: 1, "& .MuiAlert-message": { fontSize: "0.8rem" } }}>
              {friendlyTxError(cancel.error).message}
            </Alert>
          )}
          {cancel.isSuccess && (
            <Typography variant="caption" sx={{ color: "success.main", display: "block", mt: 0.5 }}>
              Reclaimed &#10003;{" "}
              {cancel.hash && (
                <a href={`https://basescan.org/tx/${cancel.hash}`} target="_blank" rel="noopener noreferrer">
                  view
                </a>
              )}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
