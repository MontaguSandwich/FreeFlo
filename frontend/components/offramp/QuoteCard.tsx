"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { ff, ffRamps } from "@/lib/theme";
import { type RTPNQuote, CURRENCIES } from "@/lib/quotes";

// ---------------------------------------------------------------------------
// Speed configuration
//
// instant keeps the emerald→teal brand spine (the unchanged brand tokens);
// fast/standard map to the warning + neutral token ramps.
// ---------------------------------------------------------------------------

const SPEED_GRADIENT: Record<string, string> = {
  instant: `linear-gradient(to right, ${ffRamps.emerald[500]}, ${ffRamps.teal[500]})`, // brand spine
  fast: `linear-gradient(to right, ${ffRamps.amber[500]}, #f97316)`, // amber -> orange
  standard: `linear-gradient(to right, ${ffRamps.ink[500]}, ${ffRamps.ink[600]})`, // zinc-500 -> zinc-600
};

const SPEED_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  instant: {
    label: "Instant",
    bg: "rgba(16, 185, 129, 0.12)",
    color: ff.brandStrong,
  },
  fast: {
    label: "Fast",
    bg: "rgba(245, 158, 11, 0.12)",
    color: ff.warning,
  },
  standard: {
    label: "Standard",
    bg: "rgba(113, 113, 122, 0.18)",
    color: ff.textSecondary,
  },
};

// ---------------------------------------------------------------------------
// QuoteCard
// ---------------------------------------------------------------------------

interface QuoteCardProps {
  quote: RTPNQuote;
  isSelected: boolean;
  onSelect: () => void;
}

export function QuoteCard({ quote, isSelected, onSelect }: QuoteCardProps) {
  const currencyInfo = CURRENCIES[quote.rtpnInfo.currency];
  const timeRemaining = Math.max(
    0,
    Math.floor((quote.expiresAt - Date.now()) / 1000)
  );
  const isExpired = timeRemaining === 0;

  const speed = quote.rtpnInfo.speed;
  const chipCfg = SPEED_CHIP[speed];

  return (
    <Card
      sx={(t) => ({
        position: "relative",
        overflow: "hidden",
        borderRadius: `${t.ff.radius.lg}px`,
        border: "1px solid",
        borderColor: isSelected ? t.ff.borderActive : t.ff.border,
        bgcolor: isSelected ? "rgba(16, 185, 129, 0.04)" : t.ff.surface2,
        opacity: isExpired ? 0.45 : 1,
        transition: `all ${t.ff.motion.base} ${t.ff.motion.ease}`,
        "&:hover": isExpired
          ? {}
          : {
              borderColor: isSelected ? t.ff.borderActive : t.ff.borderStrong,
              bgcolor: isSelected
                ? "rgba(16, 185, 129, 0.06)"
                : t.ff.surface3,
            },
      })}
    >
      {/* Top gradient speed line */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: SPEED_GRADIENT[speed],
        }}
      />

      <CardActionArea
        onClick={onSelect}
        disabled={isExpired}
        sx={{
          p: 1.5,
          pt: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          "&.Mui-disabled": {
            cursor: "not-allowed",
            pointerEvents: "auto",
            opacity: 1, // opacity handled at Card level
          },
        }}
        disableRipple={isExpired}
      >
        {/* Row 1: Speed badge + RTPN name + time | Output amount */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Left cluster */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              label={chipCfg.label}
              size="small"
              sx={{
                height: 22,
                fontSize: "0.7rem",
                fontWeight: 600,
                bgcolor: chipCfg.bg,
                color: chipCfg.color,
                "& .MuiChip-label": { px: 1 },
              }}
            />
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: "text.primary" }}
            >
              {quote.rtpnInfo.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "text.disabled", fontSize: "0.65rem" }}
            >
              {quote.rtpnInfo.avgTime}
            </Typography>
          </Box>

          {/* Right: fiat amount */}
          <Typography
            variant="body1"
            sx={{
              fontWeight: 700,
              color: "text.primary",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {currencyInfo.symbol}
            {quote.outputAmount.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Typography>
        </Box>

        {/* Row 2: Solver info + Fee */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mt: 1,
            width: "100%",
          }}
        >
          {/* Left: solver */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontSize: "0.7rem" }}
            >
              {quote.solver.avatar}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontSize: "0.7rem" }}
            >
              {quote.solver.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: (t) => t.ff.warning, fontSize: "0.7rem" }}
            >
              {"★"}
              {quote.solver.rating}
            </Typography>
          </Box>

          {/* Right: fee */}
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontSize: "0.7rem" }}
          >
            Fee: {quote.feePercent}%
          </Typography>
        </Box>
      </CardActionArea>

      {/* Selection checkmark */}
      {isSelected && (
        <Box
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            pointerEvents: "none",
          }}
        >
          <CheckCircleIcon
            sx={{ fontSize: 18, color: (t) => t.ff.brand }}
          />
        </Box>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// QuoteCardSkeleton
// ---------------------------------------------------------------------------

export function QuoteCardSkeleton() {
  return (
    <Card
      sx={(t) => ({
        p: 1.5,
        borderRadius: `${t.ff.radius.lg}px`,
        border: `1px solid ${t.ff.border}`,
        bgcolor: t.ff.surface2,
      })}
    >
      {/* Row 1 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Skeleton
            variant="rounded"
            width={48}
            height={22}
            sx={{ borderRadius: 1 }}
          />
          <Skeleton
            variant="rounded"
            width={80}
            height={18}
            sx={{ borderRadius: 1 }}
          />
        </Box>
        <Skeleton
          variant="rounded"
          width={64}
          height={22}
          sx={{ borderRadius: 1 }}
        />
      </Box>

      {/* Row 2 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mt: 1,
        }}
      >
        <Skeleton
          variant="rounded"
          width={96}
          height={14}
          sx={{ borderRadius: 0.5 }}
        />
        <Skeleton
          variant="rounded"
          width={48}
          height={14}
          sx={{ borderRadius: 0.5 }}
        />
      </Box>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// NoQuotesMessage
// ---------------------------------------------------------------------------

interface NoQuotesMessageProps {
  currency: string;
}

export function NoQuotesMessage({ currency }: NoQuotesMessageProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 4,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: (t) => `${t.ff.radius.md}px`,
          bgcolor: (t) => t.ff.surface2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 1.5,
        }}
      >
        <DescriptionOutlinedIcon
          sx={{ fontSize: 20, color: (t) => t.ff.textDisabled }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{ color: (t) => t.ff.textSecondary }}
      >
        No quotes available for {currency}
      </Typography>
    </Box>
  );
}
