# Jumper.xyz — Competitive Design Teardown

**For:** FreeFlo UI overhaul (trustless USDC↔SEPA-EUR multi-step wizard)
**Subject:** Jumper Exchange (LI.FI-powered cross-chain bridge/swap aggregator)
**Author:** Product design teardown, 2026-06-12
**Method:** This is unusually high-confidence for a teardown because **Jumper's frontend is open source** ([`github.com/jumperexchange/jumper-exchange`](https://github.com/jumperexchange/jumper-exchange), default branch `develop`). Most tokens below are quoted directly from their MUI theme source, not eyeballed. Where a claim is inferred from screenshots or third-party reviews rather than source, it is flagged **[screenshot]** or **[3rd-party]**. Exact-source claims are flagged **[source]**.

> **Key architectural fact that shapes everything:** Jumper's swap UI *is* the **LI.FI Widget** (`@lifi/widget`), a configurable React/MUI component. Jumper wraps it with their brand theme. So "Jumper's flow UX" = "LI.FI widget UX + Jumper's palette/typography/radius overrides." This matters for FreeFlo: the patterns below are a *productized, themeable design system*, and the customization surface (palette / shape / typography / component overrides) is documented. Sources: [LI.FI Customize Widget docs](https://docs.li.fi/widget/customize-widget), [Jumper `src/config/widgetConfig.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/config/widgetConfig.ts).

---

## 0. TL;DR design DNA

- **Mood:** Deep-purple/aubergine "night" theme is the hero. Not neon — *rich, saturated, slightly luxurious* purple on near-black, with soft magenta→violet→blue ambient glows behind the widget. Light mode is a pale lavender wash.
- **Shape language:** Two radii doing all the work — **pill buttons (`borderRadius: 128`, fully rounded)** and **big 24px-rounded cards**. Inputs are also 24px-rounded. Very few hard corners anywhere.
- **Type:** Body **Inter**, display/headings **Urbanist** (geometric, friendly-but-confident). A custom condensed display face **Sequel 100 Wide** for marketing moments.
- **Container:** The whole product is **one 416 × 720 px widget card** that expands sideways into a 436px "routes" panel and a 256px chain sidebar. Everything happens inside that card — selection, quotes, review, execution, success — via in-card screen transitions and a bottom drawer, not page navigation.
- **Voice:** Energetic, rhythmic, inclusive of both "Degens" and "Normies." Signature line: **"Make. The. Jump."**

---

## 1. Color palette, gradients, glassmorphism

### 1a. Base color ramps  **[source]**
From [`src/theme/baseColors.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/baseColors.ts). This is the raw token layer; brand semantics (next table) reference into it.

| Ramp | Notable stops (hex) | Role |
|---|---|---|
| **grey** | `100 #FAFAFA` · `300 #E0E0E0` · `500 #A3A3A3` · `700 #525252` · `900 #292929` | neutral text/borders |
| **violet** | `100 #FAEBFF` · `400 #DE85FF` · `500 #D35CFF` · `700 #7C10A3` · `900 #59007A` | magenta accent family |
| **orchid** | `100 #FEF5FF` · `400 #FAD6FF` · `500 #F7C2FF` · `800 #702C7A` | pale pink accent / "Best Return" tint |
| **lavenderLight** | `0 #FCFAFF` · `100 #F9F5FF` · `200 #F6F0FF` · `300 #F3EBFF` · `400 #F0E5FF` | **light-mode surfaces** |
| **lavenderDark** | `0 #30007A` · `100 #200052` · `200 #18003D` · `300 #100029` · `400 #0C001F` | deep purple anchors |
| **rubyDark** | `0 #4c2c77` · `100 #341e52` · `200 #26163c` · `300 #1c102d` · `400 #130b1e` · `500 #09050f` | **dark-mode surfaces** (aubergine) |
| **rubyLight** | `0 #dbcfed` · `100 #b49bda` · `200 #9b79cd` · `300 #7f54c0` · `400 #653ca2` | dark-mode accents (lavender-purple) |
| **blue** | `500 #5C67FF` | secondary cool accent |
| **azure** | `500 #4791FF` | info/cool accent |
| **slate** | `500 #001652` · `900 #00081F` | deep navy alt |
| **amber** | `300 #FFDE5C` · `500 #D6AB00` | warning/reward |

**Semantic colors [source]:** success `#0AA65B` (green), error `#E5452F` (vermillion), warning `#FFCC00`, info `#297EFF`. (These are the green check, red error, etc.) Note success is a *true balanced green*, not lime — reads "safe/done," not "go fast."

**Alpha scales [source]:** full `alphaDark100…900` and `alphaLight100…900` (e.g. `alphaDark200 = rgba(0,0,0,0.08)`, `alphaLight200 = rgba(255,255,255,0.08)`). These do almost all the surface-layering and border work — overlays on tinted backgrounds, not opaque greys. This is the trick that makes the dark theme feel "glassy/layered" without literal blur.

### 1b. Brand semantic palette (light + dark)  **[source]**
From [`src/theme/brandColors.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/brandColors.ts) and [`src/theme/colorSchemes.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/colorSchemes.ts). This is the layer FreeFlo should imitate structurally.

| Token | Light | Dark |
|---|---|---|
| `bg` (page bg) | `#F6F0FF` (lavenderLight 200) | `#120b1e` (between rubyDark 400/500) |
| `surface1` (card) | `#FCFAFF` | `#26163c` (rubyDark 200) |
| `surface2` | `#F9F5FF` | `#1c102d` (rubyDark 300) |
| `surface3` | `#F6F0FF` | `#130b1e` (rubyDark 400) |
| `surface4` | `#F3EBFF` | `#09050f` (rubyDark 500) |
| `accent1` (primary) | `#31007a` (deep purple) | `#653ca2` (rubyLight 400) |
| `accent2` | `#8700B8` (magenta) | `#b49bda` (rubyLight 100) |
| `primary.main` (button) | `#31007A` | `#653ca2` |
| `secondary.main` | `#E9E1F5` (light lilac) | rubyLight 100 |
| `text.primary` | `#000000` | `#FFFFFF` |
| `text.secondary` | `#747474`-ish | `rgba(255,255,255,0.75)` |
| `logoPrimary` | `#31007a` | `#b49bda` |
| `logoSecondary` | `#8700B8` | `#D35CFF` (violet 500) |
| `border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` |
| `borderActive` | `#FAD6FF` (orchid 400) | `#653ca2` |

**Takeaways:**
- **Dark mode is the signature.** Background `#120b1e` is a near-black *aubergine*, not pure black or navy — warmer and more premium. Surfaces step in luminance via the ruby-dark ramp (`#26163c → #09050f`), so cards read as gently raised tiles, all same hue family.
- **Accent strategy is monochromatic-purple.** Light mode's primary action is a *very* dark indigo `#31007a`; dark mode's is a *lighter* lavender-purple `#653ca2`. Magenta `#8700B8 / #D35CFF` is the secondary "energy" accent (badges, highlights, "Best Return" tag), used sparingly.
- **Borders are alpha overlays (8%)**, never hard lines.

### 1c. Signature gradients / ambient glow  **[source]**
Jumper does **not** use loud linear gradients on buttons. The signature gradient is the **ambient background glow** behind the widget:

```
light: bgGlow1 rgba(136, 0, 255, 0.12)   // purple
       bgGlow2 rgba(187, 0, 255, 0.12)   // magenta
       bgGlow3 rgba(0, 68, 255, 0.12)    // blue
dark:  bgGlow1/2/3 = rubyLight 400 (#653ca2)
```
Three low-opacity (12%) radial glows — purple, magenta, blue — bleed up from behind the centered card. The effect is a soft aurora, *not* a hard gradient. There is also a fixed full-viewport `Background` layer ([`components.ts` → `Background.styleOverrides`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/components.ts), `position:fixed; inset:0; zIndex:-1; backgroundSize:cover`) that hosts this glow/imagery behind everything. **Confidence: high [source].**

### 1d. Glassmorphism
- **Tooltips are the one literal glass element:** `backgroundColor: rgb(0 0 0 / 64%)` + **`backdropFilter: blur(3px)`** ([`components.ts` MuiTooltip, source]).
- The broader "glassy" feel comes from **alpha-on-tint layering** (1a) + the ambient glow, not heavy blur. This is a restrained, modern take — much more legible than full frosted-glass, which is the right call for a money app.

---

## 2. Typography  **[source]**

From [`src/fonts/fonts.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/fonts/fonts.ts) and [`src/theme/typography.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/typography.ts).

**Typefaces loaded:** Inter, Manrope, Urbanist, Sora, IBM Plex Sans (all `next/font/google`), plus **Sequel 100 Wide** (weights 65 & 85, local `.woff2`). The active roles:
- **`body` = Inter** — all UI text, numbers, amounts.
- **`display` = Urbanist** — all headings (`h1…h6`, `urbanistTitle*`). Geometric, friendly, slightly sporty.
- **Sequel 100 Wide** — a wide condensed display face reserved for marketing/brand headers **[inference — loaded but not the default `display`]**.
- Fallback stack: `Inter, Arial, Noto Sans, BlinkMacSystemFont, Segoe UI, Helvetica Neue, sans-serif`.

**Headings are heavy and tight.** All `h*` and `header*` and `title*` variants are **weight 700**, `letterSpacing: 0`. Display sizes are large and confident.

**Type scale (selected, exact px) [source]:**

| Token | size / line-height / weight | Font |
|---|---|---|
| `h1` | 48→**64**px (≥sm) / 72 / 700 | Urbanist |
| `h2` | 36px / 48 / 700 | Urbanist |
| `h3` | 28px / 36 / 700 | Urbanist |
| `urbanistTitle3XLarge` | 96px / 112 / 700 | Urbanist |
| `headerXLarge` | 64px / 96 / 700 | (display) |
| `bodyXLargeStrong` | 24px / 32 / **800** | Inter |
| `bodyLarge` | 18px / 24 / 500 | Inter |
| `bodyMedium` | 16px / 20 / 500 | Inter |
| `bodySmall` | 14px / 20 / 400 | Inter |
| `bodyXSmall` | 12px / 16 / 500 | Inter |
| `bodyXXSmall` | 10px / 14 / 400 | Inter |

**Character of the type system:**
- A **dense, semantic, named scale** (`bodyMediumStrong`, `bodyXSmall`, etc.) rather than raw MUI `body1/h6`. Each token pins font/size/weight/line-height so usage is unambiguous. Worth copying.
- Body weight defaults to **500 (medium)**, not 400 — gives UI text a solid, deliberate feel at small sizes.
- "Strong" variants jump to **700/800** for emphasis (amounts, key labels).
- Numbers use Inter (good tabular legibility); amounts on screen are large and bold **[screenshot]**.

---

## 3. Layout & spacing

### 3a. The widget container  **[source]**
From [`src/config/widgetConfig.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/config/widgetConfig.ts):
- **`WIDGET_WIDTH = 416` px, `WIDGET_HEIGHT = 720` px.** This is the canonical card. On mobile it goes full-width/full-height; at ≥`sm` it locks to 416×720, centered, with `boxShadow: shadows[1]`.
- **Container border-radius:** 24px (V2 config) / 12px (V1). Cards inside: 24px.
- **Routes panel** ("Receive"/quotes): **`maxWidth/minWidth: 436` px** — slides out to the *right* of the main card (desktop) or replaces it (mobile).
- **Chain sidebar:** 256px, also a side panel.
- App content max-width `1280` px ([`components.ts` MuiContainer]); the widget sits centered in that field over the glow background.

### 3b. Radius system  **[source]**
From [`src/theme/shape.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/shape.ts) — unusually explicit:
```
borderRadius: 12          buttonBorderRadius: 128   (full pill)
borderRadiusSecondary: 8  inputTextBorderRadius: 24
cardBorderRadius: 24      menuRadius: 24
cardBorderRadiusSmall: 12  …Medium: 16  …Large: 24  …XLarge: 32
tabBarRadius / tabRadius: 128   radiusRoundedFull: '100%'
```
So: **buttons & tabs are full pills (128)**, **cards/inputs/menus are 24**, **small chips 12**, fine details 4–8. Two dominant radii (128 pill, 24 card) is the whole visual rhythm.

### 3c. Density & spacing  **[screenshot + source]**
- Generous internal padding inside the card; From/To/Send fields are **tall, airy cards** with the label top-left and lots of breathing room **[screenshot]**.
- 8px base spacing unit (MUI default `theme.spacing(1)=8`), used in component overrides (`gap: theme.spacing(1)`, tooltip `padding: theme.spacing(1, 1.5)`).
- Shadows are **soft and low**: light-mode `shadows[1] = 0px 2px 4px rgba(0,0,0,0.08), 0px 8px 16px rgba(0,0,0,0.08)` [source, `colorSchemes.ts`]. Depth via blur+spread, never dark/harsh.

### 3d. Responsive behavior
- **Mobile:** widget is full-bleed; side panels (routes, chains) become full-screen replacements rather than adjacent columns. Reviews consistently praise the **mobile experience as seamless** [3rd-party — [Milk Road](https://milkroad.com/reviews/jumper-exchange/), [subscribed.fyi](https://subscribed.fyi/jumper-exchange/experience/)].
- **Desktop:** the card stays the *same 416px width* and *expands horizontally* with adjacent panels — it never becomes a wide multi-column form. The "small focused object floating in space" model is deliberate and central to the brand feel.

---

## 4. Components

All component facts are **[source]** from [`src/theme/components.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/components.ts) unless flagged. Note: the *swap-flow* components (route rows, step rows, drawers) live inside `@lifi/widget` and are themed via the LI.FI customization API ([docs](https://docs.li.fi/widget/customize-widget)); the catalog of themeable widget components includes `MuiAppBar, MuiAvatar, MuiButton, MuiCard (outlined/elevation/filled), MuiDrawer, MuiIconButton, MuiInputCard, MuiNavigationTabs, MuiTabs, MuiCheckbox`.

**Buttons [source]:**
- Default `size: large` → **height 48px** (medium 40, small 32).
- `borderRadius: 24` in `components.ts`, but the *brand* `buttonBorderRadius` token is `128` (full pill) — and the rendered CTAs are **fully rounded pills** **[screenshot]**.
- `textTransform: 'none'` — sentence case, never ALL CAPS.
- **Primary CTA:** solid purple pill, full card-width, white bold label ("Exchange", "Done") **[screenshot]**.
- **Secondary:** muted/translucent purple pill, same shape ("See details") **[screenshot]**.
- **Icon buttons:** circular, `color: inherit`, no hover color shift — used for the swap-direction ⌄/→ toggle, settings gear, history, expand chevrons, external-link, and the standalone circular **wallet** button beside the CTA **[screenshot]**.

**Inputs (amount entry) [source + screenshot]:**
- Outlined inputs use a **`1px solid #554F4E`** border across default/hover/focus (i.e. no color jump on focus — subtle). `inputTextBorderRadius: 24`.
- In the swap card, the amount field is a **large card-as-input** ("From"/"To"/"Send" tiles): big tap target, label top-left, token selector + balance inside, amount right-aligned and large **[screenshot]**.
- Form labels stay `text.primary` even when focused (no MUI blue) [source, MuiFormLabel].

**Token / route selectors [screenshot + 3rd-party]:**
- Token select opens a searchable list/drawer; assets shown with circular token logos + chain badge.
- Chain selection is a dedicated 256px sidebar panel [source, `chainSidebarContainer`].
- Provider/route logos are small circular avatars (`objectFit: contain`, [source MuiAvatar]) — e.g. Across, Stargate, Mayan, SushiSwap, 1inch, Kyberswap **[screenshot]**.

**Cards:** 24px radius, `surface1/2` fill, **borderless** (default `ThemeBorders` are all `width:0, style:'none'` [source, `borders.ts`]) — separation is by fill luminance + soft shadow, not strokes.

**Modals / drawers [screenshot]:**
- **Connect-wallet** is a modal/drawer titled "Connect wallet" with an X close, then a vertical list of wallets, each = circular brand icon + name (MetaMask, Coinbase Wallet, WalletConnect, Phantom, Brave Wallet).
- **Success** is a **bottom sheet that slides up over a dimmed version of the execution screen** — the prior screen stays visible behind, darkened, reinforcing continuity.

**Chips / badges [source + screenshot]:**
- **"Best Return" tag** = small pill, magenta/purple gradient-ish fill, on the recommended route card; that whole card also gets a purple-tinted surface + `borderActive` outline to read as "selected/recommended" **[screenshot]**.
- Badge tokens exist in brand palette (`badgeAccent1Bg/Fg`, muted variants) [source].

**Tabs:** pill-shaped (`tabRadius 128`), row layout, icon+label, `minHeight 40px` [source].

**Tooltips:** dark translucent (`rgb(0 0 0 / 64%)`) + `blur(3px)`, 12px text, arrow [source].

**Toasts/snackbars:** anchored **top: 80px** (below the header), not bottom [source, MuiSnackbar].

**Settings:** gear icon in the widget header opens slippage/route-priority/preferences (standard LI.FI widget settings) **[screenshot + 3rd-party]**.

---

## 5. THE CORE UX FLOWS  ← most important for FreeFlo

> Verified against Jumper's own marketing screenshots committed to the repo at [`public/widget/*.png`](https://github.com/jumperexchange/jumper-exchange/tree/develop/public/widget) (light + dark for every state: `selection`, `swap-amounts`, `quotes`, `swap-quotes`, `review-bridge`, `execution`, `success`, `connect-wallet`). I rendered and inspected these directly. Marked **[screenshot]**.

### 5a. Amount + asset selection  **[screenshot]**
Single card titled **"Exchange"** (heavy Urbanist). Three stacked tall tiles:
- **From** (source chain/token + amount), **To** (destination), **Send** (recipient/amount-out) — labels top-left, big rounded tiles.
- A **circular direction button centered on the divider** between From and To (a `↓` in the stacked layout, `→` in the side-by-side layout) to flip direction — a signature micro-affordance.
- Header row: title left; **history (receipt) icon + settings gear** top-right.
- Bottom: **full-width purple pill CTA "Exchange"** + a **separate circular wallet button** to its right.
- Empty state shows the tiles with just labels — calm, not cluttered.

### 5b. Route / quote selection  ← study this closely  **[screenshot + source + 3rd-party]**
The card expands right into a **436px "Receive" panel** listing routes as stacked cards. Each route card shows:
- **Provider icon + name** (Across, Stargate, Mayan, SushiSwap Aggregator, 1inch, Kyberswap…).
- **⛽ gas cost** (e.g. `<$0.01`, `$0.45`) and **🕐 time estimate** (e.g. `45s`, `19m`, `7m`) on one line.
- A **chevron (⌄)** to **expand the route** into its per-hop breakdown (steps, bridge+DEX used, fees) — LI.FI returns ranked routes with per-step detail [[LI.FI request-routes docs](https://docs.li.fi/sdk/request-routes)].
- The **top/recommended route is tagged "Best Return"** (a magenta pill) and visually elevated: purple-tinted card fill + active border. (LI.FI's internal `CHEAPEST`/best ranking surfaces as the **"Best Return"** label [[3rd-party/docs](https://docs.li.fi/integrate-li.fi-widget/configure-widget)].)
- A spinner top-right indicates routes still refreshing.
- **Key UX principle:** the best route is *pre-selected and highlighted*; alternatives are present but secondary. The user can accept the default in one tap or expand/compare. Decision is framed around **what you receive + cost + time**, the three things that matter — not raw technical routing.

### 5c. Execution / step-by-step progress  ← the crown jewel for FreeFlo  **[screenshot]**
After picking a route → a **Review** screen, then an **Execution** screen. From the committed `widget-review-bridge` and `widget-execution` shots:

- **Header:** back arrow (←) top-left; a **circular progress ring** top-right (indeterminate while working).
- **The route is reaffirmed as a big card:** provider lockup **"Across via LI.FI"** with the provider avatar + a small Jumper/LI.FI badge, subtitle **"<$0.01 estimated costs."**
- **A live countdown timer** with a clock icon: **`0:37`** (review screen shows the estimate `45s` with the clock; execution counts *down* `0:37`) — sets expectation and reduces "is it stuck?" anxiety. **This is the single most borrow-worthy element.**
- **Per-step status via a circular spinner** on the active step (the small ring inside the card), advancing to a check on completion.
- **Per-step transaction link:** a square **external-link icon button** (↗) opens the on-chain tx in an explorer — present *during* execution, not just after.
- **Expand chevron (⌄)** to see the full step list / cost breakdown.
- **Cost summary footer card** pinned at the bottom (⛽ `<$0.01` + expand).
- The execution view is **calm and reassuring**: one dominant card, a timer, a spinner, a tx link. No scary walls of text, no aggressive red, no jargon dump. Underlying LI.FI status model is `PENDING → DONE → FAILED` [[LI.FI status docs](https://docs.li.fi/li.fi-api/li.fi-api/status-of-a-transaction)], surfaced as spinner → check → error.

### 5d. Success state  **[screenshot]**
- A **bottom sheet slides up over the dimmed execution screen** (continuity — you can still see where you were).
- Centered **green check (`#0AA65B`) inside a soft tinted circle** — restrained, *no confetti*.
- Two pill actions at the bottom: secondary **"See details"** (muted purple) + primary **"Done"** (solid purple).
- Tone: quiet confidence, "handled." For a money app this restraint reads as *trustworthy* rather than gimmicky.

### 5e. Error / retry state
- Not in the committed marketing screenshots (they only ship happy-path). Inferred from semantic tokens + LI.FI model: errors use **`error #E5452F`**; failed steps flip the spinner to an error glyph; the widget exposes retry and a Discord/status-bot fallback for stuck cross-chain txs [[3rd-party Milk Road](https://milkroad.com/reviews/jumper-exchange/), [DEXTools tutorial](https://www.dextools.io/tutorials/how-to-use-jumper-exchange-tutorial-2026)]. **Confidence: medium.** Notably, partial-failure handling (source done, destination pending) is a known hard case they lean on support tooling for — a gap FreeFlo can do *better* on given its narrower flow.

### 5f. Wallet connection  **[screenshot]**
"Connect wallet" modal: title + X, vertical wallet list with circular brand icons (MetaMask, Coinbase, WalletConnect, Phantom, Brave). After connect, a compact circular wallet button sits beside the primary CTA in the swap card. Clean, conventional, low-friction.

### 5g. Mascot / character branding
- **No literal character mascot.** Searches for a Jumper creature/astronaut mascot returned nothing relevant. The brand identity is **abstract/typographic**: a geometric "Jumper" wordmark + arrow/jump motif, carried by the purple palette and the ambient glow, with `logoPrimary`/`logoSecondary` color tokens [source]. The personality lives in **color + motion + copy**, not a character. **Confidence: high** (absence verified across multiple searches). *Implication for FreeFlo: a mascot is optional, not table-stakes — a strong color+motion+voice system can carry brand alone.*

---

## 6. Motion / interaction / microinteractions

- **In-card screen transitions:** the entire flow (select → quotes → review → execution → success) happens by **swapping screens within the same card and sliding panels in from the side**, plus a **bottom-sheet for success** — not full-page route changes. Feels like a tactile, self-contained machine. **[screenshot, inferred from layout config]**
- **Direction toggle:** the centered circular From↔To button is the signature interactive flourish [screenshot].
- **Live timers + indeterminate progress rings** during routing and execution (the `0:37` countdown, the header spinner) — motion that *communicates state*, not decoration [screenshot].
- **Ambient background glow** is a slow, soft aurora behind the card (the three 12%-opacity glows) — likely gently animated [inference; tokens are static but positioned for it].
- **Smooth scroll** globally (`scrollBehavior: 'smooth'`, [source MuiCssBaseline]).
- **Restrained hover states:** icon buttons keep `color: inherit` on hover (no jarring recolor); input borders don't change color on focus. Motion is purposeful, never busy. **This restraint is a feature for a trust-sensitive product.**

---

## 7. Copy tone & microcopy  **[3rd-party, verbatim where quoted]**

Sources: [jumper.xyz](https://jumper.xyz/) ("Smart App for the Universal Market"), [Jumper Learn](https://jumper.xyz/learn/jumper) ("Crypto's Everything Exchange").

- **Taglines:** *"Crypto's Everything Exchange."* · *"Smart App for the Universal Market."*
- **Hero value prop (verbatim):** *"Swap any token. From here to anywhere. Jumper will find you a route and get you there."* — note the second-person, journey metaphor, and the promise to *do the work for you*.
- **Signature CTA (verbatim):** *"Make. The. Jump @ jumper.exchange"* — staccato periods for rhythm/emphasis.
- **Audience framing (verbatim):** built for *"our beloved Degens"* and *"Normies"* / newcomers *"wanting to get into crypto without risking your funds."*
- **In-product copy is terse and plain:** "Exchange," "From / To / Send," "Receive," "Best Return," "estimated costs," "See details," "Done," "Connect wallet." Verbs and nouns, no jargon, sentence case. Numbers/timers do the talking.
- **Tone overall:** energetic and confident but *reassuring* — "we'll find the route and get you there." The hard stuff is abstracted; the user is told *what they get*, not *how the plumbing works*.

---

## 8. For FreeFlo: BORROW vs AVOID

FreeFlo's wizard is scarier than a swap: a real-money **SEPA fiat payment** the user makes from their bank, then a **proof step**, then a claim. The user can lose money if they fumble. That raises the bar on *trust, clarity, and irreversibility cues*. Map Jumper's patterns accordingly.

### ✅ BORROW

1. **The single floating card model (416×720) over an ambient glow.** A focused object beats a sprawling page for a step-by-step money flow. Adopt the centered card + soft aurora background; it reads premium and keeps attention on one decision at a time.
2. **The named, semantic type + color + radius token system.** Steal the *structure* wholesale: a `baseColors` ramp layer → `brandColors` semantic layer (surface1–4, accent1/2, button*, badge*, glow*) → light/dark `colorSchemes`. Named type tokens (`bodyMediumStrong`, etc.). This is a mature, maintainable system and far better than ad-hoc CSS.
3. **The execution/progress screen — this is the template for FreeFlo's pay→prove→claim view.** Specifically:
   - **A reaffirmed summary card** of *what's happening* (amount, recipient, cost) at the top of every step.
   - **A live timer / countdown** ("~30s", "0:37") to kill "is it frozen?" anxiety — *especially* valuable across the SEPA-Instant wait and the TLSNotary proof generation.
   - **Per-step status: spinner → green check**, with each step labeled in plain language.
   - **Per-step tx/explorer links present during execution**, not buried in a final receipt — directly maps to FreeFlo showing the on-chain intent / fulfill tx and (where possible) a payment reference.
   - **Calm visual hierarchy:** one dominant card, soft colors, no jargon dump.
4. **Route/quote selection pattern → FreeFlo's quote/solver pick.** Stacked cards, each = provider + **cost + time** + expand-for-detail, with the recommended one **tagged ("Best Return") and pre-selected**. FreeFlo can mirror this for solver quotes: highlight the best rate, show fee + ETA, let power users expand. Frame the choice as *what you receive*, not mechanics.
5. **Restrained success (bottom sheet over dimmed prior screen, green check, "Done").** No confetti. For real money, quiet confidence > celebration. Keep the prior context visible behind the sheet for continuity.
6. **Pill buttons (full radius), 24px cards, borderless surfaces separated by luminance + soft shadow, sentence-case labels, `textTransform:none`.** Cheap to adopt, instantly "polished."
7. **Voice: do-the-work-for-you, second-person, plain verbs.** "We'll send the euros and prove it for you," not protocol-speak. Borrow the *reassuring confidence*; numbers/timers carry detail.
8. **Glow-not-gradient + alpha-layering for the dark theme**, with literal blur reserved for tooltips only. Legible, modern, not gaudy.
9. **The centered direction/affordance microinteraction** as a moment of delight in an otherwise serious flow.

### ⚠️ ADAPT / AVOID

1. **Don't inherit Jumper's thin error/partial-failure story.** They lean on Discord + a status bot for stuck cross-chain txs [3rd-party]. FreeFlo's failure modes are *scarier* (fiat sent but proof fails; intent expired `QuoteWindowClosed`; nullifier reused). **Design first-class error + recovery states**: what went wrong, is my money safe, what do I do now, can I retry/cancel/refund. This is where FreeFlo must *exceed* Jumper, not copy it.
2. **The 416px-locked, never-widening card is great for a swap but tight for FreeFlo's heavier steps** (entering/confirming an IBAN, reading a payment-instruction screen with an amount + reference to copy into a banking app, the proof/upload step). Keep the focused-card *feel*, but allow a roomier step layout (or a wider card / a two-pane "instructions + status" on desktop) where a real-money action needs more explanation. Don't cram a scary bank-transfer instruction into a swap-sized tile.
3. **A swap is ~instant and reversible-ish; a SEPA payment is neither.** Jumper's breezy "one tap, we got it" confidence must be **tempered with explicit irreversibility cues and a deliberate confirm** at the fiat-send step (clear "you are about to send €X from your bank — this cannot be undone," amount + reference shown prominently, maybe a typed/confirm gate). Borrow the calm, *add* the gravity.
4. **Don't over-abstract the steps.** Jumper hides routing complexity — good. But FreeFlo's user must *act* (send fiat, generate proof). Each step's required user action must be **loud and unambiguous**, not minimized into a subtle subtitle. Use Jumper's clean visual frame, but make the call-to-action per step impossible to miss.
5. **Marketing energy ("Make. The. Jump," "Degens") is on-brand for a DEX aggregator but may undercut trust for a regulated-feeling fiat offramp.** Keep the warmth and second-person voice; dial down meme/hype register in-product. Match FreeFlo's actual risk posture.
6. **Don't ship happy-path-only.** Jumper's repo screenshots are all success states. FreeFlo must storyboard and build the *unhappy* paths (timeout, proof failure, wrong amount sent, solver no-show) to the same polish as the success path — that's the real trust differentiator for a money app.

---

## Appendix — Source map

**Primary (source-of-truth, Jumper open-source repo, branch `develop`):**
- [`github.com/jumperexchange/jumper-exchange`](https://github.com/jumperexchange/jumper-exchange) — repo root
- [`src/theme/baseColors.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/baseColors.ts) — color ramps & alpha scales
- [`src/theme/brandColors.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/brandColors.ts) — light/dark brand semantics, glows
- [`src/theme/colorSchemes.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/colorSchemes.ts) — palette mapping, shadows
- [`src/theme/typography.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/typography.ts) — type scale
- [`src/fonts/fonts.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/fonts/fonts.ts) — typefaces (Inter, Urbanist, Sequel 100 Wide, …)
- [`src/theme/shape.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/shape.ts) — radius tokens
- [`src/theme/borders.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/borders.ts) — borderless surfaces
- [`src/theme/components.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/theme/components.ts) — MUI overrides (buttons, inputs, tooltips, snackbar, background)
- [`src/config/widgetConfig.ts`](https://github.com/jumperexchange/jumper-exchange/blob/develop/src/config/widgetConfig.ts) — widget dims (416×720), panels, radii
- [`public/widget/*.png`](https://github.com/jumperexchange/jumper-exchange/tree/develop/public/widget) — official flow screenshots (selection, amounts, quotes, swap-quotes, review-bridge, execution, success, connect-wallet; light+dark) — **rendered & inspected directly**

**LI.FI widget (the underlying flow component):**
- [LI.FI — Customize Widget](https://docs.li.fi/widget/customize-widget) — palette/shape/typography/component theming taxonomy
- [LI.FI — Configure Widget](https://docs.li.fi/integrate-li.fi-widget/configure-widget) — variants, "Best Return"
- [LI.FI — Request Routes/Quotes](https://docs.li.fi/sdk/request-routes) — ranked routes, per-step detail
- [LI.FI — Status of a Transaction](https://docs.li.fi/li.fi-api/li.fi-api/status-of-a-transaction) — PENDING/DONE/FAILED
- [LI.FI Widget knowledge-hub](https://li.fi/knowledge-hub/li-fi-widget/) — Standard/Expandable/Drawer variants

**Brand voice / marketing:**
- [jumper.xyz](https://jumper.xyz/) — "Smart App for the Universal Market"
- [Jumper Learn — "Crypto's Everything Exchange"](https://jumper.xyz/learn/jumper) — voice, audience, taglines

**Third-party reviews (UX corroboration):**
- [Milk Road — Jumper Review 2026](https://milkroad.com/reviews/jumper-exchange/)
- [DEXTools — How to Use Jumper (2026)](https://www.dextools.io/tutorials/how-to-use-jumper-exchange-tutorial-2026)
- [subscribed.fyi — Jumper UI/UX showcase](https://subscribed.fyi/jumper-exchange/experience/)
- [CryptoAdventure — LI.FI Review 2026](https://cryptoadventure.com/li-fi-review-2026-cross-chain-aggregation-route-quality-widget-ux-and-bridge-risk-transparency/)

**Confidence notes:** Sections 1–4 and the component catalog are **high confidence (direct from source)**. Section 5 flows are **high confidence (official screenshots inspected)** except 5e error/retry which is **medium (inferred — not shown in shipped screenshots)**. Landing-page motion specifics and Sequel-font usage are **inference**; `jumper.xyz` and `subscribed.fyi` blocked direct fetch (403/bot-protection), so landing visuals were corroborated via search snippets + the source tokens rather than a live DOM read.
