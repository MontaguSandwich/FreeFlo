"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { parseUnits, formatUnits, encodeAbiParameters, parseAbiParameters } from "viem";
import {
  ZKP2PPaymentMethod,
  calculateUsdcFromUsd,
  type ZKP2PQuote,
} from "@/lib/zkp2p-contracts";
import {
  OFFRAMP_V3_ADDRESS,
  IntentStatus,
  OFFRAMP_V2_ABI,
  ERC20_ABI,
} from "@/lib/contracts";
import {
  VENMO_TO_SEPA_ROUTER_ADDRESS,
  VENMO_TO_SEPA_ROUTER_ABI,
  RouterTransferStatus,
  type PendingTransfer,
} from "@/lib/router-contracts";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";

// Flow steps - simplified with Router
type FlowStep =
  // Initial input (collect ALL info upfront)
  | "select_flow"
  | "input_all"           // Amount + IBAN + recipient (needed for hook payload)
  | "finding_quotes"      // Find ZKP2P makers
  | "select_maker"        // Select ZKP2P maker
  // ZKP2P flow
  | "zkp2p_signal"        // Signal intent with Router hook
  | "zkp2p_send_venmo"    // User sends Venmo payment
  | "zkp2p_verify"        // User verifies with ZKP2P extension
  | "zkp2p_fulfilling"    // ZKP2P fulfilling (hook creates FreeFlo intent)
  // Router/FreeFlo flow
  | "router_waiting"      // Waiting for FreeFlo solver quotes
  | "router_commit"       // User commits via Router
  | "freeflo_pending"     // Solver fulfilling SEPA
  // Final
  | "success"
  | "error";

// Flow data
interface FlowData {
  // User inputs (collected upfront)
  usdAmount: number;
  eurIban: string;
  recipientName: string;
  minEurAmount: number;     // Slippage protection

  // ZKP2P stage
  zkp2pQuote: ZKP2PQuote | null;
  zkp2pIntentHash: `0x${string}` | null;
  venmoRecipient: string;
  usdcAmount: bigint;

  // Router/FreeFlo stage
  routerIntentId: `0x${string}` | null;
  selectedSolver: `0x${string}` | null;
  quotedEurAmount: number;
}

// Mock ZKP2P quotes (until SDK integration)
const MOCK_ZKP2P_QUOTES: ZKP2PQuote[] = [
  {
    depositId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    maker: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    availableUsdc: BigInt(10000_000000),
    usdRate: 1.001,
    paymentMethod: ZKP2PPaymentMethod.VENMO,
    minUsd: 10,
  },
  {
    depositId: "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`,
    maker: "0x2345678901234567890123456789012345678901" as `0x${string}`,
    availableUsdc: BigInt(5000_000000),
    usdRate: 1.005,
    paymentMethod: ZKP2PPaymentMethod.VENMO,
    minUsd: 50,
  },
];

export function VenmoToSepaFlow() {
  const { address, isConnected } = useAccount();

  // Flow state
  const [step, setStep] = useState<FlowStep>("select_flow");
  const [flowData, setFlowData] = useState<FlowData>({
    usdAmount: 0,
    eurIban: "",
    recipientName: "",
    minEurAmount: 0,
    zkp2pQuote: null,
    zkp2pIntentHash: null,
    venmoRecipient: "",
    usdcAmount: BigInt(0),
    routerIntentId: null,
    selectedSolver: null,
    quotedEurAmount: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Form inputs
  const [usdInput, setUsdInput] = useState("");
  const [ibanInput, setIbanInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [slippagePercent, setSlippagePercent] = useState(2); // 2% default slippage

  // ZKP2P quotes
  const [zkp2pQuotes, setZkp2pQuotes] = useState<ZKP2PQuote[]>([]);

  // FreeFlo quotes for the Router intent
  const [freefloQuotes, setFreefloQuotes] = useState<any[]>([]);

  // Contract interactions
  const { writeContract: routerCommit, data: routerCommitHash } = useWriteContract();
  const { writeContract: routerCancel, data: routerCancelHash } = useWriteContract();

  const { isSuccess: isRouterCommitConfirmed } = useWaitForTransactionReceipt({ hash: routerCommitHash });

  // Read pending transfer from Router
  const { data: pendingTransfer, refetch: refetchPendingTransfer } = useReadContract({
    address: VENMO_TO_SEPA_ROUTER_ADDRESS,
    abi: VENMO_TO_SEPA_ROUTER_ABI,
    functionName: "getPendingTransfer",
    args: address ? [address] : undefined,
    query: { enabled: !!address && step.startsWith("router") },
  });

  // Watch for Router TransferInitiated event
  useWatchContractEvent({
    address: VENMO_TO_SEPA_ROUTER_ADDRESS,
    abi: VENMO_TO_SEPA_ROUTER_ABI,
    eventName: "TransferInitiated",
    onLogs(logs) {
      const log = logs.find((l) => l.args.user?.toLowerCase() === address?.toLowerCase());
      if (log && step === "zkp2p_fulfilling") {
        setFlowData((prev) => ({
          ...prev,
          routerIntentId: log.args.intentId as `0x${string}`,
        }));
        setStep("router_waiting");
      }
    },
  });

  // Watch for FreeFlo IntentFulfilled event
  useWatchContractEvent({
    address: OFFRAMP_V3_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    eventName: "IntentFulfilled",
    onLogs(logs) {
      const log = logs.find((l) => l.args.intentId === flowData.routerIntentId);
      if (log && step === "freeflo_pending") {
        setStep("success");
      }
    },
  });

  // Calculate estimated EUR output
  const calculateEstimatedEur = useCallback((usdAmount: number): number => {
    const usdcEstimate = usdAmount * 0.999; // 0.1% ZKP2P fee estimate
    const eurEstimate = usdcEstimate * 0.92; // Approximate EUR rate
    return Math.floor(eurEstimate * 100) / 100;
  }, []);

  // Fetch ZKP2P quotes
  const fetchZkp2pQuotes = useCallback(async (usdAmount: number) => {
    // TODO: Replace with actual ZKP2P SDK call
    const filtered = MOCK_ZKP2P_QUOTES.filter(
      (q) => usdAmount >= q.minUsd && calculateUsdcFromUsd(usdAmount, q.usdRate) <= q.availableUsdc
    );
    setZkp2pQuotes(filtered);
    return filtered;
  }, []);

  // Fetch FreeFlo quotes
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

  // Encode hook payload for ZKP2P fulfillIntent
  const encodeHookPayload = useCallback((iban: string, recipientName: string, minEurAmount: bigint): `0x${string}` => {
    return encodeAbiParameters(
      parseAbiParameters("string, string, uint256"),
      [iban, recipientName, minEurAmount]
    );
  }, []);

  // Handle flow start
  const handleStart = () => {
    setStep("input_all");
  };

  // Handle initial input submission (amount + IBAN + name)
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
    const quotes = await fetchZkp2pQuotes(amount);

    if (quotes.length > 0) {
      setStep("select_maker");
    } else {
      setError("No makers available for this amount. Try a different amount.");
      setStep("input_all");
    }
  };

  // Handle maker selection
  const handleSelectMaker = (quote: ZKP2PQuote) => {
    const usdcAmount = calculateUsdcFromUsd(flowData.usdAmount, quote.usdRate);
    setFlowData((prev) => ({
      ...prev,
      zkp2pQuote: quote,
      usdcAmount: usdcAmount,
      venmoRecipient: "@zkp2p-maker-" + quote.maker.slice(2, 8),
    }));
    setStep("zkp2p_signal");
  };

  // Handle ZKP2P intent signal (with Router hook)
  const handleSignalIntent = async () => {
    if (!address || !flowData.zkp2pQuote) return;

    // Encode the hook payload with SEPA details
    const hookPayload = encodeHookPayload(
      flowData.eurIban,
      flowData.recipientName,
      BigInt(Math.floor(flowData.minEurAmount * 100)) // EUR in cents
    );

    // TODO: Call ZKP2P SDK signalIntent with:
    // - depositId: flowData.zkp2pQuote.depositId
    // - amount: flowData.usdcAmount
    // - recipient: address (user gets USDC via Router hook)
    // - postIntentHook: VENMO_TO_SEPA_ROUTER_ADDRESS
    // - postIntentHookData: hookPayload

    console.log("Would signal ZKP2P intent with Router hook:", {
      depositId: flowData.zkp2pQuote.depositId,
      amount: flowData.usdcAmount,
      recipient: address,
      postIntentHook: VENMO_TO_SEPA_ROUTER_ADDRESS,
      hookPayload: hookPayload,
    });

    // Simulate intent hash for demo
    const mockIntentHash = `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`;
    setFlowData((prev) => ({ ...prev, zkp2pIntentHash: mockIntentHash }));
    setStep("zkp2p_send_venmo");
  };

  // Handle Venmo sent
  const handleVenmoSent = () => {
    setStep("zkp2p_verify");
  };

  // Handle ZKP2P verification (user uses extension)
  const handleVerifyPayment = () => {
    // TODO: This would trigger the ZKP2P extension
    // For now, simulate the fulfillment process
    setStep("zkp2p_fulfilling");

    // Simulate ZKP2P fulfillment + Router hook execution
    setTimeout(() => {
      // Simulate Router creating FreeFlo intent
      const mockIntentId = `0x${(Date.now() + 1).toString(16).padStart(64, "0")}` as `0x${string}`;
      setFlowData((prev) => ({ ...prev, routerIntentId: mockIntentId }));
      setStep("router_waiting");

      // Fetch FreeFlo quotes
      fetchFreefloQuotes(flowData.usdcAmount);
    }, 3000);
  };

  // Poll for FreeFlo quotes when in router_waiting
  useEffect(() => {
    if (step !== "router_waiting" || !flowData.routerIntentId) return;

    const pollQuotes = async () => {
      const quotes = await fetchFreefloQuotes(flowData.usdcAmount);
      if (quotes.length > 0) {
        // Auto-select best quote
        const best = quotes[0];
        setFlowData((prev) => ({
          ...prev,
          selectedSolver: best.solver?.address,
          quotedEurAmount: best.outputAmount,
        }));
        setStep("router_commit");
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(pollQuotes, 2000);
    pollQuotes(); // Initial fetch

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
        BigInt(Math.floor(flowData.quotedEurAmount * 100)), // EUR in cents
      ],
    });
  };

  // Watch for commit confirmation
  useEffect(() => {
    if (isRouterCommitConfirmed && step === "router_commit") {
      setStep("freeflo_pending");
    }
  }, [isRouterCommitConfirmed, step]);

  // Format helpers
  const formatUsd = (amount: number) => `$${amount.toFixed(2)}`;
  const formatEur = (amount: number) => `€${amount.toFixed(2)}`;
  const formatUsdc = (amount: bigint) => `${(Number(amount) / 1_000_000).toFixed(2)} USDC`;

  // Progress calculation
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

  // Reset flow
  const resetFlow = () => {
    setStep("select_flow");
    setFlowData({
      usdAmount: 0, eurIban: "", recipientName: "", minEurAmount: 0,
      zkp2pQuote: null, zkp2pIntentHash: null, venmoRecipient: "", usdcAmount: BigInt(0),
      routerIntentId: null, selectedSolver: null, quotedEurAmount: 0,
    });
    setUsdInput("");
    setIbanInput("");
    setNameInput("");
    setError(null);
  };

  if (!isConnected) {
    return (
      <Card
        sx={{
          bgcolor: 'rgba(24,24,27,0.5)',
          backdropFilter: 'blur(20px)',
          borderRadius: 6,
          border: '1px solid #27272a',
          p: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 2 }}>
          Connect Wallet
        </Typography>
        <Typography sx={{ color: '#a1a1aa' }}>
          Please connect your wallet to continue
        </Typography>
      </Card>
    );
  }

  return (
    <Box
      sx={{
        bgcolor: 'rgba(24,24,27,0.5)',
        backdropFilter: 'blur(20px)',
        borderRadius: 6,
        border: '1px solid #27272a',
        overflow: 'hidden',
      }}
    >
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
              <Box
                sx={{
                  height: '100%',
                  bgcolor: '#3b82f6',
                  borderRadius: '9999px',
                  transition: 'all 500ms',
                  width: progress.stage === 1 ? `${progress.percent}%` : '100%',
                }}
              />
            </Box>
            <Box sx={{ flex: 1, height: 6, bgcolor: '#27272a', borderRadius: '9999px', overflow: 'hidden' }}>
              <Box
                sx={{
                  height: '100%',
                  bgcolor: '#10b981',
                  borderRadius: '9999px',
                  transition: 'all 500ms',
                  width: progress.stage === 2 ? `${progress.percent}%` : '0%',
                }}
              />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Typography variant="caption" sx={{ color: '#71717a' }}>ZKP2P (Venmo)</Typography>
            <Typography variant="caption" sx={{ color: '#71717a' }}>FreeFlo (SEPA)</Typography>
          </Box>
        </Box>
      )}

      {/* Error Display */}
      {error && (
        <Box sx={{ mx: 3, mt: 2 }}>
          <Alert
            severity="error"
            sx={{
              bgcolor: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 3,
              color: '#f87171',
              '& .MuiAlert-icon': { color: '#f87171' },
            }}
            action={
              <Button
                onClick={() => setError(null)}
                sx={{ color: 'rgba(248,113,113,0.6)', fontSize: '0.75rem', textTransform: 'none', '&:hover': { color: '#f87171' } }}
              >
                Dismiss
              </Button>
            }
          >
            <Typography variant="body2">{error}</Typography>
          </Alert>
        </Box>
      )}

      {/* Main Content */}
      <Box sx={{ p: 3 }}>
        {/* Flow Selection */}
        {step === "select_flow" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
                Cross-Border Transfer
              </Typography>
              <Typography sx={{ color: '#a1a1aa' }}>
                Send money from Venmo (US) to SEPA (Europe)
              </Typography>
            </Box>

            <Button
              onClick={handleStart}
              sx={{
                width: '100%',
                p: 3,
                background: 'linear-gradient(to bottom right, rgba(59,130,246,0.1), rgba(16,185,129,0.1))',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 4,
                textTransform: 'none',
                '&:hover': { borderColor: 'rgba(59,130,246,0.4)' },
                transition: 'all 0.2s',
                display: 'block',
                textAlign: 'left',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 3,
                      bgcolor: 'rgba(59,130,246,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="h5" sx={{ color: 'white' }}>V</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'white' }}>
                      Venmo USD
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                      US Payment Network
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 3,
                      bgcolor: 'rgba(16,185,129,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="h5" sx={{ color: 'white' }}>€</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'white' }}>
                      SEPA EUR
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                      European Bank
                    </Typography>
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
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Transfer Details
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Enter amount and destination
              </Typography>
            </Box>

            {/* Amount */}
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.5)', borderRadius: 4, p: 2 }}>
              <Typography
                variant="caption"
                sx={{ color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                You send
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                <Typography sx={{ fontSize: '1.875rem', color: '#a1a1aa' }}>$</Typography>
                <Box
                  component="input"
                  type="number"
                  value={usdInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsdInput(e.target.value)}
                  placeholder="0.00"
                  sx={{
                    flex: 1,
                    bgcolor: 'transparent',
                    fontSize: '1.875rem',
                    fontWeight: 600,
                    color: 'white',
                    outline: 'none',
                    border: 'none',
                    '&::placeholder': { color: '#52525b' },
                  }}
                />
                <Box
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    bgcolor: 'rgba(59,130,246,0.2)',
                    color: '#60a5fa',
                    borderRadius: 2,
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  USD
                </Box>
              </Box>
            </Box>

            {/* IBAN */}
            <Box>
              <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>
                Recipient IBAN
              </Typography>
              <Box
                component="input"
                type="text"
                value={ibanInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIbanInput(e.target.value.toUpperCase())}
                placeholder="DE89 3704 0044 0532 0130 00"
                sx={{
                  width: '100%',
                  px: 2,
                  py: 1.5,
                  bgcolor: 'rgba(39,39,42,0.5)',
                  border: '1px solid #3f3f46',
                  borderRadius: 3,
                  color: 'white',
                  outline: 'none',
                  fontSize: '1rem',
                  '&::placeholder': { color: '#52525b' },
                  '&:focus': { borderColor: 'rgba(16,185,129,0.5)' },
                  boxSizing: 'border-box',
                }}
              />
            </Box>

            {/* Recipient Name */}
            <Box>
              <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>
                Recipient Name
              </Typography>
              <Box
                component="input"
                type="text"
                value={nameInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNameInput(e.target.value)}
                placeholder="John Doe"
                sx={{
                  width: '100%',
                  px: 2,
                  py: 1.5,
                  bgcolor: 'rgba(39,39,42,0.5)',
                  border: '1px solid #3f3f46',
                  borderRadius: 3,
                  color: 'white',
                  outline: 'none',
                  fontSize: '1rem',
                  '&::placeholder': { color: '#52525b' },
                  '&:focus': { borderColor: 'rgba(16,185,129,0.5)' },
                  boxSizing: 'border-box',
                }}
              />
            </Box>

            {/* Estimate */}
            {usdInput && parseFloat(usdInput) >= 10 && (
              <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ color: '#a1a1aa' }}>Estimated EUR received</Typography>
                  <Typography sx={{ color: '#34d399', fontWeight: 600 }}>
                    {formatEur(calculateEstimatedEur(parseFloat(usdInput)))}
                  </Typography>
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
                width: '100%',
                py: 2,
                borderRadius: 3,
                background: 'linear-gradient(to right, #3b82f6, #10b981)',
                color: 'white',
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
                '&:hover': { opacity: 0.9 },
              }}
            >
              Find Makers
            </Button>
            <Typography variant="caption" sx={{ textAlign: 'center', color: '#71717a', display: 'block' }}>
              Minimum: $10
            </Typography>
          </Box>
        )}

        {/* Finding Quotes */}
        {step === "finding_quotes" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
              Finding Makers
            </Typography>
            <Typography sx={{ color: '#a1a1aa' }}>
              Searching for Venmo liquidity providers...
            </Typography>
          </Box>
        )}

        {/* Select Maker */}
        {step === "select_maker" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Select a Maker
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Choose who to exchange with for {formatUsd(flowData.usdAmount)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {zkp2pQuotes.map((quote) => {
                const usdcOut = calculateUsdcFromUsd(flowData.usdAmount, quote.usdRate);
                return (
                  <Button
                    key={quote.depositId}
                    onClick={() => handleSelectMaker(quote)}
                    sx={{
                      width: '100%',
                      p: 2,
                      bgcolor: 'rgba(39,39,42,0.5)',
                      border: '1px solid #3f3f46',
                      borderRadius: 3,
                      textTransform: 'none',
                      textAlign: 'left',
                      '&:hover': { borderColor: 'rgba(59,130,246,0.5)' },
                      transition: 'all 0.2s',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box
                          sx={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            bgcolor: 'rgba(59,130,246,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#60a5fa',
                            fontWeight: 600,
                          }}
                        >
                          {quote.maker.slice(2, 4).toUpperCase()}
                        </Box>
                        <Box>
                          <Typography sx={{ color: 'white', fontWeight: 500 }}>
                            Maker {quote.maker.slice(0, 8)}...
                          </Typography>
                          <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                            Rate: ${quote.usdRate.toFixed(4)} per USDC
                          </Typography>
                        </Box>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography sx={{ color: '#34d399', fontWeight: 600 }}>
                          {formatUsdc(usdcOut)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#71717a' }}>
                          Available: {formatUsdc(quote.availableUsdc)}
                        </Typography>
                      </Box>
                    </Box>
                  </Button>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Signal ZKP2P Intent */}
        {step === "zkp2p_signal" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Confirm Order
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Lock the maker&apos;s USDC for your transfer
              </Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.3)', borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>You send</Typography>
                <Typography sx={{ color: 'white' }}>{formatUsd(flowData.usdAmount)} via Venmo</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>You receive</Typography>
                <Typography sx={{ color: '#34d399' }}>
                  {formatUsdc(flowData.usdcAmount)} → ~{formatEur(flowData.minEurAmount)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: '#a1a1aa' }}>Destination</Typography>
                <Typography sx={{ color: 'white', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {flowData.eurIban.slice(0, 12)}...
                </Typography>
              </Box>
            </Box>
            <Alert
              severity="info"
              sx={{
                bgcolor: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 3,
                color: '#93c5fd',
                '& .MuiAlert-icon': { color: '#93c5fd' },
              }}
            >
              <Typography variant="body2">
                Your SEPA details are encoded in the ZKP2P intent. After verification, USDC will automatically flow to FreeFlo.
              </Typography>
            </Alert>
            <Button
              onClick={handleSignalIntent}
              sx={{
                width: '100%',
                py: 2,
                borderRadius: 3,
                bgcolor: '#3b82f6',
                color: 'white',
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#2563eb' },
              }}
            >
              Signal Intent
            </Button>
          </Box>
        )}

        {/* Send Venmo */}
        {step === "zkp2p_send_venmo" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Send Venmo Payment
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Send exactly {formatUsd(flowData.usdAmount)} to the maker
              </Typography>
            </Box>
            <Box
              sx={{
                bgcolor: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: 3,
                p: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    bgcolor: 'rgba(59,130,246,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography variant="h6" sx={{ color: '#60a5fa' }}>V</Typography>
                </Box>
                <Box>
                  <Typography sx={{ color: 'white', fontWeight: 600 }}>Venmo</Typography>
                  <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                    Send to: {flowData.venmoRecipient}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ bgcolor: 'rgba(24,24,27,0.5)', borderRadius: 2, p: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                  Amount
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'white' }}>
                  {formatUsd(flowData.usdAmount)}
                </Typography>
              </Box>
            </Box>
            <Button
              onClick={handleVenmoSent}
              sx={{
                width: '100%',
                py: 2,
                borderRadius: 3,
                bgcolor: '#3b82f6',
                color: 'white',
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#2563eb' },
              }}
            >
              I&apos;ve Sent the Payment
            </Button>
          </Box>
        )}

        {/* Verify with ZKP2P */}
        {step === "zkp2p_verify" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Verify Payment
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Use ZKP2P extension to prove your payment
              </Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.5)', borderRadius: 3, p: 3, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: 'rgba(63,63,70,0.5)',
                  borderRadius: 4,
                  mx: 'auto',
                  mb: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </Box>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                ZKP2P verifies your Venmo payment confirmation
              </Typography>
              <Typography variant="caption" sx={{ color: '#71717a', mt: 1, display: 'block' }}>
                Zero-knowledge proof - your email stays private
              </Typography>
            </Box>
            <Button
              onClick={handleVerifyPayment}
              sx={{
                width: '100%',
                py: 2,
                borderRadius: 3,
                bgcolor: '#3b82f6',
                color: 'white',
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#2563eb' },
              }}
            >
              Verify with ZKP2P
            </Button>
          </Box>
        )}

        {/* ZKP2P Fulfilling */}
        {step === "zkp2p_fulfilling" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
              Completing ZKP2P Transfer
            </Typography>
            <Typography sx={{ color: '#a1a1aa' }}>
              Releasing USDC and creating SEPA intent...
            </Typography>
          </Box>
        )}

        {/* Router Waiting for Quotes */}
        {step === "router_waiting" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#10b981', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
              Waiting for SEPA Quote
            </Typography>
            <Typography sx={{ color: '#a1a1aa' }}>
              FreeFlo solver is preparing your quote...
            </Typography>
          </Box>
        )}

        {/* Router Commit */}
        {step === "router_commit" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>
                Confirm SEPA Transfer
              </Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>
                Review and commit to the quote
              </Typography>
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
            <Button
              onClick={handleRouterCommit}
              sx={{
                width: '100%',
                py: 2,
                borderRadius: 3,
                bgcolor: '#10b981',
                color: 'white',
                fontWeight: 600,
                fontSize: '1rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#059669' },
              }}
            >
              Confirm & Send EUR
            </Button>
          </Box>
        )}

        {/* FreeFlo Pending */}
        {step === "freeflo_pending" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#10b981', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
              Sending SEPA Transfer
            </Typography>
            <Typography sx={{ color: '#a1a1aa' }}>
              FreeFlo solver is sending EUR to your bank...
            </Typography>
            <Typography variant="body2" sx={{ color: '#71717a', mt: 1 }}>
              This usually takes 10-15 seconds
            </Typography>
          </Box>
        )}

        {/* Success */}
        {step === "success" && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                background: 'linear-gradient(to bottom right, #10b981, #14b8a6)',
                borderRadius: '50%',
                mx: 'auto',
                mb: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
              Transfer Complete!
            </Typography>
            <Typography sx={{ color: '#a1a1aa', mb: 3 }}>
              Your money is on its way
            </Typography>

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
              sx={{
                mt: 3,
                px: 3,
                py: 1.5,
                borderRadius: 3,
                bgcolor: '#27272a',
                color: 'white',
                fontWeight: 500,
                fontSize: '1rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#3f3f46' },
              }}
            >
              Start New Transfer
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
