"use client";

import { useEffect, useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import CloseIcon from "@mui/icons-material/Close";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { OFFRAMP_V2_ABI, IntentStatus } from "@/lib/contracts";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { useAddressIntents, type AddressIntent } from "@/hooks/useAddressIntents";
import { computeCancelEligibility } from "@/hooks/useCancelIntent";
import { IntentRow, DEFAULT_WINDOWS, ZERO_ADDRESS, type OnchainIntent } from "./IntentRow";

const intentKey = (it: AddressIntent) => `${it.offramp.toLowerCase()}:${it.intentId.toLowerCase()}`;

export function TransactionHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, isConnected } = useAccount();
  const { OFFRAMP_V3: offramp } = useNetworkAddresses();
  const { intents, isLoading, error, refetch } = useAddressIntents(address, { enabled: open });

  // Window constants once at dialog scope (same across the audited deployments).
  const { data: quoteW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "QUOTE_WINDOW", query: { enabled: open } });
  const { data: selW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "SELECTION_WINDOW", query: { enabled: open } });
  const { data: fulfW } = useReadContract({ address: offramp, abi: OFFRAMP_V2_ABI, functionName: "FULFILLMENT_WINDOW", query: { enabled: open } });
  const windows = useMemo(
    () => ({
      quote: quoteW != null ? Number(quoteW) : DEFAULT_WINDOWS.quote,
      selection: selW != null ? Number(selW) : DEFAULT_WINDOWS.selection,
      fulfillment: fulfW != null ? Number(fulfW) : DEFAULT_WINDOWS.fulfillment,
    }),
    [quoteW, selW, fulfW]
  );

  // 1s ticker for countdowns (only while open).
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [open]);

  // One multicall across all listed intents — each read against its OWN contract.
  const { data: statusData, refetch: refetchStatuses } = useReadContracts({
    contracts: intents.map((it) => ({ address: it.offramp, abi: OFFRAMP_V2_ABI, functionName: "getIntent", args: [it.intentId] })),
    query: { enabled: open && intents.length > 0 },
  });

  const statusById = useMemo(() => {
    const m = new Map<string, OnchainIntent>();
    if (statusData) {
      intents.forEach((it, i) => {
        const r = statusData[i];
        if (r?.status === "success" && r.result) m.set(intentKey(it), r.result as unknown as OnchainIntent);
      });
    }
    return m;
  }, [statusData, intents]);

  // rank: 0 reclaimable, 1 other active, 2 terminal/unknown. Stable within rank by list order (recency).
  const rankOf = useMemo(() => {
    return (it: AddressIntent): number => {
      const oc = statusById.get(intentKey(it));
      if (!oc || oc.depositor.toLowerCase() === ZERO_ADDRESS) return 2;
      const st = Number(oc.status);
      const active = st === IntentStatus.PENDING_QUOTE || st === IntentStatus.COMMITTED;
      if (!active) return 2;
      return computeCancelEligibility(st, Number(oc.createdAt), Number(oc.committedAt), windows, nowSec).canCancel ? 0 : 1;
    };
  }, [statusById, windows, nowSec]);

  const sorted = useMemo(() => {
    return intents
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const r = rankOf(a.it) - rankOf(b.it);
        return r !== 0 ? r : a.i - b.i;
      })
      .map((x) => x.it);
  }, [intents, rankOf]);

  const reclaimableCount = useMemo(() => intents.filter((it) => rankOf(it) === 0).length, [intents, rankOf]);

  const onReclaimed = () => {
    void refetch();
    void refetchStatuses();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          backgroundImage: "none",
          border: "1px solid",
          borderColor: "rgba(16, 185, 129, 0.4)",
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", pb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Transaction history
          </Typography>
          {isConnected && intents.length > 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {intents.length} total{reclaimableCount > 0 ? ` · ${reclaimableCount} reclaimable` : ""}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="close" size="small" sx={{ mt: -0.5 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!isConnected ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Connect your wallet to see your offramp history.
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ py: 2 }}>
            <Alert severity="error" sx={{ "& .MuiAlert-message": { fontSize: "0.85rem" } }}>
              {error.message.split("\n")[0]}
            </Alert>
            <Button size="small" onClick={() => refetch()} sx={{ mt: 1, textTransform: "none" }}>
              Retry
            </Button>
          </Box>
        ) : isLoading && intents.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={72} />
            ))}
          </Box>
        ) : intents.length === 0 ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No offramp intents yet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1 }}>
            {sorted.map((it) => (
              <IntentRow
                key={intentKey(it)}
                intent={it}
                windows={windows}
                nowSec={nowSec}
                onchain={statusById.get(intentKey(it))}
                onReclaimed={onReclaimed}
              />
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
