"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import { useReadContract } from "wagmi";
import { OFFRAMP_V2_ABI, IntentStatus } from "@/lib/contracts";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { useIntentsStore, type TrackedIntent } from "@/stores/intentsStore";
import { useCancelIntent, computeCancelEligibility } from "@/hooks/useCancelIntent";

// Fallback window values (seconds) matching the contract, used until the on-chain
// constants resolve.
const DEFAULT_WINDOWS = { quote: 300, selection: 600, fulfillment: 1800 };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type ChipColor = "default" | "warning" | "info" | "success" | "error";
const STATUS_META: Record<number, { label: string; color: ChipColor }> = {
  [IntentStatus.NONE]: { label: "Unknown", color: "default" },
  [IntentStatus.PENDING_QUOTE]: { label: "Pending quote", color: "warning" },
  [IntentStatus.COMMITTED]: { label: "Committed", color: "info" },
  [IntentStatus.FULFILLED]: { label: "Fulfilled", color: "success" },
  [IntentStatus.CANCELLED]: { label: "Cancelled", color: "default" },
  [IntentStatus.EXPIRED]: { label: "Expired", color: "default" },
};

function formatDuration(sec: number): string {
  if (sec <= 0) return "now";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface OnchainIntent {
  depositor: `0x${string}`;
  status: number;
  createdAt: bigint;
  committedAt: bigint;
}

export function MyIntents() {
  const intents = useIntentsStore((s) => s.intents);
  const { OFFRAMP_V3: offramp } = useNetworkAddresses();

  // Window constants (uint64). Cached by wagmi; fall back to defaults while loading.
  const { data: quoteW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "QUOTE_WINDOW" });
  const { data: selW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "SELECTION_WINDOW" });
  const { data: fulfW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "FULFILLMENT_WINDOW" });
  const windows = {
    quote: quoteW != null ? Number(quoteW) : DEFAULT_WINDOWS.quote,
    selection: selW != null ? Number(selW) : DEFAULT_WINDOWS.selection,
    fulfillment: fulfW != null ? Number(fulfW) : DEFAULT_WINDOWS.fulfillment,
  };

  // 1s ticker for countdowns.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (intents.length === 0) return null;

  return (
    <Card
      elevation={0}
      sx={{
        maxWidth: 480,
        mx: "auto",
        mt: 3,
        width: "100%",
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        p: 2.5,
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, color: "text.primary" }}>
        Your intents
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {intents.map((it) => (
          <IntentRow key={it.intentId} intent={it} offramp={offramp} windows={windows} nowSec={nowSec} />
        ))}
      </Box>
    </Card>
  );
}

function IntentRow({
  intent,
  offramp,
  windows,
  nowSec,
}: {
  intent: TrackedIntent;
  offramp: `0x${string}`;
  windows: { quote: number; selection: number; fulfillment: number };
  nowSec: number;
}) {
  const removeIntent = useIntentsStore((s) => s.removeIntent);
  const { data, refetch, isLoading } = useReadContract({
    address: offramp,
    abi: OFFRAMP_V2_ABI,
    functionName: "getIntent",
    args: [intent.intentId],
  });
  const cancel = useCancelIntent();

  // After a successful cancel, re-read so the row reflects CANCELLED.
  useEffect(() => {
    if (cancel.isSuccess) void refetch();
  }, [cancel.isSuccess, refetch]);

  const onchain = data as OnchainIntent | undefined;
  const exists = !!onchain && onchain.depositor.toLowerCase() !== ZERO_ADDRESS;
  const status = exists ? Number(onchain!.status) : IntentStatus.NONE;
  const meta = STATUS_META[status] ?? STATUS_META[IntentStatus.NONE];
  const isActive = status === IntentStatus.PENDING_QUOTE || status === IntentStatus.COMMITTED;
  const elig = exists
    ? computeCancelEligibility(status, Number(onchain!.createdAt), Number(onchain!.committedAt), windows, nowSec)
    : { canCancel: false, secondsUntilEligible: 0, reason: "" };

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {intent.amountUsdc} USDC &rarr; {intent.currency}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {isLoading ? (
            <CircularProgress size={14} />
          ) : (
            <Chip size="small" label={meta.label} color={meta.color} variant="outlined" />
          )}
          {!isActive && (
            <IconButton size="small" onClick={() => removeIntent(intent.intentId)} aria-label="dismiss">
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
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
            onClick={() => cancel.cancelIntent(intent.intentId)}
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
              {cancel.error.message.split("\n")[0]}
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
