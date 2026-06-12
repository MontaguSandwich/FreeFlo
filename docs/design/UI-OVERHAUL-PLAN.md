# FreeFlo — UI Overhaul Plan

> **Definitive visual + UX redesign spec for FreeFlo.** A PLAN/spec only — this document
> changes no application code. The only writes it authorizes are documents under
> `docs/design/`.
>
> **Authored:** 2026-06-12 · **Author:** Principal product design + design-systems lead.
> **Branch context:** built for `audit-fixes` (the branch carrying the headless-hook
> extraction backbone). **Reads as its foundation:** `docs/design/research/peer-design.md`,
> `docs/design/research/jumper-design.md`, and — non-negotiably —
> `docs/design/research/freeflo-ui-audit.md` (the safety audit: 13 invariants + the Gate 0→6
> migration backbone).
>
> **Prime directive (the user's #1 priority): NOTHING BREAKS.** Every visual deliverable in
> this plan is mapped to a gate in the audit's migration backbone, and **no pixel changes
> before the Gate-2 behaviour-parity check passes.** All 13 invariants (INV-1…13) are
> preserved and referenced where they touch a screen.

---

## Table of contents

1. [Design thesis / north-star + brand personality](#1-design-thesis--north-star)
2. [Visual identity (logo, color, type, shape, elevation, space, motion, icon) — as `theme.ts` tokens](#2-visual-identity)
3. [Component library (unified primitives, each mapped to its offramp ancestor)](#3-component-library)
4. [Information architecture (4 phases, the summary rail, the app shell)](#4-information-architecture)
5. [Screen-by-screen redesign of `/fiat-to-fiat` (every state, incl. errors) + invariants](#5-screen-by-screen--fiat-to-fiat)
6. [Offramp `/` alignment](#6-offramp--alignment)
7. [The "nothing breaks" migration plan (Gate 0→6)](#7-the-nothing-breaks-migration-plan)
8. [Open questions / decisions for the user](#8-open-questions--decisions-for-the-user)
9. [Appendix: style-tile.html](#9-appendix--style-tilehtml)

---

## 1. Design thesis / north-star

### The one concept that drives everything

> **"The calm clearinghouse."**
> FreeFlo moves real money across a border and across a trust boundary. The product's job is
> to make a cryptographically heavy, irreversible, multi-party settlement *feel* as composed
> and legible as a private-bank wire desk — one decision per surface, the counterparty and
> the clock always visible, the cryptography felt only as a short bounded wait. Confidence,
> not hype. **Considered, not crypto.**

Everything below derives from that line. Three operating principles fall straight out of it:

1. **One decision per surface, with the deal always in view.** A persistent *transfer-summary
   rail* re-states what's happening (amount in, amount out, recipient, the live clock) at the
   top of every step — the audit's and Jumper's "reaffirmed summary card," made permanent.
   The body asks for exactly one thing.

2. **Hide the machine; show a bounded, locked wait.** This is Peer's single best insight and
   it maps 1:1 onto FreeFlo's scariest screen. The verify step runs TLSNotary → TEE
   attestation → EIP-712 → on-chain fulfill (INV-2), but the user sees *"Verifying your
   payment · up to ~30s"* with a lock and a countdown ring. The words "zkTLS / TLSNotary /
   TEE / attestation / nullifier" never appear in the wizard. (They live in docs and in
   `/learn`, exactly as Peer does it.)

3. **Gravity at the moment of risk.** Because a SEPA/Venmo payment is real and irreversible,
   the calm is *deliberately broken* at exactly two moments — the fiat-send step and the
   commit step — with explicit irreversibility cues, a do/don't checklist, and a
   risk-acknowledgment gate (Peer's "permanent loss of funds" pattern). Borrow Jumper's calm;
   add the gravity the audit demands.

### Brand personality

| Trait | Means in the UI | Anti-pattern we reject |
|---|---|---|
| **Composed** | Generous rhythm, one focal action, soft motion, no confetti even on success | Busy dashboards, celebratory spam |
| **Legible** | Plain verbs, tabular numbers, the deal restated everywhere, real values never "undefined" / "@unknown" | Crypto jargon, raw maker handles, leaked dev strings |
| **Candid** | The counterparty (as a reputation chip), the clock, the fee, and the irreversibility are all shown, never buried | Over-abstracting the user's required action into a subtitle |
| **Trustworthy-by-restraint** | The cryptography is a quiet substrate; trust is shown through behavioural guardrails, not a "ZK" badge | Selling the mechanism instead of the outcome |
| **Continental / bank-adjacent** | A considered **light mode is first-class** (our audience is EUR/SEPA, not dark-only crypto); the dark mode is the "night desk" | Inheriting Peer's dark-only by default |

**Voice (one line):** *"We'll send the euros and prove it for you."* Second-person,
outcome-first, plain verbs; numbers and timers carry the detail. Lead with **speed + cost +
"no middleman"**; the trustless mechanism is the reassuring substrate (Peer's rebrand thesis,
adopted).

### Where we deliberately diverge from the references

This is a FreeFlo-original identity, not a Peer or Jumper clone. We borrow *structure* and
*patterns*, then diverge on identity:

- **Not Peer's red-leaning ignite gradient** (their brand-red ≈ error-red collision is a
  documented hazard). FreeFlo keeps its **emerald→teal** heritage as the brand spine and
  reserves a clearly distinct hue for destructive actions.
- **Not Peer's licensed PP Valve** display face (paid + now strongly "Peer"). We choose our
  own display face (§2.3).
- **Not Jumper's aubergine/purple** and **not dark-only.** We go warm-neutral with an emerald
  signal, and we ship **both** light and dark.
- **Not Jumper's 416px-locked never-widening card** — fine for a swap, too tight for a SEPA
  instruction screen or an IBAN review. We keep the focused-card *feel* but allow a roomier
  step width where a real-money action needs explanation (the audit's explicit warning).

---

## 2. Visual identity

> **Framing constraint (HS-6, hard).** The app is **MUI v7 + emotion `sx` + `lib/theme.ts`**.
> A styling-engine swap is **out of scope** — it would touch all 202 `sx` blocks in the
> monolith plus every offramp component plus the RainbowKit `darkTheme` bridge. Everything in
> this section is therefore expressed as **additive evolution of `theme.ts`**: palette
> extension (via `theme.palette` + a small `theme.vars`-style custom token object), typography
> scale, `shape`, and **MUI `components` overrides**. We *extend* the emerald/teal/DM-Sans
> system that exists; we do not replace the framework. Today's literals (`#10b981`, `#a1a1aa`,
> `rgba(24,24,27,…)` etc.) become the *named tokens* below so "change the color once" finally
> holds.

### 2.0 Token architecture (how the layers stack)

Mirror Jumper's proven three-layer model, but inside MUI:

```
Layer 1  ff-ramps         raw color ramps (emerald, teal, sand, ink, …)        — primitives
Layer 2  ffTokens(mode)   semantic light/dark tokens (surface1..4, brand,      — meaning
                          destructive, glow, borderActive, …)
Layer 3  theme.ts         MUI palette + components overrides reference Layer 2 — MUI surface
```

Concretely, add **one file** `frontend/lib/design-tokens.ts` exporting the ramps + a
`ffTokens(mode: 'light' | 'dark')` function, and have `theme.ts` consume it. This keeps
`theme.ts` readable and lets the style tile and the app share one source of truth. (Created at
**Gate 3**, see §7.)

### 2.1 Logo / wordmark direction

> ⚠️ **Naming reality check (decision needed — see §8).** The shipped `Header.tsx` wordmark
> currently reads **"Ramp"**, not "FreeFlo". The plan below assumes we standardize on
> **"FreeFlo"** as the product name and ship a real wordmark. If the user prefers "Ramp" or a
> new name, the *system* is unchanged — only the glyph swaps.

- **Wordmark:** lowercase **`freeflo`** set in the display face (§2.3) at a tight tracking
  (−0.01em), with the two `f`'s sharing a subtly extended crossbar to imply *flow / a
  through-line*. Single weight (600). Sentence-case, never all-caps (we are not Peer's
  brutalist register).
- **Mark / glyph:** a **"flow chevron"** — two nested right-chevrons (`»`) where the inner one
  is emerald and the outer is teal, reading as *value passing through a boundary*. Replaces
  the generic `BoltIcon` lozenge in `Header.tsx`. Renders at 20px in the header lozenge, scales
  to a favicon cleanly (it's two strokes). Set on a `radius-lg` rounded square with the brand
  gradient, matching the existing header treatment so the chrome change is minimal.
- **Page accent inheritance:** keep the existing `Header`/`Background` `variant` API
  (`emerald` for `/`, a cross-border tint for `/fiat-to-fiat`) — but retune the cross-border
  variant **off Peer-blue** to a **teal→emerald** so both surfaces read as *one product*
  (today `/fiat-to-fiat` uses `#3b82f6` blue, which makes it look like a different app). See
  §4.3.
- **No mascot.** Both references ship none; a strong color + motion + voice system carries the
  brand (Jumper's verified finding). Brand expression = the wordmark + the flow-chevron + the
  emerald signal + the ambient glow.

### 2.2 Color system (light + dark, exact hex, semantic tokens)

Design intent: a **warm-neutral "paper/ink" canvas** (continental, bank-adjacent, legible)
with a **single emerald→teal brand signal** and a **clearly separated destructive amber-red**
so danger never blurs with brand (the explicit Peer lesson). We keep the existing emerald/teal
brand hexes so the migration is a *rename*, not a recolor, on the brand axis.

#### Layer 1 — raw ramps (`ff-ramps`)

| Ramp | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **emerald** (brand) | `#ecfdf5` | `#d1fae5` | `#a7f3d0` | `#6ee7b7` | `#34d399` | **`#10b981`** | `#059669` | `#047857` | `#065f46` | `#064e3b` | `#022c22` |
| **teal** (brand-2) | `#f0fdfa` | `#ccfbf1` | `#99f6e4` | `#5eead4` | `#2dd4bf` | **`#14b8a6`** | `#0d9488` | `#0f766e` | `#115e59` | `#134e4a` | `#042f2e` |
| **ink** (dark neutrals) | `#fafafa` | `#f4f4f5` | `#e4e4e7` | `#d4d4d8` | `#a1a1aa` | `#71717a` | `#52525b` | `#3f3f46` | `#27272a` | `#18181b` | `#09090b` |
| **sand** (light neutrals, warm) | `#fbfaf8` | `#f5f3ee` | `#ece9e1` | `#dedacd` | `#c4bdab` | `#a39a82` | `#7d7665` | `#5c5648` | `#403c32` | `#2a2722` | `#1a1813` |
| **amber-red** (destructive) | `#fff1f0` | `#ffd9d4` | `#ffb3a8` | `#ff8a78` | `#ff6a52` | **`#f4502f`** | `#d83a1c` | `#b22d15` | `#8c2412` | `#6b1d10` | `#3d1009` |
| **amber** (warning) | `#fffbeb` | `#fef3c7` | `#fde68a` | `#fcd34d` | `#fbbf24` | **`#f59e0b`** | `#d97706` | `#b45309` | `#92400e` | `#78350f` | `#451a03` |
| **azure** (info, links) | `#eff6ff` | `#dbeafe` | `#bfdbfe` | `#93c5fd` | `#60a5fa` | **`#3b82f6`** | `#2563eb` | `#1d4ed8` | `#1e40af` | `#1e3a8a` | `#172554` |

Notes:
- **Brand emerald `#10b981` / teal `#14b8a6` are unchanged** from today's theme → the brand
  axis migration is a literal→token rename (zero visual delta), satisfying Gate 3's
  "pixels may shift only where a literal was *wrong*" rule.
- **Destructive is `amber-red #f4502f`**, deliberately distinct from both the brand (emerald,
  different hue entirely — no collision) *and* from `info`/`azure`. We do **not** reuse the
  old `#ef4444` pure red as brand-anything; it stays destructive-only. This directly fixes the
  Peer hazard and is also distinct from `warning` amber `#f59e0b` (red vs orange-yellow).
- Light neutrals are **warm "sand"**, not cool grey — the continental/paper read. Dark
  neutrals stay the existing cool **ink/zinc** scale (so dark mode is a rename of today).

#### Layer 2 — semantic tokens (`ffTokens(mode)`)

The token layer the components consume. Both modes defined; **dark is the rename of today's
theme, light is new.**

| Token | Light | Dark | Used for |
|---|---|---|---|
| `bg` (app canvas) | `#fbfaf8` (sand-50) | `#09090b` (ink-950) | `<body>` / `Background` base |
| `bgElevated` | `#f5f3ee` (sand-100) | `#0d0d0f` | behind the card |
| `surface1` (card) | `#ffffff` | `#18181b` (ink-900) | primary card fill |
| `surface2` (nested row / input) | `#f5f3ee` | `#1c1c1f` | input wells, summary rows |
| `surface3` (deepest inset) | `#ece9e1` (sand-200) | `#121214` | "send-to" / amount wells |
| `surfaceGlass` | `rgba(255,255,255,0.72)` | `rgba(24,24,27,0.80)` | glass card (existing dark value kept) |
| `border` | `rgba(42,39,34,0.12)` | `#27272a` (ink-800) | default 1px separators (existing dark value) |
| `borderStrong` | `rgba(42,39,34,0.20)` | `#3f3f46` (ink-700) | input borders, hover |
| `borderActive` | `rgba(16,185,129,0.55)` | `rgba(16,185,129,0.55)` | selected card / focus ring (existing) |
| `brand` | `#059669` (emerald-600, AA on white) | `#10b981` (emerald-500) | primary text-accent, links-on-brand |
| `brandStrong` | `#047857` | `#34d399` | hover, emphasis |
| `onBrand` | `#ffffff` | `#06251c` (near-ink, AA on emerald) | text on a brand fill |
| `text` | `#1a1813` (sand-950) | `#fafafa` (ink-50, existing) | primary text |
| `textSecondary` | `#5c5648` (sand-700) | `#a1a1aa` (ink-400, existing) | secondary text |
| `textTertiary` | `#7d7665` | `#71717a` (ink-500) | captions, "expires in" labels |
| `textDisabled` | `#a39a82` | `#52525b` (ink-600, existing) | disabled |
| **`destructive`** | `#d83a1c` (amber-red-600, AA on white) | `#ff6a52` (amber-red-400) | error text/icon, Cancel affordance |
| `destructiveBg` | `rgba(244,80,47,0.08)` | `rgba(255,106,82,0.10)` | error Alert fill |
| `destructiveBorder` | `rgba(244,80,47,0.22)` | `rgba(255,106,82,0.22)` | error Alert border |
| `warning` | `#b45309` (amber-700, AA) | `#fbbf24` (amber-300, existing) | warning text |
| `warningBg` | `rgba(245,158,11,0.10)` | `rgba(245,158,11,0.10)` | warning Alert (existing dark) |
| `success` | `#059669` | `#34d399` | success check (= brand; intentional) |
| `info` | `#2563eb` | `#60a5fa` | info Alert, neutral links |
| `glow1 / glow2 / glow3` | `rgba(16,185,129,0.10)` / `rgba(20,184,166,0.08)` / `rgba(6,182,212,0.05)` | same | ambient `Background` orbs (existing dark values reused for both modes) |

> **Contrast budget (heeding Peer's WCAG note).** Every text token above is chosen to clear
> **WCAG AA (4.5:1)** for body text on its intended surface (light brand uses emerald-**600**,
> not 500, on white; destructive uses 600 on white). The brand **gradient** is restricted to
> large display text and fills only — **never** small body text on either canvas. Status icons
> (`success`, `destructive`) are paired with a text label, never color-only.

#### Layer 3 — `theme.palette` mapping (what changes in `theme.ts`)

```ts
// theme.ts becomes mode-parametric: createFreefloTheme('light' | 'dark')
// palette references ffTokens(mode):
primary:   { main: t.brand,  light: ramps.emerald[400], dark: ramps.emerald[700], contrastText: t.onBrand },
secondary: { main: ramps.teal[500], light: ramps.teal[400], dark: ramps.teal[600] },
error:     { main: t.destructive, light: ramps['amber-red'][400], dark: ramps['amber-red'][600] }, // NOT #ef4444
warning:   { main: ramps.amber[500], light: ramps.amber[300], dark: ramps.amber[600] },
success:   { main: t.success, light: ramps.emerald[400], dark: ramps.emerald[600] },
info:      { main: t.info, light: ramps.azure[400], dark: ramps.azure[600] },
background:{ default: t.bg, paper: t.surface1 },
text:      { primary: t.text, secondary: t.textSecondary, disabled: t.textDisabled },
divider:   t.border,
```

Plus a **custom token bag** on the theme (`theme.ff = ffTokens(mode)`) for the values MUI's
palette doesn't model (surface2/3, glow, borderActive, destructiveBg). Components read
`theme.ff.surface2` etc. via `sx={(t) => ...}`.

#### Brand gradient (the one signature fill)

```
brandGradient        : linear-gradient(135deg, #10b981 0%, #14b8a6 100%)   // emerald → teal
brandGradientHover   : linear-gradient(135deg, #059669 0%, #0d9488 100%)
brandGradientText    : linear-gradient(90deg, #34d399 0%, #2dd4bf 100%)    // large display only
```

This is exactly today's `containedPrimary` gradient — kept, named, and reused. (We do **not**
flip direction on hover like Peer; we darken, which is calmer and AA-safe.)

### 2.3 Typography

**Two-face system, both via `next/font` (self-hosted, no FOUT, App-Router-safe):**

| Role | Face | Why | Weights |
|---|---|---|---|
| **Display / headings** | **Clash Display** (Fontshare/Indian Type Foundry) *or* **Space Grotesk** (Google) | A confident, slightly technical-geometric display with character — our own voice, **not** PP Valve (licensed, "Peer"). Clash Display is free for commercial use; Space Grotesk is the safe Google fallback (`next/font/google`, zero licensing). | 500, 600, 700 |
| **Body / UI / numbers** | **DM Sans** (existing) | Already loaded and shipping; excellent tabular numerals; shared-ecosystem-neutral. **No reason to change** — keep it. | 400, 500, 600, 700 |
| Mono (refs, IBAN, tx hash) | system mono stack | IBAN/amount/hash legibility | — |

> **Recommendation:** ship **Space Grotesk** for display (zero licensing risk, instant via
> `next/font/google`, geometric-technical character that pairs cleanly with DM Sans), and hold
> **Clash Display** as a brand-upgrade option if the team wants more personality and accepts a
> self-hosted `.woff2`. Either way **body stays DM Sans** (preserves the existing
> `typography.fontFamily` and all numeral rendering). Decision flagged in §8.

#### Type scale (concrete, px + line-height + weight + tracking)

A **named, semantic scale** (Jumper's discipline) added to `theme.typography`. Smaller and
calmer than Peer's loud 110px register — this is a focused wizard, not a brutalist hero.

| Token (MUI variant / custom) | Face | Size | Line-height | Weight | Tracking | Use |
|---|---|---|---|---|---|---|
| `h1` (`displayLg`) | Display | 40px | 44 (1.1) | 700 | −0.02em | Marketing / `/learn` hero only |
| `h2` (`displayMd`) | Display | 30px | 36 | 700 | −0.02em | Page title |
| `h3` (`displaySm`) | Display | 24px | 30 | 600 | −0.015em | Card / screen title ("Confirm Order") |
| `h4` | Display | 20px | 26 | 600 | −0.01em | Section heading |
| `amountXl` (custom) | Body (DM Sans) | 34px | 40 | 700 | −0.01em, **tabular** | The big "You send" amount |
| `amountLg` (custom) | Body | 22px | 28 | 700 | tabular | Summary-rail amounts, send-to amount |
| `bodyLg` | Body | 18px | 26 | 500 | 0 | Lead paragraph |
| `body1` (base) | Body | 16px | 24 | 400/500 | 0 | Default text |
| `body2` | Body | 14px | 20 | 400/500 | 0 | Secondary, helper |
| `label` (custom) | Body | 13px | 16 | 600 | +0.04em, UPPERCASE | Field labels, "YOU SEND" wells |
| `caption` | Body | 12px | 16 | 500 | 0 | Captions, "expires in" |
| `mono` (custom) | Mono | 13px | 18 | 500 | 0 | IBAN, tx hash, countdown |
| `button` | Body | 15px | — | 600 | 0, **sentence case** | All buttons (`textTransform:none`, existing) |

**Character decisions:**
- **Buttons are sentence case** (`textTransform: none`, already the theme default) — Jumper's
  register, *not* Peer's UPPERCASE +0.1em. Calmer, more bank-adjacent.
- **Field/well labels** are the one UPPERCASE element (`label` token), echoing the existing
  "YOU SEND" / "SEND TO" / "AMOUNT" caption treatment already in the code — we keep that, just
  tokenize it.
- **All amounts and countdowns use tabular figures** (`fontVariantNumeric: 'tabular-nums'`,
  already used in `StepItem`/`QuoteCard` — extend everywhere) so digits don't jitter as they
  tick.

### 2.4 Shape / radii

Keep the existing two-radius rhythm (the theme already uses 12 + 24). Name it and extend the
scale so chips/pills/wells are consistent.

| Token | px | Use | Maps to today |
|---|---|---|---|
| `radius.xs` | 4 | inner ticks, the speed line | — |
| `radius.sm` | 8 | chips, badges, small wells | `MuiChip` (8, existing) |
| `radius.md` | **12** | buttons, inputs, alerts | `shape.borderRadius` (12, existing) |
| `radius.lg` | 16 | nested cards, summary rail | — |
| `radius.xl` | **24** | the wizard card / widget shell | `MuiCard` (24, existing) |
| `radius.pill` | 9999 | progress bars, status pills, the countdown track | progress bar (`9999px`, existing) |

Silhouette: **`radius.xl` outer card + `radius.md` controls + `radius.pill` for status/progress**.
Buttons are **`radius.md` (12), not full pills** — a deliberate divergence from both references
(Peer + Jumper both use full pills). 12px rounded reads more "considered fintech form" than
"crypto pill," and it's already the theme value (zero migration cost).

### 2.5 Elevation / glass / glow

Three-tier system; **literal blur is reserved for the card + tooltips only** (Jumper's
restraint — full frosted-glass everywhere hurts legibility on a money app).

| Token | Light | Dark | Use |
|---|---|---|---|
| `elev.0` | none | none | flat rows, borderless surfaces |
| `elev.1` | `0 1px 2px rgba(42,39,34,0.06), 0 8px 24px rgba(42,39,34,0.06)` | `0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.45)` | the wizard card |
| `elev.2` | `0 4px 12px rgba(42,39,34,0.10)` | `0 8px 24px rgba(0,0,0,0.5)` | dialogs, popovers |
| `glassCard` | `surfaceGlass` + `backdrop-filter: blur(20px)` | same (existing dark) | the card fill (keep the existing 20px blur) |
| `litEdge` (inner highlight) | `inset 0 1px 0 rgba(255,255,255,0.6)` | `inset 0.6px 0.6px 0.1px rgba(255,255,255,0.06)` | faint top-left "lit edge" on cards/buttons (Peer's nice detail, toned down) |

**Glow (ambient background).** Keep the existing `Background` component's three blurred orbs +
faint grid (it's already a soft-aurora, glow-not-gradient approach — Jumper-aligned). Retune
the `/fiat-to-fiat` variant off blue → **teal/emerald** so both pages share the aurora family
(§4.3). In **light** mode the same orbs run at slightly lower opacity over the sand canvas
(values in the token table). The card sits over the aurora as the single focal object.

### 2.6 Spacing scale

Keep MUI's 8px base (`theme.spacing(1) = 8`); the codebase already uses `sx` multiples
(`gap: 2`, `p: 3`). Document the rhythm so it's deliberate:

```
4 (0.5) · 8 (1) · 12 (1.5) · 16 (2) · 20 (2.5) · 24 (3) · 32 (4) · 40 (5) · 48 (6) · 64 (8)
```

- Card padding: **24** (`p: 3`, existing).
- Inter-control gap inside a step: **20** (`gap: 2.5`).
- Row gap inside a summary block: **12** (`gap: 1.5`, existing).
- One decision per ~**20px** vertical rhythm; comfortable, not dense (Peer's density read).

### 2.7 Motion

**Principle: motion communicates state; it never decorates.** (Both references, and doubly
true for a money app.)

| Token | Value | Use |
|---|---|---|
| `motion.fast` | 120ms ease-out | hover, focus ring, chip select |
| `motion.base` | 200ms ease-out | screen content fade/slide, card hover (existing `0.2s` everywhere) |
| `motion.slow` | 500ms ease-in-out | progress-bar width (existing `500ms`), rail value changes |
| `motion.ring` | 1000ms linear, looped | the **countdown ring** sweep (the hero micro-interaction) |
| `motion.glow` | ~20s ease-in-out alternate | very slow ambient orb drift (optional; respects reduced-motion) |
| Easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` | the house ease-out |

- **Step transitions:** content cross-fades + 8px rise on step change (in-card, like Jumper —
  *not* full-page nav). The card itself never jumps size between steps; only its content swaps.
- **The two hero moments:** (1) the **countdown ring** on verify (a conic-gradient ring
  sweeping down over ~30s with a centered seconds number + lock — Peer's "money screen,"
  rebuilt as our `CountdownRing`), and (2) the **summary-rail amount** ticking when a quote
  resolves.
- **Success is quiet:** a soft scale-in (0.96→1, 200ms) of a single check inside a tinted
  circle. **No confetti** (both references; the audit's restraint mandate).
- **`prefers-reduced-motion`:** disable the ring sweep animation (show static ring + number),
  the glow drift, and the rise; keep instantaneous state changes. (Add to `MuiCssBaseline`.)

### 2.8 Iconography / illustration

- **Icons:** clean **monoline / outline** at 1.75–2px stroke (Peer + Jumper both). Use MUI's
  `@mui/icons-material` outline set already imported (`CheckCircleOutline`, `History`,
  `OpenInNew`, `RadioButtonUnchecked`, etc.) — extend with `LockOutlined` (verify),
  `ShieldOutlined` (trust), `AccessTime`/`Schedule` (clock), `SwapHoriz` (the flow), `Bolt`
  (speed). Status semantics: outline check = done, conic ring = in-progress, hollow circle =
  pending, filled `error` glyph = failed (the `StepItem` vocabulary, reused).
- **Provider glyphs (Venmo / Revolut / SEPA / USDC):** small rounded-square color glyphs, **own
  rendering, monoline-or-flat, not the providers' full logos** until licensing is confirmed
  (§8) — today the code renders an emoji (`PLATFORMS[x].icon`) or a bare letter "V"; replace
  with a consistent neutral glyph set so the product looks intentional and dodges trademark
  risk. The USDC badge in `OfframpInput` (the `#2775CA` `$` circle) is a good existing pattern
  to generalize.
- **Illustration:** **none beyond the aurora + glyphs.** No character art, no hero
  illustration in-product (it would undercut the "calm clearinghouse" trust posture). The
  brand carries on color + the flow-chevron + motion.

---

## 3. Component library

> **Convergence goal.** One kit serves **both** surfaces. The `/` offramp side is already
> well-factored (`StepItem`, `QuoteCard`, `OfframpWidget`, `executionStore`) — so the kit is
> defined as *"evolve the offramp component, then have `/fiat-to-fiat` adopt it."* Each
> primitive below names the file it reuses/evolves. **All primitives are pure presentational
> components** (props in → JSX out, no `useState`/wagmi/`localStorage`) so they're safe under
> the rules-of-hooks invariant (INV-13 / HS-4) when the monolith's view is rebuilt at Gate 4.

| # | Primitive | Reuses / evolves (existing) | What changes | Used by |
|---|---|---|---|---|
| 1 | **`Surface` / `AppCard`** | `MuiCard` override in `theme.ts`; the inline card shells in `FiatToFiatFlow:1129` & `OfframpInput:175` | One component for "the wizard shell": `surfaceGlass` + `radius.xl` + `litEdge` + `elev.1`. Replaces the two divergent hand-rolled shells. | both |
| 2 | **`Button`** (primary / secondary / ghost / destructive) | `MuiButton` override; the ~15 inline `<Button sx>` CTAs across both files | 4 variants: **primary** = `brandGradient` fill (existing `containedPrimary`), **secondary** = `surface2` + border, **ghost** = text-only, **destructive** = `destructive` text + `destructiveBorder` outline (the existing "Cancel Intent" treatment, tokenized). `radius.md`, sentence case. | both |
| 3 | **`Field` / `MoneyInput`** | `MuiTextField` override; the inline `component="input"` amount/IBAN/name fields (`FiatToFiatFlow:1336/1368/1379`) and `OfframpInput` `TextField`s | A labeled input well (`surface3`, `label` token, emerald focus ring). **`MoneyInput`** = the big-amount variant (`amountXl`, currency adornment) unifying `OfframpInput`'s amount field and the cross-border "You send" well. | both |
| 4 | **`Select`** | the raw `component="select"` platform/currency pickers (`FiatToFiatFlow:1280/1306`) and `OfframpInput`'s `ToggleButtonGroup` | A styled MUI `Select`/`ToggleButtonGroup` with flag/glyph + label; consistent chevron, `surface3` fill, emerald-selected (existing `MuiToggleButton` override). | both |
| 5 | **`StepRow` + `Stepper`** | **`StepItem.tsx`** (status icon + label + elapsed + error + tx link) + `OfframpExecution`'s `steps.map` | `StepRow` = `StepItem` *as-is* (it already consumes the `ExecutionStep` model and is excellent). `Stepper` = a thin wrapper that also renders an optional **phase header** (the 4-phase chips, §4) above the rows. The cross-border flow adopts this, retiring its bespoke two-bar header (`FiatToFiatFlow:1130`). | both |
| 6 | **`QuoteCard`** | **`QuoteCard.tsx`** (speed gradient line, speed chip, solver, fee, selection check, skeleton, empty) | Reuse wholesale for `/`. For `/fiat-to-fiat`'s maker list (today a hand-rolled `<Button>` at `:1432`), add a **`MakerCard`** variant of the same component that renders a **reputation chip instead of a raw handle** (§5.4) and "you receive USDC / for fiat." Same skeleton + empty-state. | both |
| 7 | **`StatusScreen`** | the five near-identical centered-spinner blocks (`finding_quotes`, `authenticating`, `fulfilling`, `router_waiting`, `freeflo_pending`) | One component: centered icon/spinner (or `CountdownRing`), title, subtitle, optional escape-hatch slot. Collapses 5 copies into 1 with props. | mainly `/fiat-to-fiat` |
| 8 | **`SummaryRow` + `SummaryRail`** | the repeated "label / value space-between" blocks (`FiatToFiatFlow:1469`, `:1681`, `:1744`; `OfframpExecution:153`) | `SummaryRow` = one `label → value` line (tabular value). **`SummaryRail`** = the persistent transfer-summary header (§4.2), built from `SummaryRow`s + the live clock. | both |
| 9 | **`Chip` / `Badge`** | `MuiChip` override; `QuoteCard`'s speed chip; `OfframpInput`'s reclaimable `Badge` dot | Variants: **speed** (instant/fast/standard — existing gradient/chip config), **status** (pending/done/failed), **reputation** (the maker chip — new), **phase** (the 4 IA phases). `radius.sm`. | both |
| 10 | **`Notice` (Alert/Toast)** | `MuiAlert` usages (`FiatToFiatFlow:1180/1215/1483/1702`); `OfframpExecution:104` | One `Notice` with `kind: info | warning | error | success`, each mapped to the destructive/warning/info tokens (so error is amber-red, never brand). **Carries the action slot** (the Cancel + Dismiss buttons live here). Toasts use the same visual language, anchored top (Jumper's `top:80px`). | both |
| 11 | **`CountdownRing`** | the existing `useCountdown` + `formatCountdown` (`FiatToFiatFlow:255/277`); the deadline banner (`:1157`) | **New hero component.** A conic-gradient ring (`radius.pill` track) that sweeps as seconds elapse, with a centered tabular number + a `LockOutlined` glyph for the verify step. Two skins: **verify** (lock, ~30s, "Verifying your payment") and **deadline** (clock, MM:SS, turns `destructive` < 120s — the existing red-threshold behaviour, INV-7). Pure presentational; takes `remaining`/`total` from the hook. | both |
| 12 | **`RiskGate`** | *new* (no equivalent today) | A checkbox + label that gates a CTA: *"I understand this payment is real and cannot be reversed…"* (Peer's "permanent loss of funds" pattern). Used at the fiat-send and commit moments (§5.6, §5.10). | `/fiat-to-fiat`; optionally `/` commit |
| 13 | **`DoDontList`** | *new* (no equivalent today) | A do/don't checklist (green ✓ / `destructive` ✕ rows) for the send-fiat instructions (Peer's pattern, SEPA/Venmo-localized). | `/fiat-to-fiat` send step |
| 14 | **`AppShell`** (Header / Footer / Background) | `Header.tsx`, `Footer.tsx`, `Background.tsx` | Restyle to the token system + wordmark/glyph (§2.1); **keep the `variant` prop API** (consumed by both pages) and the `suppressHydrationWarning` layout (HS-1) untouched. | both |

**Kit principle:** a primitive is added only when it removes duplication that exists *today*
(the table's "reuses" column proves each one earns its place). Net effect: `FiatToFiatFlow`'s
202 inline `sx` blocks collapse into ~14 reused primitives, and both surfaces finally render
from one vocabulary.

---

## 4. Information architecture

### 4.1 Regroup the 14 `FlowStep`s into 4 user-meaningful phases

The 14 internal states (INV-1) are an *engineering* truth and **must not be renamed** (HS-7:
their string values are referenced in poller `enabled` flags, persistence skip/remap arrays,
`getProgress`, and resume lists — renaming silently breaks a poller). So the IA is a **display
projection over the unchanged states**, computed in the hook's `derived.progress` (the audit's
proposed return shape already has `progress`). The user never sees 14 steps — they see **4
phases**:

| Phase (user sees) | Internal `FlowStep`s (unchanged) | One-line meaning to the user |
|---|---|---|
| **1 · Set up** | `select_flow`, `input_all`, `finding_quotes`, `select_maker` | "Tell us the amount and where the euros go; pick a partner." |
| **2 · Pay & prove** | `zkp2p_signal`, `zkp2p_send_venmo`, `zkp2p_verify`, `zkp2p_authenticating`, `zkp2p_select_payment`, `zkp2p_fulfilling` | "Lock the order, make your payment, prove it (the ~30s wait)." |
| **3 · Convert** | `router_waiting`, `router_commit`, `freeflo_pending` | "We turn it into euros and you confirm the SEPA quote." |
| **4 · Done** | `success` | "Euros are on the way." |

This maps cleanly onto the existing `getProgress` 2-stage split (it already groups stage-1 =
ZKP2P and stage-2 = FreeFlo) — we simply present it as **4 labeled phases** in the rail
(Set up → Pay & prove → Convert → Done) instead of "Stage 1 of 2 · Venmo USD → USDC". The
phase chips light up as you advance; the active phase is emerald, completed phases show a
check, future phases are muted. `error` is **not** a phase (it's a flag, INV-1/INV-12) — it
renders as a `Notice`, never as a stuck dead-end phase.

> **Invariant note:** the projection is read-only over `step`; it adds **zero** new state and
> renames **zero** `FlowStep` literal. Preserves INV-1 and HS-7.

### 4.2 The persistent transfer-summary rail

The single most-borrowed pattern (Jumper's "reaffirmed summary card" + the audit's
recommendation). A **`SummaryRail`** pinned to the top of the wizard card on **every** step
from `input_all` onward (hidden only on `select_flow` and folded into the `success` card):

```
┌────────────────────────────────────────────────────────────┐
│  ⟫⟫  $250.00  ──▶  ≈ €228.50      ⟦ Phase 2 · Pay & prove ⟧ │   ← amounts (tabular) + phase chip
│  to  Anna Müller · DE89…0130 00            ⏱ 12:48          │   ← recipient (masked IBAN) + live clock
└────────────────────────────────────────────────────────────┘
```

- **Left:** flow-chevron glyph, **amount in** (USD/selected fiat) → **amount out** (EUR;
  shows `≈` estimate until a quote resolves, then the firm `quotedEurAmount`).
- **Right:** the **phase chip** (§4.1) and, once `routerIntentCreatedAt` exists, the **live
  deadline clock** (`deadlineRemaining` from `useCountdown`, INV-7) — turning `destructive`
  under 120s, exactly as the existing banner does.
- **Recipient line:** masked IBAN + name (privacy: show first 4 + last 5, like today's
  `:1480` slice).
- It is **presentational only** — fed entirely by `f.flowData` + `f.derived` from the hook.
  Replaces the bespoke progress header (`:1130-1175`) *and* removes the need to repeat the
  "you send / you receive / destination" block inside `zkp2p_signal` and `router_commit`
  (those screens keep a fuller breakdown only where a decision needs it).

### 4.3 App shell (Header / Footer / Background)

- **Header (`Header.tsx`):** swap `BoltIcon` lozenge → the **flow-chevron** + the **`freeflo`
  wordmark** (or chosen name, §8). Keep the nav (`USDC Offramp` / `Fiat to Fiat`) and the full
  RainbowKit `ConnectButton.Custom` block **untouched** (it's load-bearing wallet UX). Retune
  `gradientFrom/To`: today `/fiat-to-fiat` = **blue→emerald** (`#3b82f6`→`#10b981`), which
  makes it look like a different product. Change cross-border to **teal→emerald**
  (`#14b8a6`→`#10b981`) so both surfaces are one family; keep `/` as emerald→teal. This is a
  ~2-line token change.
- **Background (`Background.tsx`):** keep the orbs + grid; retune the `blue` variant → a
  **teal** variant (rename `variant="blue"` callers to `variant="crossborder"` and point it at
  teal/emerald orbs). Add light-mode orb opacities (token table). **Keep `position:fixed;
  inset:0; zIndex:0`** so it stays behind everything.
- **Footer (`Footer.tsx`):** restyle to tokens; add a small **light/dark toggle** if we ship
  both modes (§8), plus links to `/learn` (where the cryptography story lives — the "docs carry
  the proof" pattern).
- **Theme provider + RainbowKit bridge (`app/providers.tsx`):** the RainbowKit
  `darkTheme({ accentColor: "#10b981" })` must stay aligned to `brand`. If we ship light mode,
  add `lightTheme({ accentColor: brand-600 })` switched off the same mode signal. **The root
  `suppressHydrationWarning` on `<html>` + `<body>` (HS-1, INV — PeerAuth injects
  `data-peer-injected`) is immutable** — the shell restyle must not touch `app/layout.tsx`'s
  attributes.

---

## 5. Screen-by-screen — `/fiat-to-fiat`

> Conventions for the wireframes below: `▓` = brand-filled (gradient) primary button; `[ … ]`
> = ghost/secondary button; `◔` = countdown ring; `⟫⟫` = flow-chevron glyph; the **rail** is the
> §4.2 `SummaryRail`. Each screen lists the **invariant(s) it must preserve** — these are the
> behavioural contracts the new view wires to via `f.*` (the hook), never reimplements.
>
> **Every screen is a pure render of `f = useFiatToFiatFlow()`** (the audit's headless hook).
> Buttons call `f.actions.*`; values read `f.flowData` / `f.derived`. No screen owns state,
> contract calls, refs, or `setStep`. This is what makes the reskin safe (Gate 4).

### 5.1 `select_flow` — choose the corridor

```
┌──────────────────────────────────────────────────────┐
│            Send money across the border               │   h3 (display)
│      Pay with Venmo (US) · receive EUR by SEPA        │   body2 secondary
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  ⟫⟫  Venmo USD   ───▶   € SEPA EUR                │ │   the corridor card
│  │      US payment          European bank             │ │   (CardActionArea)
│  │ ────────────────────────────────────────────────  │ │
│  │   Estimated time         2–5 minutes               │ │
│  │   No middleman · you keep custody until you pay    │ │   ← outcome-first trust line
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ⓘ  A free browser helper proves your payment.        │   ← only if extensionState ≠ ready
│      Add it → (one-time)                               │      (NO "ZK/extension" jargon)
│                                                        │
│              [ ▓  Start a transfer  ]                  │
└──────────────────────────────────────────────────────┘
```

- The corridor becomes a real **`CardActionArea`** (today it's a `<Button>` with nested
  flex). The extension check (`extensionState === "needs_install"`, INV-2) renders as a calm
  `Notice` with an "Add it →" link to `PEER_EXTENSION_CHROME_URL` — framed as "a free browser
  helper," **never** "ZK extension."
- **Invariants:** INV-2 (extension state surfaced, not silently advanced); the rail is hidden
  here.

### 5.2 `input_all` — amount + currency + IBAN + name

```
┌──────────────────────────────────────────────────────┐
│  Set up your transfer                          1 of 4 │   h3 + phase
│  Choose how much, and where the euros land            │
│                                                        │
│  Pay with          Currency                            │
│  [ ⟐ Venmo    ▾ ]  [ 🇺🇸 USD  ▾ ]                       │   Select primitives
│                                                        │
│  ┌── YOU SEND ───────────────────────────── USD ──┐   │   MoneyInput (amountXl)
│  │  $   250.00                                      │   │
│  │  [ $50 ] [ $100 ] [ $250 ] [ $500 ]              │   │   quick-amount chips
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Recipient IBAN                                        │
│  [ DE89 3704 0044 0532 0130 00            ]           │   Field (mono)
│  Recipient name                                        │
│  [ Anna Müller                            ]           │   Field
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Estimated euros received        ≈ €228.50  ↗     │ │   estimate well (only when amt>0)
│  │  Price protection                 2% slippage      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│              [ ▓  Find partners  ]                     │   (today: "View Sellers")
└──────────────────────────────────────────────────────┘
```

- Platform/currency → **`Select`**; amount → **`MoneyInput`** with quick-amount `Chip`s
  (existing `QUICK_AMOUNTS`); IBAN/name → **`Field`**. The estimate well reuses
  `calculateEstimatedEur` (display-only).
- Validation mirrors `handleInputSubmit` exactly (amount > 0, IBAN ≥ 15, name ≥ 2) — but
  surfaced **inline per-field** (like `OfframpInput`'s helperText) instead of a single error
  string, and the CTA disables until valid (existing `disabled` logic).
- **Invariants:** the slippage → `minEurAmount` (INV-12) and the encoded values flow unchanged
  into `flowData`; no logic here, just bindings.

### 5.3 `finding_quotes` — searching

```
            ┌───────────────────────────────┐
            │   ◔  (indeterminate sweep)     │   StatusScreen
            │   Finding partners…            │
            │   Checking Venmo liquidity     │
            └───────────────────────────────┘
```

`StatusScreen` with an indeterminate `CountdownRing` (or spinner). Copy: *"Finding partners…
/ Checking {platform} liquidity"* (existing). **Invariants:** none beyond not advancing on
empty (handled in hook → returns to `input_all` with a `Notice`).

### 5.4 `select_maker` — pick a partner (reputation chip, NOT a raw handle)

> **Heeds Peer's "don't leak maker handles."** Today this screen renders
> `Deposit #{depositId}` + raw rate. The redesign renders each maker as a **`MakerCard`**
> (a `QuoteCard` variant) with a **reputation chip**, never an `@handle` or a raw deposit id.

```
┌──────────────────────────────────────────────────────┐
│  Choose a partner                              1 of 4 │
│  Who fronts the USDC for your $250.00                 │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ▏ ✦ Trusted partner   · 4.9 ★         249.75 USDC │ │   ← reputation chip (not @handle)
│  │   Instant · pays from balance         for $250.00 │ │   speed line (gradient top edge)
│  └──────────────────────────────────────────────────┘ │   ← BEST → emerald "Best rate" badge
│  ┌──────────────────────────────────────────────────┐ │
│  │ ▏ ◆ Verified partner  · 4.7 ★         249.50 USDC │ │
│  │   Instant                              for $250.00 │ │
│  └──────────────────────────────────────────────────┘ │
│  … (top 4; rest collapsed under "Show more")           │
└──────────────────────────────────────────────────────┘
```

- **Reputation chip** derives from data we *have* without exposing identity: liquidity tier +
  payment method + a derived trust label (`Trusted` / `Verified` / `New`) computed from
  deposit size / rate competitiveness. The raw `payeeUsername`/`payeeDetails` is **never**
  shown here (it's only revealed on the *send* screen as "who to pay," where the user needs
  it). The best quote gets an emerald **"Best rate"** badge (Peer/Jumper "BEST"/"Best Return"
  pattern, recolored to brand-emerald — *not* a red delta).
- `MakerCard` = `QuoteCard` shape (gradient speed line, chip, right-aligned amount, selection
  check, skeleton, empty state) — so the maker list and the `/` quote list look identical.
- **Invariants:** `handleSelectMaker` unchanged (sets `zkp2pQuote`, `usdcAmount`,
  `venmoPayee`, triggers lazy `resolvePayeeUsername`); INV-3 (the selected quote's fields feed
  signalIntent). The "don't render undefined" rule (Peer §9.7) is enforced: no field renders
  raw — every value has a humane fallback.

### 5.5 `zkp2p_signal` — confirm & lock the order

```
┌──────────────────────────────────────────────────────┐
│  ⟫⟫  $250.00 ─▶ ≈ €228.50   to Anna · DE89…00   [rail]│
├──────────────────────────────────────────────────────┤
│  Confirm your order                            2 of 4 │
│  We'll lock the partner's USDC for your transfer      │
│                                                        │
│  ┌── Order ─────────────────────────────────────────┐ │   SummaryRow group
│  │  You pay            $250.00 via Venmo             │ │
│  │  Partner fronts     249.75 USDC                   │ │
│  │  You receive        ≈ €228.50 by SEPA            │ │
│  │  To                 Anna Müller · DE89…0130 00   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ⓘ Your bank details are sealed on-chain. After you   │   Notice (info)
│    pay and prove it, the USDC converts to euros        │
│    automatically.                                      │
│                                                        │
│            [ ▓  Lock order  ]   ⟳ signing…             │   (today: "Signal Intent")
└──────────────────────────────────────────────────────┘
```

- One **`SummaryRow` group** + an info `Notice`; the CTA shows a spinner while `isSignaling`
  (existing). This is the first **wallet signature** — the copy says "Lock order," not "Signal
  Intent" (plain verb).
- **Invariants (critical):** INV-3 — `handleSignalIntent` must submit the **exact
  `referralFees`** the gating service signed (mandatory protocol fee; omission reverts
  `InvalidSignature`), and the hook payload must stay the **single tuple**
  (`encodeHookPayload`); the `IntentSignaled` log → `zkp2pIntentHash` extraction is unchanged.
  The view only calls `f.actions.signalIntent()`. INV-12 (the 409 path) surfaces as the error
  `Notice` with a Cancel action if a stale intent exists.

### 5.6 `zkp2p_send_venmo` — make the real payment (irreversibility + do/don't + risk gate)

> **The gravity screen #1.** A real, irreversible fiat payment. This is where we deliberately
> break the calm (Peer's behavioural-guardrail pattern, fully adopted).

```
┌──────────────────────────────────────────────────────┐
│  ⟫⟫  $250.00 ─▶ ≈ €228.50   to Anna · DE89…00   [rail]│
├──────────────────────────────────────────────────────┤
│  Send your Venmo payment                       2 of 4 │
│  Open Venmo and pay the partner exactly this           │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  SEND TO                                          │ │   surface3 well, amountLg
│  │  @partner-handle                          [copy]  │ │   ← the ONE place the handle shows
│  │  AMOUNT                                           │ │
│  │  $250.00                                  [copy]  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  Before you pay:                                       │   DoDontList
│   ✓ Send exactly $250.00 in one payment                │
│   ✓ Pay from your Venmo balance (so it confirms fast)  │
│   ✓ Use a personal account                             │
│   ✕ Don't add a note mentioning crypto/FreeFlo         │
│   ✕ Don't pay from a bank/eCheck (can clear too late)  │
│                                                        │
│  ⚠ This sends real money and cannot be reversed.       │   destructive-tinted line
│  [ ☐ ]  I've sent exactly $250.00 to the partner       │   RiskGate (gates the CTA)
│                                                        │
│        [ ▓  I've sent the payment  ]  (disabled→)      │
│        [ ⌫  Cancel & reclaim  ]                         │   destructive ghost (INV-9)
└──────────────────────────────────────────────────────┘
```

- The **handle** (`formatPayee(zkp2pQuote.payeeUsername)`) appears **only here**, with a copy
  affordance, plus a copyable amount — this is the one moment the user needs the counterparty's
  raw id. Humane fallback preserved (`"seller (handle unavailable)"`, never "@unknown").
- **`DoDontList`** = Peer's checklist, localized to Venmo/SEPA (exact amount, single payment,
  personal account, no crypto note, no bank/eCheck). **`RiskGate`** = the risk-ack checkbox
  gating "I've sent the payment" — *new*, the audit/Peer's "permanent loss" pattern adapted.
- **Cancel & reclaim** is the prominent escape hatch (INV-9 — `handleCancelIntent`, returns to
  `select_maker`). It must remain reachable here.
- **Invariants:** INV-9 (cancel reachable); the CTA calls `f.actions.markVenmoSent()` →
  `zkp2p_verify` (existing `handleVenmoSent`). No new logic — the gate/list are pure view.

### 5.7 `zkp2p_verify` / `zkp2p_authenticating` — the two-tier TEE stepper (bounded, locked, jargon hidden)

> **The crux — Peer's gold-standard pattern, rebuilt as ours.** A horizontal 3-node phase
> stepper **+** an inner vertical timeline, with a **bounded countdown + lock**, and **all
> crypto vocabulary hidden** (no "zkTLS / TLSNotary / TEE / attestation / zero-knowledge").
> The existing screen literally prints *"Zero-knowledge proof — your data stays private"* —
> we **remove** that and the "ZKP2P extension" naming.

**`zkp2p_verify` (ready to prove):**

```
┌──────────────────────────────────────────────────────┐
│  ⟫⟫  $250.00 ─▶ ≈ €228.50   to Anna · DE89…00   [rail]│
├──────────────────────────────────────────────────────┤
│  Prove your payment                            2 of 4 │
│                                                        │
│   ● Pay ───────── ◎ Verify ───────── ○ Convert        │   horizontal 3-node stepper
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │   inner vertical timeline:
│  │  ✓  Payment sent          $250.00                 │ │   done (green check)
│  │  ◎  Verify your payment   ⟶ up to ~30s            │ │   current (lock + ring slot)
│  │  ○  Receive euros                                 │ │   pending (hollow)
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  🔒 We check your payment privately. Nothing leaves    │   trust line — NO "ZK/TEE"
│     your device unencrypted.                           │
│                                                        │
│   (extension state →)                                  │
│   • ready:         [ ▓  Verify payment  ]              │
│   • needs_connect: [ ▓  Connect helper  ] then Verify  │
│   • needs_install: ⓘ Add the helper → , then reload    │
│   [ ⌫  Cancel & reclaim ]                               │   (INV-9)
└──────────────────────────────────────────────────────┘
```

**`zkp2p_authenticating` (extension capture in progress):** same frame, the **`Verify`** node
becomes a live **`CountdownRing` (lock skin, ~30s)** with the centered seconds number; copy:
*"Finishing sign-in… your recent payments will load here."* A `Back` ghost returns to
`zkp2p_verify` (existing `goToVerify`).

- **Two-tier structure** = Peer's exact skeleton: horizontal `Pay → Verify → Convert` nodes
  (mapping our phases) + the inner timeline (`Payment sent ✓ → Verifying ◔ → Receive euros ○`).
  Built from `Stepper` + `StepRow` + `CountdownRing`.
- **Crypto vocabulary HIDDEN.** Replace "Zero-knowledge proof…", "ZKP2P extension", "Peer
  extension", "Verify with ZKP2P" → "Prove your payment", "browser helper", "Verify payment."
  The lock + "~30s" + "checked privately" carries the entire trust message (Peer's insight).
- **Invariants (the riskiest):** INV-2 — the **subscribe→authenticate→receive-metadata→fulfill
  ordering and the `metadataUnsubRef` lifecycle are untouched**; the view only calls
  `f.actions.verifyPayment()` / `f.actions.connectExtension()`. INV-12 — the **extension-ready
  hard gate** stays (no silent advance into an unobservable poll loop); the three extension
  states drive which CTA shows. INV-9 — cancel reachable. HS-2 — the unsub ref lives in the
  hook, never in render-conditional JSX.

### 5.8 `zkp2p_select_payment` — pick the payment to prove (TEE rows as cards, expected-amount match highlighted)

```
┌──────────────────────────────────────────────────────┐
│  [rail]                                                │
├──────────────────────────────────────────────────────┤
│  Which payment was it?                         2 of 4 │
│  Pick the payment you just made — we verify it         │
│  privately.                                            │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │   payment cards (not bare buttons)
│  │ ✓ matches  $250.00   →  partner      8:54 AM      │ │   ← expected-amount MATCH highlighted
│  └──────────────────────────────────────────────────┘ │      (emerald borderActive + "matches")
│  ┌──────────────────────────────────────────────────┐ │
│  │   $40.00    →  someone else          Yesterday    │ │   non-matching: muted
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ⟳ Refresh payments                                    │   ghost (re-runs verify)
└──────────────────────────────────────────────────────┘
```

- Each row from `verifyData.rows` becomes a **proper card** (today they're bare `<Button>`s).
  The row whose amount equals the expected `flowData.usdAmount` gets an **emerald
  `borderActive` + a "✓ matches" chip** — the "expected-amount match highlighted" requirement,
  reducing mis-selection (a real risk: picking the wrong payment fails the proof).
- Empty state: *"No payments found yet. Finish the payment, then Refresh."* (existing copy,
  calmer). **Invariants:** INV-2 — `handleSelectAndFulfill(row)` builds the `buyerTee` proof
  (`encryptedSessionMaterial`, `params.index = originalIndex`) unchanged; on error returns here
  (INV-12). View calls `f.actions.selectAndFulfill(row)` only.

### 5.9 `zkp2p_fulfilling` — releasing USDC

```
            ┌───────────────────────────────┐
            │   🔒 ◔  (ring, ~bounded)        │   StatusScreen + CountdownRing(lock)
            │   Confirming your proof…       │
            │   Releasing USDC and starting  │
            │   your euro conversion         │
            │   [ ⌫ Stuck? Cancel & reclaim ]│   ← escape hatch (INV-9, fulfilling)
            └───────────────────────────────┘
```

- `StatusScreen`; **the escape hatch is mandatory here** — the extension drives proof +
  fulfill off-screen, so "Stuck? Cancel & reclaim" (INV-9, the `zkp2p_fulfilling`-specific
  `handleCancelIntent`) rescues the "extension errored off-screen" dead-end. Crypto vocabulary
  stays hidden ("Confirming your proof," not "fulfillIntent / TLSNotary").
- **Invariants:** INV-4 (the **TransferInitiated poller** is the *only* exit → `router_waiting`,
  enabled by `step === "zkp2p_fulfilling"` — the renamed-step hazard HS-7 means this string is
  untouched); INV-9 (cancel).

### 5.10 `router_waiting` → `router_commit` — confirm the SEPA quote (gravity #2)

**`router_waiting`:** `StatusScreen` — *"Preparing your euro quote… a FreeFlo partner is
quoting your rate."* (poller/quote-poll effect, INV-4/INV-8). Rail shows the live deadline
clock now that `routerIntentCreatedAt` exists.

**`router_commit`:**

```
┌──────────────────────────────────────────────────────┐
│  ⟫⟫ $250.00 ─▶ €228.50  to Anna · DE89…00  ⏱ 04:12   │   rail w/ deadline (turns red <2m)
├──────────────────────────────────────────────────────┤
│  Confirm your euro transfer                    3 of 4 │
│  Lock in this quote and we send the SEPA payment       │
│                                                        │
│  ┌── Quote ─────────────────────────────────────────┐ │
│  │  USDC deposited        249.75 USDC                │ │
│  │  You receive           €228.50          (firm)    │ │
│  │  To                    Anna Müller                │ │
│  │  IBAN                  DE89 3704 … 0130 00        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ⚠ Quote window closes in 04:12. Confirm to send.      │   warning Notice (<5m, existing)
│  ⚠ This sends euros to the bank account above.         │   irreversibility line
│  [ ☐ ]  Send €228.50 to Anna Müller                    │   RiskGate (commit)
│                                                        │
│        [ ▓  Confirm & send euros  ]                    │   disabled when deadline=0 (INV-7)
└──────────────────────────────────────────────────────┘
```

- Full **`SummaryRow` group** (a decision needs the full breakdown here, not just the rail) +
  the **deadline warning** (`< 300s` warning, `=0` error — existing INV-7 thresholds) + a
  **`RiskGate`** confirming the euro amount + destination. The CTA **hard-disables at expiry**
  (`deadlineRemaining === 0`, INV-7 — committing a stale quote reverts `QuoteWindowClosed`).
- **Invariants:** INV-7 (countdown gates commit), INV-8 (`commit(solver)` via
  `FIAT_TO_FIAT_ROUTER_ADDRESS`; **no EUR amount passed** — slippage enforced on-chain),
  INV-12 (slippage). View calls `f.actions.commitRouter()`.

### 5.11 `freeflo_pending` → `success`

**`freeflo_pending`:** `StatusScreen` — *"Sending euros to your bank… usually 10–15 seconds."*
(existing). **Invariant:** INV-4 (the **IntentFulfilled poller** is the only exit → `success`,
enabled by `step === "freeflo_pending" && routerIntentId`).

**`success` (restrained, no confetti):**

```
┌──────────────────────────────────────────────────────┐
│                       ⟢ ✓                              │   soft scale-in check in tinted circle
│              Euros are on the way                      │   h3
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  You sent          $250.00 via Venmo              │ │   SummaryRow group
│  │  Anna receives     €228.50 by SEPA               │ │
│  │  Reference         DE89…0130 00                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│         [ ▓  Start another transfer  ]                 │   (today: "Start New Transfer")
│         [ ↗  View on Basescan ]                         │   ghost (if tx hash available)
└──────────────────────────────────────────────────────┘
```

- A single check scaling in (no confetti — both references + audit). Rail folds into the
  summary. Optional explorer deep-link (Jumper/Peer pattern; only if a tx hash is on hand).
- **Invariants:** INV-5 (`success` **removes** the `flowStorageKey` — persistence cleared, as
  the existing write effect does); `resetFlow` on "Start another" clears `flowData` + the
  storage key + the metadata unsub (HS-2/HS-3).

### 5.12 Error / empty states — FIRST-CLASS recovery flows

> The audit is explicit: FreeFlo's failure modes are scarier than Jumper's, and **this is
> where FreeFlo must exceed both references** — not ship happy-path-only. Every error answers
> the four questions: *what happened · is my money safe · what do I do now · can I
> retry/cancel/reclaim.* All render through one **`Notice` (error)** with an **action slot**,
> recolored to **`destructive` (amber-red)** so danger never blurs with brand. The error
> string ↔ affordance coupling (HS-8) is preserved: the **Cancel action shows when the error is
> the active-intent kind AND a `zkp2pIntentHash` exists** (today a string match on
> `"active intent"/"active order"` — the hook should expose a structured `error.kind` so the
> affordance keys off `kind`, not copy; until then the magic strings are frozen).

| State | Trigger (real) | What the user sees | Recovery action | Invariant |
|---|---|---|---|---|
| **Fiat sent, proof failed** | `handleSelectAndFulfill` throws → returns to `zkp2p_select_payment` (INV-12) | `Notice`: *"We couldn't verify that payment. Your money is safe — pick the payment again, or reclaim your order."* | **Re-pick** (stay) · **Cancel & reclaim** (INV-9) | INV-2/9/12 |
| **Expired intent / quote-window closed** | `deadlineRemaining === 0` (INV-7); on-chain `QuoteWindowClosed` | `Notice` + rail clock = **EXPIRED**; commit CTA disabled | *"This quote expired. Reclaim your USDC from the router."* → reclaim / `rescueTimedOut` path | INV-7/8 |
| **409 active order** | `signalIntent` err contains `409`/`active order` (INV-12) | `Notice`: *"You already have an order in progress."* | **Cancel intent** action (shown because hash exists) · **Dismiss** | INV-9/12, HS-8 |
| **Extension not ready** | `extensionState ≠ ready` at verify (INV-12 hard gate) | `Notice` (not a dead end): install vs connect variants | **Add helper →** / **Connect helper** then Verify | INV-2/12 |
| **Slippage exceeded** | on-chain revert at commit (min-EUR not met) | `Notice`: *"The euro amount moved past your 2% protection."* | **Refresh quote** (re-enter `router_waiting`) · reclaim | INV-12 |
| **WASM "too much memory"** | TEE prover OOM in-extension (Peer §9.8 leaked string class) | `Notice`: *"Your browser ran low on memory while proving. Close other tabs and try again."* — **never** surface the raw WASM string | **Retry verify** · **Cancel & reclaim** | INV-2/9 |
| **No makers / no quotes** | `fetchZkp2pQuotes` empty → back to `input_all` | inline `Notice` on `input_all` (existing copy) | **Try a different amount/platform** | — |
| **Resume-from-pending** | `getPendingTransfer` PENDING on load (INV-6) | jumps straight into the rail at `router_commit`/`router_waiting` with a *"Welcome back — finish your transfer"* banner | continue commit | INV-5/6 |

**Recovery principle (Peer's blameless voice):** every error is plain, names whether funds are
safe, and **always pairs with a concrete next action** (retry / reclaim / connect). No stack
traces, no jargon, no raw dev strings ever reach the user (Peer §9.8).

---

## 6. Offramp `/` alignment

The `/` surface is already well-factored (the audit calls it the *target* architecture:
`useExecuteOfframp` + `executionStore`/`formStore`, thin views). It needs **token adoption +
primitive convergence**, not restructuring. How it adopts the system:

| `/` piece | Adopts |
|---|---|
| `OfframpWidget` (connected/disconnected + view switch) | becomes the canonical **`AppShell` card** pattern that `/fiat-to-fiat` also uses; the disconnected-state card uses `Surface` + the flow-chevron lockup. |
| `OfframpInput` (You send / You receive / recipient / quotes) | amount field → **`MoneyInput`**; currency `ToggleButtonGroup` → **`Select`**; recipient fields → **`Field`**; the 139 inline hex/rgba → **tokens** (Gate 3). Its quote list **already uses `QuoteCard`** — so `/fiat-to-fiat`'s `MakerCard` converging on `QuoteCard` is what unifies the two. |
| `QuoteCard` | **the shared quote primitive** — `/` keeps it; `/fiat-to-fiat` adopts the `MakerCard` variant. Speed gradient + chip + selection check stay. |
| `StepItem` / `OfframpExecution` | **the shared `StepRow`/`Stepper`** — `/fiat-to-fiat` adopts `StepItem` for its two-tier timeline, retiring the bespoke header. `OfframpExecution`'s summary header → the shared **`SummaryRail`**; its success block → the shared restrained **`success`** pattern. |
| `executionStore` (`ExecutionStep[]` model) | the **shared progress model**. Optionally (Gate 5) the cross-border `derived.progress` is modeled on the same `ExecutionStep[]` shape so both flows render identical step UI. |
| Transaction history (`TransactionHistory`, `IntentRow`) | token pass only; the reclaimable `Badge` dot pattern generalizes into the kit's `Badge`. Multi-deployment scan logic untouched. |
| `Header`/`Footer`/`Background` | shared `AppShell` (§4.3); `/` keeps `variant="emerald"`. |

Net: both surfaces render from one kit, one token set, one type scale — the "feels like one
product" mandate. The only structural work is on `/fiat-to-fiat` (the monolith); `/` is a
token + primitive-adoption pass.

---

## 7. The "nothing breaks" migration plan

> **This plan does not invent a process — it adopts the audit's Gate 0→6 backbone verbatim and
> maps the visual deliverables onto it.** The non-negotiable rule: **no pixel changes before
> Gate-2 behaviour-parity passes.** Visual work (Gates 3–5) is presentation-only and each gate
> is independently revertable because the hook interface is frozen at Gate 2. Verification at
> every gate: `npx tsc --noEmit` + `npx next lint` GREEN, on **node 22** with a clean `.next`
> (HS-5), plus the manual flow-parity walk-through. Phases touch **≤5 files** (CLAUDE.md rule
> #2); parallel sub-agents for >5-file token passes (rule #5).

| Gate | Theme of the gate | Visual deliverables (this plan) | Invariants preserved (must verify) | Verification |
|---|---|---|---|---|
| **0** | Baseline & freeze | **None.** Capture the 14-state walk-through, 409→Cancel, mid-flow refresh, resume-from-pending as the screenshot baseline the redesign is diffed against. | ALL — this is the behavioural snapshot. | `tsc`+`lint` green on `audit-fixes`; node 22; clean `.next`. |
| **1** | Step-0 cleanup (logic file only) | **None** (no UI). Strip the 14 `console.*`, dead vars/imports in `FiatToFiatFlow.tsx`. | INV-1…13 unaffected (pure deletion). | `tsc`+`lint`; one full manual walk. |
| **2** | **Extract `useFiatToFiatFlow()`** — the load-bearing checkpoint | **None — JSX is byte-for-byte unchanged**, only its data/handlers rebind to `f.*`. This gate ships *zero* visual change by design. | **The critical gate.** INV-1 (all `FlowStep` literals verbatim, HS-7) · INV-2 + HS-2 (`metadataUnsubRef` lifecycle) · INV-3 (`referralFees` pass-through + tuple payload) · INV-4 (poller `enabled` strings) · INV-5 + HS-3 (`__bigint__` sentinel) · INV-6 · INV-7 · INV-8 (`useNetworkAddresses`) · INV-12 (error strings, HS-8) · INV-13 + HS-4 (hook order). | **Parity gate (the one that gates all visual work):** `tsc`+`lint`; `npm run dev`; re-run the **full Gate-0 script** and diff screen-for-screen — 14-state progression, **both pollers fire**, countdown, 409→Cancel, refresh persists + proof-stage→verify remap, resume-from-pending; **no React hooks warning**; wallet stays connected with the extension (HS-1). **Do not proceed until green.** |
| **3** | **Tokenize the design system** (presentation only, mechanical) | Create `lib/design-tokens.ts` (ramps + `ffTokens`); evolve `theme.ts` to the §2 tokens (palette + `theme.ff` bag + the brand gradient + `MuiButton/Card/TextField/Chip/Toggle/Alert/Tooltip` overrides + reduced-motion). **Replace `FiatToFiatFlow`'s 139 hex + 65 rgba → tokens**; then `OfframpInput`, `QuoteCard`, `StepItem`, `OfframpExecution`, `Header`/`Footer`/`Background` in separate ≤5-file phases. Wire the chosen display font (`next/font`). | Brand emerald/teal hexes are **unchanged** → token rename is a no-op on the brand axis. `suppressHydrationWarning` (HS-1) untouched. RainbowKit accent stays = `brand`. | `tsc`+`lint`; **screenshot diff** — pixels shift *only* where a literal was wrong vs the token; both `Background` variants + RainbowKit accent still render; light + dark both compile. |
| **4** | **Rebuild the view behind the frozen hook** | Split the monolith `return(...)` into the §5 per-step view components (`FlowSelect`, `InputAll`, `MakerList`, `SignalConfirm`, `SendPayment`, `VerifyPayment`, `SelectPayment`, `StatusScreen`, `RouterCommit`, `SuccessCard`) — each pure, props from `f.*`. Introduce the **kit primitives** (§3): `Surface`, `Button`, `Field`/`MoneyInput`, `Select`, `StepRow`/`Stepper`, `QuoteCard`/`MakerCard`, `SummaryRail`/`SummaryRow`, `CountdownRing`, `RiskGate`, `DoDontList`, `Notice`. Build the **4-phase IA** projection + the **rail** + the **two-tier TEE stepper** + **first-class error states**. | **Hard rule:** sub-components are pure — no `useState`/wagmi/`localStorage`/`setStep` inside them (INV-13/HS-4). All state stays in the hook. INV-9 cancel affordances re-wired to `f.actions.cancelIntent` from all four call sites. | `tsc`+`lint` **after each phase**; re-run the Gate-0 slice for the steps touched; full-flow re-run at end of Gate 4; **run the app** (hook-order violations are runtime-only, HS-4). |
| **5** | Cross-surface convergence (optional, scoped) | Model `derived.progress` on the `executionStore` `ExecutionStep[]` shape; have `/fiat-to-fiat` and `/` render the **same `StepRow`/`Stepper`**. Generalize `Badge`. Ship the **light/dark** toggle if approved (§8). | Strictly additive to the hook's derived data; behaviour unchanged. | `tsc`+`lint`; both surfaces' step UI verified; light+dark visual pass. |
| **6** | Final acceptance | Polish pass; provider-glyph set; `/learn` link to the cryptography story. | `app/layout.tsx` still carries `suppressHydrationWarning` on `<html>`+`<body>` (HS-1); `intentsStore` + the `__bigint__` flow persistence both round-trip (HS-3). | Full E2E on both surfaces (within funding); `next build` on node 22; `tsc`+`lint` GREEN. |

**Rollback posture (from the audit):** Gates 1–2 are pure refactors (zero behaviour risk).
**Gate 2 is the checkpoint — no visual work starts until its parity gate is green.** Gates 3–5
are presentation; each is independently revertable because the hook interface is frozen.

**Why this is safe (the through-line):** the cryptographically load-bearing logic (the 14-state
machine, the TEE handshake, the pollers, persistence, the `referralFees` pass-through) is
moved *once*, at Gate 2, behind a stable interface and proven equivalent by the parity
walk-through — **before a single pixel moves.** Every screen in §5 is then a pure render of
that frozen hook, so the entire redesign is "swap the `return(...)`," which the audit certifies
as safe once Gate 2 passes.

---

## 8. Open questions / decisions for the user

1. **Light vs dark default.** Recommendation: **ship both, default to light** for the EUR/SEPA
   audience (Peer's own note that a bank-adjacent audience may prefer a considered light mode),
   with a header/footer toggle and dark as the "night desk." This is more work (a
   mode-parametric `theme.ts` + a `lightTheme` RainbowKit bridge) — **acceptable, or
   dark-only-with-a-light-pass-later?** (Dark is already shipping, so dark-first-then-light is
   the low-risk path.)

2. **Name / wordmark.** The shipped header says **"Ramp"**; CLAUDE.md / the product is
   **"FreeFlo."** Which name ships, and do we commission the `freeflo` wordmark + flow-chevron
   glyph described in §2.1 — or keep a wordmark-only treatment? (The system is identical either
   way; only the glyph changes.)

3. **Display typeface.** **Space Grotesk** (zero licensing, instant via `next/font/google`) vs
   **Clash Display** (more character, free-for-commercial but self-hosted `.woff2`) vs keeping
   **DM Sans for everything** (no new face at all). Recommendation: Space Grotesk for display,
   DM Sans for body. Confirm appetite for a second face.

4. **Provider logo licensing.** Today the UI shows emoji/letters for Venmo/Revolut/SEPA/USDC.
   Do we license the real provider marks, or ship our **own neutral glyph set** (recommended —
   dodges trademark risk and looks more intentional)? Same question for whether the `/learn`
   trust page may name the underlying tech.

5. **Scope of the offramp `/` redesign.** Recommendation: **token + primitive adoption** (§6),
   not a restructure (it's already well-factored). Confirm we're not also re-flowing the `/`
   IA — just converging its look onto the kit.

6. **Timeline / sequencing.** The plan is gated and incremental. Suggested order: **Gates 0–2
   first as a contained PR** (the safety-critical extraction; zero visual change) → review →
   then **Gate 3 (tokens)** → **Gate 4 (`/fiat-to-fiat` rebuild)** → **Gate 5–6 (convergence +
   polish)**. Is there a target milestone (e.g. tie the visual launch to the
   standalone-notary or mainnet-E2E milestone), and do we want light mode in the first visual
   release or as a fast-follow?

7. **The "Best rate" / reputation-chip semantics.** §5.4 derives a trust label
   (`Trusted`/`Verified`/`New`) from liquidity/rate rather than exposing maker handles.
   Confirm the labeling rubric (what makes a partner "Trusted") and that hiding handles until
   the send step is acceptable product-wise.

---

## 9. Appendix — style-tile.html

A single, self-contained, build-free **`docs/design/style-tile.html`** is shipped alongside
this plan. It uses **inline CSS only** (no app imports, no framework) and visualizes, in both
**light and dark**:

- the full **color system** (brand ramp, neutrals, and the **destructive amber-red kept
  visibly distinct from brand and warning** — the Peer-collision fix, made visible);
- the **type scale** (display + body, the real sizes/weights from §2.3);
- the **key components**: primary/secondary/destructive **buttons**, a **`MoneyInput`**, an
  **`AppCard`/Surface**, a **`StepRow`**, a **`QuoteCard`/`MakerCard`** (with the reputation
  chip + "Best rate" badge), a **`Notice`**, and the **`CountdownRing`** (verify + deadline
  skins).

Open it directly in a browser to *see* the direction. It is intentionally one static file so
it needs no toolchain and can't drift from a build. The hex values, radii, type sizes, and the
gradient in the tile are the **same tokens** specified in §2 (so the tile is a faithful preview
of what Gate 3's `theme.ts` will encode).

---

*End of plan. This document is a spec; no application code was modified. Implementation is
governed entirely by §7's Gate 0→6 backbone, and the Gate-2 parity check is the gate on all
visual work.*
