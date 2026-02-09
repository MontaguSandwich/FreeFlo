"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import {
  encodeAbiParameters,
  parseAbiParameters,
  parseAbiItem,
  type Log,
} from "viem";
import { Zkp2pClient, isPeerExtensionAvailable, createPeerExtensionSdk, getPeerExtensionState, PEER_EXTENSION_CHROME_URL } from "@zkp2p/sdk";
import { useSignalIntent } from "@zkp2p/sdk/react";
import {
  VENMO_TO_SEPA_ROUTER_ADDRESS,
  VENMO_TO_SEPA_ROUTER_ABI,
  RouterTransferStatus,
} from "@/lib/router-contracts";
import {
  IntentStatus,
  OFFRAMP_V2_ABI,
} from "@/lib/contracts";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { USDC_MAINNET_ADDRESS } from "@/lib/zkp2p-contracts";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";

// ============ Constants ============

// OffRampV3: QUOTE_WINDOW (5 min) + SELECTION_WINDOW (10 min) = 15 min
const OFFRAMP_DEADLINE_SECONDS = 15 * 60;

// ============ Types ============

type FlowStep =
  | "select_flow"
  | "input_all"
  | "finding_quotes"
  | "select_maker"
  | "zkp2p_signal"
  | "zkp2p_send_venmo"
  | "zkp2p_verify"
  | "zkp2p_fulfilling"
  | "router_waiting"
  | "router_commit"
  | "freeflo_pending"
  | "success"
  | "error";

interface ZkpQuote {
  depositId: string;
  escrowAddress: string;
  processorName: string;
  amount: string;
  toAddress: string;
  payeeDetails: string;
  fiatCurrencyCode: string;
  conversionRate: string;
  fiatAmount: string;
  fiatAmountFormatted: string;
  tokenAmount: string;
  tokenAmountFormatted: string;
  paymentMethod: string;
}

interface FlowData {
  usdAmount: number;
  eurIban: string;
  recipientName: string;
  minEurAmount: number;

  // ZKP2P stage
  zkp2pQuote: ZkpQuote | null;
  zkp2pIntentHash: `0x${string}` | null;
  venmoPayee: string;
  usdcAmount: bigint;

  // Router/FreeFlo stage
  routerIntentId: `0x${string}` | null;
  routerIntentCreatedAt: number | null;
  selectedSolver: `0x${string}` | null;
  quotedEurAmount: number;
}

// ============ Hooks ============

function useZkp2pClient() {
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  return useMemo(() => {
    if (!walletClient) return null;
    try {
      return new Zkp2pClient({
        walletClient,
        chainId,
      });
    } catch {
      return null;
    }
  }, [walletClient, chainId]);
}

/** Poll eth_getLogs for a specific event instead of useWatchContractEvent */
function useLogPoller(
  enabled: boolean,
  address: `0x${string}`,
  eventSignature: string,
  onLog: (log: Log) => void,
  intervalMs = 3000,
) {
  const publicClient = usePublicClient();
  const lastBlockRef = useRef<bigint>(BigInt(0));
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    if (!enabled || !publicClient || !address) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = lastBlockRef.current > BigInt(0)
          ? lastBlockRef.current + BigInt(1)
          : currentBlock - BigInt(50); // look back 50 blocks on first poll

        if (fromBlock > currentBlock) return;

        const logs = await publicClient.getLogs({
          address,
          event: parseAbiItem(eventSignature) as any,
          fromBlock,
          toBlock: currentBlock,
        });

        lastBlockRef.current = currentBlock;

        for (const log of logs) {
          if (!cancelled) onLogRef.current(log);
        }
      } catch (err) {
        console.error("Log poll error:", err);
      }
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, publicClient, address, eventSignature, intervalMs]);
}

/** Countdown hook: returns seconds remaining from a start timestamp */
function useCountdown(startTimestamp: number | null, durationSeconds: number): number {
  const [remaining, setRemaining] = useState(durationSeconds);

  useEffect(() => {
    if (!startTimestamp) {
      setRemaining(durationSeconds);
      return;
    }

    const tick = () => {
      const elapsed = Math.floor(Date.now() / 1000) - startTimestamp;
      setRemaining(Math.max(0, durationSeconds - elapsed));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTimestamp, durationSeconds]);

  return remaining;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ============ Component ============

export function VenmoToSepaFlow() {
  const { OFFRAMP_V3: OFFRAMP_V3_ADDRESS } = useNetworkAddresses();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const zkp2pClient = useZkp2pClient();

  // Flow state
  const [step, setStep] = useState<FlowStep>("select_flow");
  const [flowData, setFlowData] = useState<FlowData>({
    usdAmount: 0,
    eurIban: "",
    recipientName: "",
    minEurAmount: 0,
    zkp2pQuote: null,
    zkp2pIntentHash: null,
    venmoPayee: "",
    usdcAmount: BigInt(0),
    routerIntentId: null,
    routerIntentCreatedAt: null,
    selectedSolver: null,
    quotedEurAmount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Form inputs
  const [usdInput, setUsdInput] = useState("");
  const [ibanInput, setIbanInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [slippagePercent] = useState(2);

  // ZKP2P quotes
  const [zkp2pQuotes, setZkp2pQuotes] = useState<ZkpQuote[]>([]);

  // FreeFlo quotes
  const [freefloQuotes, setFreefloQuotes] = useState<any[]>([]);

  // Peer extension state
  const [extensionState, setExtensionState] = useState<string>("unknown");

  // Contract interactions
  const { writeContract: routerCommit, data: routerCommitHash } = useWriteContract();
  const { isSuccess: isRouterCommitConfirmed } = useWaitForTransactionReceipt({ hash: routerCommitHash });

  // ZKP2P signalIntent via SDK hook
  const { signalIntent, isLoading: isSignaling, error: signalError, txHash: signalTxHash } =
    useSignalIntent({ client: zkp2pClient });

  // OffRampV3 deadline countdown (starts when Router creates the FreeFlo intent)
  const deadlineRemaining = useCountdown(flowData.routerIntentCreatedAt, OFFRAMP_DEADLINE_SECONDS);

  // Read pending transfer from Router
  const { data: pendingTransfer, refetch: refetchPendingTransfer } = useReadContract({
    address: VENMO_TO_SEPA_ROUTER_ADDRESS,
    abi: VENMO_TO_SEPA_ROUTER_ABI,
    functionName: "getPendingTransfer",
    args: address ? [address] : undefined,
    query: { enabled: !!address && step.startsWith("router") },
  });

  // ============ Event Polling (replaces useWatchContractEvent) ============

  // Poll for Router TransferInitiated event
  useLogPoller(
    step === "zkp2p_fulfilling",
    VENMO_TO_SEPA_ROUTER_ADDRESS,
    "event TransferInitiated(address indexed user, bytes32 indexed intentId, uint256 usdcAmount, string iban, string recipientName, uint256 minEurAmount)",
    useCallback((log: Log) => {
      const args = (log as any).args;
      if (args?.user?.toLowerCase() === address?.toLowerCase()) {
        setFlowData((prev) => ({
          ...prev,
          routerIntentId: args.intentId as `0x${string}`,
          routerIntentCreatedAt: Math.floor(Date.now() / 1000),
        }));
        setStep("router_waiting");
      }
    }, [address]),
  );

  // Poll for FreeFlo IntentFulfilled event
  useLogPoller(
    step === "freeflo_pending" && !!flowData.routerIntentId,
    OFFRAMP_V3_ADDRESS,
    "event IntentFulfilled(bytes32 indexed intentId, address indexed solver, bytes32 transferId, uint256 fiatSent, bool verifiedByZkTLS)",
    useCallback((log: Log) => {
      const args = (log as any).args;
      if (args?.intentId === flowData.routerIntentId) {
        setStep("success");
      }
    }, [flowData.routerIntentId]),
  );

  // ============ Check Peer Extension ============

  useEffect(() => {
    const check = async () => {
      try {
        const state = await getPeerExtensionState();
        setExtensionState(state);
      } catch {
        setExtensionState("needs_install");
      }
    };
    check();
  }, []);

  // ============ Quote Fetching ============

  const calculateEstimatedEur = useCallback((usdAmount: number): number => {
    const usdcEstimate = usdAmount * 0.999; // ~0.1% ZKP2P fee
    const eurEstimate = usdcEstimate * 0.92; // Approximate USD/EUR rate
    return Math.floor(eurEstimate * 100) / 100;
  }, []);

  // Fetch ZKP2P quotes via proxy (avoids CORS)
  const fetchZkp2pQuotes = useCallback(async (usdAmount: number) => {
    if (!address) return [];

    try {
      const params = new URLSearchParams({
        paymentPlatforms: "venmo",
        fiatCurrency: "USD",
        user: address,
        recipient: address,
        destinationChainId: chainId.toString(),
        destinationToken: USDC_MAINNET_ADDRESS,
        amount: usdAmount.toFixed(2),
        isExactFiat: "true",
        includeNearbyQuotes: "true",
        nearbySearchRange: "20",
      });

      const response = await fetch(`/api/zkp2p-quote?${params.toString()}`);
      if (!response.ok) {
        console.error("ZKP2P proxy error:", response.status);
        return [];
      }

      const data = await response.json();

      if (!data.success || !data.responseObject?.quotes) {
        return [];
      }

      const mapped: ZkpQuote[] = data.responseObject.quotes.map((q: { intent: { depositId: string; escrowAddress: string; processorName: string; amount: string; toAddress: string; payeeDetails: string; fiatCurrencyCode: string }; conversionRate: string; fiatAmount: string; fiatAmountFormatted: string; tokenAmount: string; tokenAmountFormatted: string; paymentMethod: string }) => ({
        depositId: q.intent.depositId,
        escrowAddress: q.intent.escrowAddress,
        processorName: q.intent.processorName,
        amount: q.intent.amount,
        toAddress: q.intent.toAddress,
        payeeDetails: q.intent.payeeDetails,
        fiatCurrencyCode: q.intent.fiatCurrencyCode,
        conversionRate: q.conversionRate,
        fiatAmount: q.fiatAmount,
        fiatAmountFormatted: q.fiatAmountFormatted,
        tokenAmount: q.tokenAmount,
        tokenAmountFormatted: q.tokenAmountFormatted,
        paymentMethod: q.paymentMethod,
      }));

      setZkp2pQuotes(mapped);
      return mapped;
    } catch (err) {
      console.error("ZKP2P quote fetch failed:", err);
      return [];
    }
  }, [address, chainId]);

  // Fetch FreeFlo solver quotes
  const fetchFreefloQuotes = useCallback(async (usdcAmount: bigint) => {
    try {
      const amountNum = Number(usdcAmount) / 1_000_000;
      const response = await fetch(`/api/quote?amount=${amountNum}&currency=EUR`);
      if (response.ok) {
        const data = await response.json();
        setFreefloQuotes(data.quotes || []);
        return data.quotes || [];
      }
    } catch (err) {
      console.error("Failed to fetch FreeFlo quotes:", err);
    }
    return [];
  }, []);

  // Encode hook payload for ZKP2P signalIntent data field
  const encodeHookPayload = useCallback((iban: string, recipientName: string, minEurAmount: bigint): `0x${string}` => {
    return encodeAbiParameters(
      parseAbiParameters("string, string, uint256"),
      [iban, recipientName, minEurAmount]
    );
  }, []);

  // ============ Flow Handlers ============

  const handleStart = () => {
    setStep("input_all");
  };

  const handleInputSubmit = async () => {
    const amount = parseFloat(usdInput);
    if (isNaN(amount) || amount < 10) {
      setError("Minimum amount is $10");
      return;
    }
    if (!ibanInput || ibanInput.length < 15) {
      setError("Please enter a valid IBAN");
      return;
    }
    if (!nameInput || nameInput.length < 2) {
      setError("Please enter the recipient name");
      return;
    }

    const estimatedEur = calculateEstimatedEur(amount);
    const minEur = estimatedEur * (1 - slippagePercent / 100);

    setFlowData((prev) => ({
      ...prev,
      usdAmount: amount,
      eurIban: ibanInput,
      recipientName: nameInput,
      minEurAmount: minEur,
    }));

    setStep("finding_quotes");
    setError(null);

    const quotes = await fetchZkp2pQuotes(amount);
    if (quotes.length > 0) {
      setStep("select_maker");
    } else {
      setError("No Venmo makers available for this amount. Try a different amount.");
      setStep("input_all");
    }
  };

  const handleSelectMaker = (quote: ZkpQuote) => {
    const usdcAmount = BigInt(quote.tokenAmount);
    setFlowData((prev) => ({
      ...prev,
      zkp2pQuote: quote,
      usdcAmount,
      venmoPayee: quote.payeeDetails,
    }));
    setStep("zkp2p_signal");
  };

  const handleSignalIntent = async () => {
    if (!address || !flowData.zkp2pQuote || !zkp2pClient) return;

    const quote = flowData.zkp2pQuote;

    // Encode SEPA details as hook payload
    const hookPayload = encodeHookPayload(
      flowData.eurIban,
      flowData.recipientName,
      BigInt(Math.floor(flowData.minEurAmount * 100)), // EUR cents
    );

    try {
      const hash = await signalIntent({
        depositId: quote.depositId,
        amount: quote.amount,
        toAddress: address,
        processorName: quote.processorName,
        payeeDetails: quote.payeeDetails,
        fiatCurrencyCode: quote.fiatCurrencyCode,
        conversionRate: quote.conversionRate,
        postIntentHook: VENMO_TO_SEPA_ROUTER_ADDRESS,
        data: hookPayload,
      });

      if (hash) {
        setFlowData((prev) => ({ ...prev, zkp2pIntentHash: hash as `0x${string}` }));
        setStep("zkp2p_send_venmo");
      }
    } catch (err: any) {
      console.error("Signal intent failed:", err);
      setError(`Failed to signal intent: ${err.message || "Unknown error"}`);
    }
  };

  const handleVenmoSent = () => {
    setStep("zkp2p_verify");
  };

  const handleVerifyPayment = () => {
    // Open ZKP2P peer extension for verification
    if (extensionState === "ready") {
      try {
        const peerSdk = createPeerExtensionSdk();
        peerSdk.onramp({
          intentHash: flowData.zkp2pIntentHash || undefined,
        });
      } catch (err) {
        console.error("Failed to open peer extension:", err);
      }
    }

    // Move to fulfilling state - the extension handles proof generation + fulfillment
    // We poll for the Router TransferInitiated event to know when it's done
    setStep("zkp2p_fulfilling");
  };

  // Poll for FreeFlo quotes when in router_waiting
  useEffect(() => {
    if (step !== "router_waiting" || !flowData.routerIntentId) return;

    const pollQuotes = async () => {
      const quotes = await fetchFreefloQuotes(flowData.usdcAmount);
      if (quotes.length > 0) {
        const best = quotes[0];
        setFlowData((prev) => ({
          ...prev,
          selectedSolver: best.solver?.address,
          quotedEurAmount: best.outputAmount,
        }));
        setStep("router_commit");
      }
    };

    const interval = setInterval(pollQuotes, 2000);
    pollQuotes();
    return () => clearInterval(interval);
  }, [step, flowData.routerIntentId, flowData.usdcAmount, fetchFreefloQuotes]);

  // Handle Router commit
  const handleRouterCommit = () => {
    if (!flowData.selectedSolver) return;

    routerCommit({
      address: VENMO_TO_SEPA_ROUTER_ADDRESS,
      abi: VENMO_TO_SEPA_ROUTER_ABI,
      functionName: "commit",
      args: [
        flowData.selectedSolver,
        BigInt(Math.floor(flowData.quotedEurAmount * 100)), // EUR cents
      ],
    });
  };

  // Watch for commit confirmation
  useEffect(() => {
    if (isRouterCommitConfirmed && step === "router_commit") {
      setStep("freeflo_pending");
    }
  }, [isRouterCommitConfirmed, step]);

  // ============ Format Helpers ============

  const formatUsd = (amount: number) => `$${amount.toFixed(2)}`;
  const formatEur = (amount: number) => `€${amount.toFixed(2)}`;
  const formatUsdc = (amount: bigint) => `${(Number(amount) / 1_000_000).toFixed(2)} USDC`;

  const getProgress = (): { stage: 1 | 2; percent: number; label: string } => {
    const stage1Steps = ["input_all", "finding_quotes", "select_maker", "zkp2p_signal", "zkp2p_send_venmo", "zkp2p_verify", "zkp2p_fulfilling"];
    const stage2Steps = ["router_waiting", "router_commit", "freeflo_pending"];

    if (stage1Steps.includes(step)) {
      const idx = stage1Steps.indexOf(step);
      return { stage: 1, percent: ((idx + 1) / stage1Steps.length) * 100, label: "Venmo USD → USDC" };
    } else if (stage2Steps.includes(step)) {
      const idx = stage2Steps.indexOf(step);
      return { stage: 2, percent: ((idx + 1) / stage2Steps.length) * 100, label: "USDC → SEPA EUR" };
    }
    return { stage: 1, percent: 0, label: "Getting started" };
  };

  const progress = getProgress();

  const resetFlow = () => {
    setStep("select_flow");
    setFlowData({
      usdAmount: 0, eurIban: "", recipientName: "", minEurAmount: 0,
      zkp2pQuote: null, zkp2pIntentHash: null, venmoPayee: "", usdcAmount: BigInt(0),
      routerIntentId: null, routerIntentCreatedAt: null, selectedSolver: null, quotedEurAmount: 0,
    });
    setUsdInput("");
    setIbanInput("");
    setNameInput("");
    setError(null);
  };

  // ============ Render ============

  if (!isConnected) {
    return (
      <Card sx={{ bgcolor: 'rgba(24,24,27,0.5)', backdropFilter: 'blur(20px)', borderRadius: 6, border: '1px solid #27272a', p: 4, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 2 }}>Connect Wallet</Typography>
        <Typography sx={{ color: '#a1a1aa' }}>Please connect your wallet to continue</Typography>
      </Card>
    );
  }

  return (
    <Box sx={{ bgcolor: 'rgba(24,24,27,0.5)', backdropFilter: 'blur(20px)', borderRadius: 6, border: '1px solid #27272a', overflow: 'hidden' }}>
      {/* Progress Header */}
      {step !== "select_flow" && step !== "success" && (
        <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #27272a', bgcolor: 'rgba(24,24,27,0.3)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, color: '#a1a1aa' }}>
              Stage {progress.stage} of 2: {progress.label}
            </Typography>
            <Typography variant="caption" sx={{ color: '#71717a' }}>
              {Math.round(progress.percent)}%
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Box sx={{ flex: 1, height: 6, bgcolor: '#27272a', borderRadius: '9999px', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', bgcolor: '#3b82f6', borderRadius: '9999px', transition: 'all 500ms', width: progress.stage === 1 ? `${progress.percent}%` : '100%' }} />
            </Box>
            <Box sx={{ flex: 1, height: 6, bgcolor: '#27272a', borderRadius: '9999px', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', bgcolor: '#10b981', borderRadius: '9999px', transition: 'all 500ms', width: progress.stage === 2 ? `${progress.percent}%` : '0%' }} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Typography variant="caption" sx={{ color: '#71717a' }}>ZKP2P (Venmo)</Typography>
            <Typography variant="caption" sx={{ color: '#71717a' }}>FreeFlo (SEPA)</Typography>
          </Box>
        </Box>
      )}

      {/* Deadline Countdown (Stage 2 only) */}
      {progress.stage === 2 && flowData.routerIntentCreatedAt && (
        <Box sx={{
          px: 3, py: 1.5,
          bgcolor: deadlineRemaining < 120 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
          borderBottom: '1px solid #27272a',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Typography variant="body2" sx={{ color: deadlineRemaining < 120 ? '#f87171' : '#fbbf24' }}>
            Quote window
          </Typography>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            fontWeight: 600,
            color: deadlineRemaining < 120 ? '#f87171' : '#fbbf24',
          }}>
            {deadlineRemaining === 0 ? "EXPIRED" : formatCountdown(deadlineRemaining)}
          </Typography>
        </Box>
      )}

      {/* Error Display */}
      {(error || signalError) && (
        <Box sx={{ mx: 3, mt: 2 }}>
          <Alert
            severity="error"
            sx={{ bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, color: '#f87171', '& .MuiAlert-icon': { color: '#f87171' } }}
            action={<Button onClick={() => setError(null)} sx={{ color: 'rgba(248,113,113,0.6)', fontSize: '0.75rem', textTransform: 'none', '&:hover': { color: '#f87171' } }}>Dismiss</Button>}
          >
            <Typography variant="body2">{error || signalError?.message}</Typography>
          </Alert>
        </Box>
      )}

      {/* Main Content */}
      <Box sx={{ p: 3 }}>
        {/* Flow Selection */}
        {step === "select_flow" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Cross-Border Transfer</Typography>
              <Typography sx={{ color: '#a1a1aa' }}>Send money from Venmo (US) to SEPA (Europe)</Typography>
            </Box>

            {/* Extension check */}
            {extensionState === "needs_install" && (
              <Alert severity="warning" sx={{ bgcolor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 3, color: '#fbbf24', '& .MuiAlert-icon': { color: '#fbbf24' } }}>
                <Typography variant="body2">
                  ZKP2P browser extension required.{" "}
                  <a href={PEER_EXTENSION_CHROME_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>Install it here</a>.
                </Typography>
              </Alert>
            )}

            <Button
              onClick={handleStart}
              sx={{
                width: '100%', p: 3,
                background: 'linear-gradient(to bottom right, rgba(59,130,246,0.1), rgba(16,185,129,0.1))',
                border: '1px solid rgba(59,130,246,0.2)', borderRadius: 4, textTransform: 'none',
                '&:hover': { borderColor: 'rgba(59,130,246,0.4)' }, transition: 'all 0.2s', display: 'block', textAlign: 'left',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ width: 48, height: 48, borderRadius: 3, bgcolor: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="h5" sx={{ color: 'white' }}>V</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'white' }}>Venmo USD</Typography>
                    <Typography variant="body2" sx={{ color: '#a1a1aa' }}>US Payment Network</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  <Box sx={{ width: 48, height: 48, borderRadius: 3, bgcolor: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="h5" sx={{ color: 'white' }}>&#8364;</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'white' }}>SEPA EUR</Typography>
                    <Typography variant="body2" sx={{ color: '#a1a1aa' }}>European Bank</Typography>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #27272a', fontSize: '0.875rem' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ color: '#71717a' }}>Estimated time</Typography>
                  <Typography variant="body2" sx={{ color: '#d4d4d8' }}>2-5 minutes</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                  <Typography variant="body2" sx={{ color: '#71717a' }}>Powered by</Typography>
                  <Typography variant="body2" sx={{ color: '#d4d4d8' }}>ZKP2P + FreeFlo</Typography>
                </Box>
              </Box>
            </Button>
          </Box>
        )}

        {/* Input All (Amount + IBAN + Name) */}
        {step === "input_all" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Transfer Details</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Enter amount and destination</Typography>
            </Box>

            {/* Amount */}
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.5)', borderRadius: 4, p: 2 }}>
              <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>You send</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                <Typography sx={{ fontSize: '1.875rem', color: '#a1a1aa' }}>$</Typography>
                <Box
                  component="input" type="number" value={usdInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsdInput(e.target.value)}
                  placeholder="0.00"
                  sx={{ flex: 1, bgcolor: 'transparent', fontSize: '1.875rem', fontWeight: 600, color: 'white', outline: 'none', border: 'none', '&::placeholder': { color: '#52525b' } }}
                />
                <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(59,130,246,0.2)', color: '#60a5fa', borderRadius: 2, fontSize: '0.875rem', fontWeight: 500 }}>USD</Box>
              </Box>
            </Box>

            {/* IBAN */}
            <Box>
              <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>Recipient IBAN</Typography>
              <Box
                component="input" type="text" value={ibanInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIbanInput(e.target.value.toUpperCase())}
                placeholder="DE89 3704 0044 0532 0130 00"
                sx={{ width: '100%', px: 2, py: 1.5, bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3, color: 'white', outline: 'none', fontSize: '1rem', '&::placeholder': { color: '#52525b' }, '&:focus': { borderColor: 'rgba(16,185,129,0.5)' }, boxSizing: 'border-box' }}
              />
            </Box>

            {/* Recipient Name */}
            <Box>
              <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>Recipient Name</Typography>
              <Box
                component="input" type="text" value={nameInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNameInput(e.target.value)}
                placeholder="John Doe"
                sx={{ width: '100%', px: 2, py: 1.5, bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3, color: 'white', outline: 'none', fontSize: '1rem', '&::placeholder': { color: '#52525b' }, '&:focus': { borderColor: 'rgba(16,185,129,0.5)' }, boxSizing: 'border-box' }}
              />
            </Box>

            {/* Estimate */}
            {usdInput && parseFloat(usdInput) >= 10 && (
              <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: '#a1a1aa' }}>Estimated EUR received</Typography>
                  <Typography sx={{ color: '#34d399', fontWeight: 600 }}>{formatEur(calculateEstimatedEur(parseFloat(usdInput)))}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                  <Typography variant="body2" sx={{ color: '#71717a' }}>Slippage tolerance</Typography>
                  <Typography variant="body2" sx={{ color: '#a1a1aa' }}>{slippagePercent}%</Typography>
                </Box>
              </Box>
            )}

            <Button
              onClick={handleInputSubmit}
              disabled={!usdInput || parseFloat(usdInput) < 10 || !ibanInput || !nameInput}
              sx={{
                width: '100%', py: 2, borderRadius: 3,
                background: 'linear-gradient(to right, #3b82f6, #10b981)',
                color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none',
                '&:disabled': { opacity: 0.5, cursor: 'not-allowed' }, '&:hover': { opacity: 0.9 },
              }}
            >
              Find Makers
            </Button>
            <Typography variant="caption" sx={{ textAlign: 'center', color: '#71717a', display: 'block' }}>Minimum: $10</Typography>
          </Box>
        )}

        {/* Finding Quotes */}
        {step === "finding_quotes" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Finding Makers</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>Searching for Venmo liquidity providers...</Typography>
          </Box>
        )}

        {/* Select Maker */}
        {step === "select_maker" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Select a Maker</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Choose who to exchange with for {formatUsd(flowData.usdAmount)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {zkp2pQuotes.map((quote) => (
                <Button
                  key={quote.depositId}
                  onClick={() => handleSelectMaker(quote)}
                  sx={{
                    width: '100%', p: 2, bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3,
                    textTransform: 'none', textAlign: 'left', '&:hover': { borderColor: 'rgba(59,130,246,0.5)' }, transition: 'all 0.2s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', fontWeight: 600 }}>
                        {quote.depositId.slice(0, 4)}
                      </Box>
                      <Box>
                        <Typography sx={{ color: 'white', fontWeight: 500 }}>Deposit #{quote.depositId.slice(0, 8)}</Typography>
                        <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Rate: {Number(quote.conversionRate).toFixed(4)}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ color: '#34d399', fontWeight: 600 }}>{quote.tokenAmountFormatted} USDC</Typography>
                      <Typography variant="caption" sx={{ color: '#71717a' }}>for {quote.fiatAmountFormatted}</Typography>
                    </Box>
                  </Box>
                </Button>
              ))}
            </Box>
          </Box>
        )}

        {/* Signal ZKP2P Intent */}
        {step === "zkp2p_signal" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Confirm Order</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Lock the maker&apos;s USDC for your transfer</Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>You send</Typography>
                <Typography sx={{ color: 'white' }}>{formatUsd(flowData.usdAmount)} via Venmo</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>You receive</Typography>
                <Typography sx={{ color: '#34d399' }}>{formatUsdc(flowData.usdcAmount)} → ~{formatEur(flowData.minEurAmount)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>Destination</Typography>
                <Typography sx={{ color: 'white', fontFamily: 'monospace', fontSize: '0.75rem' }}>{flowData.eurIban.slice(0, 12)}...</Typography>
              </Box>
            </Box>
            <Alert severity="info" sx={{ bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 3, color: '#93c5fd', '& .MuiAlert-icon': { color: '#93c5fd' } }}>
              <Typography variant="body2">Your SEPA details are encoded on-chain. After Venmo verification, USDC will automatically flow to FreeFlo for EUR conversion.</Typography>
            </Alert>
            <Button
              onClick={handleSignalIntent}
              disabled={isSignaling}
              sx={{
                width: '100%', py: 2, borderRadius: 3, bgcolor: '#3b82f6', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none',
                '&:hover': { bgcolor: '#2563eb' }, '&:disabled': { opacity: 0.5 },
              }}
            >
              {isSignaling ? <CircularProgress size={24} sx={{ color: 'white' }} /> : "Signal Intent"}
            </Button>
          </Box>
        )}

        {/* Send Venmo */}
        {step === "zkp2p_send_venmo" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Send Venmo Payment</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Send exactly {formatUsd(flowData.usdAmount)} to the maker</Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 3, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: 3, bgcolor: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="h6" sx={{ color: '#60a5fa' }}>V</Typography>
                </Box>
                <Box>
                  <Typography sx={{ color: 'white', fontWeight: 600 }}>Venmo</Typography>
                  <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Open Venmo and send payment to the maker</Typography>
                </Box>
              </Box>
              <Box sx={{ bgcolor: 'rgba(24,24,27,0.5)', borderRadius: 2, p: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>Amount</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'white' }}>{formatUsd(flowData.usdAmount)}</Typography>
              </Box>
            </Box>
            <Button
              onClick={handleVenmoSent}
              sx={{ width: '100%', py: 2, borderRadius: 3, bgcolor: '#3b82f6', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none', '&:hover': { bgcolor: '#2563eb' } }}
            >
              I&apos;ve Sent the Payment
            </Button>
          </Box>
        )}

        {/* Verify with ZKP2P */}
        {step === "zkp2p_verify" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Verify Payment</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Use ZKP2P extension to prove your payment</Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.5)', borderRadius: 3, p: 3, textAlign: 'center' }}>
              <Box sx={{ width: 64, height: 64, bgcolor: 'rgba(63,63,70,0.5)', borderRadius: 4, mx: 'auto', mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </Box>
              {extensionState === "ready" ? (
                <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Click below to open the ZKP2P extension and verify your Venmo payment</Typography>
              ) : (
                <Typography variant="body2" sx={{ color: '#fbbf24' }}>
                  ZKP2P extension not detected.{" "}
                  <a href={PEER_EXTENSION_CHROME_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>Install it</a> and refresh.
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: '#71717a', mt: 1, display: 'block' }}>Zero-knowledge proof - your email stays private</Typography>
            </Box>
            <Button
              onClick={handleVerifyPayment}
              sx={{ width: '100%', py: 2, borderRadius: 3, bgcolor: '#3b82f6', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none', '&:hover': { bgcolor: '#2563eb' } }}
            >
              Verify with ZKP2P
            </Button>
          </Box>
        )}

        {/* ZKP2P Fulfilling */}
        {step === "zkp2p_fulfilling" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Completing ZKP2P Transfer</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>Releasing USDC and creating SEPA intent...</Typography>
            <Typography variant="body2" sx={{ color: '#71717a', mt: 1 }}>Waiting for on-chain confirmation</Typography>
          </Box>
        )}

        {/* Router Waiting for Quotes */}
        {step === "router_waiting" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#10b981', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Waiting for SEPA Quote</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>FreeFlo solver is preparing your quote...</Typography>
          </Box>
        )}

        {/* Router Commit */}
        {step === "router_commit" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Confirm SEPA Transfer</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Review and commit to the quote</Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>USDC deposited</Typography>
                <Typography sx={{ color: 'white' }}>{formatUsdc(flowData.usdcAmount)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>EUR to receive</Typography>
                <Typography sx={{ color: '#34d399', fontWeight: 600 }}>{formatEur(flowData.quotedEurAmount)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>Destination</Typography>
                <Typography sx={{ color: 'white', fontFamily: 'monospace', fontSize: '0.75rem' }}>{flowData.eurIban}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>Recipient</Typography>
                <Typography sx={{ color: 'white' }}>{flowData.recipientName}</Typography>
              </Box>
            </Box>

            {/* Deadline warning */}
            {deadlineRemaining < 300 && deadlineRemaining > 0 && (
              <Alert severity="warning" sx={{ bgcolor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 3, color: '#fbbf24', '& .MuiAlert-icon': { color: '#fbbf24' } }}>
                <Typography variant="body2">Quote window closes in {formatCountdown(deadlineRemaining)}. Commit now to avoid expiry.</Typography>
              </Alert>
            )}
            {deadlineRemaining === 0 && (
              <Alert severity="error" sx={{ bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, color: '#f87171', '& .MuiAlert-icon': { color: '#f87171' } }}>
                <Typography variant="body2">Quote window has expired. The intent can no longer be committed.</Typography>
              </Alert>
            )}

            <Button
              onClick={handleRouterCommit}
              disabled={deadlineRemaining === 0}
              sx={{
                width: '100%', py: 2, borderRadius: 3, bgcolor: '#10b981', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none',
                '&:hover': { bgcolor: '#059669' }, '&:disabled': { opacity: 0.5 },
              }}
            >
              Confirm &amp; Send EUR
            </Button>
          </Box>
        )}

        {/* FreeFlo Pending */}
        {step === "freeflo_pending" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#10b981', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Sending SEPA Transfer</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>FreeFlo solver is sending EUR to your bank...</Typography>
            <Typography variant="body2" sx={{ color: '#71717a', mt: 1 }}>This usually takes 10-15 seconds</Typography>
          </Box>
        )}

        {/* Success */}
        {step === "success" && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Box sx={{ width: 80, height: 80, background: 'linear-gradient(to bottom right, #10b981, #14b8a6)', borderRadius: '50%', mx: 'auto', mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Transfer Complete!</Typography>
            <Typography sx={{ color: '#a1a1aa', mb: 3 }}>Your money is on its way</Typography>

            <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 3, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', pb: 2, borderBottom: '1px solid #3f3f46' }}>
                <Typography sx={{ color: '#a1a1aa' }}>You sent</Typography>
                <Typography sx={{ color: 'white', fontWeight: 600 }}>{formatUsd(flowData.usdAmount)} via Venmo</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>Recipient receives</Typography>
                <Typography sx={{ color: '#34d399', fontWeight: 600 }}>{formatEur(flowData.quotedEurAmount)} via SEPA</Typography>
              </Box>
            </Box>

            <Button
              onClick={resetFlow}
              sx={{ mt: 3, px: 3, py: 1.5, borderRadius: 3, bgcolor: '#27272a', color: 'white', fontWeight: 500, fontSize: '1rem', textTransform: 'none', '&:hover': { bgcolor: '#3f3f46' } }}
            >
              Start New Transfer
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
