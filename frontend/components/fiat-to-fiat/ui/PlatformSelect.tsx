"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * PlatformSelect (§3 #4) — a styled native <select> with a consistent chevron,
 * surface3 fill, and emerald focus ring. Used for both the platform and currency
 * pickers. Controlled; options are rendered by the caller as plain
 * label/value pairs (keeps it provider-agnostic). The chevron is an inline SVG
 * data-URI background so the control stays a single element.
 */

const CHEVRON_BG =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2371717a' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`;

export function PlatformSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Box sx={{ flex: 1 }}>
      <Typography sx={{ mb: 1, fontSize: "0.8125rem", fontWeight: 600, color: (t) => t.ff.textSecondary }}>
        {label}
      </Typography>
      <Box
        component="select"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        sx={{
          width: "100%",
          px: 2,
          py: 1.5,
          background: (t) => t.ff.surface3,
          border: (t) => `1px solid ${t.ff.borderStrong}`,
          borderRadius: (t) => `${t.ff.radius.md}px`,
          color: (t) => t.ff.text,
          outline: "none",
          fontSize: "1rem",
          cursor: "pointer",
          appearance: "none",
          backgroundImage: CHEVRON_BG,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
          transition: (t) => `border-color ${t.ff.motion.fast} ${t.ff.motion.ease}`,
          "&:focus": { borderColor: (t) => t.ff.borderActive },
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ backgroundColor: "#18181b" }}>
            {o.label}
          </option>
        ))}
      </Box>
    </Box>
  );
}
