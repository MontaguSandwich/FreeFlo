"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  ZKP2PPaymentMethod,
  ZKP2PIntentStatus,
  ZKP2P_ORCHESTRATOR_ABI,
  ZKP2P_ESCROW_ABI,
  ZKP2P_ORCHESTRATOR_ADDRESS,
  ZKP2P_ESCROW_ADDRESS,
  USDC_MAINNET_ADDRESS,
  PAYMENT_METHOD_LABELS,
  calculateUsdcFromUsd,
  type ZKP2PQuote,
  type ZKP2PIntent,
} from "@/lib/zkp2p-contracts";
import {
  OFFRAMP_V3_ADDRESS,
  USDC_ADDRESS as USDC_SEPOLIA_ADDRESS,
  Currency,
  RTPN,
  IntentStatus,
  OFFRAMP_V2_ABI,
  ERC20_ABI,
} from "@/lib/contracts";

// Flow steps
type FlowStep =
  // Stage selection
  | "select_flow"
  // ZKP2P leg (Venmo USD → USDC)
  | "zkp2p_input"
  | "zkp2p_finding_quotes"
  | "zkp2p_select_maker"
  | "zkp2p_signal_intent"
  | "zkp2p_send_venmo"
  | "zkp2p_submit_proof"
  | "zkp2p_waiting"
  | "zkp2p_complete"
  // FreeFlo leg (USDC → SEPA EUR)
  | "freeflo_setup"
  | "freeflo_create_intent"
  | "freeflo_waiting_quotes"
  | "freeflo_input_iban"
  | "freeflo_approve"
  | "freeflo_commit"
  | "freeflo_pending"
  | "freeflo_complete"
  // Final
  | "success"
  | "error";

// Composed flow data
interface ComposedFlowData {
  // Input
  usdAmount: number;
  eurIban: string;
  recipientName: string;

  // ZKP2P stage
  zkp2pQuote: ZKP2PQuote | null;
  zkp2pIntentHash: `0x${string}` | null;
  venmoRecipient: string; // Maker's Venmo handle
  usdcReceived: bigint;
  zkp2pTxHash: `0x${string}` | null;

  // FreeFlo stage
  freefloIntentId: `0x${string}` | null;
  freefloSolver: `0x${string}` | null;
  eurAmount: number;
  freefloTxHash: `0x${string}` | null;
}

// Mock ZKP2P quotes for development (until we have real contract addresses)
const MOCK_ZKP2P_QUOTES: ZKP2PQuote[] = [
  {
    depositId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    maker: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    availableUsdc: BigInt(10000_000000), // 10,000 USDC
    usdRate: 1.001, // $1.001 per USDC
    paymentMethod: ZKP2PPaymentMethod.VENMO,
    minUsd: 10,
  },
  {
    depositId: "0x0000000000000000000000000000000000000000000000000000000000000002" as `0x${string}`,
    maker: "0x2345678901234567890123456789012345678901" as `0x${string}`,
    availableUsdc: BigInt(5000_000000), // 5,000 USDC
    usdRate: 1.005, // $1.005 per USDC
    paymentMethod: ZKP2PPaymentMethod.VENMO,
    minUsd: 50,
  },
];

export function VenmoToSepaFlow() {
  const { address, isConnected, chain } = useAccount();

  // Flow state
  const [step, setStep] = useState<FlowStep>("select_flow");
  const [flowData, setFlowData] = useState<ComposedFlowData>({
    usdAmount: 0,
    eurIban: "",
    recipientName: "",
    zkp2pQuote: null,
    zkp2pIntentHash: null,
    venmoRecipient: "",
    usdcReceived: BigInt(0),
    zkp2pTxHash: null,
    freefloIntentId: null,
    freefloSolver: null,
    eurAmount: 0,
    freefloTxHash: null,
  });
  const [error, setError] = useState<string | null>(null);

  // Form inputs
  const [usdInput, setUsdInput] = useState("");
  const [ibanInput, setIbanInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  // ZKP2P quotes
  const [zkp2pQuotes, setZkp2pQuotes] = useState<ZKP2PQuote[]>([]);

  // FreeFlo state
  const [freefloQuotes, setFreefloQuotes] = useState<any[]>([]);

  // Contract writes
  const { writeContract: zkp2pSignalIntent, data: zkp2pSignalHash } = useWriteContract();
  const { writeContract: freefloCreateIntent, data: freefloCreateHash } = useWriteContract();
  const { writeContract: freefloApprove, data: freefloApproveHash } = useWriteContract();
  const { writeContract: freefloCommit, data: freefloCommitHash } = useWriteContract();

  // Transaction receipts
  const { isSuccess: isZkp2pSignalConfirmed } = useWaitForTransactionReceipt({ hash: zkp2pSignalHash });
  const { isSuccess: isFreefloCreateConfirmed } = useWaitForTransactionReceipt({ hash: freefloCreateHash });
  const { isSuccess: isFreefloApproveConfirmed } = useWaitForTransactionReceipt({ hash: freefloApproveHash });
  const { isSuccess: isFreefloCommitConfirmed } = useWaitForTransactionReceipt({ hash: freefloCommitHash });

  // USDC balance on both chains
  const { data: usdcBalanceMainnet } = useReadContract({
    address: USDC_MAINNET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: !!address },
  });

  const { data: usdcBalanceSepolia } = useReadContract({
    address: USDC_SEPOLIA_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: baseSepolia.id,
    query: { enabled: !!address },
  });

  // Fetch ZKP2P quotes (mock for now)
  const fetchZkp2pQuotes = useCallback(async (usdAmount: number) => {
    // TODO: Replace with actual contract calls when addresses are available
    // For now, use mock quotes filtered by amount
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

  // Calculate estimated EUR output
  const calculateEstimatedEur = useCallback((usdAmount: number): number => {
    // Rough estimate: USD → USDC (1:1 with small fee) → EUR (current rate ~0.92)
    const usdcEstimate = usdAmount * 0.999; // 0.1% ZKP2P fee
    const eurEstimate = usdcEstimate * 0.92; // Approximate EUR rate
    return Math.floor(eurEstimate * 100) / 100;
  }, []);

  // Handle flow selection
  const handleSelectVenmoToSepa = () => {
    setStep("zkp2p_input");
  };

  // Handle USD amount input
  const handleUsdAmountSubmit = async () => {
    const amount = parseFloat(usdInput);
    if (isNaN(amount) || amount < 10) {
      setError("Minimum amount is $10");
      return;
    }

    setFlowData((prev) => ({ ...prev, usdAmount: amount }));
    setStep("zkp2p_finding_quotes");

    const quotes = await fetchZkp2pQuotes(amount);
    if (quotes.length > 0) {
      setStep("zkp2p_select_maker");
    } else {
      setError("No makers available for this amount. Try a different amount.");
      setStep("zkp2p_input");
    }
  };

  // Handle maker selection
  const handleSelectMaker = (quote: ZKP2PQuote) => {
    const usdcAmount = calculateUsdcFromUsd(flowData.usdAmount, quote.usdRate);
    setFlowData((prev) => ({
      ...prev,
      zkp2pQuote: quote,
      usdcReceived: usdcAmount,
      // In a real flow, we'd get the maker's Venmo handle from their deposit data
      venmoRecipient: "@zkp2p-maker-" + quote.maker.slice(2, 8),
    }));
    setStep("zkp2p_signal_intent");
  };

  // Handle ZKP2P intent signaling
  const handleSignalZkp2pIntent = async () => {
    if (!address || !flowData.zkp2pQuote) return;

    // TODO: Implement actual contract call when addresses are available
    // For now, simulate the intent creation
    console.log("Would signal ZKP2P intent:", {
      escrow: ZKP2P_ESCROW_ADDRESS,
      depositId: flowData.zkp2pQuote.depositId,
      amount: flowData.usdcReceived,
      recipient: address,
      paymentMethod: ZKP2PPaymentMethod.VENMO,
    });

    // Simulate intent hash
    const mockIntentHash = `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`;
    setFlowData((prev) => ({ ...prev, zkp2pIntentHash: mockIntentHash }));
    setStep("zkp2p_send_venmo");
  };

  // Handle Venmo payment confirmation
  const handleVenmoSent = () => {
    setStep("zkp2p_submit_proof");
  };

  // Handle ZKP2P proof submission (mock)
  const handleSubmitZkp2pProof = async () => {
    // In a real implementation, this would:
    // 1. User provides payment confirmation (email or screenshot)
    // 2. Generate ZK proof of DKIM signature
    // 3. Submit proof to orchestrator

    setStep("zkp2p_waiting");

    // Simulate proof verification (in reality, this takes ~30-60 seconds)
    setTimeout(() => {
      setFlowData((prev) => ({
        ...prev,
        zkp2pTxHash: `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`,
      }));
      setStep("zkp2p_complete");
    }, 3000);
  };

  // Proceed to FreeFlo stage
  const handleProceedToFreeflo = async () => {
    setStep("freeflo_setup");

    // Fetch FreeFlo quotes for the USDC amount
    await fetchFreefloQuotes(flowData.usdcReceived);

    setStep("freeflo_input_iban");
  };

  // Handle IBAN input
  const handleIbanSubmit = () => {
    if (!ibanInput || ibanInput.length < 15) {
      setError("Please enter a valid IBAN");
      return;
    }
    if (!nameInput || nameInput.length < 2) {
      setError("Please enter the recipient name");
      return;
    }

    setFlowData((prev) => ({
      ...prev,
      eurIban: ibanInput,
      recipientName: nameInput,
    }));

    // Select best quote
    if (freefloQuotes.length > 0) {
      const bestQuote = freefloQuotes[0];
      setFlowData((prev) => ({
        ...prev,
        freefloSolver: bestQuote.solver?.address,
        eurAmount: bestQuote.outputAmount,
      }));
    }

    setStep("freeflo_create_intent");
  };

  // Handle FreeFlo intent creation
  const handleCreateFreefloIntent = () => {
    if (!address) return;

    freefloCreateIntent({
      address: OFFRAMP_V3_ADDRESS,
      abi: OFFRAMP_V2_ABI,
      functionName: "createIntent",
      args: [flowData.usdcReceived, Currency.EUR],
      chainId: baseSepolia.id,
    });
  };

  // Watch for FreeFlo intent creation
  useEffect(() => {
    if (isFreefloCreateConfirmed && step === "freeflo_create_intent") {
      setStep("freeflo_waiting_quotes");
      // In production, we'd poll for on-chain quotes
      setTimeout(() => {
        setStep("freeflo_approve");
      }, 2000);
    }
  }, [isFreefloCreateConfirmed, step]);

  // Handle USDC approval for FreeFlo
  const handleFreefloApprove = () => {
    if (!address) return;

    freefloApprove({
      address: USDC_SEPOLIA_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [OFFRAMP_V3_ADDRESS, flowData.usdcReceived],
      chainId: baseSepolia.id,
    });
  };

  // Watch for approval
  useEffect(() => {
    if (isFreefloApproveConfirmed && step === "freeflo_approve") {
      setStep("freeflo_commit");
    }
  }, [isFreefloApproveConfirmed, step]);

  // Handle FreeFlo commit
  const handleFreefloCommit = () => {
    if (!address || !flowData.freefloIntentId || !flowData.freefloSolver) return;

    freefloCommit({
      address: OFFRAMP_V3_ADDRESS,
      abi: OFFRAMP_V2_ABI,
      functionName: "selectQuoteAndCommit",
      args: [
        flowData.freefloIntentId,
        flowData.freefloSolver,
        RTPN.SEPA_INSTANT,
        flowData.eurIban,
        flowData.recipientName,
      ],
      chainId: baseSepolia.id,
    });
  };

  // Watch for commit
  useEffect(() => {
    if (isFreefloCommitConfirmed && step === "freeflo_commit") {
      setStep("freeflo_pending");
      // Poll for fulfillment
      // In production, solver fulfills in ~10-15 seconds
    }
  }, [isFreefloCommitConfirmed, step]);

  // Format currency
  const formatUsd = (amount: number) => `$${amount.toFixed(2)}`;
  const formatEur = (amount: number) => `€${amount.toFixed(2)}`;
  const formatUsdc = (amount: bigint) => `${(Number(amount) / 1_000_000).toFixed(2)} USDC`;

  // Progress indicator
  const getProgress = (): { stage: 1 | 2; percent: number; label: string } => {
    if (step.startsWith("select") || step.startsWith("zkp2p")) {
      const zkp2pSteps: FlowStep[] = [
        "zkp2p_input", "zkp2p_finding_quotes", "zkp2p_select_maker",
        "zkp2p_signal_intent", "zkp2p_send_venmo", "zkp2p_submit_proof",
        "zkp2p_waiting", "zkp2p_complete"
      ];
      const idx = zkp2pSteps.indexOf(step as FlowStep);
      return {
        stage: 1,
        percent: idx >= 0 ? ((idx + 1) / zkp2pSteps.length) * 100 : 0,
        label: "Venmo USD → USDC",
      };
    } else {
      const freefloSteps: FlowStep[] = [
        "freeflo_setup", "freeflo_input_iban", "freeflo_create_intent",
        "freeflo_waiting_quotes", "freeflo_approve", "freeflo_commit",
        "freeflo_pending", "freeflo_complete"
      ];
      const idx = freefloSteps.indexOf(step as FlowStep);
      return {
        stage: 2,
        percent: idx >= 0 ? ((idx + 1) / freefloSteps.length) * 100 : 0,
        label: "USDC → SEPA EUR",
      };
    }
  };

  const progress = getProgress();

  // Render
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
              className={`h-full rounded-full transition-all duration-500 ${
                progress.stage === 1 ? "bg-blue-500" : "bg-blue-500"
              }`}
              style={{ width: progress.stage === 1 ? `${progress.percent}%` : "100%" }}
            />
          </div>
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress.stage === 2 ? "bg-emerald-500" : "bg-zinc-800"
              }`}
              style={{ width: progress.stage === 2 ? `${progress.percent}%` : "0%" }}
            />
          </div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-zinc-500">
          <span>ZKP2P (Venmo)</span>
          <span>FreeFlo (SEPA)</span>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400/60 hover:text-red-400 mt-1"
          >
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
              onClick={handleSelectVenmoToSepa}
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
                  <svg className="w-6 h-6 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <span className="text-2xl">€</span>
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-semibold text-white">SEPA EUR</h3>
                    <p className="text-sm text-zinc-400">European Bank Transfer</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Estimated time</span>
                  <span className="text-zinc-300">2-5 minutes</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-zinc-500">Powered by</span>
                  <span className="text-zinc-300">ZKP2P + FreeFlo</span>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ZKP2P Input */}
        {step === "zkp2p_input" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Enter Amount</h2>
              <p className="text-zinc-400 text-sm">How much USD do you want to send via Venmo?</p>
            </div>

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
                <span className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium">
                  USD
                </span>
              </div>
            </div>

            <div className="bg-zinc-800/30 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Estimated EUR received</span>
                <span className="text-white font-medium">
                  {usdInput ? formatEur(calculateEstimatedEur(parseFloat(usdInput) || 0)) : "€0.00"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-zinc-500">Exchange rate</span>
                <span className="text-zinc-400">~$1 = €0.92</span>
              </div>
            </div>

            <button
              onClick={handleUsdAmountSubmit}
              disabled={!usdInput || parseFloat(usdInput) < 10}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-emerald-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Continue
            </button>

            <p className="text-center text-xs text-zinc-500">Minimum: $10</p>
          </div>
        )}

        {/* Finding ZKP2P Quotes */}
        {step === "zkp2p_finding_quotes" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Finding Makers</h2>
            <p className="text-zinc-400">Searching for Venmo liquidity providers...</p>
          </div>
        )}

        {/* Select ZKP2P Maker */}
        {step === "zkp2p_select_maker" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Select a Maker</h2>
              <p className="text-zinc-400 text-sm">
                Choose a liquidity provider to exchange your {formatUsd(flowData.usdAmount)}
              </p>
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
                          <p className="text-white font-medium">
                            Maker {quote.maker.slice(0, 8)}...
                          </p>
                          <p className="text-sm text-zinc-400">
                            Rate: ${quote.usdRate.toFixed(4)} per USDC
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-semibold">{formatUsdc(usdcOut)}</p>
                        <p className="text-xs text-zinc-500">
                          Available: {formatUsdc(quote.availableUsdc)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Signal ZKP2P Intent */}
        {step === "zkp2p_signal_intent" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Lock USDC</h2>
              <p className="text-zinc-400 text-sm">
                The maker's USDC will be locked for your order
              </p>
            </div>

            <div className="bg-zinc-800/30 rounded-xl p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-zinc-400">You send</span>
                <span className="text-white">{formatUsd(flowData.usdAmount)} via Venmo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">You receive</span>
                <span className="text-emerald-400">{formatUsdc(flowData.usdcReceived)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Rate</span>
                <span className="text-zinc-300">${flowData.zkp2pQuote?.usdRate.toFixed(4)} per USDC</span>
              </div>
            </div>

            <button
              onClick={handleSignalZkp2pIntent}
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
              <p className="text-zinc-400 text-sm">
                Send exactly {formatUsd(flowData.usdAmount)} to the maker
              </p>
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

              <div className="bg-zinc-900/50 rounded-lg p-3 mb-4">
                <p className="text-xs text-zinc-500 uppercase mb-1">Amount</p>
                <p className="text-2xl font-bold text-white">{formatUsd(flowData.usdAmount)}</p>
              </div>

              <div className="flex items-start gap-2 text-sm text-zinc-400">
                <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p>Include the intent ID in your payment note for faster verification</p>
              </div>
            </div>

            <button
              onClick={handleVenmoSent}
              className="w-full py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
            >
              I've Sent the Payment
            </button>
          </div>
        )}

        {/* Submit ZKP2P Proof */}
        {step === "zkp2p_submit_proof" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Verify Payment</h2>
              <p className="text-zinc-400 text-sm">
                Submit proof of your Venmo payment
              </p>
            </div>

            <div className="bg-zinc-800/50 rounded-xl p-6 text-center">
              <div className="w-16 h-16 bg-zinc-700/50 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-zinc-400 text-sm mb-2">
                ZKP2P will verify your payment using the confirmation email from Venmo
              </p>
              <p className="text-xs text-zinc-500">
                This generates a zero-knowledge proof without revealing your email
              </p>
            </div>

            <button
              onClick={handleSubmitZkp2pProof}
              className="w-full py-4 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors"
            >
              Verify with ZKP2P
            </button>
          </div>
        )}

        {/* ZKP2P Waiting */}
        {step === "zkp2p_waiting" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Verifying Payment</h2>
            <p className="text-zinc-400">Generating zero-knowledge proof...</p>
            <p className="text-sm text-zinc-500 mt-2">This may take up to 60 seconds</p>
          </div>
        )}

        {/* ZKP2P Complete */}
        {step === "zkp2p_complete" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">Stage 1 Complete!</h2>
              <p className="text-zinc-400 text-sm">
                You received {formatUsdc(flowData.usdcReceived)}
              </p>
            </div>

            <div className="bg-zinc-800/30 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Venmo sent</span>
                <span className="text-white">{formatUsd(flowData.usdAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">USDC received</span>
                <span className="text-emerald-400">{formatUsdc(flowData.usdcReceived)}</span>
              </div>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-emerald-400 font-medium mb-1">Ready for Stage 2</p>
              <p className="text-sm text-zinc-400">
                Now let's convert your USDC to EUR via SEPA
              </p>
            </div>

            <button
              onClick={handleProceedToFreeflo}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Continue to SEPA Transfer
            </button>
          </div>
        )}

        {/* FreeFlo Setup */}
        {step === "freeflo_setup" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Preparing SEPA Transfer</h2>
            <p className="text-zinc-400">Fetching best rates from FreeFlo solvers...</p>
          </div>
        )}

        {/* FreeFlo IBAN Input */}
        {step === "freeflo_input_iban" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">SEPA Details</h2>
              <p className="text-zinc-400 text-sm">
                Enter the European bank account to receive {formatUsdc(flowData.usdcReceived)}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">IBAN</label>
                <input
                  type="text"
                  value={ibanInput}
                  onChange={(e) => setIbanInput(e.target.value.toUpperCase())}
                  placeholder="DE89 3704 0044 0532 0130 00"
                  className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none"
                />
              </div>

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
            </div>

            {freefloQuotes.length > 0 && (
              <div className="bg-zinc-800/30 rounded-xl p-4">
                <div className="flex justify-between">
                  <span className="text-zinc-400">You receive</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatEur(freefloQuotes[0].outputAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-zinc-500">Via SEPA Instant</span>
                  <span className="text-zinc-400">~15 seconds</span>
                </div>
              </div>
            )}

            <button
              onClick={handleIbanSubmit}
              className="w-full py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* FreeFlo Create Intent */}
        {step === "freeflo_create_intent" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Create Transfer Intent</h2>
              <p className="text-zinc-400 text-sm">
                Create an intent to convert {formatUsdc(flowData.usdcReceived)} to EUR
              </p>
            </div>

            <div className="bg-zinc-800/30 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Amount</span>
                <span className="text-white">{formatUsdc(flowData.usdcReceived)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Recipient</span>
                <span className="text-white">{flowData.recipientName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">IBAN</span>
                <span className="text-white font-mono text-xs">{flowData.eurIban}</span>
              </div>
            </div>

            <button
              onClick={handleCreateFreefloIntent}
              className="w-full py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              Create Intent
            </button>
          </div>
        )}

        {/* FreeFlo Waiting Quotes */}
        {step === "freeflo_waiting_quotes" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Waiting for Solver</h2>
            <p className="text-zinc-400">FreeFlo solver is preparing your quote...</p>
          </div>
        )}

        {/* FreeFlo Approve */}
        {step === "freeflo_approve" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Approve USDC</h2>
              <p className="text-zinc-400 text-sm">
                Allow FreeFlo to transfer your USDC
              </p>
            </div>

            <button
              onClick={handleFreefloApprove}
              className="w-full py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              Approve {formatUsdc(flowData.usdcReceived)}
            </button>
          </div>
        )}

        {/* FreeFlo Commit */}
        {step === "freeflo_commit" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Confirm Transfer</h2>
              <p className="text-zinc-400 text-sm">
                Commit to the solver's quote and initiate the transfer
              </p>
            </div>

            <button
              onClick={handleFreefloCommit}
              className="w-full py-4 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-colors"
            >
              Confirm & Send
            </button>
          </div>
        )}

        {/* FreeFlo Pending */}
        {step === "freeflo_pending" && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Processing SEPA Transfer</h2>
            <p className="text-zinc-400">Solver is sending EUR to your bank...</p>
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
            <p className="text-zinc-400 mb-6">
              Your money is on its way to the recipient
            </p>

            <div className="bg-zinc-800/30 rounded-xl p-6 text-left space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-700">
                <span className="text-zinc-400">You sent</span>
                <span className="text-white font-semibold">{formatUsd(flowData.usdAmount)} via Venmo</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Recipient receives</span>
                <span className="text-emerald-400 font-semibold">{formatEur(flowData.eurAmount)} via SEPA</span>
              </div>
            </div>

            <button
              onClick={() => {
                setStep("select_flow");
                setFlowData({
                  usdAmount: 0,
                  eurIban: "",
                  recipientName: "",
                  zkp2pQuote: null,
                  zkp2pIntentHash: null,
                  venmoRecipient: "",
                  usdcReceived: BigInt(0),
                  zkp2pTxHash: null,
                  freefloIntentId: null,
                  freefloSolver: null,
                  eurAmount: 0,
                  freefloTxHash: null,
                });
                setUsdInput("");
                setIbanInput("");
                setNameInput("");
              }}
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
