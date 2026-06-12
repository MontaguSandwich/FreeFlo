"use client";

import { PEER_EXTENSION_CHROME_URL } from "@zkp2p/sdk";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { CURRENCIES } from "@/lib/platforms";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  NoticeBanner,
  NodeStepper,
  Stepper,
  StepRow,
  phaseOfFour,
} from "../ui";

/**
 * zkp2p_verify (§5.7) — the two-tier TEE stepper, bounded + locked, crypto
 * vocabulary HIDDEN (no "zkTLS / TLSNotary / TEE / zero-knowledge / ZKP2P").
 * Behaviour preserved verbatim:
 *  - the Verify CTA always calls handleVerifyPayment. That handler owns the
 *    HARD extension-ready gate (extensionState !== "ready" ⇒ sets an error and
 *    returns; no silent advance) — the view does NOT reimplement it.
 *  - the Connect button renders ONLY when extensionState === "needs_connection"
 *    and calls connectExtension with the isConnecting flag (verbatim).
 *  - needs_install ⇒ an "Add the helper" Notice with the install link.
 *  - "Cancel & reclaim" calls handleCancelIntent with isCancelling (INV-9).
 */
export function VerifyScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { step, flowData, selectedCurrency, extensionState, isConnecting, isCancelling, handleVerifyPayment, connectExtension, handleCancelIntent } =
    flow;
  const symbol = CURRENCIES[selectedCurrency]?.symbol || "$";
  const amountLabel = `${symbol}${flowData.usdAmount.toFixed(2)}`;
  const needsInstall = !(extensionState === "ready" || extensionState === "needs_connection");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Typography variant="h4" sx={{ color: (t) => t.ff.text }}>
          Prove your payment
        </Typography>
        <Typography variant="caption" sx={{ color: (t) => t.ff.textTertiary, flexShrink: 0 }}>
          {phaseOfFour(step)}
        </Typography>
      </Box>

      {/* horizontal 3-node phase stepper */}
      <Box sx={{ px: 0.5, py: 1 }}>
        <NodeStepper
          nodes={[
            { label: "Pay", status: "done" },
            { label: "Verify", status: "active" },
            { label: "Convert", status: "pending" },
          ]}
        />
      </Box>

      {/* inner vertical timeline */}
      <Stepper>
        <StepRow status="done" label="Payment sent" trailing={amountLabel} />
        <StepRow status="active" label="Verify your payment" trailing="up to ~30s" locked />
        <StepRow status="pending" label="Receive euros" last />
      </Stepper>

      {/* trust line — NO crypto vocabulary */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <LockOutlinedIcon sx={{ fontSize: 18, color: (t) => t.ff.brand, mt: "1px", flexShrink: 0 }} />
        <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
          We check your payment privately. Nothing leaves your device unencrypted.
        </Typography>
      </Box>

      {needsInstall && (
        <NoticeBanner kind="info">
          Add the free browser helper to prove your payment.{" "}
          <a
            href={PEER_EXTENSION_CHROME_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline", fontWeight: 600 }}
          >
            Add it →
          </a>{" "}
          then reload.
        </NoticeBanner>
      )}

      {extensionState === "needs_connection" && (
        <SecondaryButton onClick={connectExtension} loading={isConnecting} loadingLabel="Connecting…">
          Connect helper
        </SecondaryButton>
      )}

      <PrimaryButton onClick={handleVerifyPayment}>Verify payment</PrimaryButton>

      <DangerButton onClick={handleCancelIntent} loading={isCancelling} loadingLabel="Cancelling…">
        Cancel &amp; reclaim
      </DangerButton>
    </Box>
  );
}
