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
  parseAbiItem,
  type Log,
} from "viem";
import { Zkp2pClient, isPeerExtensionAvailable, createPeerExtensionSdk, getPeerExtensionState, PEER_EXTENSION_CHROME_URL, getPaymentMethodsCatalog, resolvePaymentMethodHashFromCatalog, resolveFiatCurrencyBytes32 } from "@zkp2p/sdk";
import {
  FIAT_TO_FIAT_ROUTER_ADDRESS,
  FIAT_TO_FIAT_ROUTER_ABI,
  RouterTransferStatus,
} from "@/lib/router-contracts";
import {
  IntentStatus,
  OFFRAMP_V2_ABI,
} from "@/lib/contracts";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { USDC_MAINNET_ADDRESS } from "@/lib/zkp2p-contracts";
import {
  PLATFORMS,
  CURRENCIES,
  QUICK_AMOUNTS,
  getPlatformCurrencies,
  getDefaultCurrency,
  type Platform,
  type Currency,
} from "@/lib/platforms";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";

// ============ Constants ============

// OffRampV3: QUOTE_WINDOW (5 min) + SELECTION_WINDOW (10 min) = 15 min
const OFFRAMP_DEADLINE_SECONDS = 15 * 60;

// ZKP2P V3 contracts (fully permissionless PostIntentHook with IPostIntentHookV2)
const ZKP2P_V3_ORCHESTRATOR = "0x888888359E981B5225CA48fbCdCeff702FC3b888" as const;
const ZKP2P_V3_ESCROW = "0x777777779d229cdF3110e9de47943791c26300Ef" as const;
const ZKP2P_V3_PROTOCOL_VIEWER = "0xC8A622e1614BB58141E72e1D6023B16f08677d6c" as const;
const ZKP2P_API_URL = "https://api.zkp2p.xyz" as const;

// Minimal Orchestrator ABI for signalIntent and cancelIntent
const ORCHESTRATOR_ABI = [
  {
    name: "signalIntent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "escrow", type: "address" },
          { name: "depositId", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "to", type: "address" },
          { name: "paymentMethod", type: "bytes32" },
          { name: "fiatCurrency", type: "bytes32" },
          { name: "conversionRate", type: "uint256" },
          { name: "referrer", type: "address" },
          { name: "referrerFee", type: "uint256" },
          { name: "gatingServiceSignature", type: "bytes" },
          { name: "signatureExpiration", type: "uint256" },
          { name: "postIntentHook", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "cancelIntent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [],
  },
  // IntentSignaled event to extract intent hash from logs
  {
    name: "IntentSignaled",
    type: "event",
    inputs: [
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "escrow", type: "address", indexed: true },
      { name: "depositId", type: "uint256", indexed: true },
      { name: "paymentMethod", type: "bytes32", indexed: false },
      { name: "to", type: "address", indexed: false },
      { name: "funder", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fiatCurrency", type: "bytes32", indexed: false },
      { name: "conversionRate", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

// ============ Types ============

type FlowStep =
  | "select_flow"
  | "input_all"
  | "finding_quotes"
  | "select_maker"
  | "zkp2p_signal"
  | "zkp2p_send_venmo"
  | "zkp2p_verify"
  | "zkp2p_authenticating"
  | "zkp2p_select_payment"
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
  payeeUsername: string; // Human-readable username (e.g., Revolut username)
  fiatCurrencyCode: string;
  conversionRate: string;
  fiatAmount: string;
  fiatAmountFormatted: string;
  tokenAmount: string;
  tokenAmountFormatted: string;
  paymentMethod: string;
  // Gating service fields required for signalIntent
  gatingServiceSignature?: `0x${string}`;
  signatureExpiration?: string | bigint;
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

// Use production environment for ZKP2P (PostIntentHook now permissionless)
const ZKP2P_ENVIRONMENT = 'production' as const;

// Peer's production TEE attestation service — proves the buyer's fiat payment inside
// the enclave. Distinct from FreeFlo's own offramp attestation service.
const PEER_ATTESTATION_URL = 'https://attestation-service.zkp2p.xyz' as const;

function useZkp2pClient() {
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  return useMemo(() => {
    if (!walletClient) return null;
    try {
      // Let SDK handle API routing based on runtimeEnv
      return new Zkp2pClient({
        walletClient,
        chainId,
        apiKey: process.env.NEXT_PUBLIC_ZKP2P_API_KEY || '',
        runtimeEnv: ZKP2P_ENVIRONMENT,
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

export function FiatToFiatFlow() {
  const { OFFRAMP_V3: OFFRAMP_V3_ADDRESS } = useNetworkAddresses();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
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

  // Platform and currency selection
  const [selectedPlatform, setSelectedPlatform] = useState<string>("venmo");
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USD");
  const availableCurrencies = useMemo(() => getPlatformCurrencies(selectedPlatform), [selectedPlatform]);

  // Update currency when platform changes (if current currency not supported)
  useEffect(() => {
    const platformCurrencies = getPlatformCurrencies(selectedPlatform);
    if (!platformCurrencies.find(c => c.code === selectedCurrency)) {
      const defaultCurrency = getDefaultCurrency(selectedPlatform);
      if (defaultCurrency) {
        setSelectedCurrency(defaultCurrency.code);
      }
    }
  }, [selectedPlatform, selectedCurrency]);

  // ZKP2P quotes
  const [zkp2pQuotes, setZkp2pQuotes] = useState<ZkpQuote[]>([]);

  // FreeFlo quotes
  const [freefloQuotes, setFreefloQuotes] = useState<any[]>([]);

  // Peer extension state
  const [extensionState, setExtensionState] = useState<string>("unknown");

  // Contract interactions
  const { writeContract: routerCommit, data: routerCommitHash } = useWriteContract();
  const { isSuccess: isRouterCommitConfirmed } = useWaitForTransactionReceipt({ hash: routerCommitHash });

  // Local state for signaling and cancelling
  const [isSignaling, setIsSignaling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // OffRampV3 deadline countdown (starts when Router creates the FreeFlo intent)
  const deadlineRemaining = useCountdown(flowData.routerIntentCreatedAt, OFFRAMP_DEADLINE_SECONDS);

  // Read pending transfer from Router
  const { data: pendingTransfer, refetch: refetchPendingTransfer } = useReadContract({
    address: FIAT_TO_FIAT_ROUTER_ADDRESS,
    abi: FIAT_TO_FIAT_ROUTER_ABI,
    functionName: "getPendingTransfer",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Resume a pending transfer after a reload / lost flow state: if the connected
  // wallet already has a PENDING transfer on the router (the onramp hook fired but
  // the UI state was lost), jump straight to the commit flow so the offramp leg can
  // still be finished within the selection window.
  useEffect(() => {
    if (!pendingTransfer) return;
    const pt = pendingTransfer as unknown as {
      intentId: `0x${string}`; usdcAmount: bigint; createdAt: bigint; status: number;
    };
    const earlySteps: FlowStep[] = [
      "select_flow", "input_all", "finding_quotes", "select_maker",
      "zkp2p_signal", "zkp2p_send_venmo", "zkp2p_verify",
      "zkp2p_authenticating", "zkp2p_select_payment", "zkp2p_fulfilling",
    ];
    const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
    if (Number(pt.status) === 1 && earlySteps.includes(step) && pt.intentId && pt.intentId !== ZERO) {
      setFlowData((prev) => ({
        ...prev,
        routerIntentId: pt.intentId,
        usdcAmount: BigInt(pt.usdcAmount),
        routerIntentCreatedAt: Number(pt.createdAt),
      }));
      setStep("router_waiting");
    }
  }, [pendingTransfer, step]);

  // ============ Event Polling (replaces useWatchContractEvent) ============

  // Poll for Router TransferInitiated event
  useLogPoller(
    step === "zkp2p_fulfilling",
    FIAT_TO_FIAT_ROUTER_ADDRESS,
    "event TransferInitiated(address indexed user, bytes32 indexed intentId, bytes32 indexed zkp2pIntentHash, uint256 usdcAmount, string iban, string recipientName, uint256 minEurAmount)",
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

  const [isConnecting, setIsConnecting] = useState(false);

  // TEE proof capture from peer.onMetadataMessage: the buyer's recent payment rows
  // to choose from + the encrypted session material the attestation enclave needs.
  const [verifyData, setVerifyData] = useState<{
    rows: { amount?: string; currency?: string; recipient?: string; paymentId?: string; params?: Record<string, string | number | boolean>; originalIndex: number }[];
    encryptedSessionMaterial: string;
    platform: string;
    actionType: string;
  } | null>(null);
  const metadataUnsubRef = useRef<(() => void) | null>(null);

  const refreshExtensionState = useCallback(async (): Promise<string> => {
    try {
      const state = await getPeerExtensionState();
      setExtensionState(state);
      return state;
    } catch {
      setExtensionState("needs_install");
      return "needs_install";
    }
  }, []);

  useEffect(() => { refreshExtensionState(); }, [refreshExtensionState]);

  // Ask the installed extension to authorize this site. The newer PeerAuth (TEE)
  // build reports "needs_connection" — window.peer is injected but not yet connected
  // to this origin — until requestConnection() succeeds. Without this step the UI
  // looked like the extension wasn't installed at all (we only ever showed "install").
  const connectExtension = useCallback(async () => {
    if (!isPeerExtensionAvailable()) {
      setExtensionState("needs_install");
      setError("Peer extension not found on this tab. Install it (and allow it on localhost), then reload.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      await createPeerExtensionSdk().requestConnection();
      await refreshExtensionState();
    } catch (err) {
      console.error("Peer connect failed:", err);
      setError("Could not connect the Peer extension. Open it on this tab to authorize, then retry.");
    } finally {
      setIsConnecting(false);
    }
  }, [refreshExtensionState]);

  // ============ Quote Fetching ============

  const calculateEstimatedEur = useCallback((usdAmount: number): number => {
    const usdcEstimate = usdAmount * 0.999; // ~0.1% ZKP2P fee
    const eurEstimate = usdcEstimate * 0.92; // Approximate USD/EUR rate
    return Math.floor(eurEstimate * 100) / 100;
  }, []);

  // Fetch ZKP2P quotes via server-side proxy (avoids CORS)
  const fetchZkp2pQuotes = useCallback(async (fiatAmount: number, platform: string, currency: string) => {
    if (!address) {
      console.log("fetchZkp2pQuotes: missing address");
      return [];
    }

    try {
      console.log(`Fetching quotes via proxy: ${platform} ${currency} ${fiatAmount}`);

      // Use server-side proxy to avoid CORS issues with ZKP2P API
      const params = new URLSearchParams({
        amount: fiatAmount.toString(),
        fiatCurrency: currency,
        user: address,
        recipient: address,
        destinationChainId: chainId.toString(),
        destinationToken: USDC_MAINNET_ADDRESS,
        paymentPlatforms: platform,
        isExactFiat: "true",
        quotesToReturn: "10",
      });

      const response = await fetch(`/api/zkp2p-quote?${params}`);
      const data = await response.json();

      console.log("Proxy quote response:", data);

      if (!response.ok) {
        console.error("Proxy quote error:", data);
        return [];
      }

      // ZKP2P API wraps response in responseObject
      const responseData = data.responseObject || data;
      const quotes = responseData.quotes || responseData.nearbySuggestions || [];

      if (!quotes || quotes.length === 0) {
        console.log("No quotes returned from API");
        return [];
      }

      // Map API response to our ZkpQuote interface
      const mapped: ZkpQuote[] = quotes.map((q: any) => {
        // Extract username from maker.depositData (platform-specific field names)
        const depositData = q.maker?.depositData || {};
        const payeeUsername = depositData.revolutUsername
          || depositData.venmoUsername
          || depositData.cashappUsername
          || depositData.username
          || "";

        return {
          depositId: q.intent?.depositId?.toString() || q.depositId?.toString() || "",
          escrowAddress: q.intent?.escrowAddress || q.escrowAddress || ZKP2P_V3_ESCROW,
          processorName: q.intent?.processorName || q.processorName || platform,
          amount: q.intent?.amount?.toString() || q.amount?.toString() || "",
          toAddress: q.intent?.toAddress || q.toAddress || address,
          payeeDetails: q.intent?.payeeDetails || q.payeeDetails || "",
          payeeUsername,
          fiatCurrencyCode: q.intent?.fiatCurrencyCode || q.fiatCurrencyCode || currency,
          conversionRate: q.conversionRate?.toString() || "",
          fiatAmount: q.fiatAmount?.toString() || "",
          fiatAmountFormatted: q.fiatAmountFormatted || `${fiatAmount.toFixed(2)} ${currency}`,
          tokenAmount: q.tokenAmount?.toString() || "",
          tokenAmountFormatted: q.tokenAmountFormatted || "",
          paymentMethod: q.paymentMethod || "",
          gatingServiceSignature: q.gatingServiceSignature,
          signatureExpiration: q.signatureExpiration,
        };
      });

      console.log("Mapped quotes:", mapped);
      setZkp2pQuotes(mapped);
      return mapped;
    } catch (err) {
      console.error("Proxy getQuote failed:", err);
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
    // Single tuple matching the contract's HookPayload struct (not three flat
    // params — that layout makes the contract's abi.decode revert).
    return encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "iban", type: "string" },
            { name: "recipientName", type: "string" },
            { name: "minEurAmount", type: "uint256" },
          ],
        },
      ],
      [{ iban, recipientName, minEurAmount }]
    );
  }, []);

  // ============ Flow Handlers ============

  const handleStart = () => {
    setStep("input_all");
  };

  const handleInputSubmit = async () => {
    const amount = parseFloat(usdInput);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount");
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

    const quotes = await fetchZkp2pQuotes(amount, selectedPlatform, selectedCurrency);
    if (quotes.length > 0) {
      setStep("select_maker");
    } else {
      const platformName = PLATFORMS[selectedPlatform]?.name || selectedPlatform;
      setError(`No ${platformName} makers available for this amount. Try a different amount or platform.`);
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

  // Fetch gating signature via server-side proxy (keeps API key secret)
  const fetchGatingSignature = async (params: {
    depositId: string;
    amount: string;
    toAddress: string;
    processorName: string;
    payeeDetails: string;
    fiatCurrencyCode: string;
    conversionRate: string;
    escrowAddress: string;
    paymentMethod: string; // bytes32 hash from quote
    postIntentHook: string; // Router address for hook
    data: string; // Encoded hook payload
  }): Promise<{ signature: `0x${string}`; expiration: string; referralFees: { recipient: `0x${string}`; fee: string }[] } | null> => {
    // Resolve payment method and fiat currency hashes (same as SDK does)
    const catalog = getPaymentMethodsCatalog(chainId, ZKP2P_ENVIRONMENT);
    const paymentMethodHash = resolvePaymentMethodHashFromCatalog(params.processorName, catalog);
    const fiatCurrencyHash = resolveFiatCurrencyBytes32(params.fiatCurrencyCode);

    const requestBody = {
      processorName: params.processorName,
      payeeDetails: params.payeeDetails,
      depositId: params.depositId,
      amount: params.amount,
      toAddress: params.toAddress,
      paymentMethod: paymentMethodHash,
      fiatCurrency: fiatCurrencyHash,
      conversionRate: params.conversionRate,
      chainId: chainId.toString(),
      escrowAddress: params.escrowAddress,
      postIntentHook: params.postIntentHook,
      data: params.data,
    };

    console.log("Gating API request body:", JSON.stringify(requestBody, null, 2));

    try {
      // Use server-side proxy to keep API key secret
      const response = await fetch('/api/zkp2p-gating', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error("Gating API error:", response.status, result);
        return null;
      }

      console.log("Gating API response:", result);

      return {
        signature: result.signature as `0x${string}`,
        expiration: result.expiration,
        referralFees: result.referralFees ?? [],
      };
    } catch (err) {
      console.error("Failed to fetch gating signature:", err);
      return null;
    }
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

    setIsSignaling(true);
    setError(null);

    try {
      // Fetch gating signature via our server-side proxy
      console.log("Fetching gating signature for postIntentHook...");
      const gatingResult = await fetchGatingSignature({
        depositId: quote.depositId,
        amount: quote.amount,
        toAddress: address,
        processorName: quote.processorName,
        payeeDetails: quote.payeeDetails,
        fiatCurrencyCode: quote.fiatCurrencyCode,
        conversionRate: quote.conversionRate,
        escrowAddress: quote.escrowAddress,
        paymentMethod: quote.paymentMethod,
        postIntentHook: FIAT_TO_FIAT_ROUTER_ADDRESS,
        data: hookPayload,
      });

      if (!gatingResult) {
        throw new Error("Failed to fetch gating signature from API");
      }

      const gatingSignature = gatingResult.signature;
      const signatureExpiration = gatingResult.expiration;
      console.log("Gating signature fetched:", {
        signature: gatingSignature?.slice(0, 20) + "...",
        expiration: signatureExpiration
      });

      console.log("Calling SDK signalIntent with gating signature");
      console.log("SDK config: runtimeEnv=production, apiKey=" + (process.env.NEXT_PUBLIC_ZKP2P_API_KEY ? "set" : "NOT SET"));
      console.log("signalIntent params:", {
        depositId: quote.depositId,
        amount: quote.amount,
        toAddress: address,
        processorName: quote.processorName,
        payeeDetails: quote.payeeDetails,
        fiatCurrencyCode: quote.fiatCurrencyCode,
        conversionRate: quote.conversionRate,
        escrowAddress: quote.escrowAddress,
        postIntentHook: FIAT_TO_FIAT_ROUTER_ADDRESS,
        dataLength: hookPayload.length,
        hasGatingSignature: !!gatingSignature,
      });

      const hash = await zkp2pClient.signalIntent({
        depositId: BigInt(quote.depositId),
        amount: BigInt(quote.amount),
        toAddress: address,
        processorName: quote.processorName,
        payeeDetails: quote.payeeDetails,
        fiatCurrencyCode: quote.fiatCurrencyCode,
        conversionRate: BigInt(quote.conversionRate),
        escrowAddress: quote.escrowAddress as `0x${string}`,
        postIntentHook: FIAT_TO_FIAT_ROUTER_ADDRESS,
        data: hookPayload,
        // Submit the EXACT referral fees the gating service signed (ZKP2P injects a
        // mandatory protocol fee) — otherwise the orchestrator reverts InvalidSignature().
        referralFees: (gatingResult.referralFees ?? []).map((f) => ({
          recipient: f.recipient as `0x${string}`,
          fee: BigInt(f.fee),
        })),
        gatingServiceSignature: gatingSignature,
        signatureExpiration: BigInt(signatureExpiration),
      });

      console.log("SignalIntent tx hash:", hash);

      if (hash && publicClient) {
        // Wait for receipt and extract the actual intent hash from logs
        const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
        console.log("Transaction receipt:", receipt.status);

        // Find IntentSignaled event - intent hash is in topics[1]
        const intentSignaledLog = receipt.logs.find(
          (log) => log.address.toLowerCase() === ZKP2P_V3_ORCHESTRATOR.toLowerCase() &&
                   log.topics[0] === "0xf8c114f83581b2cf0b9f130782a93024aa8933e7d188901156bd68bdd558a20a" // IntentSignaled event signature
        );

        if (intentSignaledLog && intentSignaledLog.topics[1]) {
          const intentHash = intentSignaledLog.topics[1] as `0x${string}`;
          console.log("Extracted intent hash:", intentHash);
          setFlowData((prev) => ({ ...prev, zkp2pIntentHash: intentHash }));
        } else {
          // Fallback to tx hash if we can't find the event
          console.warn("Could not find IntentSignaled event, using tx hash");
          setFlowData((prev) => ({ ...prev, zkp2pIntentHash: hash as `0x${string}` }));
        }
        setStep("zkp2p_send_venmo");
      }
    } catch (err: any) {
      console.error("Signal intent failed:", err);
      console.error("Error details:", JSON.stringify(err, Object.getOwnPropertyNames(err)));

      // Check if it's a 409 conflict (active intent exists)
      const errorMsg = err.message || "Unknown error";
      if (errorMsg.includes("409") || errorMsg.includes("active order")) {
        setError("You have an active intent. Cancel it first or wait for it to expire.");
      } else {
        setError(`Failed to signal intent: ${errorMsg}`);
      }
    } finally {
      setIsSignaling(false);
    }
  };

  const handleCancelIntent = async () => {
    if (!flowData.zkp2pIntentHash || !walletClient || !publicClient) {
      setError("No active intent to cancel");
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      console.log("Cancelling intent:", flowData.zkp2pIntentHash);

      const { request } = await publicClient.simulateContract({
        address: ZKP2P_V3_ORCHESTRATOR,
        abi: ORCHESTRATOR_ABI,
        functionName: "cancelIntent",
        args: [flowData.zkp2pIntentHash],
        account: walletClient.account,
      });

      const txHash = await walletClient.writeContract(request);
      console.log("Cancel tx hash:", txHash);

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("Intent cancelled successfully");

      // Reset flow state
      setFlowData((prev) => ({ ...prev, zkp2pIntentHash: null, zkp2pQuote: null }));
      setStep("select_maker");
      setError(null);
    } catch (err: any) {
      console.error("Cancel intent failed:", err);
      setError(`Failed to cancel intent: ${err.message || "Unknown error"}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleVenmoSent = () => {
    setStep("zkp2p_verify");
  };

  const handleVerifyPayment = () => {
    const intentHash = flowData.zkp2pIntentHash;
    if (!intentHash) {
      setError("No ZKP2P intent to verify — signal an intent first.");
      return;
    }

    // Guard: the Peer extension drives proof generation + fulfillIntent. If it
    // isn't installed/connected, DON'T silently advance into an unobservable
    // poll loop (the old bug) — surface it and let the user install/refresh.
    if (extensionState !== "ready") {
      setError(
        extensionState === "needs_install" || extensionState === "unknown"
          ? "Peer extension not detected on this tab. Install it (and allow it on localhost), then reload."
          : "Peer extension isn't connected yet — click Connect below, approve in the extension, then Verify."
      );
      return;
    }

    setError(null);

    const platform = (flowData.zkp2pQuote?.processorName || "revolut").toLowerCase();
    const actionType = `transfer_${platform}`;

    try {
      const peer = createPeerExtensionSdk();

      // The extension performs the provider sign-in + buyer-TEE capture, then posts
      // back the encrypted session material + the user's recent payments here. We
      // render those for selection and build the proof ourselves (the app owns the
      // intent lifecycle in the TEE/redirect model).
      metadataUnsubRef.current?.();
      metadataUnsubRef.current = peer.onMetadataMessage((message) => {
        console.log("Peer onMetadataMessage ←", message);
        if (message.errorMessage) {
          setError(`Peer capture failed: ${message.errorMessage}`);
          setStep("zkp2p_verify");
          return;
        }
        const rows = (message.metadata || [])
          .filter((r) => !r.hidden)
          .map((r) => ({
            amount: r.amount, currency: r.currency, recipient: r.recipient,
            paymentId: r.paymentId, params: r.params, originalIndex: r.originalIndex,
          }));
        const cap = message.buyerTeeCapture?.encryptedSessionMaterial || "";
        // Show rows as soon as they arrive; retain the capture across messages in
        // case rows and the encrypted session material come separately.
        if (rows.length === 0 && !cap) return;
        setVerifyData((prev) => ({
          rows: rows.length ? rows : (prev?.rows ?? []),
          encryptedSessionMaterial: cap || prev?.encryptedSessionMaterial || "",
          platform,
          actionType,
        }));
        setStep("zkp2p_select_payment");
      });

      console.log("Peer authenticate →", { actionType, platform, attestationServiceUrl: PEER_ATTESTATION_URL });
      peer.authenticate({
        actionType,
        platform,
        captureMode: "buyerTee",
        attestationServiceUrl: PEER_ATTESTATION_URL,
        attestationActionType: actionType,
      });
      setStep("zkp2p_authenticating");
    } catch (err) {
      console.error("Peer authenticate failed:", err);
      setError("Could not open the Peer extension. Make sure it's installed and connected, then retry.");
    }
  };

  // Build the buyer-TEE proof from the selected payment and submit fulfillIntent. The
  // SDK requests the attestation from Peer's enclave and sends the on-chain tx, which
  // runs our post-intent hook (FiatToFiatRouter.execute) → TransferInitiated.
  const handleSelectAndFulfill = async (
    row: NonNullable<typeof verifyData>["rows"][number],
  ) => {
    const intentHash = flowData.zkp2pIntentHash;
    if (!intentHash || !verifyData || !zkp2pClient) return;
    setError(null);
    setStep("zkp2p_fulfilling");
    try {
      const proof: Record<string, unknown> = {
        proofType: "buyerTee",
        encryptedSessionMaterial: verifyData.encryptedSessionMaterial,
        params: { ...(row.params || {}), index: row.originalIndex },
        actionPlatform: verifyData.platform,
        actionType: verifyData.actionType,
      };
      await zkp2pClient.fulfillIntent({
        intentHash,
        proof,
        attestationServiceUrl: PEER_ATTESTATION_URL,
        callbacks: {
          onAttestationStart: () => console.log("TEE attestation requested…"),
          onTxSent: (h) => console.log("fulfill tx sent", h),
          onTxMined: (h) => console.log("fulfill mined", h),
        },
      });
      // Fulfilled → hook fired. The TransferInitiated poller advances to router_waiting.
    } catch (err: any) {
      console.error("fulfillIntent failed:", err);
      setError(`Verification failed: ${err?.message || "unknown error"}. Pick the payment again or retry.`);
      setStep("zkp2p_select_payment");
    }
  };

  // Poll for FreeFlo quotes when in router_waiting
  useEffect(() => {
    if (step !== "router_waiting" || !flowData.routerIntentId) return;

    const pollQuotes = async () => {
      const quotes = await fetchFreefloQuotes(flowData.usdcAmount);
      const best = quotes[0];
      // /api/quote returns fiatAmount in euros (not outputAmount). Guard against a
      // missing/NaN amount so we never advance to commit with a bad figure.
      const eur = Number(best?.fiatAmount);
      if (best?.solver?.address && Number.isFinite(eur) && eur > 0) {
        setFlowData((prev) => ({
          ...prev,
          selectedSolver: best.solver.address,
          quotedEurAmount: eur,
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
      address: FIAT_TO_FIAT_ROUTER_ADDRESS,
      abi: FIAT_TO_FIAT_ROUTER_ABI,
      functionName: "commit",
      // commit(address solver) — slippage is now enforced on-chain against the
      // real quote, so no caller-supplied EUR amount is passed.
      args: [flowData.selectedSolver],
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
    const stage1Steps = ["input_all", "finding_quotes", "select_maker", "zkp2p_signal", "zkp2p_send_venmo", "zkp2p_verify", "zkp2p_authenticating", "zkp2p_select_payment", "zkp2p_fulfilling"];
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
    setSelectedPlatform("venmo");
    setVerifyData(null);
    metadataUnsubRef.current?.();
    metadataUnsubRef.current = null;
    setSelectedCurrency("USD");
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
      {error && (
        <Box sx={{ mx: 3, mt: 2 }}>
          <Alert
            severity="error"
            sx={{ bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, color: '#f87171', '& .MuiAlert-icon': { color: '#f87171' } }}
            action={
              <Box sx={{ display: 'flex', gap: 1 }}>
                {(error.includes("active intent") || error.includes("active order")) && flowData.zkp2pIntentHash && (
                  <Button
                    onClick={handleCancelIntent}
                    disabled={isCancelling}
                    sx={{ color: '#fbbf24', fontSize: '0.75rem', textTransform: 'none', '&:hover': { color: '#f59e0b' } }}
                  >
                    {isCancelling ? "Cancelling..." : "Cancel Intent"}
                  </Button>
                )}
                <Button onClick={() => setError(null)} sx={{ color: 'rgba(248,113,113,0.6)', fontSize: '0.75rem', textTransform: 'none', '&:hover': { color: '#f87171' } }}>Dismiss</Button>
              </Box>
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

        {/* Input All (Amount + Platform + Currency + IBAN + Name) */}
        {step === "input_all" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Transfer Details</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Select platform, currency, and amount</Typography>
            </Box>

            {/* Platform & Currency Selectors */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              {/* Platform Selector */}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>Payment Platform</Typography>
                <Box
                  component="select"
                  value={selectedPlatform}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedPlatform(e.target.value)}
                  sx={{
                    width: '100%', px: 2, py: 1.5,
                    bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3,
                    color: 'white', outline: 'none', fontSize: '1rem', cursor: 'pointer',
                    '&:focus': { borderColor: 'rgba(59,130,246,0.5)' },
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a1a1aa' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  {Object.values(PLATFORMS).map((platform) => (
                    <option key={platform.id} value={platform.id} style={{ backgroundColor: '#27272a' }}>
                      {platform.icon} {platform.name}
                    </option>
                  ))}
                </Box>
              </Box>

              {/* Currency Selector */}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ color: '#a1a1aa', mb: 1 }}>Currency</Typography>
                <Box
                  component="select"
                  value={selectedCurrency}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedCurrency(e.target.value)}
                  sx={{
                    width: '100%', px: 2, py: 1.5,
                    bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3,
                    color: 'white', outline: 'none', fontSize: '1rem', cursor: 'pointer',
                    '&:focus': { borderColor: 'rgba(59,130,246,0.5)' },
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a1a1aa' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                  }}
                >
                  {availableCurrencies.map((currency) => (
                    <option key={currency.code} value={currency.code} style={{ backgroundColor: '#27272a' }}>
                      {currency.flag} {currency.code} - {currency.name}
                    </option>
                  ))}
                </Box>
              </Box>
            </Box>

            {/* Amount Input */}
            <Box sx={{ bgcolor: 'rgba(39,39,42,0.5)', borderRadius: 4, p: 2 }}>
              <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>You send</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                <Typography sx={{ fontSize: '1.875rem', color: '#a1a1aa' }}>{CURRENCIES[selectedCurrency]?.symbol || '$'}</Typography>
                <Box
                  component="input" type="number" value={usdInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsdInput(e.target.value)}
                  placeholder="0.00"
                  sx={{ flex: 1, bgcolor: 'transparent', fontSize: '1.875rem', fontWeight: 600, color: 'white', outline: 'none', border: 'none', '&::placeholder': { color: '#52525b' } }}
                />
                <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(59,130,246,0.2)', color: '#60a5fa', borderRadius: 2, fontSize: '0.875rem', fontWeight: 500 }}>{selectedCurrency}</Box>
              </Box>

              {/* Quick Amount Buttons */}
              <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                {QUICK_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    onClick={() => setUsdInput(amount.toString())}
                    sx={{
                      flex: 1, minWidth: '60px', py: 1,
                      bgcolor: usdInput === amount.toString() ? 'rgba(59,130,246,0.3)' : 'rgba(63,63,70,0.5)',
                      border: usdInput === amount.toString() ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent',
                      borderRadius: 2, color: 'white', fontSize: '0.875rem', fontWeight: 500, textTransform: 'none',
                      '&:hover': { bgcolor: 'rgba(59,130,246,0.2)' },
                    }}
                  >
                    {CURRENCIES[selectedCurrency]?.symbol || '$'}{amount}
                  </Button>
                ))}
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
            {usdInput && parseFloat(usdInput) > 0 && (
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
              disabled={!usdInput || parseFloat(usdInput) <= 0 || !ibanInput || !nameInput}
              sx={{
                width: '100%', py: 2, borderRadius: 3,
                background: 'linear-gradient(to right, #3b82f6, #10b981)',
                color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none',
                '&:disabled': { opacity: 0.5, cursor: 'not-allowed' }, '&:hover': { opacity: 0.9 },
              }}
            >
              View Sellers
            </Button>
          </Box>
        )}

        {/* Finding Quotes */}
        {step === "finding_quotes" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Finding Sellers</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>Searching for {PLATFORMS[selectedPlatform]?.name || 'payment'} liquidity providers...</Typography>
          </Box>
        )}

        {/* Select Maker */}
        {step === "select_maker" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Select a Seller</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Choose who to exchange with for {CURRENCIES[selectedCurrency]?.symbol || '$'}{flowData.usdAmount.toFixed(2)} {selectedCurrency}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {zkp2pQuotes.map((quote) => (
                <Button
                  key={String(quote.depositId)}
                  onClick={() => handleSelectMaker(quote)}
                  sx={{
                    width: '100%', p: 2, bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #3f3f46', borderRadius: 3,
                    textTransform: 'none', textAlign: 'left', '&:hover': { borderColor: 'rgba(59,130,246,0.5)' }, transition: 'all 0.2s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', fontWeight: 600 }}>
                        {String(quote.depositId).slice(0, 4)}
                      </Box>
                      <Box>
                        <Typography sx={{ color: 'white', fontWeight: 500 }}>Deposit #{String(quote.depositId).slice(0, 8)}</Typography>
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
                <Typography sx={{ color: 'white' }}>{CURRENCIES[selectedCurrency]?.symbol || '$'}{flowData.usdAmount.toFixed(2)} via {PLATFORMS[selectedPlatform]?.name || 'payment'}</Typography>
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

        {/* Send Payment */}
        {step === "zkp2p_send_venmo" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Send {PLATFORMS[selectedPlatform]?.name || 'Payment'}</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Send exactly {CURRENCIES[selectedCurrency]?.symbol || '$'}{flowData.usdAmount.toFixed(2)} to the seller</Typography>
            </Box>
            <Box sx={{ bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 3, p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: 3, bgcolor: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="h6" sx={{ color: '#60a5fa' }}>{PLATFORMS[selectedPlatform]?.icon || '💸'}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ color: 'white', fontWeight: 600 }}>{PLATFORMS[selectedPlatform]?.name || 'Payment'}</Typography>
                  <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Open {PLATFORMS[selectedPlatform]?.name || 'your payment app'} and send payment to the seller</Typography>
                </Box>
              </Box>
              <Box sx={{ bgcolor: 'rgba(24,24,27,0.5)', borderRadius: 2, p: 1.5, mb: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>Send To</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: '#60a5fa' }}>@{flowData.zkp2pQuote?.payeeUsername || 'Unknown'}</Typography>
              </Box>
              <Box sx={{ bgcolor: 'rgba(24,24,27,0.5)', borderRadius: 2, p: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#71717a', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>Amount</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'white' }}>{CURRENCIES[selectedCurrency]?.symbol || '$'}{flowData.usdAmount.toFixed(2)}</Typography>
              </Box>
            </Box>
            <Button
              onClick={handleVenmoSent}
              sx={{ width: '100%', py: 2, borderRadius: 3, bgcolor: '#3b82f6', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none', '&:hover': { bgcolor: '#2563eb' } }}
            >
              I&apos;ve Sent the Payment
            </Button>
            <Button
              onClick={handleCancelIntent}
              disabled={isCancelling}
              sx={{
                width: '100%', py: 1.5, borderRadius: 3,
                bgcolor: 'transparent', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)',
                fontWeight: 500, fontSize: '0.875rem', textTransform: 'none',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.5)' },
                '&:disabled': { color: '#71717a', borderColor: 'rgba(113,113,122,0.3)' }
              }}
            >
              {isCancelling ? "Cancelling Intent..." : "Cancel Intent"}
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
                <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Click below to open the Peer extension and prove your payment.</Typography>
              ) : extensionState === "needs_connection" ? (
                <Typography variant="body2" sx={{ color: '#fbbf24' }}>Peer extension detected but not connected to this site. Click Connect to authorize it.</Typography>
              ) : (
                <Typography variant="body2" sx={{ color: '#fbbf24' }}>
                  Peer extension not detected on this tab.{" "}
                  <a href={PEER_EXTENSION_CHROME_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>Install it</a>, allow it on localhost, then reload.
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: '#71717a', mt: 1, display: 'block' }}>Zero-knowledge proof — your data stays private</Typography>
            </Box>
            {extensionState === "needs_connection" && (
              <Button
                onClick={connectExtension}
                disabled={isConnecting}
                sx={{ width: '100%', py: 1.5, borderRadius: 3, bgcolor: '#10b981', color: 'white', fontWeight: 600, fontSize: '0.9375rem', textTransform: 'none', '&:hover': { bgcolor: '#059669' }, '&:disabled': { bgcolor: '#374151', color: '#9ca3af' } }}
              >
                {isConnecting ? "Connecting…" : "Connect Peer extension"}
              </Button>
            )}
            <Button
              onClick={handleVerifyPayment}
              sx={{ width: '100%', py: 2, borderRadius: 3, bgcolor: '#3b82f6', color: 'white', fontWeight: 600, fontSize: '1rem', textTransform: 'none', '&:hover': { bgcolor: '#2563eb' } }}
            >
              Verify with ZKP2P
            </Button>
            <Button
              onClick={handleCancelIntent}
              disabled={isCancelling}
              sx={{
                width: '100%', py: 1.5, borderRadius: 3,
                bgcolor: 'transparent', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)',
                fontWeight: 500, fontSize: '0.875rem', textTransform: 'none',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.5)' },
                '&:disabled': { color: '#71717a', borderColor: 'rgba(113,113,122,0.3)' }
              }}
            >
              {isCancelling ? "Cancelling Intent..." : "Cancel Intent"}
            </Button>
          </Box>
        )}

        {/* Authenticating with provider (extension capture in progress) */}
        {step === "zkp2p_authenticating" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Sign in with your provider</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>Complete the sign-in the Peer extension just opened. Your recent payments will load here to verify.</Typography>
            <Button onClick={() => setStep("zkp2p_verify")} sx={{ mt: 3, px: 3, py: 1, borderRadius: 3, bgcolor: 'transparent', color: '#a1a1aa', border: '1px solid rgba(113,113,122,0.3)', textTransform: 'none', fontSize: '0.8125rem' }}>Back</Button>
          </Box>
        )}

        {/* Select the payment to prove inside the TEE */}
        {step === "zkp2p_select_payment" && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 0.5 }}>Select your payment</Typography>
              <Typography variant="body2" sx={{ color: '#a1a1aa' }}>Pick the payment to prove. It is verified inside Peer&apos;s secure enclave.</Typography>
            </Box>
            {(verifyData?.rows.length ?? 0) === 0 ? (
              <Typography variant="body2" sx={{ color: '#fbbf24' }}>No payments found yet. Make sure the payment is complete, then refresh.</Typography>
            ) : (
              verifyData!.rows.map((r, i) => (
                <Button
                  key={r.paymentId || `${r.originalIndex}-${i}`}
                  onClick={() => handleSelectAndFulfill(r)}
                  sx={{ justifyContent: 'space-between', textTransform: 'none', px: 2, py: 1.5, borderRadius: 3, bgcolor: 'rgba(39,39,42,0.5)', border: '1px solid #27272a', color: 'white', '&:hover': { bgcolor: 'rgba(39,39,42,0.9)' } }}
                >
                  <Typography sx={{ color: 'white', fontWeight: 600 }}>{r.amount ? `${r.amount} ${r.currency || ''}`.trim() : `Payment #${r.originalIndex}`}</Typography>
                  <Typography variant="caption" sx={{ color: '#a1a1aa' }}>{r.recipient || ''}</Typography>
                </Button>
              ))
            )}
            <Button onClick={handleVerifyPayment} sx={{ mt: 1, py: 1, borderRadius: 3, bgcolor: 'transparent', color: '#60a5fa', textTransform: 'none', fontSize: '0.8125rem' }}>Refresh payments</Button>
          </Box>
        )}

        {/* ZKP2P Fulfilling */}
        {step === "zkp2p_fulfilling" && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={48} sx={{ color: '#3b82f6', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>Completing ZKP2P Transfer</Typography>
            <Typography sx={{ color: '#a1a1aa' }}>Proving payment in the extension, then releasing USDC and creating the SEPA intent...</Typography>
            <Typography variant="body2" sx={{ color: '#71717a', mt: 1 }}>Waiting for on-chain confirmation</Typography>
            {/* Escape hatch: the extension drives proof + fulfillment off-screen.
                If it errors or the user closes it, this avoids being stuck here
                forever — they can reclaim the ZKP2P intent and retry. */}
            <Button
              onClick={handleCancelIntent}
              disabled={isCancelling}
              sx={{
                mt: 3, px: 3, py: 1, borderRadius: 3,
                bgcolor: 'transparent', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)',
                fontWeight: 500, fontSize: '0.8125rem', textTransform: 'none',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.5)' },
                '&:disabled': { color: '#71717a', borderColor: 'rgba(113,113,122,0.3)' }
              }}
            >
              {isCancelling ? "Cancelling..." : "Extension stuck? Cancel intent"}
            </Button>
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
                <Typography sx={{ color: 'white', fontWeight: 600 }}>{CURRENCIES[selectedCurrency]?.symbol || '$'}{flowData.usdAmount.toFixed(2)} via {PLATFORMS[selectedPlatform]?.name || 'payment'}</Typography>
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
