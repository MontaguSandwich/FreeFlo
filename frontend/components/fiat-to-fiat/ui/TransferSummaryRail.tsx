"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { FlowChevron } from "./ProviderGlyph";
import { CountdownPill } from "./CountdownRing";
import { PHASE_LABELS } from "./phases";
import { maskIban } from "./format";

/**
 * TransferSummaryRail (§4.2) — the persistent transfer-summary header pinned to
 * the top of the wizard card on every step from input_all onward. Restates the
 * deal: amount in → amount out, recipient (masked IBAN + name), the active phase
 * chip, and (once the FreeFlo intent exists) the live deadline clock. Pure
 * presentational — every value is fed from the hook's flowData / derived; it
 * owns no state.
 */
export function TransferSummaryRail({
  amountIn,
  amountOut,
  amountOutEstimate = false,
  recipientName,
  recipientIban,
  phaseIdx,
  deadlineLabel,
  deadlineDanger = false,
  deadlineExpired = false,
  showDeadline = false,
}: {
  amountIn: string;
  amountOut: string;
  amountOutEstimate?: boolean;
  recipientName?: string;
  recipientIban?: string;
  phaseIdx: 0 | 1 | 2 | 3;
  deadlineLabel?: string;
  deadlineDanger?: boolean;
  deadlineExpired?: boolean;
  showDeadline?: boolean;
}) {
  const hasRecipient = Boolean(recipientName || recipientIban);
  return (
    <Box
      sx={{
        px: 3,
        py: 2,
        borderBottom: (t) => `1px solid ${t.ff.border}`,
        background: "rgba(16,185,129,0.03)",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {/* Top: amounts + phase chip */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <FlowChevron size={18} />
          <Typography
            sx={{ fontSize: "1.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: (t) => t.ff.text }}
          >
            {amountIn}
          </Typography>
          <Box
            component="svg"
            aria-hidden
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            sx={{ flexShrink: 0, color: (t) => t.ff.textTertiary }}
          >
            <path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Box>
          <Typography
            sx={{
              fontSize: "1.375rem",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: (t) => t.ff.brandStrong,
              whiteSpace: "nowrap",
            }}
          >
            {amountOutEstimate ? "≈ " : ""}
            {amountOut}
          </Typography>
        </Box>
        <Box
          sx={{
            flexShrink: 0,
            px: 1.25,
            py: 0.5,
            borderRadius: (t) => `${t.ff.radius.sm}px`,
            background: "rgba(16,185,129,0.12)",
            border: (t) => `1px solid ${t.ff.borderActive}`,
          }}
        >
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 600, color: (t) => t.ff.brandStrong, whiteSpace: "nowrap" }}>
            Phase {phaseIdx + 1} · {PHASE_LABELS[phaseIdx]}
          </Typography>
        </Box>
      </Box>

      {/* Bottom: recipient + live deadline clock */}
      {(hasRecipient || (showDeadline && deadlineLabel)) && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          {hasRecipient ? (
            <Typography
              sx={{
                fontSize: "0.8125rem",
                color: (t) => t.ff.textSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              to {recipientName || "recipient"}
              {recipientIban ? (
                <Box component="span" sx={{ ml: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {maskIban(recipientIban)}
                </Box>
              ) : null}
            </Typography>
          ) : (
            <span />
          )}
          {showDeadline && deadlineLabel && (
            <CountdownPill label={deadlineLabel} danger={deadlineDanger} expired={deadlineExpired} />
          )}
        </Box>
      )}
    </Box>
  );
}
