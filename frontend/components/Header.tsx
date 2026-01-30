"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import BoltIcon from "@mui/icons-material/Bolt";

export function Header() {
  const pathname = usePathname();
  const isVenmoPage = pathname === "/venmo-to-sepa";

  const gradientFrom = isVenmoPage ? "#3b82f6" : "#10b981";
  const gradientTo = isVenmoPage ? "#10b981" : "#14b8a6";

  return (
    <Box
      component="header"
      sx={{
        width: "100%",
        px: 4,
        py: 2.5,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          maxWidth: 1280,
          mx: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo + Nav */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                background: `linear-gradient(to bottom right, ${gradientFrom}, ${gradientTo})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 4px 12px ${gradientFrom}33`,
              }}
            >
              <BoltIcon sx={{ color: "white", fontSize: 20 }} />
            </Box>
            <Typography variant="h6" sx={{ color: "white", fontWeight: 700, letterSpacing: "-0.02em" }}>
              Ramp
            </Typography>
          </Link>

          {/* Nav Links */}
          <Box
            component="nav"
            sx={{
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              gap: 0.5,
              ml: 2,
              pl: 2,
              borderLeft: "1px solid",
              borderColor: "divider",
            }}
          >
            <Button
              component={Link}
              href="/"
              size="small"
              sx={{
                color: pathname === "/" ? "white" : "text.secondary",
                bgcolor: pathname === "/" ? "rgba(39, 39, 42, 0.5)" : "transparent",
                "&:hover": {
                  bgcolor: "rgba(39, 39, 42, 0.5)",
                  color: "white",
                },
                borderRadius: 2,
                px: 1.5,
                py: 0.75,
                fontSize: "0.875rem",
                minWidth: "auto",
              }}
            >
              USDC Offramp
            </Button>
            <Button
              component={Link}
              href="/venmo-to-sepa"
              size="small"
              sx={{
                color: isVenmoPage ? "white" : "text.secondary",
                bgcolor: isVenmoPage ? "rgba(39, 39, 42, 0.5)" : "transparent",
                "&:hover": {
                  bgcolor: "rgba(39, 39, 42, 0.5)",
                  color: "white",
                },
                borderRadius: 2,
                px: 1.5,
                py: 0.75,
                fontSize: "0.875rem",
                minWidth: "auto",
              }}
            >
              Venmo to SEPA
            </Button>
          </Box>
        </Box>

        {/* Connect Button */}
        <ConnectButton.Custom>
          {({
            account,
            chain,
            openAccountModal,
            openChainModal,
            openConnectModal,
            mounted,
          }) => {
            const ready = mounted;
            const connected = ready && account && chain;

            return (
              <Box
                {...(!ready && {
                  "aria-hidden": true,
                  sx: {
                    opacity: 0,
                    pointerEvents: "none",
                    userSelect: "none",
                  },
                })}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <Button
                        onClick={openConnectModal}
                        variant="contained"
                        sx={{
                          background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})`,
                          boxShadow: `0 4px 12px ${gradientFrom}33`,
                          "&:hover": {
                            background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})`,
                            opacity: 0.9,
                          },
                        }}
                      >
                        Connect Wallet
                      </Button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <Button
                        onClick={openChainModal}
                        sx={{
                          bgcolor: "rgba(239, 68, 68, 0.2)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: "#f87171",
                          "&:hover": {
                            bgcolor: "rgba(239, 68, 68, 0.3)",
                          },
                        }}
                      >
                        Wrong Network
                      </Button>
                    );
                  }

                  return (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Button
                        onClick={openChainModal}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          py: 1,
                          borderRadius: 2,
                          bgcolor: "rgba(39, 39, 42, 0.5)",
                          border: "1px solid rgba(63, 63, 70, 0.5)",
                          "&:hover": { bgcolor: "rgba(39, 39, 42, 1)" },
                          minWidth: "auto",
                        }}
                      >
                        {chain.hasIcon && chain.iconUrl && (
                          <Box
                            component="img"
                            alt={chain.name ?? "Chain"}
                            src={chain.iconUrl}
                            sx={{ width: 20, height: 20, borderRadius: "50%" }}
                          />
                        )}
                        <Typography variant="body2" sx={{ color: "#d4d4d8" }}>
                          {chain.name}
                        </Typography>
                      </Button>

                      <Button
                        onClick={openAccountModal}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 2,
                          py: 1,
                          borderRadius: 2,
                          bgcolor: "rgba(39, 39, 42, 0.5)",
                          border: "1px solid rgba(63, 63, 70, 0.5)",
                          "&:hover": { bgcolor: "rgba(39, 39, 42, 1)" },
                          minWidth: "auto",
                        }}
                      >
                        <Box
                          sx={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: `linear-gradient(to bottom right, ${gradientFrom}, ${gradientTo})`,
                          }}
                        />
                        <Typography variant="body2" sx={{ color: "white", fontWeight: 500 }}>
                          {account.displayName}
                        </Typography>
                      </Button>
                    </Box>
                  );
                })()}
              </Box>
            );
          }}
        </ConnectButton.Custom>
      </Box>
    </Box>
  );
}
