"use client";

// SignOnceFlow — presentational shell for the TIER-1 "sign-once" offramp.
// ALL logic lives in useSignOnceOfframp; this is a thin shell (inputs → run() →
// per-step timeline → success), theme-tokens only. Mirrors OfframpWidget/OfframpInput.

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { useAccount } from "wagmi";
import {
  FlowCard,
  Field,
  PrimaryButton,
  SecondaryButton,
  StatusScreen,
  StepRow,
  Stepper,
  SuccessCheck,
  NoticeBanner,
  groupIban,
  type StepStatus,
} from "@/components/fiat-to-fiat/ui";
import {
  useSignOnceOfframp,
  type SignOnceOfframpApi,
  type StepState,
} from "@/hooks/useSignOnceOfframp";

// Map the hook's StepState → the StepRow's StepStatus vocabulary.
const STEP_STATUS: Record<StepState, StepStatus> = {
  done: "done",
  active: "active",
  pending: "pending",
};

// The on-this-tab timeline steps. Keys MUST match useSignOnceOfframp's TIMELINE_ORDER (the set
// `stepStatus` accepts) — post-submit "processing" progress is shown separately via flow.progress.
const STEP_DEFS: {
  key: "approving" | "signing" | "submitting";
  label: string;
  locked?: boolean;
}[] = [
  { key: "approving", label: "Approve Permit2 (one-time)" },
  { key: "signing", label: "Sign once (gasless)", locked: true },
  { key: "submitting", label: "Submitted" },
];

// ---------------------------------------------------------------------------
// Connect-wallet gate (mirrors OfframpWidget's not-connected card)
// ---------------------------------------------------------------------------

function ConnectGate() {
  return (
    <FlowCard sx={{ maxWidth: 480, mx: "auto", p: 6, textAlign: "center" }}>
      <Box
        sx={{
          width: 80,
          height: 80,
          mx: "auto",
          mb: 3,
          borderRadius: (t) => `${t.ff.radius.lg}px`,
          background: (t) =>
            `linear-gradient(to bottom right, ${t.ff.glow1}, ${t.ff.glow2})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AccountBalanceWalletIcon sx={{ fontSize: 40, color: (t) => t.ff.brandStrong }} />
      </Box>
      <Typography variant="h3" sx={{ color: (t) => t.ff.text, mb: 1 }}>
        Connect Your Wallet
      </Typography>
      <Typography sx={{ color: (t) => t.ff.textSecondary }}>
        Connect your wallet to sign a one-shot USDC → SEPA offramp.
      </Typography>
    </FlowCard>
  );
}

// ---------------------------------------------------------------------------
// Not-deployed guard
// ---------------------------------------------------------------------------

function NotDeployed() {
  return (
    <FlowCard sx={{ maxWidth: 480, mx: "auto", p: 4 }}>
      <NoticeBanner kind="warning">
        The sign-once stack isn&apos;t wired into this build yet. Check back soon.
      </NoticeBanner>
    </FlowCard>
  );
}

// ---------------------------------------------------------------------------
// Success state
// ---------------------------------------------------------------------------

function DoneScreen({ flow }: { flow: SignOnceOfframpApi }) {
  const r = flow.result;
  // We reach "done" only after polling the solver to a "complete" status, which carries the fill
  // txHash — proof the SEPA payment settled and the USDC was released on-chain. A COMPLETION.
  const completed = !!r?.txHash;
  const eur = r?.eurCents != null ? (Number(r.eurCents) / 100).toFixed(2) : null;
  const ibanShort = r?.iban ? `${r.iban.slice(0, 8)}…${r.iban.slice(-4)}` : null;

  return (
    <FlowCard sx={{ maxWidth: 480, mx: "auto" }}>
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Box sx={{ mb: 3 }}>
          <SuccessCheck />
        </Box>
        <Typography variant="h3" sx={{ color: (t) => t.ff.text, mb: 1 }}>
          {completed ? "Offramp complete" : "Order submitted"}
        </Typography>
        <Typography sx={{ color: (t) => t.ff.textSecondary, maxWidth: 380, mx: "auto" }}>
          {completed ? (
            <>
              {eur ? `€${eur}` : "EUR"} was sent via SEPA Instant
              {ibanShort ? ` to ${ibanShort}` : ""}, and your USDC was released to the solver — all
              from one signature.
            </>
          ) : (
            <>
              The solver will pay SEPA EUR to your recipient and release your USDC. No further
              signatures are needed.
            </>
          )}
        </Typography>

        {r?.txHash && (
          <Typography
            component="a"
            href={`https://basescan.org/tx/${r.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: "inline-block",
              mt: 2,
              color: (t) => t.palette.primary.main,
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            View the on-chain release ↗
          </Typography>
        )}

        <Box sx={{ mt: 4 }}>
          <SecondaryButton onClick={flow.reset}>Start another</SecondaryButton>
        </Box>
      </Box>
    </FlowCard>
  );
}

// ---------------------------------------------------------------------------
// In-flight timeline (approve → deposit → sign → submit)
// ---------------------------------------------------------------------------

function RunningScreen({ flow }: { flow: SignOnceOfframpApi }) {
  const titleFor: Record<string, string> = {
    approving: "Approving Permit2 (one-time)…",
    signing: "Signing your order…",
    submitting: "Submitting to the solver…",
    processing: "The solver is filling your order…",
  };
  // Once the order is acked we poll the solver — there are no more wallet prompts; the live
  // status line (flow.progress) replaces the "confirm prompts" hint.
  const polling = flow.step === "processing";
  return (
    <FlowCard sx={{ maxWidth: 480, mx: "auto" }}>
      <Box sx={{ p: 3 }}>
        <StatusScreen
          title={titleFor[flow.step] ?? "Working…"}
          subtitle={
            polling
              ? "Keep this tab open — the solver pays SEPA and releases your USDC."
              : "Keep this tab open and confirm any wallet prompts."
          }
          hint={polling ? flow.progress ?? undefined : undefined}
        />
        <Stepper>
          {STEP_DEFS.map((s, i) => (
            <StepRow
              key={s.key}
              status={STEP_STATUS[flow.stepStatus(s.key)]}
              label={s.label}
              locked={s.locked}
              last={i === STEP_DEFS.length - 1}
            />
          ))}
        </Stepper>
      </Box>
    </FlowCard>
  );
}

// ---------------------------------------------------------------------------
// Input form (idle / error)
// ---------------------------------------------------------------------------

function InputScreen({ flow }: { flow: SignOnceOfframpApi }) {
  const cleanIban = flow.iban.replace(/\s+/g, "");
  const ibanError = cleanIban.length > 0 && cleanIban.length < 15;
  const nameError = flow.recipientName.length > 0 && flow.recipientName.trim().length < 2;
  const amtNum = Number(flow.usdcAmount);
  const amtError = flow.usdcAmount.length > 0 && !(Number.isFinite(amtNum) && amtNum > 0);

  const cta = (() => {
    if (!flow.onCorrectChain) return "Switch to Base mainnet";
    if (cleanIban.length < 15) return "Enter a destination IBAN";
    if (flow.recipientName.trim().length < 2) return "Enter the recipient name";
    if (!(Number.isFinite(amtNum) && amtNum > 0)) return "Enter a USDC amount";
    return "Sign once & send";
  })();

  return (
    <FlowCard sx={{ maxWidth: 480, mx: "auto", overflow: "visible" }}>
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Box>
          <Typography variant="h4" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
            Sign-once offramp
          </Typography>
          <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
            One gasless signature — the solver pays all gas. A solver sends SEPA EUR and
            claims your USDC. First time only, a one-time Permit2 approval.
          </Typography>
        </Box>

        <Field
          label="Destination IBAN"
          value={flow.iban}
          onChange={flow.setIban}
          placeholder="DE89 3704 0044 0532 0130 00"
          mono
          uppercaseValue
          error={ibanError}
          helperText={ibanError ? "IBAN looks too short" : undefined}
        />

        <Field
          label="Recipient name"
          value={flow.recipientName}
          onChange={flow.setRecipientName}
          placeholder="Jane Doe"
          error={nameError}
          helperText={nameError ? "Name must be at least 2 characters" : undefined}
        />

        <Field
          label="USDC amount"
          value={flow.usdcAmount}
          onChange={flow.setUsdcAmount}
          placeholder="10.00"
          type="text"
          error={amtError}
          helperText={
            amtError
              ? "Enter a number greater than 0"
              : "We fetch a EUR floor from solver quotes automatically."
          }
        />

        {/* Manual EUR floor — only the fallback when no quote can be fetched. */}
        <Field
          label="Minimum EUR (fallback if no quote)"
          value={flow.minEurManual}
          onChange={flow.setMinEurManual}
          placeholder="optional — e.g. 9.20"
          type="text"
        />

        {flow.error && (
          <NoticeBanner
            kind="error"
            action={
              <SecondaryButton
                onClick={flow.reset}
                sx={{ width: "auto", py: 0.5, px: 1.5, fontSize: "0.8125rem" }}
              >
                Dismiss
              </SecondaryButton>
            }
          >
            {flow.error}
          </NoticeBanner>
        )}

        {!flow.onCorrectChain && (
          <NoticeBanner kind="warning">
            This flow runs on Base mainnet only. Switch your wallet network to continue.
          </NoticeBanner>
        )}

        <PrimaryButton
          disabled={!flow.canSubmit}
          loading={flow.busy}
          loadingLabel="Working…"
          onClick={flow.run}
        >
          {cta}
        </PrimaryButton>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          <CircularProgress
            size={10}
            thickness={6}
            sx={{ color: (t) => t.ff.textTertiary, visibility: "hidden" }}
          />
          <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary }}>
            {cleanIban.length >= 15
              ? `Paying ${groupIban(cleanIban)} — gasless, the solver pays gas`
              : "One gasless signature: the solver pays gas and only claims your USDC after proving the SEPA payment."}
          </Typography>
        </Box>
      </Box>
    </FlowCard>
  );
}

// ---------------------------------------------------------------------------
// Shell — picks the screen for the current step
// ---------------------------------------------------------------------------

export function SignOnceFlow() {
  const { isConnected } = useAccount();
  const flow = useSignOnceOfframp();

  if (!flow.deployed) return <NotDeployed />;
  if (!isConnected) return <ConnectGate />;
  if (flow.step === "done") return <DoneScreen flow={flow} />;
  if (flow.busy) return <RunningScreen flow={flow} />;
  return <InputScreen flow={flow} />;
}
