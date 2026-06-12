"use client";

import { createTheme } from "@mui/material/styles";

/* ===========================================================================
 * FreeFlo design system — Gate 3 (DARK foundation)
 *
 * Implements docs/design/UI-OVERHAUL-PLAN.md §2 ("Visual identity") as an
 * additive evolution of the existing MUI theme. DARK is the default and the
 * only mode built here (per the locked user decision); the plan's light tokens
 * are intentionally not materialised yet.
 *
 * Layering (mirrors the plan's three-layer model, kept inline to honour the
 * Gate-3 "touch ≤5 files" constraint — the standalone lib/design-tokens.ts the
 * plan sketches is a later nicety; the brand axis is unchanged either way):
 *
 *   Layer 1  ffRamps     raw colour ramps (emerald, teal, ink, amberRed, …)
 *   Layer 2  ff          semantic DARK tokens (surface ramp, brand, destructive…)
 *   Layer 3  theme       MUI palette + components overrides consume Layers 1–2
 *
 * The brand emerald (#10b981) / teal (#14b8a6) hexes are UNCHANGED from the
 * shipping theme, so the brand-axis migration is a literal→token rename with
 * zero visual delta. The one deliberate recolor is the error axis: destructive
 * moves off the old #ef4444 to the plan's amber-red so danger never blurs with
 * the brand (the documented Peer hazard).
 * ===========================================================================*/

/* ---------------------------------------------------------------------------
 * Layer 1 — raw colour ramps (`ff-ramps`, §2.2)
 * ------------------------------------------------------------------------- */
export const ffRamps = {
  emerald: {
    50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399",
    500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b", 950: "#022c22",
  },
  teal: {
    50: "#f0fdfa", 100: "#ccfbf1", 200: "#99f6e4", 300: "#5eead4", 400: "#2dd4bf",
    500: "#14b8a6", 600: "#0d9488", 700: "#0f766e", 800: "#115e59", 900: "#134e4a", 950: "#042f2e",
  },
  ink: {
    50: "#fafafa", 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8", 400: "#a1a1aa",
    500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a", 900: "#18181b", 950: "#09090b",
  },
  // Destructive ramp — amber-red, deliberately a different hue from both the
  // emerald brand and the azure info ramp (§2.2). NOT the old #ef4444.
  amberRed: {
    50: "#fff1f0", 100: "#ffd9d4", 200: "#ffb3a8", 300: "#ff8a78", 400: "#ff6a52",
    500: "#f4502f", 600: "#d83a1c", 700: "#b22d15", 800: "#8c2412", 900: "#6b1d10", 950: "#3d1009",
  },
  // Warning ramp — orange-yellow amber, separated from destructive red.
  amber: {
    50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24",
    500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f", 950: "#451a03",
  },
  // Info / links ramp.
  azure: {
    50: "#eff6ff", 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa",
    500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af", 900: "#1e3a8a", 950: "#172554",
  },
} as const;

/* ---------------------------------------------------------------------------
 * Layer 2 — semantic DARK tokens (`ffTokens('dark')`, §2.2)
 *
 * The token bag the components consume. Exposed on the theme as `theme.ff`
 * (module-augmented below) for the values MUI's palette doesn't model
 * (surface2/3, glow, borderActive, destructiveBg, …).
 * ------------------------------------------------------------------------- */
export const ff = {
  // Surfaces / canvas
  bg: ffRamps.ink[950], // #09090b — app canvas (<body> / Background base)
  bgElevated: "#0d0d0f", // behind the card
  surface1: ffRamps.ink[900], // #18181b — primary card fill
  surface2: "#1c1c1f", // nested row / input well
  surface3: "#121214", // deepest inset ("send-to" / amount wells)
  surfaceGlass: "rgba(24, 24, 27, 0.80)", // glass card fill (existing dark value kept)

  // Borders
  border: ffRamps.ink[800], // #27272a — default 1px separators
  borderStrong: ffRamps.ink[700], // #3f3f46 — input borders, hover
  borderActive: "rgba(16, 185, 129, 0.55)", // selected card / focus ring

  // Brand
  brand: ffRamps.emerald[500], // #10b981 — primary text-accent, links-on-brand
  brandStrong: ffRamps.emerald[400], // #34d399 — hover, emphasis
  onBrand: "#06251c", // near-ink, AA on emerald — text on a brand fill

  // Text
  text: ffRamps.ink[50], // #fafafa — primary text
  textSecondary: ffRamps.ink[400], // #a1a1aa — secondary text
  textTertiary: ffRamps.ink[500], // #71717a — captions, "expires in" labels
  textDisabled: ffRamps.ink[600], // #52525b — disabled

  // Destructive (amber-red — distinct from brand AND warning AND info)
  destructive: ffRamps.amberRed[400], // #ff6a52 — error text/icon, Cancel affordance
  destructiveBg: "rgba(255, 106, 82, 0.10)", // error Alert fill
  destructiveBorder: "rgba(255, 106, 82, 0.22)", // error Alert border

  // Warning
  warning: ffRamps.amber[300], // #fbbf24
  warningBg: "rgba(245, 158, 11, 0.10)",
  warningBorder: "rgba(245, 158, 11, 0.22)",

  // Success (= brand emerald-400; intentional per §2.2)
  success: ffRamps.emerald[400], // #34d399

  // Info
  info: ffRamps.azure[400], // #60a5fa
  infoBg: "rgba(59, 130, 246, 0.10)",
  infoBorder: "rgba(59, 130, 246, 0.22)",

  // Ambient background glow orbs
  glow1: "rgba(16, 185, 129, 0.10)",
  glow2: "rgba(20, 184, 166, 0.08)",
  glow3: "rgba(6, 182, 212, 0.05)",

  // Countdown-ring track (dark)
  ringTrack: "rgba(255, 255, 255, 0.08)",

  // Elevation (§2.5)
  elev1: "0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.45)", // the wizard card
  elev2: "0 8px 24px rgba(0,0,0,0.5)", // dialogs, popovers
  litEdge: "inset 0.6px 0.6px 0.1px rgba(255,255,255,0.06)", // faint "lit edge"

  // Radii (§2.4)
  radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, pill: 9999 },

  // Motion (§2.7)
  motion: {
    fast: "120ms",
    base: "200ms",
    slow: "500ms",
    ring: "1000ms",
    glow: "20s",
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },

  // Brand gradient — the one signature fill (§2.2)
  brandGradient: "linear-gradient(135deg, #10b981 0%, #14b8a6 100%)", // emerald → teal
  brandGradientHover: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
  brandGradientText: "linear-gradient(90deg, #34d399 0%, #2dd4bf 100%)", // large display only
} as const;

/* Display typeface (Space Grotesk) is loaded via next/font in app/layout.tsx
 * and exposed as the CSS variable `--font-display`. Body stays DM Sans. */
export const displayFontFamily =
  "var(--font-display), 'DM Sans', system-ui, sans-serif";
export const bodyFontFamily = "'DM Sans', system-ui, sans-serif";
const monoFontFamily =
  "ui-monospace, SFMono-Regular, Menlo, 'Space Mono', monospace";

/* ---------------------------------------------------------------------------
 * Layer 3 — MUI theme (palette + typography + components consume Layers 1–2)
 * ------------------------------------------------------------------------- */
const theme = createTheme({
  // Expose the semantic token bag on the theme for `sx={(t) => t.ff.*}` reads.
  ff,
  palette: {
    mode: "dark",
    primary: {
      main: ff.brand, // emerald-500
      light: ffRamps.emerald[400],
      dark: ffRamps.emerald[700],
      contrastText: ff.onBrand,
    },
    secondary: {
      main: ffRamps.teal[500], // teal-500
      light: ffRamps.teal[400],
      dark: ffRamps.teal[600],
    },
    error: {
      // amber-red destructive — NOT the old #ef4444 (Peer-collision fix)
      main: ff.destructive, // #ff6a52
      light: ffRamps.amberRed[300],
      dark: ffRamps.amberRed[600],
    },
    warning: {
      main: ffRamps.amber[500],
      light: ffRamps.amber[300],
      dark: ffRamps.amber[600],
    },
    success: {
      main: ff.success, // emerald-400
      light: ffRamps.emerald[400],
      dark: ffRamps.emerald[600],
    },
    info: {
      main: ff.info, // azure-400
      light: ffRamps.azure[400],
      dark: ffRamps.azure[600],
    },
    background: {
      default: ff.bg, // #09090b
      paper: ff.surface1, // #18181b
    },
    text: {
      primary: ff.text,
      secondary: ff.textSecondary,
      disabled: ff.textDisabled,
    },
    divider: ff.border, // #27272a
    action: {
      hover: "rgba(255, 255, 255, 0.05)",
      selected: "rgba(16, 185, 129, 0.08)",
      disabled: "rgba(255, 255, 255, 0.3)",
      disabledBackground: "rgba(255, 255, 255, 0.12)",
    },
  },
  typography: {
    // Body / UI / numbers — DM Sans (unchanged).
    fontFamily: bodyFontFamily,
    // Display / headings — Space Grotesk via the CSS var (§2.3 type scale).
    h1: {
      fontFamily: displayFontFamily,
      fontSize: "2.5rem", // 40px
      lineHeight: 1.1,
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: displayFontFamily,
      fontSize: "1.875rem", // 30px
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: "-0.02em",
    },
    h3: {
      fontFamily: displayFontFamily,
      fontSize: "1.5rem", // 24px
      lineHeight: 1.25,
      fontWeight: 600,
      letterSpacing: "-0.015em",
    },
    h4: {
      fontFamily: displayFontFamily,
      fontSize: "1.25rem", // 20px
      lineHeight: 1.3,
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h5: {
      fontFamily: displayFontFamily,
      fontWeight: 600,
    },
    h6: {
      fontFamily: displayFontFamily,
      fontWeight: 600,
    },
    button: {
      // Sentence case, calm — Jumper's register (§2.3). Unchanged from today.
      textTransform: "none",
      fontWeight: 600,
      fontSize: "0.9375rem", // 15px
    },
  },
  shape: {
    borderRadius: ff.radius.md, // 12 — buttons, inputs, alerts
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFeatureSettings: "'ss01' on, 'ss02' on",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          backgroundColor: ff.bg,
        },
        "::-webkit-scrollbar": {
          width: "6px",
          height: "6px",
        },
        "::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "::-webkit-scrollbar-thumb": {
          background: ff.borderStrong,
          borderRadius: "3px",
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: ffRamps.ink[600],
        },
        'input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button':
          {
            WebkitAppearance: "none",
            margin: 0,
          },
        'input[type="number"]': {
          MozAppearance: "textfield",
        },
        "::selection": {
          background: "rgba(16, 185, 129, 0.3)",
        },
        // Motion communicates state; respect the user's reduced-motion choice
        // (§2.7) — kill non-essential animation/transition globally.
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: ff.radius.md, // 12 — not full pills (§2.4)
          padding: "10px 20px",
          fontSize: "0.9375rem", // 15px
          transition: `background ${ff.motion.fast} ${ff.motion.ease}, opacity ${ff.motion.fast} ${ff.motion.ease}`,
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none",
          },
        },
        containedPrimary: {
          background: ff.brandGradient,
          color: ff.onBrand,
          boxShadow: ff.litEdge,
          "&:hover": {
            background: ff.brandGradientHover,
          },
        },
        // Destructive affordance (Cancel & reclaim) — amber-red text + border,
        // tinted hover. Distinct from the brand (§3 Button spec).
        outlinedError: {
          color: ff.destructive,
          borderColor: ff.destructiveBorder,
          "&:hover": {
            borderColor: ff.destructiveBorder,
            backgroundColor: ff.destructiveBg,
          },
        },
        textError: {
          color: ff.destructive,
          "&:hover": {
            backgroundColor: ff.destructiveBg,
          },
        },
      },
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: ff.radius.xl, // 24 — the wizard card / widget shell
          backgroundColor: ff.surfaceGlass,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${ff.border}`,
          boxShadow: ff.elev1,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: ff.radius.md, // 12
            backgroundColor: ff.surface3,
            transition: `border-color ${ff.motion.fast} ${ff.motion.ease}`,
            "& fieldset": {
              borderColor: ff.borderStrong,
            },
            "&:hover fieldset": {
              borderColor: ffRamps.ink[600],
            },
            "&.Mui-focused fieldset": {
              borderColor: ff.borderActive,
            },
            "&.Mui-error fieldset": {
              borderColor: ff.destructiveBorder,
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: ff.radius.sm, // 8
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: ff.radius.sm, // 8
          border: `1px solid ${ff.borderStrong}`,
          color: ffRamps.ink[300],
          transition: `background-color ${ff.motion.fast} ${ff.motion.ease}, border-color ${ff.motion.fast} ${ff.motion.ease}`,
          "&.Mui-selected": {
            borderColor: ff.borderActive,
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            color: ff.text,
            "&:hover": {
              backgroundColor: "rgba(16, 185, 129, 0.15)",
            },
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        // One Notice visual language; error = amber-red (never brand), §3.
        root: {
          borderRadius: ff.radius.md, // 12
          border: "1px solid",
          alignItems: "flex-start",
        },
        standardError: {
          color: ff.destructive,
          backgroundColor: ff.destructiveBg,
          borderColor: ff.destructiveBorder,
          "& .MuiAlert-icon": { color: ff.destructive },
        },
        standardWarning: {
          color: ff.warning,
          backgroundColor: ff.warningBg,
          borderColor: ff.warningBorder,
          "& .MuiAlert-icon": { color: ff.warning },
        },
        standardInfo: {
          color: ff.info,
          backgroundColor: ff.infoBg,
          borderColor: ff.infoBorder,
          "& .MuiAlert-icon": { color: ff.info },
        },
        standardSuccess: {
          color: ff.success,
          backgroundColor: "rgba(16, 185, 129, 0.10)",
          borderColor: "rgba(16, 185, 129, 0.22)",
          "& .MuiAlert-icon": { color: ff.success },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: ff.surface1,
          color: ff.text,
          border: `1px solid ${ff.border}`,
          borderRadius: ff.radius.sm, // 8
          boxShadow: ff.elev2,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          fontSize: "0.75rem",
          padding: "6px 10px",
        },
        arrow: {
          color: ff.surface1,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: ff.border,
        },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(39, 39, 42, 0.8)",
        },
      },
    },
  },
});

export default theme;

/* ---------------------------------------------------------------------------
 * Module augmentation — make `theme.ff` (the semantic token bag) type-safe so
 * components can read `sx={(t) => ({ background: t.ff.surface2 })}`.
 * ------------------------------------------------------------------------- */
declare module "@mui/material/styles" {
  interface Theme {
    ff: typeof ff;
  }
  interface ThemeOptions {
    ff?: typeof ff;
  }
}

/* outlinedError / textError variant overrides require the Button colour-prop
 * slots to exist in the override map (they do in MUI v7 by default). */
