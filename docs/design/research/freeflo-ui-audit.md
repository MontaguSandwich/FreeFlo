# FreeFlo Frontend — "Do-Not-Break" Safety Audit

**Scope:** Authoritative safety audit for a full visual overhaul of the FreeFlo frontend
(Next.js 14 App Router + MUI v7 + wagmi v2 + viem v2 + `@zkp2p/sdk` 0.5.0).
**Prime directive:** NOTHING BREAKS. This document is the contract the design overhaul is built around.
**Status:** Read-only audit. No code changed.

**Files audited (all paths relative to `frontend/`):**
`components/FiatToFiatFlow.tsx` (1766 LOC — primary target), `components/offramp/*`
(OfframpWidget, OfframpInput, OfframpExecution, QuoteCard, StepItem, IntentRow, TransactionHistory),
`components/{Header,Footer,Background}.tsx`, `lib/theme.ts`, `app/{providers,layout,page}.tsx`,
`app/fiat-to-fiat/page.tsx`, `stores/{formStore,executionStore,intentsStore,historyUiStore}.ts`,
`hooks/{useExecuteOfframp,useNetworkAddresses,useCreateIntent,useCancelIntent,usePollFulfillment}.ts`,
`lib/{router-contracts,contracts,network,platforms,wagmi}.ts`, `CLAUDE.md`.

**Two independent surfaces exist** — they share the theme + chrome (Header/Footer/Background)
but NOT the flow logic:
- **`/` (USDC offramp):** `OfframpWidget` → `OfframpInput` / `OfframpExecution`, driven by Zustand
  stores (`formStore`, `executionStore`) + the `useExecuteOfframp` headless hook. This surface is
  **already well-architected** (logic is in a hook + stores; view is thin).
- **`/fiat-to-fiat` (cross-border):** `FiatToFiatFlow.tsx` — a single 1766-LOC component that
  fuses a 14-state machine, the Peer TEE handshake, ZKP2P signalIntent, two on-chain pollers,
  localStorage persistence, and ~1100 lines of inline-styled JSX. This is the high-risk monolith.

---

## 1. INVARIANT INVENTORY

Every item below is load-bearing business logic that MUST survive the reskin byte-for-byte
behaviorally. "Reskin breaks it" = the user-visible failure mode.

> Line refs are from the audited working tree on branch `audit-fixes`.

### INV-1 — FlowStep state machine (14 states)
- **What:** The cross-border wizard is a single `FlowStep` union driving the entire render.
  Definition: `FiatToFiatFlow.tsx:115-130`. The 14 states:
  `select_flow → input_all → finding_quotes → select_maker → zkp2p_signal → zkp2p_send_venmo →
  zkp2p_verify → zkp2p_authenticating → zkp2p_select_payment → zkp2p_fulfilling →
  router_waiting → router_commit → freeflo_pending → success` (+ `error` is a flag, not a step —
  errors are surfaced via the `error` string state, see INV-12).
- **State holder:** `const [step, setStep] = useState<FlowStep>("select_flow")` at `:294`.
- **Transition triggers (21 `setStep` calls — all must be preserved):**
  - `handleStart` `:634` → `input_all`
  - `handleInputSubmit` `:638-675` → `finding_quotes`, then `select_maker` (quotes found) or back to `input_all` (none)
  - `handleSelectMaker` `:677-694` → `zkp2p_signal`
  - `handleSignalIntent` `:781-875` → `zkp2p_send_venmo` (after `IntentSignaled` log parsed)
  - `handleVenmoSent` `:912-914` → `zkp2p_verify`
  - `handleVerifyPayment` `:916-985` → `zkp2p_authenticating`; the `onMetadataMessage` callback → `zkp2p_select_payment`
  - `handleSelectAndFulfill` `:990-1016` → `zkp2p_fulfilling` (then poller advances)
  - `TransferInitiated` poller `:429-445` → `router_waiting`
  - `router_waiting` quote-poll effect `:1019-1046` → `router_commit`
  - `handleRouterCommit` confirm effect `:1063-1067` → `freeflo_pending`
  - `IntentFulfilled` poller `:447-458` → `success`
  - `handleCancelIntent` `:877-910` → `select_maker`
  - rehydrate effect `:368-386` and resume effect `:404-424` (see INV-5/6) also set `step`
- **Why load-bearing:** Every render branch (`:1206`–`:1762`) is keyed on `step ===`. The
  progress header (`getProgress` `:1082-1094`), the countdown gating, and the pollers' `enabled`
  flags all read `step`. It is the single source of truth for "where in the flow am I."
- **Failure mode if broken:** Wrong screen rendered, dead-end states, or the user stranded mid-flow
  with an active on-chain intent locking USDC and no way to advance/cancel.

### INV-2 — Peer TEE proof handshake (the riskiest sequence)
- **What:** The buyer-TEE onramp proof. The Peer browser extension performs provider sign-in +
  TEE capture; the app owns the intent lifecycle and submits `fulfillIntent`.
- **Where (in order):**
  - `useZkp2pClient` `:180-198` — builds `Zkp2pClient` from `walletClient` + `chainId` + API key, `runtimeEnv: 'production'`. Memoized; returns `null` until a wallet client exists.
  - `refreshExtensionState` `:474-485` — `getPeerExtensionState()` → `extensionState` ∈ `{unknown, needs_install, needs_connection, ready}`. Runs on mount (`:485`).
  - `connectExtension` `:491-508` — `isPeerExtensionAvailable()` guard, then `createPeerExtensionSdk().requestConnection()`, then re-refresh.
  - `handleVerifyPayment` `:916-985` — the core. Extension-ready guard (`:926-933`, see INV-12), then `createPeerExtensionSdk()`, subscribes `peer.onMetadataMessage(...)` (`:948-971`) storing the unsub in `metadataUnsubRef` (`:472`), then `peer.authenticate({ actionType, platform, captureMode: "buyerTee", attestationServiceUrl: PEER_ATTESTATION_URL, attestationActionType })` (`:973-979`). `actionType = "transfer_" + platform` (`:938`).
  - `onMetadataMessage` callback `:948-971` — handles `errorMessage`, maps `metadata` rows (filters `r.hidden`), retains `buyerTeeCapture.encryptedSessionMaterial` across messages into `verifyData` (`:466-471`), advances to `zkp2p_select_payment`.
  - `handleSelectAndFulfill` `:990-1016` — builds the `proof` object (`proofType: "buyerTee"`, `encryptedSessionMaterial`, `params: { ...row.params, index: row.originalIndex }`, `actionPlatform`, `actionType`) and calls `zkp2pClient.fulfillIntent({ intentHash, proof, attestationServiceUrl: PEER_ATTESTATION_URL })`. On error → back to `zkp2p_select_payment`.
  - **Cleanup:** `metadataUnsubRef.current?.()` is called before re-subscribing (`:947`) and in `resetFlow` (`:1110-1111`).
- **Constants:** `PEER_ATTESTATION_URL = 'https://attestation-service.zkp2p.xyz'` (`:178`),
  `ZKP2P_ENVIRONMENT = 'production'` (`:174`).
- **Why load-bearing:** This is the only path that turns the user's fiat payment into on-chain
  proof → USDC release → the FiatToFiatRouter hook firing. The subscribe→authenticate→
  receive-metadata→fulfill ordering AND the ref cleanup are correctness-critical (a leaked
  subscription double-fires; a missed unsub before re-subscribe stacks handlers).
- **Failure mode if broken:** Proof never completes → USDC stays locked in the ZKP2P escrow →
  user loses funds until manual reclaim. Stacked subscriptions → duplicate `fulfillIntent`
  attempts / spurious errors. Lost `metadataUnsubRef` → memory/handler leak across attempts.

### INV-3 — signalIntent + gating signature + MANDATORY referralFees
- **What:** Locks a maker's USDC by signaling a ZKP2P intent, with the SEPA details encoded as the
  PostIntentHook payload.
- **Where:**
  - `fetchGatingSignature` `:719-779` — POSTs to `/api/zkp2p-gating` (server proxy keeps the API key
    secret). Resolves `paymentMethod` + `fiatCurrency` hashes via SDK catalog helpers (`:733-736`).
    **Returns `{ signature, expiration, referralFees }`** (`:770-774`) — `referralFees` defaults to `[]`.
  - `encodeHookPayload` `:614-630` — encodes `(iban, recipientName, minEurAmount)` as a SINGLE tuple
    matching the contract's `HookPayload` struct. Flat params make `abi.decode` revert. (Mirrored in
    `lib/router-contracts.ts:198-219`.)
  - `handleSignalIntent` `:781-875` — fetches gating sig, then `zkp2pClient.signalIntent({...,
    postIntentHook: FIAT_TO_FIAT_ROUTER_ADDRESS, data: hookPayload, referralFees: (gatingResult.referralFees ?? []).map(...), gatingServiceSignature, signatureExpiration })`.
  - **THE MANDATORY PASS-THROUGH** `:830-835`: the exact `referralFees` the gating service signed
    MUST be submitted. ZKP2P injects a mandatory protocol fee; omitting it reverts `InvalidSignature()`.
  - After tx: waits for receipt, extracts the intent hash from the `IntentSignaled` log
    (`topic[0] == 0xf8c114f8…`, hash in `topics[1]`) `:841-858`, sets `zkp2pIntentHash`.
- **Why load-bearing:** This is the on-chain commitment that locks USDC and binds the SEPA payload.
  `referralFees` and the tuple-encoded `data` are both revert-on-mismatch. The `IntentSignaled`
  hash is later used for `fulfillIntent` (INV-2) and `cancelIntent` (INV-9).
- **Failure mode if broken:** `signalIntent` reverts (`InvalidSignature` if `referralFees` dropped;
  decode revert if payload flattened) → the whole flow is dead at step `zkp2p_signal`. A lost intent
  hash → can't fulfill or cancel → stranded active order (next attempt 409s, see INV-12).

### INV-4 — Two on-chain log pollers (`useLogPoller`)
- **What:** Custom `eth_getLogs` poller (`:200-252`) replacing `useWatchContractEvent` (which the
  comment at `:200` and `:426` says was unreliable here). Two instances:
  - **A — TransferInitiated** `:429-445`: enabled only when `step === "zkp2p_fulfilling"`, on
    `FIAT_TO_FIAT_ROUTER_ADDRESS`. On a log whose `args.user == address`, sets
    `routerIntentId / usdcAmount / routerIntentCreatedAt` and → `router_waiting`.
  - **B — IntentFulfilled** `:447-458`: enabled when `step === "freeflo_pending" && routerIntentId`,
    on `OFFRAMP_V3_ADDRESS` (from `useNetworkAddresses`). On a log whose `args.intentId ==
    routerIntentId`, → `success`.
- **Polling block-selection logic** `:218-243`: tracks `lastBlockRef`; first poll looks back 50
  blocks (`currentBlock - 50n`), subsequent polls run `lastBlockRef+1 → currentBlock`; guards
  `fromBlock > currentBlock`; 3000 ms interval; `cancelled` flag + `clearInterval` on cleanup;
  `onLogRef` keeps the latest callback without re-subscribing.
- **Why load-bearing:** These are the ONLY transitions out of `zkp2p_fulfilling` and
  `freeflo_pending`. They are gated on `step` (the `enabled` arg) and on the wallet `address` /
  `routerIntentId` closures. The 50-block lookback + monotonic cursor is what makes them not miss
  the event and not re-fire.
- **Failure mode if broken:** Flow hangs forever on "Completing ZKP2P Transfer" or "Sending SEPA
  Transfer" even though the on-chain event fired — the user thinks it failed and may double-pay or
  abandon a successful transfer. If `enabled` is mis-wired during the reskin (e.g. step renamed),
  the poller silently never runs.

### INV-5 — localStorage flow persistence + bigint serialization + proof-stage remap
- **What:** Persists the in-flight cross-border flow across refreshes, keyed by wallet, so a reload
  mid-onramp doesn't strand an active on-chain intent.
- **Where:**
  - Key: `flowStorageKey = "ff-flow-" + address.toLowerCase()` `:365` (null when disconnected).
  - **Write effect** `:388-398`: skips `select_flow` / `input_all` / `error`; on `success` REMOVES
    the key (`:391`); otherwise `JSON.stringify({step, flowData}, replacer)` where the replacer
    encodes `bigint → "__bigint__"+v.toString()` (`:395`).
  - **Rehydrate effect** `:368-386`: guarded by `rehydratedKeyRef` (runs once per wallet key);
    `JSON.parse(raw, reviver)` where reviver decodes `"__bigint__"`-prefixed strings back to
    `BigInt` (`:374-375`); bails if no `zkp2pIntentHash` AND no `routerIntentId` (`:377`); merges
    into `flowData`.
  - **Proof-stage→verify remap** `:381-382`: if the saved step ∈
    `{zkp2p_authenticating, zkp2p_select_payment, zkp2p_fulfilling}`, it resumes at `zkp2p_verify`
    instead — because the extension's TEE capture cannot survive a reload, but the on-chain intent
    is still active and re-provable.
  - `resetFlow` (`:1114`) and the success write-path both clear the key.
- **The `__bigint__` sentinel** is used ONLY here (`usdcAmount` is the bigint field in `flowData`).
- **Why load-bearing:** `flowData.usdcAmount` is a `bigint`; raw `JSON.stringify` throws on bigint
  ("Do not know how to serialize a BigInt"), which would silently drop persistence (caught by the
  `try/catch` at `:397` → no save). The proof-stage remap prevents resuming into a dead TEE state.
- **Failure mode if broken:** A reload mid-onramp wipes the intent from the UI while it's still
  active on-chain → 409 "active order" on retry, stranded USDC. If bigint serialization is removed,
  persistence silently no-ops. If the remap is dropped, resuming lands on a screen waiting for an
  extension message that will never arrive.

### INV-6 — Resume-on-load from on-chain pending transfer
- **What:** If the connected wallet already has a `PENDING` transfer on the router (onramp hook
  fired but UI state was lost), jump straight to the commit flow.
- **Where:**
  - Read: `useReadContract` `getPendingTransfer(address)` `:354-360`, `enabled: !!address`,
    with `refetchPendingTransfer`.
  - Resume effect `:404-424`: if `pt.status === 1` (PENDING) AND current `step` is one of the
    `earlySteps` (`:409-413`) AND `intentId` is non-zero, set `routerIntentId / usdcAmount /
    routerIntentCreatedAt` from chain and → `router_waiting`.
- **Why load-bearing:** This is the safety net for "user closed the tab after the USDC was released
  but before committing the SEPA leg." Without it the USDC sits in the router with a 15-min
  selection window ticking and the user has no UI to finish.
- **Failure mode if broken:** Funds released into the router but never committed → they time out and
  the user must manually reclaim (`rescueTimedOut`). Silent loss-of-progress.

### INV-7 — Countdowns / windows
- **What:** Time pressure on the offramp leg.
  - `OFFRAMP_DEADLINE_SECONDS = 15*60` `:50` — QUOTE_WINDOW (5m) + SELECTION_WINDOW (10m).
  - `useCountdown(startTimestamp, durationSeconds)` `:255-275` — ticks every 1s, derives remaining
    from `Date.now()` − start; resets when start is null.
  - `deadlineRemaining = useCountdown(flowData.routerIntentCreatedAt, OFFRAMP_DEADLINE_SECONDS)` `:351`.
  - Used to: render the Stage-2 countdown banner (`:1157-1175`, red < 120s), warn at < 300s
    (`:1701-1705`), block "Confirm & Send EUR" when `deadlineRemaining === 0` (`:1714`).
  - The 5-min ZKP2P quote/gating `signatureExpiration` lives on the quote (`:817`, `:837`) and is
    enforced on-chain, not by a UI timer.
  - The `/` offramp surface has its own per-step elapsed timers in `StepItem` (`:23-37`) and
    `TransactionHistory` reads contract windows (`QUOTE_WINDOW / SELECTION_WINDOW /
    FULFILLMENT_WINDOW`, `TransactionHistory.tsx:29-39`; defaults `IntentRow.tsx:16`).
- **Why load-bearing:** The commit button must hard-disable at expiry — committing a stale quote
  reverts on-chain (`QuoteWindowClosed`). The countdown is the user's only signal that the window
  is closing.
- **Failure mode if broken:** User commits after expiry → revert + wasted gas + confusion; or no
  urgency shown → window silently lapses → forced reclaim.

### INV-8 — Contract reads/writes (addresses + functions)
- **OffRampV3 address resolution:** `const { OFFRAMP_V3: OFFRAMP_V3_ADDRESS } = useNetworkAddresses()`
  (`:286`). `useNetworkAddresses` (`hooks/useNetworkAddresses.ts`) reads `useChainId()` and maps via
  `lib/network.ts:getAddressesForChain`. **All on-chain reads/writes must use this dynamic address**,
  never a hardcoded constant — the app dual-deploys (mainnet/testnet/local) and switches with the
  wallet's chain. (`useCreateIntent`, `useCancelIntent`, `usePollFulfillment` all already do.)
- **Router (fixed mainnet address `FIAT_TO_FIAT_ROUTER_ADDRESS`, `lib/router-contracts.ts:25`):**
  - `getPendingTransfer(user)` read `:354-360` (INV-6).
  - `commit(solver)` write `:1049-1060` via `routerCommit` (`useWriteContract` `:343`) + confirm via
    `useWaitForTransactionReceipt` `:344`. Slippage is enforced on-chain — **no EUR amount is passed**
    (comment `:1056-1057`).
- **ZKP2P Orchestrator (`ZKP2P_V3_ORCHESTRATOR` `:53`):**
  - `signalIntent` via the SDK (INV-3).
  - `cancelIntent(intentHash)` via `publicClient.simulateContract` + `walletClient.writeContract`
    (`:888-898`, INV-9).
- **FreeFlo quotes:** `getQuote` is fetched off-chain via `/api/quote` (`fetchFreefloQuotes`
  `:598-611`); `/` surface uses `fetchOnChainQuotes` in `lib/quotes.ts` (via `useExecuteOfframp`).
- **Why load-bearing:** A reskin that imports a hardcoded address, or drops the `useNetworkAddresses`
  call during a refactor, silently routes to the wrong (or deprecated) contract.
- **Failure mode if broken:** Reads return empty / writes revert (`NotAuthorizedWitness 0x41110897`
  on a deprecated router; see `lib/router-contracts.ts:10-20`). On testnet/local: total breakage.

### INV-9 — cancelIntent (escape hatch) + Cancel affordance
- **What:** Lets the user reclaim a stranded ZKP2P intent.
- **Where:** `handleCancelIntent` `:877-910` — guards on `zkp2pIntentHash`/clients, simulates +
  writes `cancelIntent(intentHash)` on the orchestrator, waits for receipt, clears
  `zkp2pIntentHash`/`zkp2pQuote`, returns to `select_maker`.
- **Surfaced from FOUR places:** the error Alert action (`:1185-1193`, only when the error mentions
  "active intent"/"active order" AND a hash exists), the send screen (`:1531-1544`), the verify
  screen (`:1586-1599`), and the `zkp2p_fulfilling` "Extension stuck?" escape hatch (`:1648-1661`).
- **Why load-bearing:** Without a reachable cancel, any failure mid-onramp permanently locks USDC
  (until the contract window lapses). The `zkp2p_fulfilling` escape hatch specifically rescues the
  "extension drove off-screen and errored" dead-end.
- **Failure mode if broken:** Stranded funds, no user-driven recovery — the worst-case UX/financial
  outcome.

### INV-10 — `useExecuteOfframp` orchestration (the `/` surface)
- **What:** The headless engine for the simple USDC→fiat offramp. `hooks/useExecuteOfframp.ts`
  sequences create → poll quotes → approve → commit → poll fulfillment, driving `executionStore`
  (`ExecutionStep[]`) and reading `formStore`.
- **Critical sub-invariants:**
  - **`useRef` re-entry guards** `hasStartedQuotePoll / hasStartedApproval / hasStartedCommit`
    (`:33-35`) prevent each phase from double-firing across re-renders.
  - **Quote-binding** `:80-89`: the polled quote MUST match the exact `rtpn` AND `solver.address`
    the user reviewed; no silent fallback to a different solver.
  - **`getState()` reads** (`:57`, `:148-151`) avoid widening effect dep arrays.
  - **Skip-approval** path when allowance suffices (`:121-127`).
  - `usePollFulfillment` (`hooks/usePollFulfillment.ts`) — uses `useWatchContractEvent` + a 3s poll
    backup + a `fulfilledRef` idempotency guard (the only place `useWatchContractEvent` survives).
- **Why load-bearing:** This is the entire `/` page transaction engine. The refs and quote-binding
  prevent double-spends and wrong-solver commits.
- **Failure mode if broken:** Double `createIntent`/`approve`/`commit`; committing against a quote
  the user didn't see; or fulfillment never detected.

### INV-11 — Zustand stores (cross-render state)
- `formStore.ts` — `/` form state (`amount, currency, receivingInfo, recipientName, selectedQuote`).
  Read both reactively and via `getState()`.
- `executionStore.ts` — `view` ("input"|"execution") + the `ExecutionStep[]` model
  (`createIntent / approve / commit / transferPending / complete`, each with
  `status ∈ idle|pending|done|failed|skipped`, `txHash`, `error`, `startedAt`). `OfframpWidget`
  toggles on `view` (`OfframpWidget.tsx:66`).
- `intentsStore.ts` — `persist`-backed (`name: "freeflo-tracked-intents"`) list of created intents
  for the history/reclaim panel.
- `historyUiStore.ts` — ephemeral dialog open/close.
- **Why load-bearing:** The `/` view layer is a pure function of these stores. `executionStore.view`
  is the view switch; `intentsStore` is the persisted reclaim ledger.
- **Failure mode if broken:** History/reclaim loses persisted intents (stranded funds invisible);
  view fails to switch input↔execution; step statuses desync from reality.

### INV-12 — Error-handling branches
- **409 / active-order** `:865-868`: maps `err.message` containing `"409"`/`"active order"` to a
  specific "You have an active intent…" message — which is what triggers the Cancel affordance
  (`:1185`). The string match is part of the contract; changing copy without updating both ends
  breaks the affordance.
- **Extension-not-ready guard** `:926-933`: blocks `handleVerifyPayment` unless
  `extensionState === "ready"`, with distinct messages for `needs_install`/`unknown` vs
  `needs_connection`. This guard is what prevents the old "silent advance into an unobservable poll
  loop" bug — it MUST remain a hard gate.
- **Slippage** `:653-654`: `minEur = estimatedEur * (1 - slippagePercent/100)` (default 2%, `:315`);
  encoded into the hook payload as EUR cents (`:790`) and enforced on-chain at commit.
- **fulfillIntent failure** `:1011-1015`: returns to `zkp2p_select_payment` so the user can re-pick.
- **Quote-window-expired** `:1706-1710` + disabled commit (`:1714`).
- **`/` surface errors:** each step writes `executionStore.error` + sets the step `failed`
  (`useExecuteOfframp.ts:110-113, 137-140, 174-177`); rendered in `OfframpExecution` (`:104-116`)
  and per-step in `StepItem` (`:143-155`).
- **Why load-bearing:** These branches are the difference between "recoverable" and "stuck." The
  409→Cancel and extension-ready guards in particular gate against fund-locking dead-ends.
- **Failure mode if broken:** Silent infinite spinners; no cancel button when there's an active
  intent; advancing into a TEE flow with no extension.

### INV-13 — Hooks-order / conditional-render correctness (rules of hooks)
- **What:** `FiatToFiatFlow` calls **18 `useState`, 9 `useEffect`, 9 `useCallback`**, plus wagmi
  hooks (`useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useReadContract,
  usePublicClient, useWalletClient`), all UNCONDITIONALLY at the top before the first early return
  (`if (!isConnected)` at `:1119`). The custom `useLogPoller`/`useCountdown` are also called
  unconditionally.
- **Why load-bearing:** React requires identical hook call order every render. The component already
  obeys this (early returns are after all hooks). Any reskin that pushes a hook below a conditional,
  or wraps a sub-tree that calls hooks in a conditional, throws "rendered fewer/more hooks than
  expected" and white-screens the page.
- **Failure mode if broken:** Hard crash (error boundary / blank page), wallet shows disconnected.

---

## 2. LOGIC ↔ PRESENTATION SEPARATION MAP

### `/fiat-to-fiat` (FiatToFiatFlow.tsx) — currently FUSED; must be split

| Concern | Lines | Class | Notes |
|---|---|---|---|
| Constants (orchestrator/escrow/ABIs/URLs) | `:47-111`, `:174-178` | **LOGIC** | Move to a `lib/` module |
| `FlowStep` / `ZkpQuote` / `FlowData` types | `:115-169` | **LOGIC** | Shared contract between hook + view |
| `useZkp2pClient` | `:180-198` | **LOGIC** | Already a hook |
| `useLogPoller` / `useCountdown` / `formatCountdown` | `:200-281` | **LOGIC** | Already extractable helpers |
| `step`, `flowData`, `error` state | `:294-309` | **LOGIC** | Core machine state |
| Form input state (`usdInput/ibanInput/nameInput/slippage`) | `:312-316` | **MIXED** | Input values; view-bindable but feed logic |
| Platform/currency selection + sync effect | `:318-331` | **MIXED** | Pure-data selection |
| `zkp2pQuotes / freefloQuotes / extensionState / verifyData` | `:334-340, 466-472` | **LOGIC** | |
| Router write hook + signaling/cancelling flags | `:343-348` | **LOGIC** | |
| `pendingTransfer` read + resume effect | `:354-360, 404-424` | **LOGIC** | INV-6 |
| Persistence (rehydrate + write + remap) | `:365-398` | **LOGIC** | INV-5 |
| Two pollers | `:429-458` | **LOGIC** | INV-4 |
| Extension handshake (`refreshExtensionState/connectExtension`) | `:474-508` | **LOGIC** | INV-2 |
| Quote fetching (`fetchZkp2pQuotes/fetchFreefloQuotes`, mapping) | `:512-611` | **LOGIC** | |
| `encodeHookPayload` | `:614-630` | **LOGIC** | INV-3 |
| All handlers (`handleStart`…`handleRouterCommit`) | `:634-1067` | **LOGIC** | INV-1/2/3/9 |
| `formatUsd/Eur/Usdc/Payee`, `getProgress`, `resetFlow` | `:1071-1115` | **MIXED** | Derived/format → hook; reset is logic |
| Entire `return (...)` JSX | `:1119-1765` | **PRESENTATION** | ~640 LOC; safe to fully redo |

**Verdict:** ~1100 LOC of logic is interleaved with ~640 LOC of inline-styled JSX in one component.
The presentation (the `return`) is safe to rewrite ONLY if the logic is extracted first behind a
stable interface.

### Proposed headless hook: `useFiatToFiatFlow()`

Create `hooks/useFiatToFiatFlow.ts` (and move types to `lib/fiat-to-fiat-types.ts`,
constants to `lib/fiat-to-fiat-constants.ts`). The hook returns exactly four buckets so the view
becomes a pure render of `(state) → JSX`:

```ts
function useFiatToFiatFlow(): {
  // ----- state (read-only) -----
  step: FlowStep;
  flowData: FlowData;
  error: string | null;
  extensionState: string;          // unknown | needs_install | needs_connection | ready
  isConnected: boolean;
  isSignaling: boolean;
  isCancelling: boolean;
  isConnecting: boolean;
  zkp2pQuotes: ZkpQuote[];
  verifyData: VerifyData | null;
  // form inputs (controlled)
  usdInput: string; ibanInput: string; nameInput: string;
  selectedPlatform: string; selectedCurrency: string;
  availableCurrencies: Currency[];
  // ----- derived -----
  derived: {
    progress: { stage: 1 | 2; percent: number; label: string };   // getProgress
    deadlineRemaining: number;                                      // useCountdown
    estimatedEur: number;                                          // calculateEstimatedEur(usdInput)
    formatUsd; formatEur; formatUsdc; formatPayee; formatCountdown;
  };
  // ----- actions -----
  actions: {
    setUsdInput; setIbanInput; setNameInput;
    setSelectedPlatform; setSelectedCurrency;
    start;                 // handleStart
    submitInput;           // handleInputSubmit
    selectMaker;           // handleSelectMaker
    signalIntent;          // handleSignalIntent
    markVenmoSent;         // handleVenmoSent
    verifyPayment;         // handleVerifyPayment
    selectAndFulfill;      // handleSelectAndFulfill
    connectExtension;
    commitRouter;          // handleRouterCommit
    cancelIntent;          // handleCancelIntent
    dismissError;          // setError(null)
    reset;                 // resetFlow
    goToVerify;            // setStep("zkp2p_verify")  — used by "Back"/"Refresh" buttons
  };
}
```

**What moves into the hook (everything except JSX):** lines `:286-1115`. The view component
(`FiatToFiatFlow`) becomes `const f = useFiatToFiatFlow(); return (<view>)` and renders branches
keyed on `f.step`, wiring buttons to `f.actions.*`. **No business logic, no `setStep`, no contract
calls, no `localStorage`, no refs survive in the view.** This lets the overhaul swap the entire
`return (...)` (or replace it with a multi-file component tree) while the hook guarantees identical
behavior. The hook is unit-/integration-testable in isolation; the view is purely visual.

### `/` (offramp) — ALREADY separated; use as the reference pattern
`useExecuteOfframp` + `executionStore`/`formStore` is the target architecture. `OfframpWidget` /
`OfframpInput` / `OfframpExecution` are thin views over the hook+stores. The cross-border overhaul
should converge on this same shape. (One caveat: the `/` views still carry heavy inline `sx` with
hardcoded hex — see §3 — so "separated logic" ≠ "uses the design system." Both need work.)

---

## 3. REUSABLE DESIGN ASSETS

### 3a. Theme tokens (`lib/theme.ts`) — the canonical source the design system MUST build on

- **Palette (dark mode):**
  - primary `#10b981` (light `#34d399`, dark `#059669`) — emerald
  - secondary `#14b8a6` (light `#2dd4bf`, dark `#0d9488`) — teal
  - error `#ef4444` / `#f87171` / `#dc2626`
  - warning `#f59e0b` / `#fbbf24` / `#d97706`
  - success `#10b981` / `#34d399` / `#059669`
  - info `#3b82f6` / `#60a5fa` / `#2563eb`
  - background.default `#0a0a0b`, background.paper `#18181b` (zinc-900)
  - text.primary `#fafafa`, text.secondary `#a1a1aa`, text.disabled `#52525b`
  - divider `rgba(63,63,70,0.5)`; action.hover/selected/disabled per `:48-53`
- **Typography:** `'DM Sans', system-ui, sans-serif`; h1/h2 weight 700 + `-0.025em`; h3–h6 weight
  600; `button` `textTransform: none`, weight 600.
- **Shape:** `borderRadius: 12`.
- **Component overrides:** `MuiButton` (radius 12, `containedPrimary` emerald→teal gradient,
  elevation disabled), `MuiCard` (radius 24, `rgba(24,24,27,0.8)` + `blur(20px)` + `#27272a`
  border), `MuiPaper` (no backgroundImage), `MuiTextField` (zinc inputs, emerald focus ring),
  `MuiChip` (radius 8), `MuiToggleButton` (emerald-selected), `MuiDivider`, `MuiSkeleton`. Plus
  `MuiCssBaseline` global scrollbar/selection/number-input styling.
- **Also a token source:** `darkTheme({ accentColor: "#10b981" })` in `app/providers.tsx:20-25`
  (RainbowKit) — must stay aligned to the emerald accent.

### 3b. Reusable offramp components / patterns (the design-system seed)
- **`StepItem`** (`offramp/StepItem.tsx`) — the canonical stepper row (status icon, label, elapsed
  timer, error, tx link). Already consumes the `ExecutionStep` model. **Reuse for the cross-border
  flow's progress instead of the bespoke two-bar header at `FiatToFiatFlow.tsx:1130-1153`.**
- **`executionStore` `ExecutionStep[]` model** (`stores/executionStore.ts:3-27`) — the proven
  shape for representing a multi-step async pipeline (`id/label/status/txHash/error/startedAt`).
  A unified design system should model BOTH flows on this.
- **`QuoteCard` / `QuoteCardSkeleton` / `NoQuotesMessage`** (`offramp/QuoteCard.tsx`) — polished,
  reusable quote selector with speed gradients, selection state, loading + empty states. The
  cross-border maker list (`:1432-1457`) is a hand-rolled `<Button>` that should be replaced by a
  `QuoteCard`-style component.
- **`OfframpWidget` shell** (`offramp/OfframpWidget.tsx`) — the connected/disconnected + input/
  execution view-switch container pattern.
- **`IntentRow` + `TransactionHistory`** — the reclaim/history dialog; already multi-deployment
  aware and theme-token-driven (mostly).
- **Chrome:** `Header` / `Footer` / `Background` are presentation with per-page `variant` props
  (`emerald`/`blue`/`venmo`) — safe to restyle, but the `variant` API is consumed by both pages
  (`app/page.tsx`, `app/fiat-to-fiat/page.tsx`) and must keep working.

### 3c. Inconsistency quantified (the case for the overhaul)
Measured on `components/FiatToFiatFlow.tsx` (1766 LOC):
- **202 inline `sx={{` blocks** — the entire view is inline-styled.
- **139 hardcoded hex literals** across **19 distinct colors**, almost all duplicating theme tokens.
  Top offenders: `#a1a1aa` ×40 (= `text.secondary`), `#71717a` ×16, `#27272a` ×11 (border),
  `#fbbf24` ×10 (= warning.light), `#f87171` ×10 (= error.light), `#3b82f6` ×8 (= info.main),
  `#60a5fa` ×7, `#3f3f46` ×7, `#10b981` ×7 (= **primary.main, hardcoded instead of `primary.main`**),
  `#34d399` ×5 (= primary.light).
- **65 `rgba(...)` literals** (alpha tints of the same palette, none tokenized).
- Zero use of `theme.palette.*` references; the file bypasses the design system entirely.
- For contrast, the `/` views (`OfframpInput`, `StepItem`, `QuoteCard`) ALSO hardcode hex heavily
  (e.g. `OfframpInput.tsx` uses `rgb(16,185,129)` / `rgb(9,9,11)` inline rather than tokens) — so
  the design-system migration is a cross-surface job, not just the monolith.

**Implication:** a token pass (replace literals → `theme.palette.*` / `sx` shorthands) is a
prerequisite for "change the color once." This is the single highest-leverage cleanup, but it must
be done as a *behavior-preserving* mechanical substitution (see §5), not bundled with logic changes.

---

## 4. RISK HOTSPOTS

### HS-1 — Root `suppressHydrationWarning` (App Router hydration)
- **Trap:** PeerAuth/TEE injects `data-peer-injected` onto `<html>` *before* React hydrates.
  `app/layout.tsx:20-21` sets `suppressHydrationWarning` on BOTH `<html>` and `<body>`. Remove
  either (or replace `layout.tsx` during a chrome refactor) and the root-attribute mismatch breaks
  hydration → the app goes non-interactive (wallet "disconnected", clicks dead). Documented in
  `frontend/CLAUDE.md:11-12`.
- **Guardrail:** Treat `app/layout.tsx`'s `suppressHydrationWarning` (both elements) as immutable.
  If the layout is touched, re-assert it and smoke-test wallet connect with the Peer extension
  installed. Do NOT convert the layout to anything that drops these attributes.

### HS-2 — Metadata subscription refs (`metadataUnsubRef`)
- **Trap:** `metadataUnsubRef` (`:472`) holds the `onMetadataMessage` unsubscribe. It is cleared
  before re-subscribe (`:947`) and in `resetFlow` (`:1110-1111`). A reskin that re-renders the
  verify sub-tree differently, remounts the component, or "tidies" the refs can leak subscriptions
  (stacked handlers → duplicate `fulfillIntent`) or drop the unsub (handler fires after reset).
- **Guardrail:** The ref lifecycle moves verbatim into `useFiatToFiatFlow` (§2). Add an
  `useEffect` cleanup returning `metadataUnsubRef.current?.()` on unmount. Never move the
  subscription into render-conditional JSX.

### HS-3 — Bigint (de)serialization in persistence
- **Trap:** `flowData.usdcAmount` is a `bigint`. The `__bigint__` sentinel
  (`:374-375` reviver, `:395` replacer) is the only thing keeping `JSON.stringify` from throwing.
  A refactor that swaps the persistence layer (e.g. to `zustand/persist`, or a generic serializer)
  without bigint handling will silently no-op saves (the `try/catch` swallows it) → INV-5/6 break
  with no error.
- **Guardrail:** Keep the sentinel reviver/replacer (or a `superjson`-equivalent) and add a test:
  round-trip a `flowData` with a non-zero `usdcAmount` bigint. Assert the persisted/rehydrated
  value is `bigint`, not `string`/`number`.

### HS-4 — wagmi hook ordering / rules-of-hooks
- **Trap:** See INV-13. 18 `useState` + wagmi hooks + custom hooks all run unconditionally before
  the `!isConnected` early return. Splitting the monolith into sub-components, or adding a
  conditional wrapper around a hook-calling region, risks variable hook counts → runtime crash.
- **Guardrail:** Extract ALL hooks into `useFiatToFiatFlow` (one call site, top of the view).
  Sub-components must be pure (props in, JSX out) — no wagmi/`useState` inside conditionally
  rendered children unless that child is always mounted. Run the app (not just tsc) after the split;
  hook-order violations are runtime-only.

### HS-5 — node-22 SDK requirement
- **Trap:** `@zkp2p/sdk ^0.5.0` requires **node ≥ 22** (`frontend/CLAUDE.md:5-12`). After switching
  node/SDK versions you must `rm -rf .next` before `npm run dev` (stale webpack chunks break wallet
  connect). A contributor on node 18 (the solver/attestation default) will see opaque build/runtime
  failures, not a clean error.
- **Guardrail:** Document `nvm use 22` + `rm -rf .next` in the migration runbook; ideally add an
  `engines: { node: ">=22" }` to `frontend/package.json` (currently **unset** — verified). Verify
  the dev/build node version at every gate in §5.

### HS-6 — MUI version + styling-engine change risk
- **Trap:** The app is on **MUI v7** (`@mui/material ^7.3.7`) with emotion `sx`. Any proposal to
  swap the styling approach (Tailwind, CSS Modules, styled-components, a different component lib)
  would touch every one of the 202 `sx` blocks in the monolith plus all offramp components, AND
  the theme + RainbowKit `darkTheme` integration + `CssBaseline`. This is the largest silent-break
  surface in the overhaul.
- **Guardrail:** **Strong recommendation: keep MUI + the existing `theme.ts` as the system.** Do the
  overhaul as (a) tokenize literals → `theme.palette.*`, (b) lift repeated `sx` into theme
  `components` overrides or small styled wrappers, (c) replace bespoke widgets with the offramp
  components. If a styling-engine swap is truly required, it must be its own phased project with its
  own audit — do NOT combine it with the logic extraction.

### HS-7 — `step`-string coupling (poller `enabled` + persistence + 409 copy)
- **Trap:** `FlowStep` string values are referenced as bare strings in MANY places beyond the
  switch: poller `enabled` flags (`:429`, `:448`), the persistence skip/remap arrays (`:381`,
  `:390-391`, `:409-413`), `getProgress`'s `stage1Steps/stage2Steps` arrays (`:1083-1084`), and the
  resume `earlySteps` list. Renaming a step (tempting during a "cleanup") silently disables a poller
  or breaks resume — tsc won't catch a string-array membership change.
- **Guardrail:** When the logic moves to the hook, keep the `FlowStep` literals EXACTLY as-is (or
  introduce a `const enum`/`as const` map and migrate ALL string sites together — see CLAUDE.md
  rule #10 "NO SEMANTIC SEARCH": grep every literal). Add an integration test that walks the full
  state machine.

### HS-8 — Error-string ↔ affordance coupling
- **Trap:** The Cancel button appears only when `error.includes("active intent") ||
  error.includes("active order")` (`:1185`), and that message is produced by the 409 branch
  (`:867-868`). Restyling the error component or "improving" the copy without updating both ends
  silently hides the only recovery path. Same fragility for the extension-state messages.
- **Guardrail:** Replace string-matching with a structured error type
  (`{ kind: 'active-intent' | ... , message }`) inside the hook, and key affordances off `kind`.
  If that's out of scope, treat the magic strings as a frozen interface.

---

## 5. MIGRATION SAFETY CHECKLIST

Ordered, verifiable, behavior-preserving. Each gate runs `npx tsc --noEmit` and `npx next lint`
(the project's checks per `frontend/CLAUDE.md:115-120`; `lint` script = `next lint`,
`.eslintrc.json` present). Use node 22 + `rm -rf .next` before any `npm run dev` (HS-5).

> Per CLAUDE.md rule #2 (phased execution, ≤5 files/phase) and the "Step 0" rule (strip dead
> code/debug logs first). Note: the monolith has **14 `console.*` calls** — clean those in Step 0.

**Gate 0 — Baseline & freeze (no code change yet)**
- Record current behavior: run both surfaces end-to-end (or as far as funding allows). Capture the
  14-state cross-border walk-through, the 409→Cancel path, a mid-flow refresh (persistence), and a
  resume-from-pending. Screenshot each screen.
- `npx tsc --noEmit` and `npx next lint` must be GREEN on `audit-fixes` before starting.
- Confirm node 22 (`node -v`), `engines` note, and a clean `.next`.

**Gate 1 — Step 0 cleanup (logic file only)** *(≤1 file)*
- In `FiatToFiatFlow.tsx`: remove the 14 `console.log/error/warn`, any dead props/vars, unused
  imports. NO behavior change. Commit separately.
- Verify: tsc + lint green; manual smoke of one full cross-border walk (mock/dev).

**Gate 2 — Extract logic into `useFiatToFiatFlow` (no view change yet)** *(≤4 files)*
- New: `lib/fiat-to-fiat-types.ts` (FlowStep/ZkpQuote/FlowData), `lib/fiat-to-fiat-constants.ts`
  (orchestrator/escrow/ABIs/URLs/deadline), `hooks/useFiatToFiatFlow.ts` (all of `:286-1115`).
- `FiatToFiatFlow.tsx` becomes `const f = useFiatToFiatFlow(); return (<unchanged JSX, wired to
  f.* >)` — JSX markup/styles UNCHANGED, only the data/handler sources rebind to the hook.
- **Preserve verbatim:** all `FlowStep` literals (HS-7), the `metadataUnsubRef` lifecycle (HS-2),
  the `__bigint__` sentinel (HS-3), `useNetworkAddresses` for `OFFRAMP_V3` (INV-8), the `referralFees`
  pass-through (INV-3), poller `enabled` flags (INV-4), all hook call order (HS-4/INV-13).
- **Verify (parity gate — the critical one):**
  - tsc + lint green.
  - `npm run dev` (node 22, clean `.next`). Re-run the FULL Gate-0 script and diff behavior screen
    for screen: 14-state progression, both pollers fire (`router_waiting`, `success`), countdown,
    409→Cancel affordance, mid-flow refresh persists + remaps proof-stage→verify, resume-from-pending.
  - Confirm NO React "hooks" warning in console (HS-4) and wallet stays connected with the Peer
    extension present (HS-1).

**Gate 3 — Tokenize the design system (presentation only, mechanical)** *(theme + ≤4 view files at a time)*
- Replace hardcoded hex/rgba in `FiatToFiatFlow.tsx`'s JSX with `theme.palette.*` / `sx` tokens
  (139 hex + 65 rgba → tokens; §3c). Pure find-and-replace of equal colors; NO layout/logic change.
- Do the same, in separate ≤5-file phases, for `OfframpInput`, `QuoteCard`, `StepItem`,
  `OfframpExecution`, Header/Footer/Background.
- Where a literal has no exact token, EXTEND `theme.ts` (add the token) rather than inlining.
- **Verify:** tsc + lint green; visual diff (screenshots) — pixels may shift only where a literal
  was *wrong* vs the token; flag any unexpected visual delta. Both `Background` variants
  (emerald/blue) and the RainbowKit accent still render.

**Gate 4 — Rebuild the view behind the stable hook** *(component tree, ≤5 files/phase)*
- Now safe to redo presentation: split the monolith's `return (...)` into per-step view components
  (e.g. `FlowSelect`, `InputAll`, `MakerList`, `SignalConfirm`, `SendPayment`, `VerifyPayment`,
  `SelectPayment`, `RouterCommit`, `SuccessCard`) that each take props from `f.*` and render only.
  Reuse `StepItem` / `QuoteCard` / the `OfframpWidget` shell where applicable (§3b).
- **Hard rule:** sub-components are pure — no `useState`/wagmi/`localStorage`/`setStep` inside them
  (HS-4). All state stays in `useFiatToFiatFlow`.
- **Verify after EACH phase:** tsc + lint; re-run the relevant slice of the Gate-0 script for the
  steps touched; full-flow re-run at the end of Gate 4.

**Gate 5 — Cross-surface convergence (optional, scoped)** *(≤5 files)*
- Optionally model the cross-border progress on the `executionStore`-style `ExecutionStep[]` and
  reuse `StepItem`, retiring the bespoke two-bar header (`:1130-1153`). Strictly additive to the
  hook's `derived.progress`; behavior unchanged.

**Gate 6 — Final acceptance**
- Full E2E on both surfaces (within funding limits): mainnet cross-border happy path, a forced
  failure → Cancel/reclaim, a refresh-mid-flow, a resume-from-pending, and the `/` offramp
  create→approve→commit→fulfill.
- `npx tsc --noEmit` + `npx next lint` GREEN. `next build` succeeds on node 22.
- Confirm `app/layout.tsx` still carries `suppressHydrationWarning` on `<html>` and `<body>` (HS-1),
  and `intentsStore` persistence + the `__bigint__` flow persistence both still round-trip.

**Rollback posture:** Gates 1–2 are pure refactors (revertable with zero behavior risk). Gate 2 is
the load-bearing checkpoint — do NOT proceed to any visual work until the parity gate passes. Gates
3–5 are presentation; each is independently revertable because the hook interface is frozen.
