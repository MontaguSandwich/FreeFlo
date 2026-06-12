"use client";

import Box from "@mui/material/Box";

/**
 * ProviderGlyph (§2.8) — small rounded-square neutral color glyphs for the
 * payment platforms / corridors. Deliberately NOT the providers' full logos
 * (trademark safety) — a consistent flat letter mark on a tinted square so the
 * product looks intentional. The flow-chevron and the €/USDC marks live here too.
 */

const MARKS: Record<string, { label: string; from: string; to: string; fg: string }> = {
  venmo: { label: "V", from: "#3D95CE", to: "#2563eb", fg: "#ffffff" },
  cashapp: { label: "$", from: "#00D632", to: "#059669", fg: "#ffffff" },
  zelle: { label: "Z", from: "#6D1ED4", to: "#7c3aed", fg: "#ffffff" },
  revolut: { label: "R", from: "#0666EB", to: "#1d4ed8", fg: "#ffffff" },
  wise: { label: "W", from: "#9FE870", to: "#16a34a", fg: "#06251c" },
  paypal: { label: "P", from: "#003087", to: "#0070BA", fg: "#ffffff" },
  mercadopago: { label: "M", from: "#00AEEF", to: "#2563eb", fg: "#ffffff" },
  sepa: { label: "€", from: "#10b981", to: "#14b8a6", fg: "#06251c" },
  usdc: { label: "$", from: "#2775CA", to: "#1d4ed8", fg: "#ffffff" },
};

export function ProviderGlyph({
  id,
  size = 40,
  radius = 12,
}: {
  id: string;
  size?: number;
  radius?: number;
}) {
  const mark = MARKS[id] ?? { label: (id[0] || "?").toUpperCase(), from: "#3f3f46", to: "#27272a", fg: "#fafafa" };
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${radius}px`,
        background: `linear-gradient(135deg, ${mark.from} 0%, ${mark.to} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: mark.fg,
        fontWeight: 700,
        fontSize: size * 0.45,
        lineHeight: 1,
        boxShadow: (t) => t.ff.litEdge,
      }}
    >
      {mark.label}
    </Box>
  );
}

/**
 * FlowChevron — the brand glyph (§2.1): two nested right-chevrons (»), inner
 * emerald + outer teal, reading as value passing through a boundary.
 */
export function FlowChevron({ size = 18 }: { size?: number }) {
  return (
    <Box
      component="svg"
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      sx={{ flexShrink: 0 }}
    >
      <path d="M5 6l5 6-5 6" stroke="#14b8a6" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6l5 6-5 6" stroke="#10b981" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  );
}

/** A small right-arrow used in the corridor / rail (amount in → out). */
export function FlowArrow({ size = 22 }: { size?: number }) {
  return (
    <Box
      component="svg"
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      sx={{ flexShrink: 0 }}
    >
      <path
        d="M13 7l5 5m0 0l-5 5m5-5H6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}
