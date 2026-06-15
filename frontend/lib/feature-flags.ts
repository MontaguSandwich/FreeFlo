/**
 * Route feature flags.
 *
 * The plain USDC offramp ("/", OffRampV3) is the always-on default. The newer opt-in flows —
 * the Compact sign-once offramp ("/sign-once") and the fiat-to-fiat bridge ("/fiat-to-fiat") —
 * are gated so a deployment can enable them independently (mirrors the solver's env gating, where
 * COMPACT_ARBITER_ADDRESS / FIAT_TO_FIAT_ROUTER_ADDRESS turn the matching server paths on).
 *
 * Flags are NEXT_PUBLIC_* so the SAME value is readable both server-side (middleware route gate)
 * and client-side (the nav) — the on/off state is not a secret. Default: ON in development, OFF in
 * production, so merging to `main` keeps prod on the baseline until the flag is explicitly set.
 * Set NEXT_PUBLIC_ENABLE_SIGN_ONCE / NEXT_PUBLIC_ENABLE_FIAT_TO_FIAT to "true" (or "false") to override.
 */

function flag(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  // Unset: on in dev, off in prod. NODE_ENV is inlined at build for the client bundle.
  return process.env.NODE_ENV !== "production";
}

export function signOnceEnabled(): boolean {
  return flag(process.env.NEXT_PUBLIC_ENABLE_SIGN_ONCE);
}

export function fiatToFiatEnabled(): boolean {
  return flag(process.env.NEXT_PUBLIC_ENABLE_FIAT_TO_FIAT);
}
