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
 * MakerCard (§5.4) — a quote card for the maker list, Peer-style: the USDC fronted,
 * the payee handle (@…) with a tier-coloured verification check, the platform, and
 * the fiat to pay. (Earlier this screen deliberately hid the @handle and showed only
 * a reputation chip — that "don't leak handles" rule is intentionally reversed here
 * per product direction; the handle is public maker data anyway.) Pure presentational;
 * `onSelect` calls the hook's handleSelectMaker(quote).
 */

const SPEED_GRADIENT = "linear-gradient(to right, #10b981, #14b8a6)"; // instant (pays from balance)

type Tier = "trusted" | "verified" | "new";

function reputationOf(quote: ZkpQuote): { tier: Tier; label: string } {
  // Trust tier from liquidity (token amount fronted). Larger committed liquidity →
  // higher tier. Humane fallback to "New".
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

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

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

  // Payee handle (public maker data). May be absent on a list item (only the selected
  // maker is lazily resolved) — fall back to the reputation label so the right slot is
  // never empty.
  const rawHandle = (quote.payeeUsername || "").trim();
  const handleLabel = rawHandle ? (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`) : null;
  const platformLabel = quote.processorName ? titleCase(quote.processorName) : null;
  const payLabel = quote.fiatAmountFormatted || "";

  const subParts = [payLabel ? `≈ ${payLabel} to pay` : "", platformLabel, "Instant"].filter(Boolean);

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
        sx={{ p: 1.75, pt: 2, display: "flex", flexDirection: "column", gap: 1, alignItems: "stretch" }}
      >
        {/* Row 1: USDC fronted | payee handle (+ tier check) */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, width: "100%" }}>
          <Typography
            sx={{
              fontSize: "1.05rem",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: (t) => t.ff.brandStrong,
              whiteSpace: "nowrap",
            }}
          >
            {usdcLabel}
          </Typography>

          <Box
            title={rep.label}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 1,
              py: 0.4,
              minWidth: 0,
              borderRadius: (t) => `${t.ff.radius.sm}px`,
              background: tierStyle.bg,
              color: tierStyle.color,
            }}
          >
            {tierStyle.icon}
            <Typography
              sx={{
                fontSize: "0.8rem",
                fontWeight: 600,
                color: handleLabel ? (t) => t.ff.text : "inherit",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 180,
              }}
            >
              {handleLabel ?? rep.label}
            </Typography>
          </Box>
        </Box>

        {/* Row 2: fiat to pay · platform · speed | best badge */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, width: "100%" }}>
          <Typography
            sx={{
              fontSize: "0.78rem",
              color: (t) => t.ff.textSecondary,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subParts.join(" · ")}
          </Typography>
          {isBest && (
            <Box
              sx={{
                flexShrink: 0,
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
      </CardActionArea>
    </Card>
  );
}
