import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import {
  encodeAbiParameters,
  parseAbiItem,
  type Log,
} from "viem";
import { Zkp2pClient, isPeerExtensionAvailable, createPeerExtensionSdk, getPeerExtensionState, getPaymentMethodsCatalog, resolvePaymentMethodHashFromCatalog, resolveFiatCurrencyBytes32 } from "@zkp2p/sdk";
import {
  FIAT_TO_FIAT_ROUTER_ADDRESS,
  FIAT_TO_FIAT_ROUTER_ABI,
} from "@/lib/router-contracts";
import { friendlyTxError, type TxRecovery } from "@/lib/tx-errors";
import { useNetworkAddresses } from "@/hooks/useNetworkAddresses";
import { USDC_MAINNET_ADDRESS } from "@/lib/zkp2p-contracts";
import {
  PLATFORMS,
  getPlatformCurrencies,
  getDefaultCurrency,
} from "@/lib/platforms";

// ============ Constants ============

// OffRampV3: QUOTE_WINDOW (5 min) + SELECTION_WINDOW (10 min) = 15 min
export const OFFRAMP_DEADLINE_SECONDS = 15 * 60;

// ZKP2P V3 contracts (fully permissionless PostIntentHook with IPostIntentHookV2)
export const ZKP2P_V3_ORCHESTRATOR = "0x888888359E981B5225CA48fbCdCeff702FC3b888" as const;
export const ZKP2P_V3_ESCROW = "0x777777779d229cdF3110e9de47943791c26300Ef" as const;
export const ZKP2P_V3_PROTOCOL_VIEWER = "0xC8A622e1614BB58141E72e1D6023B16f08677d6c" as const;
export const ZKP2P_API_URL = "https://api.zkp2p.xyz" as const;

// Minimal Orchestrator ABI for signalIntent and cancelIntent
export const ORCHESTRATOR_ABI = [
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
  // cancelIntent reverts this (selector 0x9481f8b9) when the intent no longer exists —
  // e.g. it was already cancelled/pruned outside our app (the Peer UI). Declaring it
  // lets viem decode the revert instead of showing a raw selector.
  { type: "error", name: "IntentNotFound", inputs: [{ name: "intentHash", type: "bytes32" }] },
] as const;

// The ZKP2P Orchestrator reverts IntentNotFound(bytes32) when an intent is gone —
// already cancelled/pruned outside our app. We treat that as "already cancelled" so the
// user is never wedged on a dead verify screen (the on-chain intent can't be re-cancelled).
function isIntentGoneError(err: unknown): boolean {
  const msg = String((err as { message?: string } | undefined)?.message ?? err ?? "");
  return msg.includes("IntentNotFound") || msg.toLowerCase().includes("0x9481f8b9");
}

// The router's commit reverts SlippageExceeded (0x71c4efed) — or OffRampV3 QuoteNotFound
// (0xcf533f49) — when there's no on-chain quote >= the user's floor. The usual cause is
// that the onramped amount is below the solver's minimum, so the solver never quoted it
// on-chain even though the quote API (which doesn't enforce the minimum) showed a price.
function isNoQuoteError(err: unknown): boolean {
  const e = err as { shortMessage?: string; message?: string } | undefined;
  const msg = String(e?.shortMessage ?? e?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("slippageexceeded") ||
    msg.includes("0x71c4efed") ||
    msg.includes("quotenotfound") ||
    msg.includes("0xcf533f49")
  );
}

// ============ Types ============

export type FlowStep =
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

export interface ZkpQuote {
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

export interface FlowData {
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
export const ZKP2P_ENVIRONMENT = 'production' as const;

// Peer's production TEE attestation service — proves the buyer's fiat payment inside
// the enclave. Distinct from FreeFlo's own offramp attestation service.
export const PEER_ATTESTATION_URL = 'https://attestation-service.zkp2p.xyz' as const;

/**
 * Turn the zkp2p-gating proxy's error payload into a human-readable reason.
 * The proxy forwards the upstream ZKP2P body verbatim in `details`, e.g. a 403
 * tier gate: {"message":"paypal requires PLUS tier or higher. Complete $2000 in
 * volume to unlock.","errorCode":"paypal_requires_plus_tier_or_higher_..."}.
 * Surfacing that `message` tells the user WHY signalling failed (a ZKP2P
 * account-policy gate on certain payment methods such as PayPal/Venmo) instead
 * of the opaque "Failed to fetch gating signature from API". Falls back to the
 * proxy's own `error` string, then the HTTP status.
 */
function gatingErrorMessage(result: unknown, status: number): string {
  const r = (result ?? {}) as { error?: string; details?: unknown };
  let detail = "";
  if (typeof r.details === "string") {
    // `details` is usually the raw upstream JSON body — pull `.message` out of it.
    try {
      detail = (JSON.parse(r.details) as { message?: string })?.message ?? r.details;
    } catch {
      detail = r.details;
    }
  } else if (r.details && typeof r.details === "object") {
    detail = (r.details as { message?: string }).message ?? "";
  }
  detail = (detail || r.error || "").trim();
  return detail || `Gating request failed (HTTP ${status}).`;
}

export function useZkp2pClient() {
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
export function useLogPoller(
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
export function useCountdown(startTimestamp: number | null, durationSeconds: number): number {
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

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ============ Headless flow hook ============

// ZKP2P per-wallet "taker tier" (from /v2/taker/tier via the zkp2p-tier proxy).
// Tier is keyed to the connected wallet's cumulative volume and gates higher-risk
// payment methods: PEASANT(0) → PEER($500) → PLUS($2000) → PRO($10k). Each platform
// limit says whether that method isLocked for this wallet and the minTier it needs.
export interface TakerPlatformLimit {
  platformName: string;
  isLocked: boolean;
  minTierRequired: string | null;
  effectiveCapDisplay?: string;
}
export interface TakerTier {
  tier: string;
  perIntentCapDisplay?: string;
  maxOrderSizeDisplay?: string;
  volumeToNextTierDisplay?: string;
  nextTier?: string | null;
  platformLimits?: TakerPlatformLimit[];
}
export interface PlatformLock {
  locked: boolean;
  minTierRequired: string | null;
  cap: string | null;
}

export function useFiatToFiatFlow() {
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
  // When an error is recoverable, what the UI should offer (e.g. reclaim a stuck
  // transfer, start over). Cleared alongside `error` via dismissError().
  const [errorRecovery, setErrorRecovery] = useState<TxRecovery | null>(null);

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

  // Per-wallet ZKP2P taker tier — lets the picker show which payment methods are
  // locked for THIS wallet (e.g. PayPal needs PLUS) BEFORE the user walks the whole
  // flow into a /v3/intent 403 at "Lock order". Best-effort: on failure it stays
  // null and we fall back to surfacing the real reason at signal time.
  const [takerTier, setTakerTier] = useState<TakerTier | null>(null);
  useEffect(() => {
    if (!address) { setTakerTier(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/zkp2p-tier?owner=${address}&chainId=${chainId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.success && data.tier) setTakerTier(data.tier as TakerTier);
      } catch {
        /* leave null — the signal-time error surfacing is the safety net */
      }
    })();
    return () => { cancelled = true; };
  }, [address, chainId]);

  // Whether a UI platform is locked for this wallet's tier. Returns null when we
  // have no tier data yet (→ no gating; degrade to the prior behaviour). Matches the
  // tier's platformName to our platform id case-insensitively.
  const platformLock = useCallback((platformId: string): PlatformLock | null => {
    if (!takerTier?.platformLimits) return null;
    const lim = takerTier.platformLimits.find(
      (p) => p.platformName?.toLowerCase() === platformId.toLowerCase(),
    );
    if (!lim) return null;
    return {
      locked: Boolean(lim.isLocked),
      minTierRequired: lim.minTierRequired ?? null,
      cap: lim.effectiveCapDisplay ?? null,
    };
  }, [takerTier]);

  // ZKP2P quotes
  const [zkp2pQuotes, setZkp2pQuotes] = useState<ZkpQuote[]>([]);

  // FreeFlo quotes
  const [freefloQuotes, setFreefloQuotes] = useState<any[]>([]);

  // Live solver-derived EUR estimate for the input preview (null until fetched).
  const [estimatedEur, setEstimatedEur] = useState<number | null>(null);
  // True while computing the binding slippage floor from a live solver quote.
  const [isPricingFloor, setIsPricingFloor] = useState(false);

  // Peer extension state
  const [extensionState, setExtensionState] = useState<string>("unknown");

  // Contract interactions
  // Commit + reclaim are simulate-first (see handleRouterCommit / handleReclaimTransfer)
  // so a doomed tx surfaces a clear error instead of a reverting signature.
  const [isCommitting, setIsCommitting] = useState(false);
  const [isReclaiming, setIsReclaiming] = useState(false);

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

  // ---- Persist the in-flight flow across refreshes (keyed by wallet). Without this,
  // a reload mid-onramp (e.g. to re-detect the extension) wipes the ZKP2P intent while
  // it's still active on-chain, leaving a stranded "active order" (409 on retry). ----
  const flowStorageKey = address ? `ff-flow-${address.toLowerCase()}` : null;
  const rehydratedKeyRef = useRef<string | null>(null);
  // A router transfer the user just reclaimed/cancelled this session — never re-resume
  // it from a stale PENDING read.
  const reclaimedIntentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!flowStorageKey || rehydratedKeyRef.current === flowStorageKey) return;
    rehydratedKeyRef.current = flowStorageKey;
    try {
      const raw = localStorage.getItem(flowStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw, (_k, v) =>
        typeof v === "string" && v.startsWith("__bigint__") ? BigInt(v.slice(10)) : v,
      ) as { step: FlowStep; flowData: FlowData };
      if (!saved?.flowData?.zkp2pIntentHash && !saved?.flowData?.routerIntentId) return;
      setFlowData((prev) => ({ ...prev, ...saved.flowData }));
      // The extension's TEE capture can't survive a reload, so re-enter the proof at
      // the verify screen — the on-chain intent is still active and re-provable.
      const proofStage: FlowStep[] = ["zkp2p_authenticating", "zkp2p_select_payment", "zkp2p_fulfilling"];
      setStep(proofStage.includes(saved.step) ? "zkp2p_verify" : saved.step);
    } catch {
      /* corrupt/unparseable persisted flow — start fresh */
    }
  }, [flowStorageKey]);

  useEffect(() => {
    if (!flowStorageKey) return;
    if (step === "select_flow" || step === "input_all" || step === "error") return;
    if (step === "success") { try { localStorage.removeItem(flowStorageKey); } catch { /* noop */ } return; }
    try {
      localStorage.setItem(
        flowStorageKey,
        JSON.stringify({ step, flowData }, (_k, v) => (typeof v === "bigint" ? `__bigint__${v.toString()}` : v)),
      );
    } catch { /* ignore quota/serialization */ }
  }, [flowStorageKey, step, flowData]);

  // Reconcile the UI with the on-chain router transfer (recovery after a reload / lost
  // state). Two cases:
  //  - PENDING with no live flow → resume into the commit flow so the offramp leg can
  //    finish within the selection window.
  //  - the transfer we're showing went TERMINAL (CANCELLED/EXPIRED — e.g. the user just
  //    reclaimed, or it timed out) → clear the flow so they're not stranded on a dead
  //    commit screen (which localStorage would otherwise keep restoring).
  useEffect(() => {
    if (!pendingTransfer) return;
    const pt = pendingTransfer as unknown as {
      intentId: `0x${string}`; usdcAmount: bigint; createdAt: bigint; status: number;
    };
    const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
    if (!pt.intentId || pt.intentId === ZERO) return;
    // Never re-resume a transfer the user just reclaimed this session, even if the read
    // cache still shows it PENDING for a moment.
    if (reclaimedIntentRef.current === pt.intentId) return;

    const PENDING = 1, CANCELLED = 4, EXPIRED = 5;
    const routerStages: FlowStep[] = ["router_waiting", "router_commit"];

    // Dead transfer while the UI shows a committable screen → drop it.
    if (
      (Number(pt.status) === CANCELLED || Number(pt.status) === EXPIRED) &&
      routerStages.includes(step) &&
      flowData.routerIntentId === pt.intentId
    ) {
      if (flowStorageKey) { try { localStorage.removeItem(flowStorageKey); } catch { /* noop */ } }
      setFlowData((prev) => ({
        ...prev,
        routerIntentId: null,
        selectedSolver: null,
        quotedEurAmount: 0,
        routerIntentCreatedAt: null,
      }));
      setStep("select_flow");
      setError("That transfer was reclaimed or expired — you're back to the start.");
      return;
    }

    // PENDING with no live flow → resume into the commit flow.
    const earlySteps: FlowStep[] = [
      "select_flow", "input_all", "finding_quotes", "select_maker",
      "zkp2p_signal", "zkp2p_send_venmo", "zkp2p_verify",
      "zkp2p_authenticating", "zkp2p_select_payment", "zkp2p_fulfilling",
    ];
    if (Number(pt.status) === PENDING && earlySteps.includes(step)) {
      setFlowData((prev) => ({
        ...prev,
        routerIntentId: pt.intentId,
        usdcAmount: BigInt(pt.usdcAmount),
        routerIntentCreatedAt: Number(pt.createdAt),
      }));
      setStep("router_waiting");
    }
  }, [pendingTransfer, step, flowData.routerIntentId, flowStorageKey]);

  // Liveness probe — don't strand the user on a restored verify/proof screen for a
  // ZKP2P intent that no longer exists on-chain (e.g. it was cancelled via the Peer
  // UI). Simulate cancelIntent as a READ-ONLY probe; ONLY IntentNotFound clears the
  // flow — a live-but-not-yet-cancellable intent reverts differently and is left
  // untouched, so there are no false resets. Runs at most once per intent hash.
  const probedIntentRef = useRef<string | null>(null);
  useEffect(() => {
    const hash = flowData.zkp2pIntentHash;
    const proofStages: FlowStep[] = [
      "zkp2p_verify", "zkp2p_authenticating", "zkp2p_select_payment", "zkp2p_fulfilling",
    ];
    if (!hash || !publicClient || !address || !proofStages.includes(step)) return;
    if (probedIntentRef.current === hash) return;
    probedIntentRef.current = hash;

    let cancelled = false;
    (async () => {
      try {
        await publicClient.simulateContract({
          address: ZKP2P_V3_ORCHESTRATOR,
          abi: ORCHESTRATOR_ABI,
          functionName: "cancelIntent",
          args: [hash],
          account: address,
        });
        // Simulation succeeded → the intent exists and is cancellable → live. No-op.
      } catch (err) {
        if (cancelled || !isIntentGoneError(err)) return; // any other revert → keep the flow
        if (flowStorageKey) {
          try { localStorage.removeItem(flowStorageKey); } catch { /* noop */ }
        }
        setFlowData((prev) => ({
          ...prev,
          zkp2pIntentHash: null,
          zkp2pQuote: null,
          routerIntentId: null,
        }));
        setStep("select_flow");
        setError("Your previous order was already cancelled — starting fresh.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, flowData.zkp2pIntentHash, publicClient, address, flowStorageKey]);

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
          usdcAmount: BigInt(args.usdcAmount),
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

  // Poll the SOLVER for a TERMINAL offramp failure during the wait (e.g. the recipient
  // isn't a trusted Qonto beneficiary). Success is handled by the IntentFulfilled log poller
  // above; this surfaces a FAILURE — the real reason + a reclaim escape — IMMEDIATELY instead
  // of spinning until the 15-min deadline. The solver exposes its per-intent DB status at
  // /api/intent-status (proxied); a 404/unknown means "keep waiting", and a 'pending_retry'
  // status is transient (the solver is still trying), so only 'failed' is terminal.
  const [offrampError, setOfframpError] = useState<string | null>(null);
  useEffect(() => {
    if (step !== "freeflo_pending" || !flowData.routerIntentId) return;
    setOfframpError(null); // fresh wait
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = async () => {
      try {
        const res = await fetch(`/api/solver-intent-status?intentId=${flowData.routerIntentId}`);
        if (!res.ok) return; // 404 = solver has no record yet → keep waiting
        const data = await res.json();
        if (!cancelled && data?.found && data.status === "failed") {
          setOfframpError(
            data.error ||
              "The euro payout couldn't be completed. Your USDC is safe — reclaim it below and try again.",
          );
          if (timer) clearInterval(timer);
        }
      } catch {
        /* network blip — keep polling */
      }
    };
    void check();
    timer = setInterval(check, 6000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [step, flowData.routerIntentId]);

  // Detect an EXTERNAL commit (the solver/relayer called commitFor on the user's
  // behalf — the gasless 3->2 path). Active while we'd otherwise wait for / show the
  // manual commit; on TransferCommitted for our intent we skip straight to the
  // pending screen. The manual commit (handleRouterCommit) stays as the fallback
  // when no relayer is running, so this poller is purely additive.
  useLogPoller(
    (step === "router_waiting" || step === "router_commit") && !!flowData.routerIntentId,
    FIAT_TO_FIAT_ROUTER_ADDRESS,
    "event TransferCommitted(address indexed user, bytes32 indexed intentId, address solver, uint256 eurAmount)",
    useCallback((log: Log) => {
      const args = (log as any).args;
      if (args?.intentId === flowData.routerIntentId) {
        setFlowData((prev) => ({
          ...prev,
          selectedSolver: (args.solver as `0x${string}`) ?? prev.selectedSolver,
          // eurAmount is the FIRM on-chain committed quote (cents) — the authoritative
          // "you receive". Always use it, overriding any earlier /api/quote estimate
          // (which could be stale, e.g. quoted against a prior intent's amount).
          quotedEurAmount: Number(args.eurAmount) / 100,
        }));
        setStep("freeflo_pending");
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

  // Detect the Peer extension robustly. PeerAuth injects asynchronously after
  // load (it mutates <html> post-hydration — hence suppressHydrationWarning), so a
  // single on-mount check often latches "needs_install" and would need a manual
  // reload. Instead: poll briefly until the state resolves, AND re-check when the
  // tab regains focus / becomes visible (e.g. after the user clicks the extension
  // or returns from the provider tab) — no reload needed.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;
      const state = await refreshExtensionState();
      attempts += 1;
      const resolved = state === "ready" || state === "needs_connection";
      if (!resolved && attempts < 12 && !cancelled) {
        timer = setTimeout(poll, 600); // ~7s of grace for late async injection
      }
    };
    poll();

    const recheck = () => { if (!cancelled) void refreshExtensionState(); };
    const onVisible = () => { if (document.visibilityState === "visible") recheck(); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshExtensionState]);

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

  // Live EUR estimate from the FreeFlo solver's own quote API for a given USDC
  // amount. This is the SAME pricing the on-chain commit checks, so a floor
  // derived from it stays self-consistent with selectQuoteAndCommit. Pure (no
  // state) so it serves both the input preview and the binding floor.
  const fetchSolverEurEstimate = useCallback(async (usdcAmount: bigint): Promise<number | null> => {
    const amountNum = Number(usdcAmount) / 1_000_000;
    if (!(amountNum > 0)) return null;
    try {
      const res = await fetch(`/api/quote?amount=${amountNum}&currency=EUR`);
      if (!res.ok) return null;
      const data = await res.json();
      // The proxy sorts quotes best-first; fiatAmount is in euros.
      const eur = Number((data.quotes ?? [])[0]?.fiatAmount);
      return Number.isFinite(eur) && eur > 0 ? eur : null;
    } catch {
      return null;
    }
  }, []);

  // Check the offramp minimum for a USDC amount via the solver quote API. Returns
  // ok=false (with the minimum in USDC) when the amount is below the solver's minimum
  // — used to gate sub-minimum transfers before they strand at commit. Fails OPEN on
  // a transient API error (the simulate-first commit + reclaim still protect the user).
  const checkOfframpMinimum = useCallback(
    async (usdcAmount: bigint): Promise<{ ok: boolean; minUsdc: number | null }> => {
      const amountNum = Number(usdcAmount) / 1_000_000;
      if (!(amountNum > 0)) return { ok: false, minUsdc: null };
      try {
        const res = await fetch(`/api/quote?amount=${amountNum}&currency=EUR`);
        if (!res.ok) return { ok: true, minUsdc: null };
        const data = await res.json();
        const minUsdc = typeof data.minUsdcAmount === "number" ? data.minUsdcAmount / 1_000_000 : null;
        const ok = !data.belowMinimum && (data.quotes?.length ?? 0) > 0;
        return { ok, minUsdc };
      } catch {
        return { ok: true, minUsdc: null };
      }
    },
    [],
  );

  // Input-screen preview (debounced): a live, solver-derived "≈ €X" as the user
  // types. Estimates the onramp output (~0.1% ZKP2P fee, USDC≈USD) then asks the
  // solver what that USDC fetches in EUR. Display only — the binding floor is set
  // from the REAL onramped amount at maker selection (priceFloor).
  useEffect(() => {
    const amount = parseFloat(usdInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEstimatedEur(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const estUsdc = BigInt(Math.floor(amount * 0.999 * 1_000_000));
      const eur = await fetchSolverEurEstimate(estUsdc);
      if (!cancelled) setEstimatedEur(eur);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [usdInput, selectedCurrency, fetchSolverEurEstimate]);

  // Set the load-bearing slippage floor from a LIVE solver quote on the real
  // onramped USDC amount. Once commit is automatic (commitFor), this floor is the
  // user's only protection, so it MUST track live pricing — never a constant.
  const priceFloor = useCallback(async (usdcAmount: bigint) => {
    setIsPricingFloor(true);
    setError(null);
    const liveEur = await fetchSolverEurEstimate(usdcAmount);
    if (liveEur === null) {
      setIsPricingFloor(false);
      setError("Couldn't fetch a live price to set your protection floor. Tap Retry price before locking.");
      return;
    }
    const minEur = Math.floor(liveEur * (1 - slippagePercent / 100) * 100) / 100;
    setFlowData((prev) => ({ ...prev, minEurAmount: minEur }));
    setIsPricingFloor(false);
  }, [fetchSolverEurEstimate, slippagePercent]);

  // Re-run floor pricing for the in-flight transfer (SignalScreen retry).
  const repriceFloor = useCallback(() => {
    if (flowData.usdcAmount > BigInt(0)) void priceFloor(flowData.usdcAmount);
  }, [flowData.usdcAmount, priceFloor]);

  // Fetch ZKP2P quotes via server-side proxy (avoids CORS)
  const fetchZkp2pQuotes = useCallback(async (fiatAmount: number, platform: string, currency: string) => {
    if (!address) {
      return [];
    }

    try {

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


      if (!response.ok) {
        console.error("Proxy quote error:", data);
        return [];
      }

      // ZKP2P API wraps response in responseObject
      const responseData = data.responseObject || data;
      const quotes = responseData.quotes || responseData.nearbySuggestions || [];

      if (!quotes || quotes.length === 0) {
        return [];
      }

      // Map API response to our ZkpQuote interface
      const mapped: ZkpQuote[] = quotes.map((q: any) => {
        // The readable handle the buyer must pay (e.g. a Revolut username) lives on the
        // quote's `maker.offchainId` (confirmed on the /v2/quote response — `payeeData`
        // is null there, and `maker.depositData` doesn't exist). Reading the wrong path
        // is why the maker list showed no handle. Keep payeeData + the lazy
        // /api/zkp2p-payee resolver as fallbacks. `intent.payeeDetails` is the HASHED
        // on-chain id (kept for the gating call and the resolver lookup).
        const payeeUsername: string =
          q.maker?.offchainId
          || q.maker?.telegramUsername
          || q.payeeData?.offchainId
          || q.payeeData?.telegramUsername
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

    setFlowData((prev) => ({
      ...prev,
      usdAmount: amount,
      eurIban: ibanInput,
      recipientName: nameInput,
      // The binding floor is set from a live solver quote on the REAL onramped
      // amount once a maker is selected (priceFloor in handleSelectMaker).
      minEurAmount: 0,
    }));

    setStep("finding_quotes");
    setError(null);

    const quotes = await fetchZkp2pQuotes(amount, selectedPlatform, selectedCurrency);
    if (quotes.length === 0) {
      const platformName = PLATFORMS[selectedPlatform]?.name || selectedPlatform;
      setError(`No ${platformName} makers available for this amount. Try a different amount or platform.`);
      setStep("input_all");
      return;
    }

    // Gate the offramp minimum up front: the onramp output (USDC) must clear the
    // solver's minimum or the transfer strands at commit (the solver skips quoting
    // sub-minimum amounts on-chain). Check the best maker's USDC output.
    const bestUsdc = quotes.reduce((max, q) => {
      let t = BigInt(0);
      try { t = BigInt(q.tokenAmount || "0"); } catch { /* ignore */ }
      return t > max ? t : max;
    }, BigInt(0));
    const { ok, minUsdc } = await checkOfframpMinimum(bestUsdc);
    if (!ok) {
      const minLabel = minUsdc ? minUsdc.toFixed(2) : "0.10";
      setError(
        `Amount too small — after fees the euro conversion needs at least ~${minLabel} USDC. Increase your amount and try again.`,
      );
      setStep("input_all");
      return;
    }

    setStep("select_maker");
  };

  const handleSelectMaker = (quote: ZkpQuote) => {
    const usdcAmount = BigInt(quote.tokenAmount);
    setFlowData((prev) => ({
      ...prev,
      zkp2pQuote: quote,
      usdcAmount,
      venmoPayee: quote.payeeDetails,
      minEurAmount: 0, // recomputed live from the real USDC just below
    }));
    setStep("zkp2p_signal");

    // Set the load-bearing slippage floor from a live solver quote on the REAL
    // onramped USDC. The SignalScreen shows it and handleSignalIntent signs it.
    void priceFloor(usdcAmount);

    // The handle usually arrives on the quote (payeeData.offchainId). If this maker
    // has no curated payee data, resolve it from the hashed on-chain id so the send
    // screen shows who to pay instead of "@unknown". Only the selected maker is
    // resolved (not all 10 quotes), and only when the handle is actually missing.
    if (!quote.payeeUsername && quote.payeeDetails && quote.processorName) {
      void resolvePayeeUsername(quote);
    }
  };

  // Lazily fetch a maker's readable handle via the server proxy (GET /v2/makers/...)
  // and patch it onto the in-flight quote. Best-effort: a failure leaves the neutral
  // fallback label rather than blocking the flow.
  const resolvePayeeUsername = useCallback(async (quote: ZkpQuote) => {
    try {
      const params = new URLSearchParams({
        processorName: quote.processorName,
        hashedOnchainId: quote.payeeDetails,
      });
      const res = await fetch(`/api/zkp2p-payee?${params}`);
      if (!res.ok) return;
      const { offchainId } = (await res.json()) as { offchainId?: string };
      if (!offchainId) return;
      setFlowData((prev) =>
        prev.zkp2pQuote?.depositId === quote.depositId
          ? { ...prev, zkp2pQuote: { ...prev.zkp2pQuote, payeeUsername: offchainId } }
          : prev,
      );
    } catch {
      /* keep the neutral fallback; the send screen still works */
    }
  }, []);

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
  }): Promise<{ signature: `0x${string}`; expiration: string; referralFees: { recipient: `0x${string}`; fee: string }[] }> => {
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


    // Use server-side proxy to keep API key secret. A network failure reaching
    // our own proxy throws a friendly message; a gating REJECTION (e.g. ZKP2P's
    // PayPal "PLUS tier" gate) throws the REAL upstream reason so the user sees
    // why, instead of the opaque "Failed to fetch gating signature from API".
    const response = await fetch('/api/zkp2p-gating', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }).catch((err) => {
      console.error("Failed to reach gating proxy:", err);
      throw new Error("Couldn't reach the gating service. Check your connection and try again.");
    });

    const result: any = await response.json().catch(() => ({}));

    if (!response.ok || !result?.success) {
      console.error("Gating API error:", response.status, result);
      throw new Error(gatingErrorMessage(result, response.status));
    }

    return {
      signature: result.signature as `0x${string}`,
      expiration: result.expiration,
      referralFees: result.referralFees ?? [],
    };
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

      // fetchGatingSignature throws the real reason on failure (network issue or a
      // ZKP2P gating rejection like the PayPal tier gate), so a returned result is
      // always valid — no generic-null guard needed.
      const gatingSignature = gatingResult.signature;
      const signatureExpiration = gatingResult.expiration;

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


      if (hash && publicClient) {
        // Wait for receipt and extract the actual intent hash from logs
        const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });

        // Find IntentSignaled event - intent hash is in topics[1]
        const intentSignaledLog = receipt.logs.find(
          (log) => log.address.toLowerCase() === ZKP2P_V3_ORCHESTRATOR.toLowerCase() &&
                   log.topics[0] === "0xf8c114f83581b2cf0b9f130782a93024aa8933e7d188901156bd68bdd558a20a" // IntentSignaled event signature
        );

        if (intentSignaledLog && intentSignaledLog.topics[1]) {
          const intentHash = intentSignaledLog.topics[1] as `0x${string}`;
          setFlowData((prev) => ({ ...prev, zkp2pIntentHash: intentHash }));
        } else {
          // Fallback to tx hash if we can't find the event
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

      const { request } = await publicClient.simulateContract({
        address: ZKP2P_V3_ORCHESTRATOR,
        abi: ORCHESTRATOR_ABI,
        functionName: "cancelIntent",
        args: [flowData.zkp2pIntentHash],
        account: walletClient.account,
      });

      const txHash = await walletClient.writeContract(request);

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Reset flow state
      setFlowData((prev) => ({ ...prev, zkp2pIntentHash: null, zkp2pQuote: null }));
      setStep("select_maker");
      setError(null);
    } catch (err: any) {
      // Already cancelled/pruned elsewhere (e.g. via the Peer UI): there's nothing
      // on-chain left to cancel, so don't show an error — clear the stale flow and
      // start fresh so the user is no longer wedged on the dead verify screen.
      if (isIntentGoneError(err)) {
        console.warn("ZKP2P intent already gone (IntentNotFound) — clearing stale flow");
        resetFlow();
        setError("That order was already cancelled — you're back to the start.");
        return;
      }
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
    setErrorRecovery(null);
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
      });
      // Fulfilled → hook fired. The TransferInitiated poller advances to router_waiting.
    } catch (err: any) {
      console.error("fulfillIntent failed:", err);
      // Decode the revert into plain language + the right recovery. The common case here
      // is UserAlreadyHasPendingTransfer (0x4c0b07ac) — a stale router slot from a prior
      // attempt — which arrives as an undecodable signature. Telling the user to "pick the
      // payment again" can't clear a stuck slot, so route them to the reclaim action.
      const f = friendlyTxError(err, "Verification failed — please retry.");
      setError(f.message);
      if (f.recovery === "reclaim") {
        setErrorRecovery("reclaim");
        setStep("error");
      } else {
        setErrorRecovery(f.recovery === "restart" ? "restart" : null);
        setStep("zkp2p_select_payment");
      }
    }
  };

  // Poll for FreeFlo quotes when in router_waiting
  useEffect(() => {
    if (step !== "router_waiting" || !flowData.routerIntentId) return;

    let cancelled = false;
    const pollQuotes = async () => {
      // Quote the CURRENT intent's real onramped amount. Prefer flowData.usdcAmount
      // (set from TransferInitiated); fall back to the on-chain pendingTransfer ONLY
      // when it's for THIS intent. A stale cached transfer from a prior/reclaimed
      // intent would otherwise quote the wrong amount — the source of the stale figure.
      const pt = pendingTransfer as { intentId?: `0x${string}`; usdcAmount?: bigint } | undefined;
      const ptAmt =
        pt && pt.intentId === flowData.routerIntentId ? BigInt(pt.usdcAmount ?? BigInt(0)) : BigInt(0);
      const amt = flowData.usdcAmount > BigInt(0) ? flowData.usdcAmount : ptAmt;
      if (amt <= BigInt(0)) return;
      const quotes = await fetchFreefloQuotes(amt);
      // A relayer may have committed (advancing us to freeflo_pending) while this fetch
      // was in flight — don't yank the step back to router_commit.
      if (cancelled) return;
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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, flowData.routerIntentId, flowData.usdcAmount, pendingTransfer, fetchFreefloQuotes]);

  // Handle Router commit — simulate FIRST so a doomed commit surfaces a clear message
  // instead of prompting the user to sign a reverting tx. The common failure is
  // SlippageExceeded: no on-chain quote >= the floor, usually because the onramped
  // amount is below the solver's minimum (the quote API showed a price the solver
  // won't honour on-chain). On success, send + advance to the pending screen.
  const handleRouterCommit = async () => {
    if (!flowData.selectedSolver || !publicClient || !walletClient) return;
    setIsCommitting(true);
    setError(null);
    try {
      const { request } = await publicClient.simulateContract({
        address: FIAT_TO_FIAT_ROUTER_ADDRESS,
        abi: FIAT_TO_FIAT_ROUTER_ABI,
        functionName: "commit",
        // commit(address solver) — slippage is enforced on-chain against the real quote.
        args: [flowData.selectedSolver],
        account: walletClient.account,
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStep("freeflo_pending");
    } catch (err: any) {
      if (isNoQuoteError(err)) {
        setError(
          "No solver quote is available on-chain for this amount yet — it's most likely below the solver's minimum (~0.1 USDC / ~€0.09). Reclaim your USDC below and try a larger amount.",
        );
      } else {
        setError(friendlyTxError(err, "Couldn't commit — please try again.").message);
      }
    } finally {
      setIsCommitting(false);
    }
  };

  // Reclaim a PENDING router transfer (router.cancel() → USDC back to the user). The
  // escape when no quote ever lands (e.g. a sub-minimum amount) so the user is never
  // wedged on the commit screen.
  const handleReclaimTransfer = async () => {
    if (!publicClient || !walletClient) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const { request } = await publicClient.simulateContract({
        address: FIAT_TO_FIAT_ROUTER_ADDRESS,
        abi: FIAT_TO_FIAT_ROUTER_ABI,
        functionName: "cancel",
        args: [],
        account: walletClient.account,
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      // Mark reclaimed so the resume effect won't re-restore it from a stale PENDING
      // read, and refresh the on-chain read before resetting.
      reclaimedIntentRef.current =
        flowData.routerIntentId ??
        ((pendingTransfer as { intentId?: `0x${string}` } | undefined)?.intentId ?? null);
      try { await refetchPendingTransfer(); } catch { /* noop */ }
      resetFlow();
      setError("Reclaimed your USDC — you're back to the start.");
    } catch (err: any) {
      setError(`Couldn't reclaim: ${err?.shortMessage || err?.message || "unknown error"}`);
    } finally {
      setIsReclaiming(false);
    }
  };

  // Resolve a transfer slot that's blocking a NEW flow (the "you have an unfinished
  // transfer" / UserAlreadyHasPendingTransfer 0x4c0b07ac case). Reads the on-chain status
  // and runs the CORRECT recovery, simulate-first: PENDING → cancel(); PENDING past the
  // 15m commit window → rescueTimedOut(user); COMMITTED → rescueCommitted(user). A
  // too-early revert (CannotCancelYet/NotTimedOutYet) surfaces a clear "try again" message.
  const handleResolvePending = async () => {
    if (!publicClient || !walletClient || !address) return;
    setIsReclaiming(true);
    setError(null);
    try {
      const ptRaw = await publicClient.readContract({
        address: FIAT_TO_FIAT_ROUTER_ADDRESS,
        abi: FIAT_TO_FIAT_ROUTER_ABI,
        functionName: "getPendingTransfer",
        args: [address],
      });
      const pt = ptRaw as unknown as { intentId: `0x${string}`; createdAt: bigint; status: number };
      const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const status = Number(pt.status);
      const NONE = 0, COMMITTED = 2;

      // Slot already free (or never existed / already terminal) → just clear the UI.
      if (!pt.intentId || pt.intentId === ZERO || status === NONE || status > COMMITTED) {
        reclaimedIntentRef.current = pt.intentId ?? null;
        try { await refetchPendingTransfer(); } catch { /* noop */ }
        setErrorRecovery(null);
        resetFlow();
        setError("No unfinished transfer to reclaim — you're clear to start.");
        return;
      }

      // Simulate-first, then send the recovery that matches the slot's state.
      let txHash: `0x${string}`;
      if (status === COMMITTED) {
        const { request } = await publicClient.simulateContract({
          address: FIAT_TO_FIAT_ROUTER_ADDRESS,
          abi: FIAT_TO_FIAT_ROUTER_ABI,
          functionName: "rescueCommitted",
          args: [address],
          account: walletClient.account,
        });
        txHash = await walletClient.writeContract(request);
      } else {
        const COMMIT_TIMEOUT = 15 * 60;
        const pastWindow =
          Number(pt.createdAt) > 0 && Date.now() / 1000 > Number(pt.createdAt) + COMMIT_TIMEOUT;
        if (pastWindow) {
          const { request } = await publicClient.simulateContract({
            address: FIAT_TO_FIAT_ROUTER_ADDRESS,
            abi: FIAT_TO_FIAT_ROUTER_ABI,
            functionName: "rescueTimedOut",
            args: [address],
            account: walletClient.account,
          });
          txHash = await walletClient.writeContract(request);
        } else {
          const { request } = await publicClient.simulateContract({
            address: FIAT_TO_FIAT_ROUTER_ADDRESS,
            abi: FIAT_TO_FIAT_ROUTER_ABI,
            functionName: "cancel",
            args: [],
            account: walletClient.account,
          });
          txHash = await walletClient.writeContract(request);
        }
      }

      await publicClient.waitForTransactionReceipt({ hash: txHash });
      reclaimedIntentRef.current = pt.intentId;
      try { await refetchPendingTransfer(); } catch { /* noop */ }
      setErrorRecovery(null);
      resetFlow();
      setError("Reclaimed your previous transfer — your USDC is back and you're clear to start.");
    } catch (err: any) {
      // CannotCancelYet / NotTimedOutYet → still inside its window; friendlyTxError returns
      // the "try again shortly" copy. Leave errorRecovery set so the button stays available.
      setError(friendlyTxError(err, "Couldn't reclaim — please try again shortly.").message);
    } finally {
      setIsReclaiming(false);
    }
  };

  const dismissError = () => {
    setError(null);
    setErrorRecovery(null);
  };

  // ============ Format Helpers ============

  const formatUsd = (amount: number) => `$${amount.toFixed(2)}`;
  const formatEur = (amount: number) => `€${amount.toFixed(2)}`;
  const formatUsdc = (amount: bigint) => `${(Number(amount) / 1_000_000).toFixed(2)} USDC`;
  // Prefix the handle with "@" once (offchainId may already include it); neutral
  // fallback instead of the old alarming "@Unknown" when no handle resolved.
  const formatPayee = (handle?: string): string => {
    const h = (handle || "").trim();
    if (!h) return "seller (handle unavailable)";
    return h.startsWith("@") ? h : `@${h}`;
  };

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
    setErrorRecovery(null);
    setOfframpError(null);
    if (flowStorageKey) { try { localStorage.removeItem(flowStorageKey); } catch { /* noop */ } }
  };

  // The view references every name below verbatim (destructured 1:1), so the JSX needs
  // no edits. State, setters, derived values, formatters, handlers, and wallet flags.
  return {
    // wallet / connection
    address,
    isConnected,
    // flow state
    step,
    setStep,
    flowData,
    error,
    setError,
    errorRecovery,
    dismissError,
    // terminal offramp failure surfaced by the solver during the freeflo_pending wait
    offrampError,
    extensionState,
    isSignaling,
    isCancelling,
    isCommitting,
    isReclaiming,
    isConnecting,
    isPricingFloor,
    zkp2pQuotes,
    verifyData,
    // form inputs (controlled)
    usdInput,
    setUsdInput,
    ibanInput,
    setIbanInput,
    nameInput,
    setNameInput,
    selectedPlatform,
    setSelectedPlatform,
    selectedCurrency,
    setSelectedCurrency,
    availableCurrencies,
    slippagePercent,
    // per-wallet ZKP2P tier + which platforms it locks (e.g. PayPal needs PLUS)
    takerTier,
    platformLock,
    // derived
    progress,
    deadlineRemaining,
    estimatedEur,
    // formatters / pure helpers
    formatUsd,
    formatEur,
    formatUsdc,
    formatPayee,
    formatCountdown,
    // handlers
    handleStart,
    handleInputSubmit,
    handleSelectMaker,
    handleSignalIntent,
    handleVenmoSent,
    handleVerifyPayment,
    handleSelectAndFulfill,
    handleCancelIntent,
    handleRouterCommit,
    handleReclaimTransfer,
    handleResolvePending,
    repriceFloor,
    connectExtension,
    resetFlow,
  };
}

export type FiatToFiatFlowApi = ReturnType<typeof useFiatToFiatFlow>;
