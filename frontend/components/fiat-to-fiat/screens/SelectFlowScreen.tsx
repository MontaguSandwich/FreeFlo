"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CardActionArea from "@mui/material/CardActionArea";
import { PEER_EXTENSION_CHROME_URL } from "@zkp2p/sdk";
import type { FiatToFiatFlowApi } from "@/hooks/useFiatToFiatFlow";
import { PLATFORMS } from "@/lib/platforms";
import { PrimaryButton, NoticeBanner, ProviderGlyph, FlowArrow, Surface } from "../ui";

/**
 * select_flow (§5.1) — choose the corridor. Behaviour preserved:
 *  - the corridor CTA calls flow.handleStart (was the big <Button onClick={handleStart}>).
 *  - the extension Notice renders ONLY when extensionState === "needs_install"
 *    (verbatim with the current component), framed as "a free browser helper"
 *    with an "Add it →" link to PEER_EXTENSION_CHROME_URL — no ZK jargon.
 *  - rail is hidden on this step (handled by the shell).
 */
export function SelectFlowScreen({ flow }: { flow: FiatToFiatFlowApi }) {
  const { selectedPlatform, extensionState, handleStart } = flow;
  const platformId = PLATFORMS[selectedPlatform] ? selectedPlatform : "venmo";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ textAlign: "center" }}>
        <Typography variant="h3" sx={{ color: (t) => t.ff.text, mb: 0.5 }}>
          Send money across the border
        </Typography>
        <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
          Pay from your app · receive EUR by SEPA
        </Typography>
      </Box>

      <Surface level={3} sx={{ p: 0, overflow: "hidden" }}>
        <CardActionArea onClick={handleStart} sx={{ p: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
              <ProviderGlyph id={platformId} size={44} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, color: (t) => t.ff.text }}>Your fiat</Typography>
                <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
                  From your app
                </Typography>
              </Box>
            </Box>
            <Box sx={{ color: (t) => t.ff.textTertiary }}>
              <FlowArrow size={22} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
              <ProviderGlyph id="sepa" size={44} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, color: (t) => t.ff.text }}>SEPA EUR</Typography>
                <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
                  European bank
                </Typography>
              </Box>
            </Box>
          </Box>
          <Box sx={{ mt: 2, pt: 2, borderTop: (t) => `1px solid ${t.ff.border}` }}>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography variant="body2" sx={{ color: (t) => t.ff.textTertiary }}>
                Estimated time
              </Typography>
              <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
                2–5 minutes
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
              <Typography variant="body2" sx={{ color: (t) => t.ff.textTertiary }}>
                No middleman
              </Typography>
              <Typography variant="body2" sx={{ color: (t) => t.ff.textSecondary }}>
                you keep custody until you pay
              </Typography>
            </Box>
          </Box>
        </CardActionArea>
      </Surface>

      {extensionState === "needs_install" && (
        <NoticeBanner kind="info">
          A free browser helper proves your payment.{" "}
          <a
            href={PEER_EXTENSION_CHROME_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline", fontWeight: 600 }}
          >
            Add it →
          </a>{" "}
          (one-time)
        </NoticeBanner>
      )}

      <PrimaryButton onClick={handleStart}>Start a transfer</PrimaryButton>
    </Box>
  );
}
