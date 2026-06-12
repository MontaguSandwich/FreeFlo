"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

/**
 * DoDontList (§3 #13 / §5.6) — a do/don't checklist (emerald ✓ / destructive ✕
 * rows) for the send-fiat instructions. Pure presentational.
 */
export function DoDontList({
  title,
  items,
}: {
  title?: string;
  items: { ok: boolean; text: string }[];
}) {
  return (
    <Box>
      {title && (
        <Typography sx={{ fontSize: "0.9375rem", fontWeight: 600, color: (t) => t.ff.text, mb: 1 }}>
          {title}
        </Typography>
      )}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {items.map((item, i) => (
          <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <Box
              sx={{
                mt: "1px",
                width: 18,
                height: 18,
                flexShrink: 0,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: item.ok ? "rgba(16,185,129,0.16)" : (t) => t.ff.destructiveBg,
                color: (t) => (item.ok ? t.ff.brand : t.ff.destructive),
              }}
            >
              {item.ok ? <CheckIcon sx={{ fontSize: 12 }} /> : <CloseIcon sx={{ fontSize: 12 }} />}
            </Box>
            <Typography sx={{ fontSize: "0.875rem", color: (t) => t.ff.textSecondary, lineHeight: 1.45 }}>
              {item.text}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
