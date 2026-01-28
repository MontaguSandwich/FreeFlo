"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { parseUnits, formatUnits, encodeAbiParameters, parseAbiParameters } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  ZKP2PPaymentMethod,
  USDC_MAINNET_ADDRESS,
  calculateUsdcFromUsd,
  type ZKP2PQuote,
} from "@/lib/zkp2p-contracts";
import {
  OFFRAMP_V3_ADDRESS,
  USDC_ADDRESS as USDC_SEPOLIA_ADDRESS,
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
      <div className="bg-zinc-900/50 backdrop-blur-xl rounded-3xl border border-zinc-800 p-8 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">Connect Wallet</h2>
        <p className="text-zinc-400">Please connect your wallet to continue</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 backdrop-blur-xl rounded-3xl border border-zinc-800 overflow-hidden">
      {/* Progress Header */}
      {step !== "select_flow" && step !== "success" && (
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-zinc-400">
              Stage {progress.stage} of 2: {progress.label}
            </span>
            <span className="text-xs text-zinc-500">{Math.round(progress.percent)}%</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: progress.stage === 1 ? `${progress.percent}%` : "100%" }}
              />
            </div>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: progress.stage === 2 ? `${progress.percent}%` : "0%" }}
              />
            </div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-zinc-500">
            <span>ZKP2P (Venmo)</span>
            <span>FreeFlo (SEPA)</span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-400/60 hover:text-red-400 mt-1">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="p-6">
        {/* Flow Selection */}
        {step === "select_flow" && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Cross-Border Transfer</h2>
              <p className="text-zinc-400">Send money from Venmo (US) to SEPA (Europe)</p>
            </div>

            <button
              onClick={handleStart}
              className="w-full p-6 bg-gradient-to-br from-blue-500/10 to-emerald-500/10 border border-blue-500/20 rounded-2xl hover:border-blue-500/40 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <span className="text-2xl">V</span>
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-semibold text-white">Venmo USD</h3>
                    <p className="text-sm text-zinc-400">US Payment Network</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <svg className="w-6 h-6 text-zinc-600 group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-2xl">€</span>
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-semibold text-white">SEPA EUR</h3>
                    <p className="text-sm text-zinc-400">European Bank</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-800 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Estimated time</span>
                  <span className="text-zinc-300">2-5 minutes</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-zinc-500">Powered by</span>
                  <span className="text-zinc-300">ZKP2P + FreeFlo</span>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Input All (Amount + IBAN + Name) */}
        {step === "input_all" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Transfer Details</h2>
              <p className="text-zinc-400 text-sm">Enter amount and destination</p>
            </div>

            {/* Amount */}
            <div className="bg-zinc-800/50 rounded-2xl p-4">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">You send</label>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-3xl text-zinc-400">$</span>
                <input
                  type="number"
                  value={usdInput}
                  onChange={(e) => setUsdInput(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-3xl font-semibold text-white outline-none"
                />
                <span className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium">USD</span>
              </div>
            </div>

            {/* IBAN */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Recipient IBAN</label>
              <input
                type="text"
                value={ibanInput}
                onChange={(e) => setIbanInput(e.target.value.toUpperCase())}
                placeholder="DE89 3704 0044 0532 0130 00"
                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>

            {/* Recipient Name */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Recipient Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="John Doe"
                className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              />
            </div>

            {/* Estimate */}
            {usdInput && parseFloat(usdInput) >= 10 && (
              <div className="bg-zinc-800/30 rounded-xl p-4">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Estimated EUR received</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatEur(calculateEstimatedEur(parseFloat(usdInput)))}
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-zinc-500">Slippage tolerance</span>
                  <span className="text-zinc-400">{slippagePercent}%</span>
                </div>
              </div>
            )}

            <button
              onClick={handleInputSubmit}
              disabled={!usdInput || parseFloat(usdInput) < 10 || !ibanInput || !nameInput}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-emerald-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Find Makers
            </button>
            <p className="text-center text-xs text-zinc-500">Minimum: $10</p>
          </div>
        )}

        {/* Finding Quotes */}
        {step === "finding_quotes" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Finding Makers</h2>
            <p className="text-zinc-400">Searching for Venmo liquidity providers...</p>
          </div>
        )}

        {/* Select Maker */}
        {step === "select_maker" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Select a Maker</h2>
              <p className="text-zinc-400 text-sm">Choose who to exchange with for {formatUsd(flowData.usdAmount)}</p>
            </div>
            <div className="space-y-3">
              {zkp2pQuotes.map((quote) => {
                const usdcOut = calculateUsdcFromUsd(flowData.usdAmount, quote.usdRate);
                return (
                  <button
                    key={quote.depositId}
                    onClick={() => handleSelectMaker(quote)}
                    className="w-full p-4 bg-zinc-800/50 border border-zinc-700 rounded-xl hover:border-blue-500/50 transition-all text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-semibold">
                          {quote.maker.slice(2, 4).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">Maker {quote.maker.slice(0, 8)}...</p>
                          <p className="text-sm text-zinc-400">Rate: ${quote.usdRate.toFixed(4)} per USDC</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold">{formatUsdc(usdcOut)}</p>
                        <p className="text-xs text-zinc-500">Available: {formatUsdc(quote.availableUsdc)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Signal ZKP2P Intent */}
        {step === "zkp2p_signal" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Confirm Order</h2>
              <p className="text-zinc-400 text-sm">Lock the maker&apos;s USDC for your transfer</p>
            </div>
            <div className="bg-zinc-800/30 rounded-xl p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-zinc-400">You send</span>
                <span className="text-white">{formatUsd(flowData.usdAmount)} via Venmo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">You receive</span>
                <span className="text-emerald-400">{formatUsdc(flowData.usdcAmount)} → ~{formatEur(flowData.minEurAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Destination</span>
                <span className="text-white font-mono text-xs">{flowData.eurIban.slice(0, 12)}...</span>
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-300">
              Your SEPA details are encoded in the ZKP2P intent. After verification, USDC will automatically flow to FreeFlo.
            </div>
            <button
              onClick={handleSignalIntent}
              className="w-full py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
            >
              Signal Intent
            </button>
          </div>
        )}

        {/* Send Venmo */}
        {step === "zkp2p_send_venmo" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Send Venmo Payment</h2>
              <p className="text-zinc-400 text-sm">Send exactly {formatUsd(flowData.usdAmount)} to the maker</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <span className="text-xl text-blue-400">V</span>
                </div>
                <div>
                  <p className="text-white font-semibold">Venmo</p>
                  <p className="text-sm text-zinc-400">Send to: {flowData.venmoRecipient}</p>
                </div>
              </div>
              <div className="bg-zinc-900/50 rounded-lg p-3">
                <p className="text-xs text-zinc-500 uppercase mb-1">Amount</p>
                <p className="text-2xl font-bold text-white">{formatUsd(flowData.usdAmount)}</p>
              </div>
            </div>
            <button
              onClick={handleVenmoSent}
              className="w-full py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
            >
              I&apos;ve Sent the Payment
            </button>
          </div>
        )}

        {/* Verify with ZKP2P */}
        {step === "zkp2p_verify" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Verify Payment</h2>
              <p className="text-zinc-400 text-sm">Use ZKP2P extension to prove your payment</p>
            </div>
            <div className="bg-zinc-800/50 rounded-xl p-6 text-center">
              <div className="w-16 h-16 bg-zinc-700/50 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-zinc-400 text-sm">ZKP2P verifies your Venmo payment confirmation</p>
              <p className="text-xs text-zinc-500 mt-2">Zero-knowledge proof - your email stays private</p>
            </div>
            <button
              onClick={handleVerifyPayment}
              className="w-full py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
            >
              Verify with ZKP2P
            </button>
          </div>
        )}

        {/* ZKP2P Fulfilling */}
        {step === "zkp2p_fulfilling" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Completing ZKP2P Transfer</h2>
            <p className="text-zinc-400">Releasing USDC and creating SEPA intent...</p>
          </div>
        )}

        {/* Router Waiting for Quotes */}
        {step === "router_waiting" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Waiting for SEPA Quote</h2>
            <p className="text-zinc-400">FreeFlo solver is preparing your quote...</p>
          </div>
        )}

        {/* Router Commit */}
        {step === "router_commit" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Confirm SEPA Transfer</h2>
              <p className="text-zinc-400 text-sm">Review and commit to the quote</p>
            </div>
            <div className="bg-zinc-800/30 rounded-xl p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-zinc-400">USDC deposited</span>
                <span className="text-white">{formatUsdc(flowData.usdcAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">EUR to receive</span>
                <span className="text-emerald-400 font-semibold">{formatEur(flowData.quotedEurAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Destination</span>
                <span className="text-white font-mono text-xs">{flowData.eurIban}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Recipient</span>
                <span className="text-white">{flowData.recipientName}</span>
              </div>
            </div>
            <button
              onClick={handleRouterCommit}
              className="w-full py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              Confirm & Send EUR
            </button>
          </div>
        )}

        {/* FreeFlo Pending */}
        {step === "freeflo_pending" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sending SEPA Transfer</h2>
            <p className="text-zinc-400">FreeFlo solver is sending EUR to your bank...</p>
            <p className="text-sm text-zinc-500 mt-2">This usually takes 10-15 seconds</p>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="text-center py-8">
            <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full mx-auto mb-6 flex items-center justify-center">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Transfer Complete!</h2>
            <p className="text-zinc-400 mb-6">Your money is on its way</p>

            <div className="bg-zinc-800/30 rounded-xl p-6 text-left space-y-4">
              <div className="flex justify-between pb-4 border-b border-zinc-700">
                <span className="text-zinc-400">You sent</span>
                <span className="text-white font-semibold">{formatUsd(flowData.usdAmount)} via Venmo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Recipient receives</span>
                <span className="text-emerald-400 font-semibold">{formatEur(flowData.quotedEurAmount)} via SEPA</span>
              </div>
            </div>

            <button
              onClick={resetFlow}
              className="mt-6 px-6 py-3 rounded-xl bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition-colors"
            >
              Start New Transfer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
