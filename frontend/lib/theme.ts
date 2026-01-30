"use client";

import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#10b981", // emerald-500
      light: "#34d399", // emerald-400
      dark: "#059669", // emerald-600
    },
    secondary: {
      main: "#14b8a6", // teal-500
      light: "#2dd4bf", // teal-400
      dark: "#0d9488", // teal-600
    },
    error: {
      main: "#ef4444",
      light: "#f87171",
      dark: "#dc2626",
    },
    warning: {
      main: "#f59e0b",
      light: "#fbbf24",
      dark: "#d97706",
    },
    success: {
      main: "#10b981",
      light: "#34d399",
      dark: "#059669",
    },
    info: {
      main: "#3b82f6",
      light: "#60a5fa",
      dark: "#2563eb",
    },
    background: {
      default: "#0a0a0b",
      paper: "#18181b", // zinc-900
    },
    text: {
      primary: "#fafafa", // zinc-50
      secondary: "#a1a1aa", // zinc-400
      disabled: "#52525b", // zinc-600
    },
    divider: "rgba(63, 63, 70, 0.5)", // zinc-700/50
    action: {
      hover: "rgba(255, 255, 255, 0.05)",
      selected: "rgba(16, 185, 129, 0.08)",
      disabled: "rgba(255, 255, 255, 0.3)",
      disabledBackground: "rgba(255, 255, 255, 0.12)",
    },
  },
  typography: {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    h1: {
      fontWeight: 700,
      letterSpacing: "-0.025em",
    },
    h2: {
      fontWeight: 700,
      letterSpacing: "-0.025em",
    },
    h3: {
      fontWeight: 600,
    },
    h4: {
      fontWeight: 600,
    },
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFeatureSettings: "'ss01' on, 'ss02' on",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "::-webkit-scrollbar": {
          width: "6px",
          height: "6px",
        },
        "::-webkit-scrollbar-track": {
          background: "transparent",
        },
        "::-webkit-scrollbar-thumb": {
          background: "#3f3f46",
          borderRadius: "3px",
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: "#52525b",
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
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: "10px 20px",
          fontSize: "0.875rem",
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none",
          },
        },
        containedPrimary: {
          background: "linear-gradient(to right, #10b981, #14b8a6)",
          "&:hover": {
            background: "linear-gradient(to right, #059669, #0d9488)",
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
          borderRadius: 24,
          backgroundColor: "rgba(24, 24, 27, 0.8)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid #27272a",
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
            borderRadius: 12,
            backgroundColor: "rgba(39, 39, 42, 0.5)",
            "& fieldset": {
              borderColor: "#3f3f46",
            },
            "&:hover fieldset": {
              borderColor: "#52525b",
            },
            "&.Mui-focused fieldset": {
              borderColor: "rgba(16, 185, 129, 0.5)",
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: "1px solid #3f3f46",
          color: "#d4d4d8",
          "&.Mui-selected": {
            borderColor: "rgba(16, 185, 129, 0.5)",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            color: "#fafafa",
            "&:hover": {
              backgroundColor: "rgba(16, 185, 129, 0.15)",
            },
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "rgba(63, 63, 70, 0.5)",
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
