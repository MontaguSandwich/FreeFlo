/**
 * Presentational formatting helpers used across the kit (display-only; the
 * hook owns the canonical formatters for amounts).
 */

/** Mask an IBAN for the rail/receipt: first 4 + last 5 (privacy, §4.2). */
export function maskIban(iban: string): string {
  const clean = (iban || "").replace(/\s+/g, "");
  if (clean.length <= 9) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-5)}`;
}

/** Group an IBAN into 4-char blocks for the full (review) display. */
export function groupIban(iban: string): string {
  const clean = (iban || "").replace(/\s+/g, "");
  return clean.replace(/(.{4})/g, "$1 ").trim();
}
