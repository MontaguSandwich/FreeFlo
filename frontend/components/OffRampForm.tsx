"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useWatchContractEvent } from "wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import { QuoteCard, QuoteCardSkeleton } from "./QuoteCard";
import {
  Currency,
  CURRENCIES,
  RTPNQuote,
  fetchQuotesByRtpn,
  fetchOnChainQuotes,
  validateReceivingInfo,
  getReceivingInfoPlaceholder,
  getReceivingInfoLabel,
  CURRENCY_TO_CONTRACT,
  STRING_RTPN_TO_CONTRACT,
  ContractCurrency,
} from "@/lib/quotes";
import { 
  OFFRAMP_V2_ADDRESS, 
  OFFRAMP_V2_ABI, 
  USDC_ADDRESS, 
  ERC20_ABI,
  IntentStatus,
} from "@/lib/contracts";

const CURRENCY_OPTIONS: Currency[] = ['EUR', 'GBP', 'USD', 'BRL', 'INR'];

type Step = "input" | "details" | "creating" | "waiting_quotes" | "approve" | "commit" | "pending" | "success";

export function OffRampV2() {
  const { address, isConnected } = useAccount();

  // Form state
  const [amount, setAmount] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("EUR");

  // Quote state (mock quotes for preview)
  const [quotes, setQuotes] = useState<RTPNQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<RTPNQuote | null>(null);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);

  // Intent state
  const [intentId, setIntentId] = useState<`0x${string}` | null>(null);

  // Details state
  const [receivingInfo, setReceivingInfo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [receivingInfoError, setReceivingInfoError] = useState<string | null>(null);

  // UI state
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);

  // Contract interactions
  const { writeContract: createIntent, data: createIntentHash, isPending: isCreatingIntent } = useWriteContract();
  const { writeContract: approve, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContract: selectQuote, data: selectQuoteHash, isPending: isSelectingQuote } = useWriteContract();

  const { isLoading: isCreateConfirming, isSuccess: isCreateConfirmed } =
    useWaitForTransactionReceipt({ hash: createIntentHash });
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isSelectConfirming, isSuccess: isSelectConfirmed } =
    useWaitForTransactionReceipt({ hash: selectQuoteHash });

  // Read USDC balance and allowance
  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, OFFRAMP_V2_ADDRESS] : undefined,
  });

  // Watch for IntentCreated events to get intentId
  useWatchContractEvent({
    address: OFFRAMP_V2_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    eventName: 'IntentCreated',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { intentId: `0x${string}`; depositor: Address };
        if (args.depositor?.toLowerCase() === address?.toLowerCase()) {
          console.log('Intent created:', args.intentId);
          setIntentId(args.intentId);
        }
      }
    },
  });

  // Watch for IntentFulfilled events
  useWatchContractEvent({
    address: OFFRAMP_V2_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    eventName: 'IntentFulfilled',
    onLogs(logs) {
      for (const log of logs) {
        const args = log.args as { intentId: `0x${string}` };
        if (args.intentId === intentId) {
          console.log('Intent fulfilled!');
          setStep("success");
        }
      }
    },
  });

  // Fetch mock quotes when amount or currency changes (for preview before creating intent)
  const loadQuotes = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      setQuotes([]);
      return;
    }

    setIsLoadingQuotes(true);
    try {
      const newQuotes = await fetchQuotesByRtpn(numAmount, selectedCurrency);
      setQuotes(newQuotes);
      // Only clear selectedQuote if we're in the input step to avoid resetting user's flow
      // When in details step, the user has already selected a quote and we should preserve it
      if (step === "input") {
        setSelectedQuote(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingQuotes(false);
    }
  }, [amount, selectedCurrency, step]);

  // Debounced quote fetching - only in input step to prevent flow reset
  useEffect(() => {
    // Don't refetch quotes when user is filling in details or in other steps
    // This prevents the flow from resetting when user enters IBAN
    if (step !== "input") {
      return;
    }

    const timer = setTimeout(() => {
      if (parseFloat(amount) >= 1) {
        loadQuotes();
      } else {
        setQuotes([]);
        setSelectedQuote(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [amount, selectedCurrency, loadQuotes, step]);

  // Validate receiving info
  useEffect(() => {
    if (receivingInfo && selectedQuote) {
      const result = validateReceivingInfo(selectedQuote.rtpn, receivingInfo);
      setReceivingInfoError(result.valid ? null : result.error || "Invalid");
    } else {
      setReceivingInfoError(null);
    }
  }, [receivingInfo, selectedQuote]);

  // Track if we've already processed quote polling for this intent
  const [quotesProcessed, setQuotesProcessed] = useState(false);

  // State to track if we should auto-proceed after finding quotes
  const [shouldAutoProceed, setShouldAutoProceed] = useState(false);
  const [foundQuoteForAutoProceed, setFoundQuoteForAutoProceed] = useState<RTPNQuote | null>(null);

  // Handle intent creation success - move to waiting for quotes and start polling
  useEffect(() => {
    if (isCreateConfirmed && intentId && !quotesProcessed) {
      console.log("Intent created, waiting for solver quotes...", intentId);
      setStep("waiting_quotes");
      
      // Start polling for real quotes
      const usdcAmount = parseFloat(amount);
      let pollCount = 0;
      const maxPolls = 30; // Poll for up to 60 seconds (30 * 2s)
      let stopped = false;
      
      const pollForQuotes = async () => {
        if (stopped) return;
        
        try {
          console.log(`Polling for quotes (${pollCount + 1}/${maxPolls})...`);
          const realQuotes = await fetchOnChainQuotes(intentId, usdcAmount);
          
          if (realQuotes.length > 0 && !stopped) {
            stopped = true; // Prevent further polling
            setQuotesProcessed(true); // Mark as processed
            console.log(`Found ${realQuotes.length} real quote(s)!`, realQuotes);
            setQuotes(realQuotes);
            
            // Find a matching quote for the user's selected RTPN
            const matchingQuote = selectedQuote 
              ? realQuotes.find(q => q.rtpn === selectedQuote.rtpn)
              : realQuotes[0];
            
            if (matchingQuote) {
              console.log("Found matching quote:", matchingQuote.solver.address);
              setSelectedQuote(matchingQuote);
              
              // If user already filled in details, auto-proceed to approval
              if (receivingInfo && recipientName && receivingInfo.length > 5 && recipientName.length >= 2) {
                console.log("Details already filled, auto-proceeding to approval...");
                setShouldAutoProceed(true);
                setFoundQuoteForAutoProceed(matchingQuote);
              } else {
                // Go to details step - user needs to fill in details
                setStep("details");
              }
            } else {
              setStep("details");
            }
            return;
          }
          
          pollCount++;
          if (pollCount < maxPolls && !stopped) {
            setTimeout(pollForQuotes, 2000);
          } else if (!stopped) {
            console.log("Timeout waiting for quotes");
            setError("No quotes received. Please try again.");
            setStep("input");
          }
        } catch (err) {
          console.error("Error polling for quotes:", err);
          pollCount++;
          if (pollCount < maxPolls && !stopped) {
            setTimeout(pollForQuotes, 2000);
          }
        }
      };
      
      // Start polling after 3 seconds (give solver time to process)
      setTimeout(pollForQuotes, 3000);
    }
  }, [isCreateConfirmed, intentId, amount, selectedQuote, quotesProcessed, receivingInfo, recipientName]);

  // Auto-proceed to approval after quotes are found (if details were already filled)
  useEffect(() => {
    if (shouldAutoProceed && foundQuoteForAutoProceed && intentId) {
      setShouldAutoProceed(false);
      setFoundQuoteForAutoProceed(null);
      
      const usdcAmountWei = parseUnits(amount, 6);
      
      // Check allowance
      if (!allowance || (allowance as bigint) < usdcAmountWei) {
        console.log("Auto-proceeding: Approving USDC...");
        setStep("approve");
        approve({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [OFFRAMP_V2_ADDRESS, usdcAmountWei],
        });
      } else {
        // Already have allowance, go straight to commit
        console.log("Auto-proceeding: Committing with solver:", foundQuoteForAutoProceed.solver.address);
        setStep("commit");
        selectQuote({
          address: OFFRAMP_V2_ADDRESS,
          abi: OFFRAMP_V2_ABI,
          functionName: "selectQuoteAndCommit",
          args: [
            intentId,
            foundQuoteForAutoProceed.solver.address as Address,
            STRING_RTPN_TO_CONTRACT[foundQuoteForAutoProceed.rtpn],
            receivingInfo,
            recipientName,
          ],
        });
      }
    }
  }, [shouldAutoProceed, foundQuoteForAutoProceed, intentId, amount, allowance, approve, selectQuote, receivingInfo, recipientName]);

  // Handle approval success - proceed to commit
  useEffect(() => {
    if (isApproveConfirmed && step === "approve") {
      refetchAllowance();
      setStep("commit");
      
      // Now commit with the selected quote
      if (intentId && selectedQuote?.solver?.address) {
        selectQuote({
          address: OFFRAMP_V2_ADDRESS,
          abi: OFFRAMP_V2_ABI,
          functionName: "selectQuoteAndCommit",
          args: [
            intentId,
            selectedQuote.solver.address as Address,
            STRING_RTPN_TO_CONTRACT[selectedQuote.rtpn],
            receivingInfo,
            recipientName,
          ],
        });
      }
    }
  }, [isApproveConfirmed, step, intentId, selectedQuote, receivingInfo, recipientName, refetchAllowance, selectQuote]);

  // Handle select quote success - start polling for fulfillment
  useEffect(() => {
    if (isSelectConfirmed) {
      setStep("pending");
    }
  }, [isSelectConfirmed]);

  // Read intent status from contract
  const { data: intentData, refetch: refetchIntent } = useReadContract({
    address: OFFRAMP_V2_ADDRESS,
    abi: OFFRAMP_V2_ABI,
    functionName: "getIntent",
    args: intentId ? [intentId] : undefined,
    query: {
      enabled: !!intentId && step === "pending",
    },
  });

  // Poll for intent fulfillment status (backup for event watching)
  useEffect(() => {
    if (step !== "pending" || !intentId) return;

    let cancelled = false;
    const pollInterval = 3000; // 3 seconds

    const checkStatus = async () => {
      if (cancelled) return;

      try {
        const result = await refetchIntent();
        const intent = result.data as { status: number | bigint } | undefined;
        
        // IntentStatus.FULFILLED = 3 (compare as Number since Viem may return bigint)
        if (intent && Number(intent.status) === IntentStatus.FULFILLED) {
          console.log("Intent fulfilled detected via polling!");
          setStep("success");
          return;
        }
        console.log("Polling intent status:", intent?.status, "looking for:", IntentStatus.FULFILLED);
      } catch (err) {
        console.error("Error polling for fulfillment:", err);
      }

      if (!cancelled) {
        setTimeout(checkStatus, pollInterval);
      }
    };

    // Start polling after a short delay
    const timer = setTimeout(checkStatus, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, intentId, refetchIntent]);

  const handleSelectQuote = (quote: RTPNQuote) => {
    // Preserve IBAN/receiving info if switching between quotes of the same RTPN type
    // This prevents losing user input when comparing different solvers for the same payment method
    const isSameRtpn = selectedQuote?.rtpn === quote.rtpn;

    setSelectedQuote(quote);

    // Only clear receiving info if switching to a different payment method
    if (!isSameRtpn) {
      setReceivingInfo("");
      setRecipientName("");
    }

    setStep("details");
  };

  const handleCreateIntent = () => {
    setError(null);
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      setError("Enter at least 1 USDC");
      return;
    }

    const usdcAmountWei = parseUnits(amount, 6);
    
    if (balance && usdcAmountWei > (balance as bigint)) {
      setError("Insufficient USDC balance");
      return;
    }

    setStep("creating");
    
    createIntent({
      address: OFFRAMP_V2_ADDRESS,
      abi: OFFRAMP_V2_ABI,
      functionName: "createIntent",
      args: [usdcAmountWei, CURRENCY_TO_CONTRACT[selectedCurrency]],
    });
  };

  const handleCommit = () => {
    setError(null);
    console.log("[handleCommit] Starting...", { 
      selectedQuote: selectedQuote?.solver?.address, 
      intentId, 
      step,
      quotesProcessed 
    });

    if (!selectedQuote) {
      console.log("[handleCommit] No selectedQuote!");
      return;
    }

    const validation = validateReceivingInfo(selectedQuote.rtpn, receivingInfo);
    if (!validation.valid) {
      setError(validation.error || "Invalid receiving info");
      return;
    }

    if (!recipientName || recipientName.trim().length < 2) {
      setError("Please enter the recipient name");
      return;
    }

    const usdcAmountWei = parseUnits(amount, 6);

    if (balance && usdcAmountWei > (balance as bigint)) {
      setError("Insufficient USDC balance");
      return;
    }

    // If no intent yet, create one first
    if (!intentId) {
      console.log("[handleCommit] Creating intent...");
      setStep("creating");
      createIntent({
        address: OFFRAMP_V2_ADDRESS,
        abi: OFFRAMP_V2_ABI,
        functionName: "createIntent",
        args: [usdcAmountWei, CURRENCY_TO_CONTRACT[selectedCurrency]],
      });
      return;
    }

    // Check allowance before committing
    if (!allowance || (allowance as bigint) < usdcAmountWei) {
      console.log("[handleCommit] Approving USDC...");
      setStep("approve");
      approve({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [OFFRAMP_V2_ADDRESS, usdcAmountWei],
      });
      return;
    }

    // We have intentId and allowance - now commit
    if (!selectedQuote.solver?.address) {
      console.log("[handleCommit] No solver address in quote!");
      setError("Invalid quote - no solver address. Waiting for solver quotes...");
      return;
    }

    console.log("[handleCommit] Committing with solver:", selectedQuote.solver.address);
    setStep("commit");
    
    selectQuote({
      address: OFFRAMP_V2_ADDRESS,
      abi: OFFRAMP_V2_ABI,
      functionName: "selectQuoteAndCommit",
      args: [
        intentId,
        selectedQuote.solver.address as Address,
        STRING_RTPN_TO_CONTRACT[selectedQuote.rtpn],
        receivingInfo,
        recipientName,
      ],
    });
  };

  const resetForm = () => {
    setAmount("");
    setSelectedCurrency("EUR");
    setQuotes([]);
    setSelectedQuote(null);
    setReceivingInfo("");
    setRecipientName("");
    setIntentId(null);
    setStep("input");
    setError(null);
    setQuotesProcessed(false);
  };

  const currencyInfo = CURRENCIES[selectedCurrency];

  // Not connected state
  if (!isConnected) {
    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
          <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
          </svg>
        </div>
        <h3 className="text-2xl font-semibold text-white mb-2">Connect Your Wallet</h3>
        <p className="text-zinc-400">Connect your wallet to start off-ramping USDC</p>
      </div>
    );
  }

  // Success state
  if (step === "success") {
    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
          <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Transfer Complete!</h3>
        <p className="text-zinc-400 mb-8">
          {CURRENCIES[selectedQuote?.rtpnInfo.currency || 'EUR'].symbol}
          {selectedQuote?.outputAmount.toLocaleString()} sent via {selectedQuote?.rtpnInfo.name}
        </p>

        <div className="bg-zinc-800/50 rounded-2xl p-5 mb-8 text-left max-w-sm mx-auto space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">You sent</span>
            <span className="text-white font-medium">{amount} USDC</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">You received</span>
            <span className="text-emerald-400 font-medium">
              {CURRENCIES[selectedQuote?.rtpnInfo.currency || 'EUR'].symbol}
              {selectedQuote?.outputAmount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Network</span>
            <span className="text-white">{selectedQuote?.rtpnInfo.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Solver</span>
            <span className="text-white">{selectedQuote?.solver.avatar} {selectedQuote?.solver.name}</span>
          </div>
        </div>

        <button
          onClick={resetForm}
          className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:opacity-90 transition-opacity"
        >
          New Transfer
        </button>
      </div>
    );
  }

  // Creating intent on-chain
  if (step === "creating") {
    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Creating Intent</h3>
        <p className="text-zinc-400 mb-4">
          Please confirm the transaction in your wallet...
        </p>
        <p className="text-sm text-zinc-500">
          Requesting off-ramp of {amount} USDC to {selectedCurrency}
        </p>
      </div>
    );
  }

  // Waiting for solver quotes
  if (step === "waiting_quotes") {
    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Waiting for Quotes</h3>
        <p className="text-zinc-400 mb-4">
          Intent created! Solvers are generating quotes...
        </p>
        <p className="text-sm text-zinc-500 mb-6">
          This usually takes 10-30 seconds
        </p>
        {intentId && (
          <p className="text-xs text-zinc-600 font-mono mb-6">
            Intent: {intentId.slice(0, 10)}...{intentId.slice(-8)}
          </p>
        )}
        <p className="text-xs text-emerald-400">
          Once a solver submits a quote, you can approve and complete the transfer
        </p>
        <button
          onClick={() => {
            // For now, go back to details with the mock quote to let user proceed
            // In production, we'd poll for real quotes here
            setStep("details");
          }}
          className="mt-6 px-6 py-2 rounded-xl bg-zinc-800 text-white text-sm hover:bg-zinc-700 transition-colors"
        >
          Continue with Preview Quote
        </button>
      </div>
    );
  }

  // Pending state (after commit, waiting for fulfillment)
  if (step === "pending") {
    const handleCheckStatus = async () => {
      try {
        const result = await refetchIntent();
        const intent = result.data as { status: number } | undefined;
        if (intent && intent.status === IntentStatus.FULFILLED) {
          setStep("success");
        }
      } catch (err) {
        console.error("Error checking status:", err);
      }
    };

    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-12 text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-4 border-amber-500/30 border-t-amber-500 animate-spin" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Transfer in Progress</h3>
        <p className="text-zinc-400 mb-4">
          Solver is sending {CURRENCIES[selectedQuote?.rtpnInfo.currency || 'EUR'].symbol}
          {selectedQuote?.outputAmount.toLocaleString()} via {selectedQuote?.rtpnInfo.name}
        </p>
        <p className="text-sm text-zinc-500">
          Estimated time: {selectedQuote?.rtpnInfo.avgTime}
        </p>
        {intentId && (
          <p className="mt-4 text-xs text-zinc-600 font-mono">
            Intent: {intentId.slice(0, 10)}...{intentId.slice(-8)}
          </p>
        )}
        <button
          onClick={handleCheckStatus}
          className="mt-6 px-6 py-2 rounded-xl bg-zinc-800 text-white text-sm hover:bg-zinc-700 transition-colors"
        >
          Check Status
        </button>
      </div>
    );
  }

  // Details step (after selecting a quote)
  if (step === "details" && selectedQuote) {
    return (
      <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-6 max-w-md mx-auto">
        <button
          onClick={() => setStep("input")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to quotes
        </button>

        <h2 className="text-lg font-semibold text-white mb-6">Enter Payment Details</h2>

        {/* Selected quote summary */}
        <div className="bg-zinc-800/50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-zinc-400">Selected Route</span>
            <span className="text-sm font-medium text-white">{selectedQuote.rtpnInfo.name}</span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-zinc-400">You send</span>
            <span className="text-sm font-medium text-white">{amount} USDC</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">You receive</span>
            <span className="text-lg font-bold text-emerald-400">
              {CURRENCIES[selectedQuote.rtpnInfo.currency].symbol}
              {selectedQuote.outputAmount.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Receiving info input */}
        <div className="mb-4">
          <label className="block text-sm text-zinc-400 mb-2">
            {getReceivingInfoLabel(selectedQuote.rtpn)}
          </label>
          <input
            type="text"
            value={receivingInfo}
            onChange={(e) => setReceivingInfo(e.target.value)}
            placeholder={getReceivingInfoPlaceholder(selectedQuote.rtpn)}
            className={`w-full bg-zinc-800/50 border rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none transition-colors ${
              receivingInfoError
                ? "border-red-500/50 focus:border-red-500"
                : "border-zinc-700 focus:border-emerald-500/50"
            }`}
          />
          {receivingInfoError && (
            <p className="text-red-400 text-xs mt-1">{receivingInfoError}</p>
          )}
        </div>

        {/* Recipient name input */}
        <div className="mb-6">
          <label className="block text-sm text-zinc-400 mb-2">Recipient Name</label>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="John Doe"
            className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button
          onClick={handleCommit}
          disabled={isCreatingIntent || isCreateConfirming || isApproving || isApproveConfirming || isSelectingQuote || isSelectConfirming || !!receivingInfoError || !receivingInfo || !recipientName}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          {(isCreatingIntent || isCreateConfirming || isApproving || isApproveConfirming || isSelectingQuote || isSelectConfirming) && (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          {isCreatingIntent || isCreateConfirming
            ? "Creating Intent..."
            : isApproving || isApproveConfirming
            ? "Approving USDC..."
            : isSelectingQuote || isSelectConfirming
            ? "Confirming..."
            : "Confirm & Send"}
        </button>
      </div>
    );
  }

  // Check if we should show quotes panel
  const showQuotesPanel = parseFloat(amount) >= 1 || isLoadingQuotes || quotes.length > 0;

  // Main view: horizontal split layout (or single column if no quotes yet)
  return (
    <div className={`flex gap-4 items-stretch ${showQuotesPanel ? '' : 'justify-center'}`}>
      {/* LEFT: Intent Entry */}
      <div className="w-80 flex-shrink-0">
        <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-6 h-full">
          <h2 className="text-lg font-semibold text-white mb-6">Off-Ramp USDC</h2>

          {/* Amount Input */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-zinc-400">You send</label>
              <span className="text-xs text-zinc-600">
                Balance: {balance ? formatUnits(balance as bigint, 6) : "0"}
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-4 pr-20 text-xl font-semibold text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 bg-zinc-700/50 rounded-lg">
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">$</div>
                <span className="text-sm font-medium text-white">USDC</span>
              </div>
            </div>
          </div>

          {/* Currency Selector */}
          <div>
            <label className="block text-sm text-zinc-400 mb-2">You receive</label>
            <div className="grid grid-cols-5 gap-1.5">
              {CURRENCY_OPTIONS.map((currency) => {
                const info = CURRENCIES[currency];
                const isSelected = selectedCurrency === currency;
                return (
                  <button
                    key={currency}
                    onClick={() => {
                      setSelectedCurrency(currency);
                      setSelectedQuote(null);
                    }}
                    className={`py-2.5 rounded-lg border text-center transition-all ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-zinc-700 bg-zinc-800/30 hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="text-base mb-0.5">{info.flag}</div>
                    <div className="text-[10px] font-medium text-zinc-300">{info.id}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected currency info */}
          <div className="mt-4 p-3 bg-zinc-800/30 rounded-xl">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-lg">{currencyInfo.flag}</span>
              <span className="text-white font-medium">{currencyInfo.name}</span>
            </div>
          </div>

          {/* Hint when no amount entered */}
          {!showQuotesPanel && (
            <div className="mt-6 text-center">
              <p className="text-xs text-zinc-500">
                Enter at least 1 USDC to see available routes
              </p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Quotes Panel - only shown when there's an amount */}
      {showQuotesPanel && (
        <div className="w-80 flex-shrink-0">
          <div className="rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-5 h-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">
                {isLoadingQuotes 
                  ? "Finding routes..." 
                  : `${quotes.length} routes`
                }
              </h2>
              {quotes.length > 0 && !isLoadingQuotes && (
                <button
                  onClick={loadQuotes}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              )}
            </div>

            {/* Quotes Grid - compact */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {isLoadingQuotes ? (
                <>
                  <QuoteCardSkeleton />
                  <QuoteCardSkeleton />
                </>
              ) : (
                quotes.map((quote) => (
                  <QuoteCard
                    key={`${quote.rtpn}-${quote.solver.address}`}
                    quote={quote}
                    isSelected={selectedQuote?.rtpn === quote.rtpn && selectedQuote?.solver.address === quote.solver.address}
                    onSelect={() => handleSelectQuote(quote)}
                  />
                ))
              )}
            </div>

            {/* Help text */}
            {quotes.length > 0 && (
              <p className="mt-3 text-[10px] text-zinc-500 text-center">
                Click to select route
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
