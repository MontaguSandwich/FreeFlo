# Peer (formerly ZKP2P) — Product & Brand Design Teardown

> Competitive design research for the FreeFlo UI overhaul. FreeFlo is a trustless
> USDC↔fiat (SEPA EUR) cross-border app built **on** the ZKP2P/Peer protocol, so Peer
> is both our upstream ecosystem and our closest design reference. This teardown is
> source-grounded: the bulk of the token data below was extracted directly from Peer's
> shipped production CSS bundle and JS bundle, plus their docs screenshots.
>
> **Researched:** 2026-06-12. **Author:** design teardown (Claude).
> **Confidence legend:** ✅ extracted from shipped code/assets (high) · 🟡 inferred from
> screenshots/docs (medium) · ⚪ secondhand/press (low).

## 0. Method & Sources

`peer.xyz` and the legacy `ramp.zkp2p.xyz` serve the **identical** Vite/React SPA
(byte-identical asset hashes — e.g. `index-C1REu9lu.css`, `index-0v6CZoSW.js`).
`zkp2p.xyz` 301-redirects to `www.peer.xyz`. The app is a client-rendered SPA (Privy for
auth/social login, Relay for cross-chain bridging), so the marketing scrapers return thin
HTML — **all real tokens below were mined from the compiled CSS/JS bundles**, which is why
hex/px values are exact rather than guessed. The wizard screenshots are the official ones
from `docs.peer.xyz`.

| # | Source | URL |
|---|--------|-----|
| S1 | Peer marketing + app SPA (home) | https://www.peer.xyz/ |
| S2 | Production CSS token bundle (load-bearing) | https://www.peer.xyz/assets/index-C1REu9lu.css |
| S3 | Production JS app bundle (microcopy/flow) | https://www.peer.xyz/assets/index-0v6CZoSW.js |
| S4 | Legacy app (same bundle) | https://ramp.zkp2p.xyz/ |
| S5 | Buyer onboarding guide (12-step flow + screenshots) | https://docs.peer.xyz/guides/for-buyers/complete-guide-to-onboarding |
| S6 | Docs home / IA | https://docs.peer.xyz/ |
| S7 | Protocol + intro / positioning copy | https://docs.peer.xyz/guides/introduction/zkp2p |
| S8 | PeerAuth / zkTLS / TEE attestation docs | https://docs.peer.xyz/protocol/zkp2p-protocol |
| S9 | GitHub org "Peer (Previously ZKP2P)" | https://github.com/zkp2p |
| S10 | Providers repo (PeerAuth provider templates) | https://github.com/zkp2p/providers |
| S11 | X / Twitter (rebrand) | https://x.com/peerxyz · https://x.com/zkp2p/status/1930688326073528733 |
| S12 | Rebrand press | https://www.bitget.com/news/detail/12560605186063 |
| S13 | PP Valve typeface (Pangram Pangram) | https://pangrampangram.com/products/valve |
| S14 | Demo landing | https://demo.peer.xyz/ (currently 404; referenced from S5/search) |
| S15 | Bankless explainer (flow narrative) | https://www.bankless.com/read/onramp-privately-with-zkp2p |

Screenshots viewed directly (from S5, hosted on `docs.peer.xyz/assets/images/`):
`OnrampStep1` (landing), `OnrampStep4` (currency/platform modal), `OnrampStep6` (buy card +
quote list), `OnrampStep8` (payment instructions), `OnrampStep10` (verify — select payment),
`OnrampStep11` (verify — proof generating), `OnrampStep12` (verify — success).

---

## 1. Brand Positioning & The Rebrand (context for tone)

ZKP2P rebranded to **Peer** in mid-2025 (announced via @zkp2p → @peerxyz). The stated
rationale, paraphrased from the announcement and press: *"as zero-knowledge technology
matures, the focus shifts from the technology to the people using it… making technology
simpler and finance fairer. Funds should flow directly between people."* [S11, S12] ⚪

The strategic read for us: **they deliberately de-emphasized "ZK" in the consumer brand.**
"Peer" foregrounds the human/P2P story; the cryptography is now a trust *substrate*, not the
headline. The crypto vocabulary ("zkTLS", "TEE", "attestation") survives only in **docs**,
not in the consumer wizard. This is the single most important brand decision for us to weigh
(see §8).

Positioning copy, verbatim:
- Meta/OG description (shipped): *"The fastest crypto onramp and offramp. Base, Solana,
  Hyperliquid, Ethereum & more. Venmo, PayPal, Revolut, CashApp & more. **No middlemen, no
  additional verification.**"* [S1, S4] ✅
- Landing hero headline: **"CRYPTO IN SECONDS, FOR LESS"** [S5 OnrampStep1] 🟡
- `<title>`: *"Peer | Trustless P2P Fiat-Crypto Marketplace"* [S1] ✅
- Docs positioning: *"cheapest, fastest, lowest fraud and most composable fiat-to-crypto
  on/off ramp"*; five pillars — **Trustless / Private / Interoperable / Low Fees / Fast** [S7] ⚪
- In-app product line: *"Buy crypto directly using Venmo, Cash App, Revolut, and more"* [S3] ✅

Note the hierarchy: **speed and price lead, trustlessness is the noun in the title, ZK is
buried.** They sell the outcome, not the mechanism.

---

## 2. Color Palette ✅ (extracted from `--peer-*` CSS custom properties, S2)

Peer ships a fully-named design-token system under the `--peer-` namespace. This is the
real palette, not eyeballed. The app is **dark-first** (near-black canvas); the marketing
site uses a black-on-white brutalist treatment. There is **no separately themed light app**
— the app UI is dark, period.

### Core brand / accent

| Token | Hex | Role |
|-------|-----|------|
| `--peer-ignite-yellow` | `#FFE500` | Primary accent (warm yellow), gradient start |
| `--peer-ignite-red` | `#FF3A33` | Primary accent (red), gradient end |
| `--peer-link` | `#1F95E2` | Links (the one cool/blue accent) |

The two "ignite" colors are the **only** brand accents and they are almost always used
**together as a gradient**, never as flat fills for primary CTAs. (Each appears 10× in the
CSS — by far the most-referenced brand colors.)

### The "Ignite" gradient family (the signature visual) ✅

| Token | Definition |
|-------|------------|
| `--peer-gradient-ignite` | `linear-gradient(270deg, #FFE500 0%, #FF3A33 100%)` |
| `--peer-gradient-ignite-hover` | `linear-gradient(90deg, #FFE500 0%, #FF3A33 100%)` |
| `--peer-gradient-ignite-text` | `linear-gradient(90deg, #FFE500, #FF3A33)` (for gradient text) |
| `--peer-gradient-ignite-vertical` | `linear-gradient(180deg, #FFE500 0%, #FF3A33 100%)` |
| `--peer-gradient-ignite-diagonal` | `linear-gradient(8.27deg, #FFE500 8.73%, #FF3A33 89.42%)` |
| `--peer-gradient-ignite-steep-diagonal` | `linear-gradient(42.6deg, #FFE500 19.59%, #FF3A33 69.63%)` |
| `--peer-gradient-ignite-near-horizontal` | `linear-gradient(-89.11deg, #FFE500 3.94%, #FF3A33 91.73%)` |

The gradient flips direction on hover (270°→90°). It is used on: primary CTA buttons, the
**progress-stepper connector lines** (the yellow→red line between wizard steps — visible in
every verify screenshot), gradient headline text, and step-icon circles.

### Neutrals (dark UI scale)

| Token | Hex | Role |
|-------|-----|------|
| `--peer-black` | `#000000` | True black (marketing canvas, deepest bg) |
| `--peer-obsidian` | `#101010` | App background |
| `--peer-rich-black` | `#181818` | Card/panel surface |
| (observed) | ~`#202225`–`#0E0E0E` | Nested rows / inputs (screenshot-derived) 🟡 |
| `--peer-border-dark` | `#383838` | Borders on dark surfaces |
| `--peer-grey` / `--peer-text-secondary` | `#777777` | Secondary text |
| `--peer-text-placeholder` | `#6C757D` | Input placeholder |
| `--peer-light-grey` / `--peer-border-light` | `#EEEEEE` | Light borders / light-surface dividers |
| `--peer-border-subtle` | `#D3D3D3` | Subtle border |
| `--peer-border-card-light` | `#C9C9C9` | Card border (light contexts) |
| `--peer-text-primary` | `#FFFFFF` | Primary text on dark |
| `--peer-text-dark` | `#000000` | Primary text on light |
| `--peer-text-dark-alt` | `#101010` | Alt dark text |

### Semantic / status

| Token | Hex | Role |
|-------|-----|------|
| `--peer-success` | `#4BB543` | Success (green checks, BEST badge, completed timeline) |
| `--peer-warning` | `#FFC107` | Warning amber |
| `--peer-error` | `#FF4040` | Error red |
| `--peer-error-alt` | `#DF2E2D` | Error red (alt) |

> ⚠️ Brand-collision note for FreeFlo: Peer's **error** (`#FF4040`) and **brand red**
> (`#FF3A33`) are nearly identical. They get away with it because brand-red almost never
> appears as a flat fill — it lives inside the gradient. If we adopt a red accent we must
> keep destructive/error visually distinct (different saturation or reserve solid-red for
> errors only). See §8 "avoid".

### Light vs dark summary
- **App = dark only.** Obsidian `#101010` canvas, `#181818` cards, white text, grey
  secondaries, ignite gradient accents. No light-mode app shipped. ✅
- **Marketing = "light brutalist."** Off-white (~`#F5F5F3`) background with giant solid-black
  organic blob shapes and black PP Valve type; the ignite gradient appears only on the CTA
  pill. [S5 OnrampStep1] 🟡

---

## 3. Typography ✅ (from `@font-face` + `--peer-font-*`, S2)

A two-typeface system, both self-hosted (no Google Fonts dependency despite a preconnect):

| Role | Family | Weights shipped | Token |
|------|--------|-----------------|-------|
| **Headline / display** | **PP Valve** (Pangram Pangram) | `PlainSemibold` 600, `PlainExtrabold` 800 | `--peer-font-headline: "PP Valve", sans-serif` |
| **Body / UI** | **Inter** | Medium 500, SemiBold 600 | `--peer-font-body: "Inter", sans-serif` |
| Mono (code/docs) | ui-monospace / SFMono / Menlo stack | — | (system) |

Self-hosted files confirm the exact cuts: `PPValve-PlainSemibold.woff2/.woff/.otf`,
`PPValve-PlainExtrabold.otf`, `Inter-Medium.woff2`, `Inter-SemiBold.woff2`. [S2] ✅

**PP Valve** is a commercial "industrial Sans" by Valerio Monopoli / Pangram Pangram —
ink-trapped, condensed-leaning, with stencil and cursive alternates; free for personal use,
licensed for commercial. [S13] It gives the headlines a distinctive **techno-industrial,
slightly brutalist** character (you can see the ink traps and tight tracking in the
all-caps "VERIFY PAYMENT" / "COMPLETE PAYMENT" wizard headers). This is the brand's voice —
**do not** substitute generic Inter/Geist here or you lose the personality. (For us: PP
Valve is licensable; if we want the *feel* without the license, nearest free analogues are
Anton/Archivo Expanded/Space Grotesk — but none have the ink traps.)

### Type scale (px, exact)

| Token | px | Notes |
|-------|----|-------|
| `--peer-font-size-hero` | **110** | Marketing hero |
| `--peer-font-size-h1` | 96 | |
| `--peer-font-size-h2` | 64 | |
| `--peer-font-size-h3` | 48 | |
| `--peer-font-size-h4` | 44 | |
| `--peer-font-size-h5` | 32 | |
| `--peer-font-size-h6` | 24 | |
| `--peer-font-size-body-lg` | 20 | |
| `--peer-font-size-body` | 16 | base |
| `--peer-font-size-body-sm` | 14 | |
| `--peer-font-size-button` | **14** | buttons are small + tracked |
| `--peer-font-size-label` / `subheading` | 14 | |
| `--peer-font-size-caption` | 12 | |
| `--peer-font-size-badge` | **8** | micro-badges |

### Weights, line-height, tracking

| Token | Value |
|-------|-------|
| Weights | regular 400 · medium 500 · semibold 600 · bold 700 · extrabold 800 |
| `--peer-line-height-headline` | **1.02** (very tight — display) |
| `--peer-line-height-tight` | 0.9 |
| `--peer-line-height-body` | 1.3 |
| `--peer-line-height-relaxed` | 1.5 |
| `--peer-letter-spacing-button` | **0.1em** (buttons are UPPERCASE + widely tracked) |
| `--peer-letter-spacing-tight` | −0.02em (headlines) |
| `--peer-letter-spacing-snug` | −0.01em |
| `--peer-letter-spacing-subheading` | +0.02em |

**Character takeaways:**
- Display type is **huge, condensed, ultra-tight leading (1.02), negative tracking** — loud
  and confident.
- **Buttons & step labels are UPPERCASE, 14px, +0.1em tracking** — a signature. ("BUY",
  "SEND", "SIGNING TRANSACTION", "GENERATE QR CODE", "SELECT PAYMENT", "GO TO BUY".)
- Body is plain Inter at 16/1.3 — the workhorse contrast against the showy headlines.

---

## 4. Layout, Spacing & Radii ✅

### Spacing scale (4px base, S2)
`--peer-space-*`: 0, **4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96** px
(tokens `space-1`…`space-24`). Standard 4px grid; 16/24 dominate card padding. ✅

### Radii (S2)
| Token | px |
|-------|----|
| `--peer-radius-xs` | 4 |
| `--peer-radius-sm` | 8 |
| `--peer-radius-md` | 10 |
| `--peer-radius-lg` | 16 |
| `--peer-radius-xl` | 24 |
| `--peer-radius-2xl` | **32** |
| `--peer-radius-full` | 9999 (pills) |

**The app reads as "soft".** Outer cards/panels use the big 24–32px radius; the wizard
container is a large rounded-corner panel (≈24–32px). Buttons and chips are **fully rounded
pills** (`radius-full`). Inputs/rows sit around 10–16px. The combination of near-black
surfaces + large radii + pill buttons is the core "Peer app" silhouette. 🟡

### Breakpoints (S2)
mobile 425 · tablet 768 · laptop 1024 · desktop 1280 · wide 1440.

### Shadows (S2)
- `--peer-shadow-sm/md/lg`: standard Tailwind-ish elevation
  (`0 1px 2px`, `0 4px 6px −1px`, `0 10px 15px −3px`, all `rgba(0,0,0,.1)`).
- `--peer-shadow-inner: inset .624px .624px .125px 0 rgba(255,255,255,.25)` — a subtle
  **top-left inner highlight** that gives buttons/cards a faint "lit edge" on the dark
  canvas. Nice detail worth stealing.

### Containers / density
The wizard is a **single centered card / pair of cards**, narrow (mobile-app-like column,
~380–460px feel) even on desktop. The buy view pairs **two side-by-side cards**: the
buy/quote-input card (left) and the quote-selection list (right) [S5 OnrampStep6] 🟡.
Density is **comfortable, not dense** — generous vertical rhythm, one decision per row.

---

## 5. Components ✅/🟡

| Component | Spec / behavior |
|-----------|-----------------|
| **Primary button** | Full-pill, **ignite gradient** fill, **UPPERCASE 14px +0.1em** dark text on the gradient. Gradient flips 270°→90° on hover. Disabled/in-progress state goes flat grey with a left spinner + label (e.g. "● SIGNING TRANSACTION", "↻ VERIFYING PAYMENT"). [S5 Steps 6/11] |
| **Secondary / success button** | Solid **white pill, black uppercase label** ("GO TO BUY" on success). [S5 Step12] White = "you're done / neutral next step". |
| **Tertiary** | Ghost/outline pills in the nav ("+ ADD CUSTOM RECIPIENT" is a subtle bordered pill). |
| **Segmented control** | `BUY | SEND` toggle at top of the action card (active = filled dark chip, inactive = muted). A small history/clock icon sits at the segment's right. [S5 Step6] |
| **Inputs** | Large numeric amount field (big bold number, e.g. "25"), inline **token/asset selector pill** on the right of the same row (icon + ticker + chevron). Search inputs have a leading magnifier icon, rounded, dark fill, grey placeholder (`#6C757D`). [S5 Step4/6] |
| **"You send / Paying using / You receive" rows** | Stacked labeled rows inside the buy card; each row = small grey label above + bold value + right-aligned selector pill. Sub-value line shows fiat equiv + "Balance: 0.00". This is the core onramp input pattern. [S5 Step6] |
| **Dropdown / selector modal** | Opens a **modal** ("Select Currency & Platform"), **two-column**: left = currency search + "Popular Currencies" then "All Currencies A–Z" (flag avatar + name + subtitle); right = "Platform" search + list (logo + name + **right-aligned liquidity** "5000 USDC" + a "No cooldown" sub-label). Top-right "X" close. Footer: feedback prompt. [S5 Step4] |
| **Quote list / cards** | "Select a Quote (Top 4)" panel; each quote row = big USDC amount + maker handle (e.g. `@MAXLOMU`) + rate breakdown line (`≈ €24.65 · 0.8597 EUR / USDC`) + payment-method tag. **Selected row** gets a lighter raised surface; best row gets a green **"BEST"** badge; some show a red delta ("−2.29%"). Filter chips for payment methods sit at the top of the list. [S5 Step6] |
| **Badges / chips** | Tiny (8px font token). Status badges: green "BEST", "No cooldown", percentage deltas (green up / red down), "BETA" tag on the wordmark. Payment-method filter chips with provider glyphs. |
| **Progress stepper (horizontal)** | 3 nodes — **Payment → Authenticate → Verify** — circular icons (paper-plane, key, check) connected by the **ignite gradient line**. Active/done icons are gradient-filled circles; the current target ("Verify") is a white circle. Labels below each node. Present on every verify screen. [S5 Step10/11/12] |
| **Progress timeline (vertical, inner)** | Below the stepper, a **vertical checklist timeline**: row = icon + title + sub-caption, with a status node on the right connected by a vertical line. States: ✓ green check (done) → **green countdown ring with seconds number** (in progress, e.g. "8") → hollow circle (pending). [S5 Step11/12] |
| **Instruction checklist** | Do/don't list using **green ✓ for do's and red ✕ for don'ts**, each a short imperative line. [S5 Step8] |
| **Confirmation checkbox** | Explicit risk-ack checkbox: *"I understand that not following the instructions above may lead to permanent loss of funds."* gating the CTA. [S5 Step8] |
| **Countdown / expiry pill** | "⏱ Order expires in 5h 59m left" banner; "Expires in …" elsewhere. [S5 Step8; S3] |
| **Toasts** | react-toastify under the hood (CSS exposes `--toastify-*`). Standard top/corner toasts; success green / error red. Strings like "Create deposit transaction submitted.", "A network error occurred. Please try again." [S2/S3] |
| **Tooltips** | Hover breakdowns on fee rows ("Frontend fee", "Network fee" with breakdown on hover); "?" affordance in the platform modal header. [S5; S7] |
| **Tx success link** | Underlined "Received 29.079911 USDC on Base ↗" deep-link to explorer. [S5 Step12] |

---

## 6. THE WIZARD UX (most important) 🟡 — verbatim flow

Canonical buyer flow (12 steps), from the official onboarding guide [S5], cross-checked
against shipped microcopy [S3] and the screenshots.

### 6.1 Amount / asset selection (Steps 4–5)
- Connect wallet **or social login** (Privy: Twitter/Google/Email). Network fee shows **"0"
  when using social login** (gas sponsored) — a great friction-killer.
- Action card with `BUY | SEND` segmented toggle. Three stacked rows:
  - **"You send"** — big numeric input + fiat selector pill (e.g. EUR ▾).
  - **"Paying using"** — payment-method selector pill (e.g. Revolut ▾).
  - **"You receive"** — auto-computed crypto amount + asset selector (USDC ▾) + fiat equiv +
    "Balance: 0.00".
- Currency **and** platform are chosen in one **two-column modal** ("Select Currency &
  Platform") that surfaces **per-platform available liquidity** and cooldown status inline —
  i.e. liquidity is a first-class selection signal, not hidden until later. [S5 Step4]
- "You receive" is computed live against available maker liquidity ("Calculating…" / live).

### 6.2 Peer / quote / payment-method selection (Step 5–6)
- Right-hand **"Select a Quote (Top 4)"** list. Each quote exposes the **maker's handle**,
  exact **rate breakdown**, payment method, a **"BEST"** badge, and a signed **% delta** vs
  best. The user explicitly picks a counterparty quote — the P2P/marketplace nature is
  surfaced, not abstracted. [S5 Step6]
- CTA "Start Order" / shows "● SIGNING TRANSACTION" with spinner while the intent tx signs.

### 6.3 Payment step (Step 8) — instructions + risk gate
Header **"COMPLETE PAYMENT"** with the 3-node stepper (Payment active). Body:
- Expiry banner: **"⏱ Order expires in 5h 59m left"**.
- A do/don't **instruction checklist** (verbatim, [S5 Step8 + S3]):
  - ✓ *"Use a **personal** Revolut account (**not** Business)"*
  - ✓ *"Pay from your Revolut balance so the payment **confirms** before the ZKP2P
    transaction expires"*
  - ✓ *"Send exactly 25.00 EUR in a single payment"*
  - ✓ *"Ensure the seller receives exactly EUR"*
  - ✕ *"Avoid **cross-currency** conversion"*
  - ✕ *"If you do send the wrong currency, a **5% penalty** will be automatically applied"*
  - ✕ *"Do not pay from a Revolut **Business** account"*
- **Risk-ack checkbox**: *"I understand that not following the instructions above may lead to
  permanent loss of funds."* → enables **"GENERATE QR CODE"**.
- Critical microcopy reused across providers (shipped [S3]): *"Do not include Peer,
  PeerAuth, crypto, or related terms in the memo."* and *"Do not pay with a bank account or
  eCheck. Those can clear after order expires."* — i.e. they **bake fraud/operational
  failure modes into microcopy** at the exact moment of action.

### 6.4 THE VERIFY / PROOF STEP (the crux for FreeFlo) — Steps 10–12
This is the screen we most need to learn from. Peer's underlying proof tech is the
**PeerAuth extension** generating **zkTLS / TLSNotary / zkEmail** web proofs, **verified by an
Attestation Service running inside an AWS Nitro Enclave** (TEE) that signs an EIP-712
attestation — *the same architecture FreeFlo uses.* Crucially, **none of that vocabulary
appears on the verify screen.** The user just sees three plain steps. [S8; S5]

**Header:** **"VERIFY PAYMENT"** + the 3-node stepper **Payment → Authenticate → Verify**.

**Step 10 — select the payment to prove:**
- Heading **"Your Revolut Payments"** + sub **"Select a payment to verify"** + a refresh icon.
- A list of recent payments pulled from the provider: each row = "Sent €25 to maxlomu" +
  timestamp (or a "2/4" progress indicator on others). User taps the matching one.
- Gradient CTA **"SELECT PAYMENT"**. [S5 Step10]

**Step 11 — proof generating (the money screen):**
- Top: the selected payment confirmed with a **green ✓** ("Sent €25 to maxlomu · 8:54 AM on
  Revolut").
- Middle: **"Verifying Payment"** with a **lock icon** and the caption **"Can take up to 30
  seconds"**, and a **live green countdown ring counting down the seconds** (screenshot shows
  "8"). This is how they make a ~30s TEE round-trip feel safe and bounded.
- Bottom: **"Complete Onramp — Receive USDC on Base"**, still a hollow pending node.
- CTA: disabled flat-grey **"↻ VERIFYING PAYMENT"** with spinner. [S5 Step11]
- The whole verify flow is framed as a **vertical timeline** (Payment ✓ → Verifying ⏳ →
  Complete ○) so progress is legible at a glance, and the lock icon + "30 seconds" caption
  carries the entire trust/privacy message **without saying "ZK" or "TEE".**

**Step 12 — success:**
- All three timeline rows show **green ✓**.
- A subtle underlined deep-link: **"Received 29.079911 USDC on Base ↗"**.
- Solid **white** CTA **"GO TO BUY"** (return to top of funnel). [S5 Step12]

**Key insight:** they collapse a cryptographically heavy flow (extension → provider
auth/MPC → zkTLS proof → Nitro enclave attestation → EIP-712 sig → on-chain fulfill) into
**three friendly verbs and a 30-second timer.** The complexity is *felt* only as a short,
bounded wait with a lock icon. This is the gold standard we should match.

### 6.5 Loading / progress vocabulary (shipped strings, [S3]) ✅
"Calculating…", "Generating Address…", "Generating…", "Bridge in progress…", "Waiting for
confirmation…", "Waiting for deposit…", "Verifying Payment / Can take up to 30 seconds",
"Linking your account…", "Processing…", "Loading…". Plus bridge states "Bridge Complete!",
"Bridge Failed", "Bridge Timeout".

### 6.6 Error / empty / edge states (shipped strings, [S3]) ✅
- Network: *"A network error occurred. Please try again."* · *"Check your connection and
  retry."* · *"An unexpected error occurred"*.
- Expiry: *"Code expired. Generate a new one to continue."* · *"Expires in …"*.
- Wallet/account mismatch: *"Active wallet does not match the signed-in account. Reconnect
  and try again."*
- Liquidity: *"Insufficient liquidity in deposit"*, *"Amount too small"*, *"Amount is too
  small to cover gas fees"*, *"Amount is below minimum…"*.
- Auth re-link: *"Google authorization expired. Reconnect Gmail and try again."*
- Seller-side (deposit/liquidity-provider flow) confirmations: *"A buyer places an order
  against your deposit."* / *"A buyer completed payment and your USDC has been released."*

Tone of errors: **plain, blameless, always paired with a concrete next action** ("…Please
try again", "…Reconnect and try again", "…Generate a new one"). No stack traces, no jargon.

---

## 7. Motion, Iconography, Illustration ✅/🟡

- **Motion:** restrained, functional. Spinners on in-progress buttons; the **animated
  green countdown ring** on the verify step is the hero micro-interaction; gradient
  direction-flip on button hover (270°→90°). No heavy parallax in-app. The **marketing**
  site is the playful one (big animated black blob shapes around the hero). [S5 Step1] 🟡
- **Iconography:** thin/outline line icons (paper-plane "send", key "authenticate", circled
  check "verify", lock, clock, magnifier, chevrons, refresh). Provider/brand logos rendered
  as small rounded color glyphs (Venmo, Cash App, Chime, Revolut, Zelle, PayPal, Wise). Style
  is **clean monoline, not skeuomorphic.**
- **Illustration / mascot:** **no mascot.** Brand expression = the **PP Valve wordmark
  "peer"** (lowercase) + giant **organic black blob shapes** on marketing + the ignite
  gradient. Abstract/typographic, not character-driven. This restraint reads as "fintech you
  can trust," not "crypto toy."

---

## 8. Copy Tone & Trust Communication ✅/⚪

**Voice:** terse, confident, outcome-first, lightly imperative. Headlines shout in
all-caps PP Valve ("CRYPTO IN SECONDS, FOR LESS"); UI labels are clipped uppercase verbs
("BUY", "GENERATE QR CODE", "GO TO BUY"); helper/error copy is calm plain-English.

**How they sell trust/ZK/privacy — the pattern we should copy:**
1. **Show, don't jargon.** The consumer surface says "**No middlemen, no additional
   verification**", "Trustless", and a **lock icon + "Can take up to 30 seconds"** — and
   that's it. The words "zero-knowledge", "zkTLS", "TLSNotary", "TEE", "Nitro", "attestation"
   live **only in docs** [S7, S8], never in the wizard.
2. **Make safety tangible at the moment of risk.** Trust is communicated through *behavioral
   guardrails*: the do/don't checklist, the "permanent loss of funds" ack checkbox, the
   expiry timer, and "don't put crypto in the memo" — concrete, plain-language, right where
   the user could make a costly mistake.
3. **Surface the counterparty, own the P2P story.** Maker handles, per-quote rates, and
   liquidity are visible — they don't hide that it's peer-to-peer; they make it feel like a
   transparent marketplace.
4. **Docs carry the proof.** For the technically curious, docs lay out the five pillars
   (Trustless/Private/Interoperable/Low Fees/Fast) and the full crypto stack, including that
   *"the EIP-712 signing key is wrapped by an AWS KMS key whose decrypt policy is gated on the
   enclave's PCR8 measurement, so the key can only be unwrapped by an enclave running the
   published code."* [S8] — i.e. trust claims are **backed and inspectable**, just not
   shoved at the consumer.

---

## 9. What to BORROW vs AVOID for FreeFlo

### ✅ Borrow

1. **A named token system** (`--peer-*` equivalent: `--ff-*`). Their discipline — semantic
   color/space/radius/type tokens with a single accent-gradient family — is exactly what a
   "full UI overhaul" needs as its foundation. Steal the *structure*, not the hex.
2. **The two-tier verify pattern** (horizontal 3-node stepper **+** inner vertical timeline)
   is the best part. For FreeFlo's offramp (roles inverted: user deposits USDC, solver sends
   SEPA) the user-facing analogue is "Deposit → Solver pays SEPA → Proof verified → USDC
   released to solver / fiat lands." Map our TLSNotary+attestation flow onto this exact
   skeleton.
3. **Hide the cryptography; show a bounded timer + lock.** Our verify step (TLSNotary →
   attestation/TEE → EIP-712) should read as *"Verifying payment · up to ~30s"* with a lock
   and a countdown, **not** "Generating TLSNotary proof / EIP-712 / nullifier." Keep the deep
   proof story in docs only. This directly de-risks our most intimidating screen.
4. **Behavioral guardrails as trust UI**: the do/don't checklist, the **"permanent loss of
   funds" ack checkbox**, the **expiry countdown**, and "don't reference crypto in the memo."
   For SEPA-EUR these translate almost 1:1 (exact amount, single payment, correct IBAN/BIC,
   no reference that flags the bank, SEPA-Instant vs standard timing). High value, low effort.
5. **Liquidity-first selection modal** — surfacing available liquidity + cooldown per
   route/maker inline. FreeFlo can show solver liquidity/availability the same way so users
   don't hit "insufficient liquidity" late.
6. **Social-login + gas-sponsored "Network fee: 0"** as a first-impression friction killer.
7. **Blameless error copy with a concrete next action** ("…Please try again / Reconnect /
   Generate a new one"). Adopt this voice wholesale; mine their string list [S3] as a
   starting template for ours.
8. **Micro-details:** the inner top-left highlight shadow on dark surfaces
   (`inset .624px .624px … rgba(255,255,255,.25)`), big 24–32px card radii + full-pill
   buttons, uppercase +0.1em tracked button labels, white pill for the terminal "you're done"
   CTA. These read premium and are cheap to replicate.
9. **De-emphasize "ZK/trustless" in the headline, lead with speed + cost + "no middlemen."**
   FreeFlo's value (trustless USDC↔SEPA, no KYC middleman) should headline the *outcome*; the
   trust mechanism is the reassuring substrate, mirroring Peer's rebrand thesis.

### ⛔ Avoid / diverge

1. **Red brand-accent ≈ error red collision.** Peer's `#FF3A33` (brand) and `#FF4040`
   (error) are nearly identical; they survive only because brand-red lives inside the
   gradient. **Don't repeat this.** If FreeFlo keeps a warm gradient, reserve a clearly
   distinct hue/saturation for destructive/error so "danger" never blurs with "brand."
2. **Yellow-on-dark contrast.** `#FFE500` on near-black is high-contrast as a fill, but
   gradient *text* (yellow→red) on dark can dip below WCAG AA for small/secondary text.
   FreeFlo should restrict gradient text to large display only and use solid white for body.
3. **PP Valve is licensed.** Beautiful and on-brand for *them*, but it's a paid Pangram
   Pangram face and it's now strongly associated with Peer. FreeFlo should pick its **own**
   display typeface (own the identity, avoid a "Peer clone" read, sidestep licensing). Keep
   Inter (or a similar neutral) for body — that's safe and shared-ecosystem-appropriate.
4. **Dark-only.** Peer ships no light app theme. FreeFlo serving EUR/SEPA users (more
   bank-app-like expectations) may want at least a considered light mode; don't inherit
   "dark-only" by default.
5. **Marketing brutalism (giant blob shapes, 110px hero) ≠ app system.** Their loud
   marketing aesthetic does **not** carry into the calm dark app. Keep that separation; don't
   let blob/brutalist marketing styling leak into the transactional wizard where trust and
   legibility matter most.
6. **Counterparty handles like "@MAXLOMU" / "@ZKPP9788…"** expose raw maker identities and
   look crypto-native. For a fiat-first audience this can feel sketchy; FreeFlo may want to
   abstract the solver behind a trust/reputation chip rather than a raw handle.
7. **"2/4"-style raw progress codes** and "undefined" recipient labels visible in their
   verify list [S5 Step10] are leaky/unpolished — make sure our equivalents render real,
   human-readable values and never "undefined."
8. **Dense crypto vocabulary in any consumer-facing string.** Even their shipped JS leaks
   developer-y strings ("Buyer TEE proof requires encryptedSessionMaterial…", "Attestation
   PCR8 does not match the trusted pin") — fine in logs, **never** surface these to users.

---

## 10. Quick token cheat-sheet (for kicking off our own tokens)

```
/* Accent (Peer "Ignite") — reference only; pick our own to avoid clone read */
ignite-yellow : #FFE500
ignite-red    : #FF3A33
ignite-grad   : linear-gradient(270deg, #FFE500 0%, #FF3A33 100%)  /* hover -> 90deg */
link          : #1F95E2

/* Dark surfaces */
bg/obsidian   : #101010
surface/card  : #181818
border-dark   : #383838
text-primary  : #FFFFFF
text-secondary: #777777
placeholder   : #6C757D

/* Status */
success : #4BB543   warning : #FFC107   error : #FF4040 / #DF2E2D

/* Type */
display : "PP Valve" 600/800  (pick our own equivalent)
body    : "Inter" 500/600
scale   : 110/96/64/48/44/32/24 · body 20/16/14 · caption 12 · badge 8
lh      : headline 1.02 · body 1.3 · relaxed 1.5
tracking: headline -0.02em · button +0.1em UPPERCASE

/* Space (4px base) */ 4 8 12 16 20 24 28 32 36 40 48 56 64 80 96
/* Radius */ xs4 sm8 md10 lg16 xl24 2xl32 full9999
/* Shadow */ inner: inset .624px .624px .125px 0 rgba(255,255,255,.25)
/* Breakpoints */ 425 / 768 / 1024 / 1280 / 1440
```

---

*Confidence: §2–4 and the shipped strings in §6 are ✅ extracted directly from Peer's
production bundles. §5–6 layout/component descriptions and §7 are 🟡 from the official docs
screenshots (viewed). §1 rebrand framing is ⚪ secondhand. The verify-step architecture
parallel (Nitro/PCR8/EIP-712) is confirmed in Peer's own docs [S8] and mirrors FreeFlo's
attestation service.*
