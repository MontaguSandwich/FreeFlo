"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import type { ZkpQuote } from "@/hooks/useFiatToFiatFlow";

/**
 * MakerCard (§3 #6 / §5.4) — a QuoteCard variant for the maker list. Renders the
 * maker as a REPUTATION CHIP (Trusted / Verified / New) derived from data we
 * have (token amount fronted + rate competitiveness) — NEVER the raw
 * @handle / deposit id (the raw payeeUsername is only revealed later on the send
 * screen). Mirrors QuoteCard's shape: gradient speed line, chip, right-aligned
 * amount, hover/selection affordances. Pure presentational; `onSelect` calls the
 * hook's handleSelectMaker(quote).
 */

const SPEED_GRADIENT = "linear-gradient(to right, #10b981, #14b8a6)"; // instant (pays from balance)

type Tier = "trusted" | "verified" | "new";

function reputationOf(quote: ZkpQuote): { tier: Tier; label: string } {
  // Trust tier from liquidity (token amount fronted) — no identity exposed.
  // Larger committed liquidity → higher tier. Humane fallback to "New".
  let usdc = 0;
  try {
    usdc = quote.tokenAmount ? Number(BigInt(quote.tokenAmount)) / 1_000_000 : Number(quote.tokenAmountFormatted) || 0;
  } catch {
    usdc = Number(quote.tokenAmountFormatted) || 0;
  }
  if (usdc >= 1000) return { tier: "trusted", label: "Trusted partner" };
  if (usdc >= 200) return { tier: "verified", label: "Verified partner" };
  return { tier: "new", label: "New partner" };
}

const TIER_STYLE: Record<Tier, { icon: React.ReactNode; bg: string; color: string }> = {
  trusted: { icon: <AutoAwesomeOutlinedIcon sx={{ fontSize: 14 }} />, bg: "rgba(16,185,129,0.14)", color: "#34d399" },
  verified: { icon: <VerifiedOutlinedIcon sx={{ fontSize: 14 }} />, bg: "rgba(45,212,191,0.14)", color: "#2dd4bf" },
  new: { icon: <ShieldOutlinedIcon sx={{ fontSize: 14 }} />, bg: "rgba(113,113,122,0.18)", color: "#a1a1aa" },
};

export function MakerCard({
  quote,
  isBest = false,
  onSelect,
}: {
  quote: ZkpQuote;
  isBest?: boolean;
  onSelect: () => void;
}) {
  const rep = reputationOf(quote);
  const tierStyle = TIER_STYLE[rep.tier];
  const usdcLabel = quote.tokenAmountFormatted ? `${quote.tokenAmountFormatted} USDC` : "USDC";
  const forLabel = quote.fiatAmountFormatted || "";

  return (
    <Card
      sx={{
        position: "relative",
        overflow: "hidden",
        borderRadius: (t) => `${t.ff.radius.lg}px`,
        border: (t) => `1px solid ${isBest ? t.ff.borderActive : t.ff.border}`,
        background: (t) => (isBest ? "rgba(16,185,129,0.04)" : t.ff.surface2),
        backdropFilter: "none",
        boxShadow: "none",
        transition: (t) => `all ${t.ff.motion.base} ${t.ff.motion.ease}`,
        "&:hover": { borderColor: (t) => t.ff.borderActive },
      }}
    >
      {/* speed line (instant — pays from balance) */}
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: SPEED_GRADIENT }} />

      <CardActionArea
        onClick={onSelect}
        sx={{ p: 1.75, pt: 2, display: "flex", flexDirection: "column", alignItems: "stretch" }}
      >
        {/* Row 1: reputation chip (+ best badge) | USDC fronted */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: (t) => `${t.ff.radius.sm}px`,
                background: tierStyle.bg,
                color: tierStyle.color,
              }}
            >
              {tierStyle.icon}
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "inherit", whiteSpace: "nowrap" }}>
                {rep.label}
              </Typography>
            </Box>
            {isBest && (
              <Box
                sx={{
                  px: 0.75,
                  py: 0.3,
                  borderRadius: (t) => `${t.ff.radius.sm}px`,
                  background: (t) => t.ff.brandGradient,
                }}
              >
                <Typography sx={{ fontSize: "0.65rem", fontWeight: 700, color: (t) => t.ff.onBrand, whiteSpace: "nowrap" }}>
                  Best rate
                </Typography>
              </Box>
            )}
          </Box>
          <Typography
            sx={{
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: (t) => t.ff.brandStrong,
              whiteSpace: "nowrap",
            }}
          >
            {usdcLabel}
          </Typography>
        </Box>

        {/* Row 2: speed sub-line | for fiat */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1, width: "100%" }}>
          <Typography sx={{ fontSize: "0.78rem", color: (t) => t.ff.textSecondary }}>
            Instant · pays from balance
          </Typography>
          {forLabel && (
            <Typography sx={{ fontSize: "0.78rem", color: (t) => t.ff.textTertiary, fontVariantNumeric: "tabular-nums" }}>
              for {forLabel}
            </Typography>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}
