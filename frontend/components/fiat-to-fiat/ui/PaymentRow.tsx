"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";

/**
 * PaymentRow (§5.8) — a TEE payment rendered as a card (today they're bare
 * buttons). The row whose amount matches the expected `usdAmount` gets an
 * emerald borderActive + a "✓ matches" chip — reduces mis-selection (picking the
 * wrong payment fails the proof). Pure presentational; `onSelect` calls the
 * hook's handleSelectAndFulfill(row).
 */
export function PaymentRow({
  amountLabel,
  recipient,
  matches = false,
  onSelect,
}: {
  amountLabel: string;
  recipient?: string;
  matches?: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      sx={{
        overflow: "hidden",
        borderRadius: (t) => `${t.ff.radius.lg}px`,
        border: (t) => `1px solid ${matches ? t.ff.borderActive : t.ff.border}`,
        background: (t) => (matches ? "rgba(16,185,129,0.05)" : t.ff.surface2),
        backdropFilter: "none",
        boxShadow: "none",
        transition: (t) => `all ${t.ff.motion.base} ${t.ff.motion.ease}`,
        "&:hover": { borderColor: (t) => t.ff.borderActive },
      }}
    >
      <CardActionArea onClick={onSelect} sx={{ px: 2, py: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            {matches && (
              <Box
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.4,
                  px: 0.75,
                  py: 0.3,
                  borderRadius: (t) => `${t.ff.radius.sm}px`,
                  background: "rgba(16,185,129,0.16)",
                  color: (t) => t.ff.brand,
                  flexShrink: 0,
                }}
              >
                <CheckCircleOutlineIcon sx={{ fontSize: 13 }} />
                <Typography sx={{ fontSize: "0.68rem", fontWeight: 600, color: "inherit" }}>matches</Typography>
              </Box>
            )}
            <Typography
              sx={{
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: (t) => t.ff.text,
                whiteSpace: "nowrap",
              }}
            >
              {amountLabel}
            </Typography>
          </Box>
          {recipient && (
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
              {recipient}
            </Typography>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}
