# Sheltüh Brand Direction One: "Structured Expression" (web design system)

Status: proposed · Owner: ui-design-director · Scope: the whole site, from 320px up. **This file is the visual source of truth.** If an older spec (`mobile-home.md`, `home.md` §2 before this date, `mobile.md`, `favourites-analytics.md`, `whos-going.md`, `messaging.md`) conflicts with it on colour, type, radius, shadow or motion, this file wins. Their structure, behaviour, data and accessibility rules still stand. The one exception is `check-in.md`: the door scanner keeps its own functional palette (§2.6).

**Source:** the owner's PDF "SHELTÜH BRAND DIRECTION ONE", pp. 1–27. Vectors are in `public/brand/`: `sheltuh-wordmark.svg` (uppercase), `sheltuh-wordmark-lowercase.svg`, `sheltuh-u.svg` (secondary ü) and `sheltuh-dots.svg` (two-dot mark), all `fill="currentColor"`.

**Code read:** `app/globals.css`, `app/layout.tsx`, `app/manifest.ts`, `app/icon.svg`, `app/events/page.tsx`, `app/events/[slug]/page.tsx`, `app/login/page.tsx`, `components/{Nav,Footer,AuthNavLinks,EventArt,EventDetailsView,TicketSelector,CheckoutConfirmation,EventFilterBar,EventBrowser,SearchBar,ContentPage,DemoNotice}.tsx`, `components/ui/{Button,Section,EventTile,Field,Sticker}.tsx`, `components/home/phone/{HomeEventCard,PhoneHero,GoingStack}.tsx`, `components/map/{MapEventMarker,category-ring}.ts*`, `components/tickets/{TicketStub,UBarcode}.tsx`, `lib/{pricing,fees,types}.ts`, `lib/pwa/theme.ts`, `lib/live/adapt.ts`, `lib/sample-events.ts` (poster palettes), `lib/api/types.ts` (`CustomerOrder`), `tests/{phone-home-tokens,door-tokens,pwa-manifest,Button,SceneMap,EventTile,TicketSelector,TicketQr}.test.*`, `e2e/pwa.spec.ts`, `docs/design-system.md`, `docs/design/{home,mobile-home}.md`, `docs/pwa.md`.

---

## 0. What the brand book actually shows

These principles come from the pages themselves, not from the brief.

| Observation (page) | Why it works | What it means for the web |
| --- | --- | --- |
| Every page has a **1px rule across the top, then a three-part running strap**: "SHELTÜH · DIRECTION ONE · 07" (all pages) | It's structure before expression. The reader always knows where they are, and the big type has a quiet frame to push against. | Section heads and page headers get a rule and a mono strap (§6.4). This is the "structured" half of the brand. |
| **Huge uppercase grotesk headlines set bottom-left**, tracking tight, against empty space (pp. 1–3, 5, 27) | Scale contrast. A single loud line plus a lot of negative space reads as confident and editorial, not busy. | The display sizes go big, with one display line per view and generous space around it. The book's headlines are set in a tight grotesk (Instrument Sans–like), not Bootzy. |
| **Bootzy is for the logo and rare hero moments**: its soft, blobby, heavy forms appear only in the wordmark and the "Aa" sample (pp. 7–10, 24) | One expressive face that's used rarely stays special. | `font-display` (Bootzy) is used only on brand question lines and the hero (§3). All other headings use Instrument Sans. |
| **Rounded squares, never circles**: the umlaut dots, the logomark, the palette swatches (r ≈ 6.5% of width), and the ü's terminals (pp. 11–23) | It's a signature shape that's distinct from the pill and circle language of generic SaaS. | Controls, cards and avatars are rounded squares (§2.4). Pills and circles are retired. |
| **Orange as a field or as a mark, never as body text**: full orange panels with black or white display type, orange logo on black (pp. 9, 10, 13, 14, 25, 26) | Orange carries the energy, and black and cream carry the reading. | Orange is used for fills, marks, primary conversion CTAs and large display text only (§2.2). |
| **Photo chips inline with type**: "WHAT'S ON.[photo]", "[photo]SHELTÜH / [photo]NEAR Ü." (p. 25) | The type and the photography interlock, which feels like a magazine cover rather than a template hero. | An optional `InlinePhoto` device for brand lines (§8.3). |
| **Candid, flash-lit, close-cropped people** at parties and shows (pp. 25–26) | It's real culture, not stock. | Photography rules (§8.1). |
| Small **square bullets** "▪" (p. 4) | They echo the dot shape at text scale. | List bullets in content pages (§5). |

## 1. Audit: the current UI against the brand

1. **Wrong palette.** Paper `#f3f0e8` and ink `#0b0b0b` aren't brand values. Pink `--pop` (`#ff4fb0`), acid yellow `--highlight` (`#e8ff3a`) and five category hues (including purple `#7a2fc0`) aren't in the brand. Signal Orange appears nowhere.
2. **Wrong type.** The display face is Bricolage Grotesque 800 and the body is Inter (`app/layout.tsx`). The brand specifies Bootzy, Instrument Sans and IBM Plex Mono. There's no mono role, so dates and metadata are set in tracked Inter caps (`eyebrow`).
3. **The wordmark is typeset, not drawn.** `Nav.tsx` renders `Shelt<span>ü</span>h` in `font-heading`, and `Footer.tsx` sets "Sheltüh" in `display-xl`. The official vectors aren't used anywhere.
4. **Off-brand app icon.** `app/icon.svg` is a stroked U with yellow circle dots on `#0b0b0b`. It isn't the official ü.
5. **Pills and circles everywhere.** Buttons (`.btn` 9999px), the search field, map filter chips, steppers, avatars and map markers are all fully round. The brand's shape is the rounded square.
6. **Inconsistent radius and shadow.** The phone home is soft (16px radius plus `shadow-card`) while everything else is square and flat. The brand rejects decorative shadows, and needs one radius system across the site.
7. **Decorative perpetual motion.** `.float`, `.spin-slow`, `RoundBadge` spin, `Marquee`, `Carousel` drift, and `.ken-burns` (16s infinite alternate) conflict with owner decision 6 in `home.md`.
8. **Sticker graphics that aren't the brand** (`Burst`, `RoundBadge`, `Scribble`). The brand's own graphic device is the two dots, and it's never used.
9. **Fallback poster art is off-palette.** `lib/sample-events.ts` uses neon blue, teal and pink, and live events reuse it via `assignPoster`.
10. **No question-led voice.** Headlines are generic ("All events", "Find your room. Find your people.").
11. **Off-brand transactional email** (`lib/server/ticket-email.ts`: electric blue `#2b3cff` button). Resolved 22 Oct 2026: every transactional email is now built on `lib/server/email-layout.ts` (§9, "Transactional emails").

## 2. Tokens (`app/globals.css`)

### 2.1 Colour tokens: brand → existing names

> **Superseded (23 Oct 2026):** the `--background`, `--surface`, `--surface-border`, `--accent-foreground` and `--cream` rows are replaced by [`theme-white-dark.md`](theme-white-dark.md) §2.1. White replaced cream as the foundation, `--cream` became `--paper`, and there's a Light / Dark switch. The text below is kept as the record.

Most components re-skin through this table alone. **Write hex in lowercase**: `tests/door-tokens.test.ts` and `tests/pwa-manifest.test.ts` match `#[0-9a-f]{6}`, and the manifest test reads the **first** `--background:` in the file, so `:root` must stay first.

| Token | Now | New | Role |
| --- | --- | --- | --- |
| `--background` | `#f3f0e8` | **`#fffae7`** (Cream) | Site foundation and editorial sections |
| `--card` | `#fbfaf5` (home only) | **`#ffffff`** (White) | Cards, fields, ticket stubs, sheets, dialogs. Site-wide now. |
| `--surface` | `#eae6db` | **`#f2ecd6`** | Sunken cream: skeletons, placeholders, selected table rows. **Never behind orange marks** (2.87:1). |
| `--surface-border` | `#d3cec1` | **`#ddd5ba`** | Soft hairline for decorative dividers only. Never a control boundary. |
| `--foreground` | `#0b0b0b` | **`#000000`** (Black) | Text, structure rules, nav |
| `--muted` | `#6b675e` | `#6b675e` (unchanged) | Secondary text |
| `--accent` | `#0b0b0b` | **`#000000`** | Default solid buttons and text links. **Accent stays black**: `text-accent` links (32 uses) would fail if it became orange. |
| `--accent-strong` | `#2b2b2b` | **`#262626`** | Hover on black |
| `--accent-foreground` | `#f3f0e8` | **`#fffae7`** | Text on black |
| `--signal` | — | **`#ff4800`** (Signal Orange) | New. Signature fills, primary conversion CTA, marks, large display. |
| `--signal-foreground` | — | **`#000000`** | New. Text on orange. |
| `--ink` / `--cream` | — | **`#000000`** / **`#fffae7`** | New. Constants that are **never re-scoped** (for `.btn-signal:hover` and similar). |
| `--danger` / `--danger-foreground` | `#b3261e` / `#ffffff` | unchanged | Errors. Never decorative. |
| `--highlight` | `#e8ff3a` | **`var(--signal)`** in increment 1, then **deleted** (§9) | Transitional alias: Demo, Draft, Free badges and the search submit go orange through the token swap alone. |
| `--pop` | `#ff4fb0` | **`var(--signal)`** in increment 1, then **deleted** | Transitional alias. Pink is superseded. |
| `--cat-*` (5) | hues | **deleted** in the map increment (§2.7) | |
| `--door-*`, `[data-door]` | — | **unchanged** | §2.6 |

Add to `@theme inline`: `--color-signal`, `--color-signal-foreground`, `--color-ink`, `--color-cream` (and keep `--color-card`, which is now site-wide).

### 2.2 Contrast (WCAG 2.2; computed with relative luminance: black 0, cream 0.9540, white 1, orange 0.2590)

> **Superseded (23 Oct 2026):** the Light and Dark contrast tables are in [`theme-white-dark.md`](theme-white-dark.md) §2.1 and §2.2. White replaced cream as the foundation, `--cream` became `--paper`, and there's a Light / Dark switch. The text below is kept as the record.

| Text / fill on background | Ratio | Verdict and permitted use |
| --- | --- | --- |
| Black on Cream | **20.08:1** | All text |
| Black on White | **21.00:1** | All text |
| Black on `surface` `#f2ecd6` | **17.74:1** | All text |
| `muted` `#6b675e` on Cream / White / `surface` | **5.39 / 5.63 / 4.76:1** | Secondary text at any size (≥4.5) |
| `danger` `#b3261e` on Cream / White / `surface` | **6.25 / 6.54 / 5.52:1** | Error text |
| Cream on Black | **20.08:1** | Ink sections |
| `muted-ink` `#a39e93` on Black | **7.87:1** | Secondary text in ink sections |
| **Black on Orange** | **6.18:1** | AA for all sizes. **The only small-text pairing on orange.** Buttons, badges, the orange band. |
| **Orange on Black** | **6.18:1** | AA for all sizes: `.btn-signal:hover`, footer wordmark, orange labels on black chips |
| White on Orange | **3.40:1** | **Large text only**: ≥24px regular or ≥18.66px (14pt) bold. For example a white display question line on an orange panel, as on p. 25. Never buttons, never body text. |
| Cream on Orange | **3.25:1** | Large text only, same rule as above |
| **Orange on Cream / White** | **3.25 / 3.40:1** | **Fails 4.5 for text.** Allowed for display text ≥24px regular or ≥18.66px bold (`display-*` and `font-display` only), and for non-text marks (≥3:1): dots, the umlaut marker, focus accents, logos. **Never body, meta, links, labels or prices.** |
| Orange on `surface` | **2.87:1** | **Fails** non-text 3:1. Don't put orange marks on `bg-surface`. |

Rules:
- **Small orange text on light backgrounds is banned.** For emphasis at small sizes, use black text on an orange fill, or black text with an orange mark beside it.
- **Links are black and underlined.** They're never orange.

### 2.3 Scopes and the dark-mode policy

> **Superseded (23 Oct 2026):** "Light only" no longer holds: the theme policy and the ink, signal and new paper scopes are in [`theme-white-dark.md`](theme-white-dark.md) §2.2 and §2.3. White replaced cream as the foundation, `--cream` became `--paper`, and there's a Light / Dark switch. The text below is kept as the record.

- **Light only.** There's no `prefers-color-scheme: dark` theme. That's a brand decision: "predominantly light, cream/white foundations". `html { color-scheme: light }` stays.
- **Ink and orange are sections, not themes.** Add two re-skinning scopes after `:root`. They work exactly like `[data-door]`, so every shared component inverts inside them with no class changes:

```css
[data-surface="ink"] {       /* footer, buy bar, featured card body, FavouritesNotice band, creators card */
  --background: #000000; --card: #141414; --surface: #1a1a1a; --surface-border: #333333;
  --foreground: #fffae7; --muted: #a39e93;
  --accent: #fffae7; --accent-strong: #ffffff; --accent-foreground: #000000;
  --danger: #ff6b5e; --danger-foreground: #000000;   /* 7.52:1 on black */
  background: var(--background); color: var(--foreground);
}
[data-surface="signal"] {    /* at most one full-bleed orange band per page (§7.1) */
  --background: #ff4800; --foreground: #000000; --muted: #000000; /* no grey on orange */
  --surface-border: #000000; --accent: #000000; --accent-strong: #262626; --accent-foreground: #fffae7;
  background: var(--background); color: var(--foreground);
}
```

- `.btn-signal` is **forbidden inside `[data-surface="signal"]`**, because it would be orange on orange.
- `[data-door]` stays the only full-screen dark UI.

### 2.4 Radius (from the brand's rounded squares) and elevation

Replace the home-only `@theme` block:

```css
@theme {
  --radius-card: 0.75rem;   /* 12px  rounded-card:    event media, featured, info cards, sheets, ticket stub, map card */
  --radius-control: 0.5rem; /* 8px   rounded-control: buttons, inputs, selects, search, chips, steppers, menus, toasts */
  --radius-badge: 0.25rem;  /* 4px   rounded-badge:   category chip, date badge, status badge, unread count */
  --radius-dot: 28%;        /*       rounded-dot:     avatars, map markers, category discs (echo the umlaut) */
  --shadow-card: 0 0 #0000; /* increment 1: existing shadow-card classes go flat; deleted in cleanup */
}
```

- **Square (0)** is kept for full-bleed photography, page sections, ruled panels, tables, the map canvas, the nav and the footer.
- **There are no pills and no circles.** `rounded-full` survives only on native radios and checkboxes.
- **No shadows anywhere.** Elevation is expressed by **White on Cream plus a 1px border**:
  - Info cards: `border border-foreground`. This is the palette-card look on p. 23.
  - Fields: `border border-foreground`.
  - Sheets and dialogs: `border border-foreground`, with a flat `rgb(0 0 0 / 0.5)` backdrop and no blur.

### 2.5 Borders, focus, spacing

**Borders:**
- **Structure rules:** `border-t border-foreground`, 1px black: sections, panels, strap rules, the nav bottom edge.
- **Soft dividers:** `border-surface-border`, 1px, between rows inside a white card or table.
- **Control boundaries** (inputs, outline buttons, chips): 1px `foreground` (21:1).

**Focus:**
- Unchanged: `:focus-visible { outline: 2px solid var(--foreground); outline-offset: 3px }`.
- It's black on cream (20:1), cream inside ink scopes (20:1), and black on orange (6.18:1).
- Fields keep `focus-visible:outline-offset-0`.
- **The focus ring is never orange**: next to `.btn-signal` it would merge with the fill.

**Spacing:** 4, 8, 12, 16, 20, 24, 32, 48, 64, 80 and 96px only. That's Tailwind 1, 2, 3, 4, 5, 6, 8, 12, 16, 20 and 24. No arbitrary spacing values except the documented grid offsets.

### 2.6 Door check-in: unchanged

Leave `[data-door]`, `--door-admit #3ddc84`, `--door-refuse #b3261e`, `--door-hold #ffb020` and their foregrounds, and `DOOR_THEME_COLOR = "#0b0b0b"` exactly as they are. They're functional colours in a dark venue, and `tests/door-tokens.test.ts` pins them. The door does take the new fonts (§3) and button shapes through the shared classes.

### 2.7 Category colour policy: replace with monochrome

- The five `--cat-*` hues are used only by the map's marker ring (`components/map/category-ring.ts`). There's no legend, and the category is already in each marker's accessible name and on the card.
- **Retire them.** Markers get a black ring, and an orange ring when selected (§6.10). Categories appear as mono text chips everywhere.
- This removes purple and keeps orange meaningful.
- If differentiation is wanted later, use `CategoryIcon` glyphs, never hues.

## 3. Typography

### 3.1 Faces and loading (`app/fonts.ts`, new; imported by `app/layout.tsx`)

```ts
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
// import localFont from "next/font/local";              // §3.4: uncomment when Bootzy arrives

export const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], display: "swap" }); // variable wght 400–700
export const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", weight: ["400", "500"], subsets: ["latin"], display: "swap" });
// export const bootzy = localFont({ variable: "--font-bootzy", src: [{ path: "./fonts/bootzy/Bootzy-Regular.woff2", weight: "400", style: "normal" }], display: "swap", adjustFontFallback: "Arial", preload: true });
```

- In `<html className>`, `${instrument.variable} ${plexMono.variable}` replaces Bricolage and Inter, so two families are removed. `latin` includes ü, so the subset is enough.
- `next/font` self-hosts the files and adds size-adjusted fallbacks, which minimises CLS.
- Preload stays on for both families: mono dates and Instrument titles are above the fold on cards.

In `:root`:

```css
--face-sans: var(--font-instrument), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
--face-mono: var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
/* THE display token. Bootzy isn't licensed into the repo yet: the fallback is Instrument Sans 700, set
   tight, which is how the brand book sets its own headlines. Flip this block when Bootzy lands (§3.4). */
--face-display: var(--face-sans);
--display-weight: 700;
--display-tracking: -0.045em;
--display-leading: 0.88;
```

`@theme inline` changes:
- `--font-sans: var(--face-sans); --font-mono: var(--face-mono);`
- **Delete** `--font-display` and `--font-heading` from the theme (they collide with the next/font variable names).
- Add two utilities:

```css
@utility font-display { font-family: var(--face-display); font-weight: var(--display-weight); letter-spacing: var(--display-tracking); }
@utility font-heading { font-family: var(--face-sans); font-weight: 700; letter-spacing: -0.025em; }
```

These keep the 40+ existing `font-heading` call sites working, with weight included. The variable font would otherwise default to 400.

`body` uses `font-family: var(--face-sans)`. Fix `EventArt`'s SVG `fontFamily` to `var(--face-display)`.

### 3.2 Scale (utilities keep their names, so call sites re-skin)

Sizes are given as base / `sm` 640 / `lg` 1024. LH is line-height.

| Utility / role | Face | Base | sm | lg | LH | Tracking | Case | Wt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `display-xl`: home hero h1 only | **display token** | `clamp(2rem,10vw,2.625rem)` (32–42) | `clamp(3.375rem,8.5vw,6rem)` | ≤96px | `var(--display-leading)` 0.88 | `var(--display-tracking)` | upper | `var(--display-weight)` |
| `display-lg`: page h1, event title (plain Instrument Sans, no dotted vowels: owner, 29 Oct 2026) | Instrument | `clamp(2rem,8.5vw,2.5rem)` (32–40) | `clamp(2.5rem,5.5vw,3.5rem)` | `clamp(3.5rem,5vw,4.5rem)` (56–72) | 0.95 | -0.035em | upper | 700 |
| `display-lg font-display`: brand question h1 ("What's on.", "Sheltüh near ü.") | **display token** | as `display-lg` | | | 0.9 | display token | upper | display token |
| `display-md`: section h2, empty-state titles | Instrument | 24px / 26 | 28 / 30 | 32 / 34 | — | -0.03em | upper | 700 |
| h3/h4 base rule, `font-heading`: panel and dialog titles | Instrument | 20px / 24 | | | — | -0.025em | upper (base rule, as today) | 700 |
| Card title (h3, overrides) | Instrument | 16 / 22 | | | — | -0.01em | sentence (`normal-case`) | 600 |
| Body large (intro) | Instrument | 16 / 24 | 18 / 28 | | — | 0 | sentence | 400 |
| Body | Instrument | 16 / 24 | | | — | 0 | sentence | 400 |
| Small | Instrument | 14 / 20 | | | — | 0 | sentence | 400 |
| Fine print (minimum size) | Instrument | 12 / 16 | | | — | 0 | sentence | 400 |
| Price | Instrument + `tabular-nums` | 14 / 20 on cards; 16 / 24 for tickets | | | — | 0 | sentence | 600 (total 700) |
| Numerals (`StatGrid`) | Instrument + `tabular-nums` | 32 / 36 | | 40 / 44 | — | -0.03em | — | 700 |
| `eyebrow`: labels, straps, categories, field labels | **Plex Mono** | 12 / 16 | | | — | 0.04em | upper | 500 |
| `meta` (new): dates and times on cards, timestamps, references | **Plex Mono** | 12 / 16 | | | — | 0.02em | upper | 400 |
| Ticket code | Plex Mono | 20 / 28 | 24 / 32 | | — | 0.06em | upper | 500 |
| Nav link | Instrument | 13 / 16 | | | — | 0.01em | upper | 600 |
| Button | Instrument | md 13 / 16, sm 12 / 16, lg 14 / 20 | | | — | 0.02em | upper | 600 |

**Rules:**
- **`font-display` appears at most once per view**, on the h1 of the home page, /events and /map, plus the 404 page. Never on event titles: user-supplied titles get Instrument.
- **Dotted vowels are for the wordmark and the hero headlines only** (owner, 29 Oct 2026). The home h1 ("Find yo^ur next th^ing."), "What's on." on /events and "Sheltüh near you." on /map are the only headlines with dotted letters, and each dots a letter or two, never the whole line (30 Oct 2026): the h1 is `font-display display-plain` (plain Instrument Sans) and `DottedLine` draws only the letters marked with `^` in `font-dots`, so the text and the accessible name stay plainly spelled. Every other title (page titles, section heads such as "This weekend", auth, account, dashboard, admin and checkout titles, organiser and member profile h1s, nav menu items, card titles, the 404 line) is plain Instrument Sans, so `display-lg` alone has no dots. `DottedText` is retired.
- **Uppercase** for display, headings, buttons, nav, eyebrow and meta. **Sentence case** for body, card titles, prices and venue names.
- **Never letter-space lowercase text.**
- Base `h1–h4` keeps `text-transform: uppercase` and `line-height: 0.95`. Its family becomes `var(--face-sans)`, weight 700, tracking -0.025em, so existing headings change by token only.

### 3.3 The "ü" in copy

Brand lines use "ür" and "ü" for "your" and "you". To keep screen readers saying the right words, use one pattern everywhere (helper `components/brand/BrandU.tsx`):

`<span aria-hidden="true">{the line as shown}</span><span className="sr-only">{the whole plain sentence}</span>`, e.g. `<BrandU spoken="Where is your Sheltüh?">…WHERE IS ÜR… SHELTÜH?</BrandU>`. One sr-only span holding the whole sentence (not "your" alone between visible pieces), so screen readers read it as one phrase.

- In "Sheltüh", the ü is real text, unchanged.
- Never put "ür" or "ü" in body copy, buttons, labels or errors. It's for brand lines only.

### 3.4 Dropping in Bootzy later (4 steps)

1. Add the licensed `Bootzy-Regular.woff2` (and its licence file) at `app/fonts/bootzy/`.
2. In `app/fonts.ts`, uncomment the `localFont` import and `bootzy`, and add `${bootzy.variable}` to `<html className>`.
3. In `:root`, flip the display block, which is the single token switch:
   - `--face-display: var(--font-bootzy), var(--face-sans);`
   - `--display-weight: 400;` (or the licensed weight's value)
   - `--display-tracking: -0.01em;`
   - `--display-leading: 0.9;`
4. Re-run `home.md`'s hero line acceptance (exactly 3 lines at 320, 375, 430, 640, 768, 1024 and 1280). If "SHELTÜH?" overflows at 320, lower the base clamp max to `2.375rem`. No component changes.

## 4. Logo usage

> **Superseded (23 Oct 2026):** the theme colour is now `#ffffff` (with `DARK_THEME_COLOR` `#000000` in Dark), per [`theme-white-dark.md`](theme-white-dark.md) §5.1. White replaced cream as the foundation, `--cream` became `--paper`, and there's a Light / Dark switch. The text below is kept as the record.

| Asset | Where | Size on screen | Colour treatments |
| --- | --- | --- | --- |
| **Uppercase wordmark** (primary), `sheltuh-wordmark.svg`, ratio 4.41:1 | Nav (all widths); OG image; email header once a PNG export exists (§11 #6) | Nav: **20px tall (88px wide) below lg, 24px (106px) at lg**. **Minimum 16px tall (71px).** | Black on Cream or White · Cream or White on Black · **Orange on Black** · Black on Orange · Orange on Cream or White (non-text graphic, 3.25:1) |
| **Lowercase wordmark** (secondary), ratio 3.69:1 | Informal and expressive moments only: the footer sign-off (below) | Minimum 20px tall | Same treatments |
| **Secondary ü**, `sheltuh-u.svg`, ratio 0.665:1 | Favicon, app icons, PWA splash; Sheltüh system avatar in Messages; the ticket's `UBarcode` (already a ü, keep it) | Minimum 16px tall | Black on Orange (icons) · any brand pair above |
| **Two-dot mark**, `sheltuh-dots.svg`, ratio 3.15:1 | The motif (§5): loader, markers, empty states, connection states | Minimum 12px wide | Orange, Black or Cream; follows `currentColor` |

**Implementation:**
- Add `components/brand/{Wordmark,UMark,DotsMark}.tsx`. They **inline the paths from `public/brand/*.svg`** with the same viewBoxes, so `currentColor` works and nothing extra is fetched.
- Each is `aria-hidden="true" focusable="false"`. The accessible name sits on the parent: the nav link keeps `aria-label="Sheltüh home"` (`tests/Nav.test.tsx` queries it).

**Never:**
- Typeset the wordmark (§1.3).
- Recolour part of it, outline it, add effects or gradients, stretch it, rotate it, or rebuild it in Bootzy.
- Set it on a busy photo, unless it sits over the featured card's ink scrim or a solid area with ≥3:1 local contrast.

**Clear space:**
- Wordmarks: **25% of the rendered wordmark height on all sides**, which is two umlaut-dot heights. The 24px nav wordmark therefore needs at least 6px (the nav gives 16+).
- ü: 50% of its width.
- Dots: one dot width (32% of the mark's width).

**Placements:**
- **Nav:** the uppercase wordmark in `foreground`.
- **Footer** (ink scope): the full-width uppercase wordmark in **Signal Orange** as the closing sign-off, `w-full h-auto` (247px tall at 1088px content width, 63px at 280). It's `aria-hidden`, because the © line carries the name.
- **Favicon and app icon:**
  - `app/icon.svg` becomes a 64×64 `rect rx="14" fill="#ff4800"` with the official ü path in `#000000`, centred at 60% of the icon height.
  - Maskable and `apple-icon` are full-bleed orange with the ü at **50% height**, inside the 80% safe zone.
  - Regenerate the PNGs and `.ico` with the script in `docs/pwa.md` "Regenerating the icons", with its `svg()` updated to this artwork.
- **Theme colour:** `APP_THEME_COLOR = "#fffae7"`. Also update `public/offline.html`'s `--background`, `--foreground` (`#000000`) and its `theme-color` meta.
- **OG image:** new `app/opengraph-image.tsx` plus a `twitter-image.tsx` re-export, using `ImageResponse` at 1200×630:
  - Background `#ff4800`.
  - The two-dot mark in black, 96px wide, at (96, 96).
  - The uppercase wordmark in black, 720px wide, bottom-left at x 96, bottom 96.
  - **No live text**, so no font fetch is needed.
  - Needs `metadataBase` (see §10).
- **Loading splash** (PWA): Cream background plus the icon, handled by the manifest.

## 5. The two-dot motif

`components/brand/DotsMark.tsx` exports:
- `DotsMark({ size: "xs" | "sm" | "md" | "lg", joined?: boolean, className })`. Widths are xs 12px, sm 20px, md 32px and lg 64px, with height = width ÷ 3.15. It inlines the two paths.
- `DotsLoader({ label?: string; announce?: boolean })`.

"Joined" translates the left path +12.5 and the right path −12.5 user units. That narrows the gap from 1× a dot to about 0.35×, approximating the "additional variation" on pp. 19–22 until its vector arrives (§11).

**Exhaustive list of uses. Nothing else gets dots: no backgrounds, patterns, dividers or cursor effects.**

| # | Use | Spec | Motion | Reduced motion |
| --- | --- | --- | --- | --- |
| 1 | **Strap marker** (section heads, page headers) | `DotsMark xs` in `text-signal` before the strap text, 8px gap. **Not on `bg-surface`.** | None | — |
| 2 | **Active nav item** (the "umlaut") | New utility `umlaut`: a `::before` 10×4px at `top: 2px`, centred over the label. It uses `mask: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 4'><rect width='4' height='4' rx='1'/><rect x='6' width='4' height='4' rx='1'/></svg>")` and `background: var(--umlaut, transparent)`. `aria-current="page"` sets `--umlaut: var(--signal)`; hover sets `--umlaut: var(--foreground)`. In the phone menu the dots are 8×8 squares 4px apart (`size` modifier), aligned over the first letter. | `opacity` 150ms ease-out | Instant |
| 3 | **Selected filter chip** | Two 4×4 `rounded-[1px]` squares, 2px apart, in `bg-signal`, 8px before the label, on the black chip (6.18:1) | None | — |
| 4 | **Loader** | `DotsLoader`: `DotsMark md` in `foreground`, plus `text-sm text-muted` "{label}…". `role="status"` only when `announce` is set (many hosts already own a live region). | Dots move apart ↔ joined, `0.9s cubic-bezier(.45,0,.55,1) infinite alternate` | Static, apart; the text carries the state |
| 5 | **Connection states**: viewer is on Who's Going, joined a waitlist, sent a message request | `DotsMark sm joined`, beside the confirmation heading | Joins **once**, 400ms `cubic-bezier(.2,.7,.2,1)`, then holds | Rendered joined, no animation |
| 6 | **Order confirmed** (checkout) | `DotsMark xs joined` in the strap, **static** (checkout stays quiet, §6.9) | None | — |
| 7 | **Empty states** | `DotsMark lg` in `foreground`, 24px above the title | None | — |
| 8 | **"Up next" badge** | `DotsMark xs` in black before the label, on orange | None | — |
| 9 | **Content bullets** (legal, help) | A single 6×6px black `rounded-[1.5px]` square at `0.6em` from the top, `pl-5`. This is p. 4's square bullet, not two dots. | — | — |

## 6. Components

### 6.1 Buttons (`.btn*` in `globals.css`; `ui/Button.tsx` gains `signal`)

| Variant | Rest | Hover (`@media (hover:hover)`) | Use |
| --- | --- | --- | --- |
| `signal` (new): `btn-signal` | `bg-signal border-signal text-black` (6.18:1) | `bg: var(--ink); border-color: var(--signal); color: var(--signal)` (6.18:1, works on cream and on ink) | **The primary conversion action, at most one per viewport:** home hero "Explore events", the event page buy bar "Get tickets", the sold-out "Join waitlist". **Never in checkout** (§6.9), forms, dashboards or admin. |
| `solid` (default) | `bg-accent text-accent-foreground`: black and cream (20:1), or inverted inside ink | `bg-accent-strong` | Every other primary action: forms, Checkout, dashboards |
| `outline` | transparent, 1px `foreground`, `text-foreground` | `bg-foreground text-background` | Secondary |
| `light` | Retire: it becomes `outline` inside `[data-surface="ink"]` (the scope inverts it) | | |
| `danger` | unchanged | | Destructive |

**Base `.btn`:**
- `inline-flex items-center justify-center gap-2 border rounded-control` (8px), Instrument 600, uppercase, tracking 0.02em.
- Transition: `background-color, color, border-color 150ms`.

**Sizes:** **sm** `min-h-8 px-3 text-xs/4` (32px) · **md** `min-h-10 px-5 text-[0.8125rem]/4` (40px) · **lg** `min-h-12 px-6 text-sm/5` (48px, the thumb action).

**States:**
- **Focus-visible:** the global ring.
- **Active:** `motion-safe:active:translate-y-px`.
- **Disabled and busy:** `bg-surface border-surface-border text-muted opacity-100 cursor-not-allowed`. This replaces `opacity: .5`, because orange at 50% reads as pink.
- **Loading:** label text changes as today ("Booking…"), with no spinner.

Icons in buttons are 16px, stroke 1.75, `aria-hidden`.

**Tests:** `tests/Button.test.ts` adds `buttonClass("signal")` → `"btn btn-signal"`.

### 6.2 Fields (`ui/Field.tsx`, base layer in `globals.css`)

- **Inputs, selects and textareas:** `bg-card` (White), 1px `foreground` border, `rounded-control`, 16px text on phones / 14px from sm (unchanged), `min-h-12 sm:min-h-10`, `px-3`. The base layer's `border-radius: 0` becomes `var(--radius-control)` and `background-color: transparent` becomes `var(--card)`.
- **Label:** `eyebrow text-muted` (Plex Mono 12px).
- **Hint:** 12/16 muted.
- **Error:** `aria-invalid` → border `danger`, plus 14/20 `text-danger` message with `role="alert"` (as today).
- **Disabled:** `bg-surface text-muted border-surface-border`.
- **Checkboxes and radios:** native, `accent-color: var(--foreground)`.
- **`SearchBar`:**
  - Drop the `rounded-full!`, `bg-surface!` and `border-foreground!` overrides: it's a field, `rounded-control bg-card`.
  - The submit is `size-11 rounded-control bg-foreground text-background`, with hover `bg-signal text-black`. Increment 1's alias makes it orange first; change it to black in increment 3, so there's no orange inside forms.
  - **Amended 24 Oct 2026 (owner round: "our search bar similar [to Eventbrite] and a close location"):** the bar is a `rounded-full` pill (an owner-approved exception to "no pills, no circles") holding the words, a divider, a location segment and a round submit. The submit is orange with a black icon (`btn-signal`, 6.18:1) in the home hero and on `/search`, where search is the page's main action; it stays black, orange on hover, in the desktop header, beside pages' own orange actions. Never a white icon on orange. Focus keeps the global ring, inset inside the bar. Behaviour and privacy: `docs/architecture.md`, "Location (near you)".

### 6.3 Chips and filters

- **Filter chip** (`SceneMapFilterBar` toggles; future /events chips): `h-10 rounded-control border border-foreground px-3.5 text-sm font-medium bg-card`.
  - **Selected** (`aria-pressed=true`, or `:checked +`): `bg-foreground text-background` plus §5 #3 dots.
  - Hover: `bg-surface`.
  - Focus: the global ring.
- **Category chip on media:** `eyebrow rounded-badge bg-cream text-black px-2 py-1` at `left-2 top-2`. It's an opaque fill, so contrast is 20:1 regardless of the photo.
- **Status badge** (dashboard and admin): `eyebrow rounded-badge px-2 py-0.5`:
  - **Pending:** `border border-foreground`
  - **Approved / Published:** `bg-foreground text-background`
  - **On sale:** `bg-signal text-black`
  - **Rejected / Suspended:** `border border-danger text-danger`
- **Price badges** (home compact): **"Free"** `bg-signal text-black`; **"Under A$20"** `border border-foreground bg-card`.
- **Demo and Draft labels** (`DemoNotice`, `ContentPage`): `eyebrow rounded-badge bg-signal text-black px-2 py-1`.

### 6.4 Section head and page header

**Strap** (new shared `components/ui/Strap.tsx`):
- `flex items-center justify-between gap-4 border-t border-foreground pt-2 eyebrow`.
- Left: `DotsMark xs` plus a label (e.g. "This weekend").
- Right: an optional note in `text-muted` (e.g. "Fri 23 – Sun 25 Oct").

**`SectionHead`** (home) and **`SectionHeader`** (`ui/Section`):
- Strap, then `mt-3` a row `flex items-end justify-between gap-4`: the h2 `display-md` on the left, and **See all** on the right.
- See all: Instrument 600 14/20, underlined, a 16px → arrow, `min-h-11`.
- The note moves into the strap's right slot. `home.md` §5.6's note text is unchanged.

**`PageHeader`:**
- No top rule (the nav's bottom rule is directly above it).
- `eyebrow` strap → `mt-4` h1 (`display-lg`, or `display-lg font-display` when the new prop `brand` is set) → `mt-4` intro, `text-base sm:text-lg text-muted max-w-xl`.
- Action on the right from sm, as today.
- Spacing `mb-10 sm:mb-14` (unchanged).

**`Panel`:** keep `border-t border-foreground pt-5`. Title: `font-heading text-xl leading-6 mb-4` (drop `display-md !text-2xl`).

### 6.5 Event cards (`ui/EventTile.tsx` and `home/*Card.tsx`): one anatomy

They're **image-first with no container**: the rounded-square image is the object, and the text sits on the page.

```
div.relative.flex.flex-col                                   (grid cell / rail item)
├─ Link.group.flex.flex-col.gap-3  → /events/{slug}            card's main link
│   ├─ div.relative.overflow-hidden.rounded-card              media
│   │   ├─ EventArt  aspect per §8.2, hover: motion-safe group-hover:scale-[1.03] 300ms ease-out
│   │   └─ category chip (§6.3) left-2 top-2
│   └─ div.flex.flex-col.gap-1
│       ├─ p.meta            "SAT 24 OCT · 7:00 PM"   (black, not muted: when matters)
│       ├─ h3 card title     line-clamp-2, group-hover:underline underline-offset-4
│       ├─ p.text-sm.text-muted  venue · suburb (truncate)
│       ├─ p price           §6.8 (amount 600 + "incl. booking fee" 400 muted, same 14/20)
│       └─ GoingStack sm     (where data allows; never invented)
├─ SaveButton variant="overlay" absolute right-1 top-1        (unchanged position, tested)
├─ Quick-buy link (§6.6)                                      sibling, never inside the Link
└─ "By {organiser}" link (EventTile only, unchanged)
```

**States:**
- **Hover** (hover-capable only): the image scales 1.03 and the title underlines.
- **Focus-visible:** the ring around the main link, which wraps media and text. The rail's `py-4` keeps it unclipped.
- **Active:** `motion-safe:active:scale-[0.98]` 150ms.
- **Loading:** the placeholder is `rounded-card bg-surface` media at the same ratio, plus three `bg-surface` bars (h-3 w-24, h-4 w-full, h-3 w-32) with 8px gaps. No shimmer.
- **Image error:** `EventArt` falls back to the poster.
- **Empty:** owned by the section.

**Variants** (sizes and ratios as `home.md` §4 and §5.7, which stay authoritative for the home):

| Variant | Difference from the anatomy |
| --- | --- |
| `standard` (grid, rail; `EventTile`) | As drawn |
| `wide` (This weekend) | 3:2 media. **Date badge** at `left-2 top-2` (`rounded-badge bg-cream px-2 py-1`): range in Instrument 700 14/16 plus month in `eyebrow` 10/12. The category chip moves to `left-2 bottom-2`. Adds a 2-line description at 14/20 muted. |
| `compact` (Free & low-cost, lists) | `grid grid-cols-[6rem_1fr] sm:grid-cols-[7rem_1fr] gap-3`. The thumb is `rounded-control` (8px; 12px is too round at 96px). Each item has `border-t border-surface-border pt-3`, with no card. Badge per §6.3. |
| `featured` (Up next) | The whole card is one link: `rounded-card overflow-hidden`, `data-surface="ink"` text block over the functional scrim (`home.md` §4 budget). **Badge:** "Up next" `eyebrow rounded-badge bg-signal text-black px-2 py-1` with `DotsMark xs`. **Title:** `font-heading` uppercase 28–36px (`home.md` §2). **Arrow:** `size-11 rounded-control bg-cream text-black` (was a disc). The scrim is the **only gradient permitted on the site**: it's functional, and black ≥85% opaque under text. |
| `external` | Price line: "Tickets on {provider}" / "Free · Tickets on {provider}" (`home.md` §5.7). No GoingStack and no ↗ icon. |
| `sold-out` (needs B-WL, §10) | Price line "Sold out" (600, black). Quick-buy reads "Join waitlist". No badge on the media (no colour-only signal). |

### 6.6 Quick buy from cards (owner requirement 1)

**Decision:** the card gets a **sibling button-styled link** that goes straight to the event page's ticket section, `/events/{slug}#tickets`.
- **Not a sheet.** One checkout path keeps the fee note, ticket terms, Who's Going booking email and the external-ticket beacon in one place, and it needs no new data loading on cards.
- A sheet is listed in §10 as a later proposal.

**Anatomy** (owner decision 6 replaces the quiet underlined text link):
- `buttonClass("signal", "md", "min-h-11 px-4 sm:min-h-10")`: Signal Orange fill, **black label** (6.18:1; never white on orange), `rounded-control`, semibold, 44px tall on phones and 40px from `sm`, the 16px → arrow kept.
- Visible label (`aria-hidden`), plus one sr-only span with the whole name, "{label} for {event.title}".
- Hover (hover-capable devices): the `.btn-signal` hover, black fill with an orange label. Press: the `.btn` 1px nudge, motion-safe only.
- Focus: the page's black ring on a cream gap (`:focus-visible`, `outline-ink`); never orange.
- It's outside the card's main link and never inside `[data-surface="signal"]`.

**Placement:**
- Its own row under the main link (`pt-3`). In grids, `mt-auto` aligns rows.
- **compact:** the row is indented to the text column, `pl-27 sm:pl-31` (6.75rem / 7.75rem), and the button fills that column below `sm`.
- **featured:** the row sits under the card, outside it (`mt-3`).

**Hit area and spacing:**
- 44px tall on phones (40px from `sm`), the label plus 16px each side wide.
- At least 12px vertical separation from the card link's text.
- It never overlaps the Save heart (top-right of the media).

**Label and target by event state:**

| Event | Label | Target |
| --- | --- | --- |
| Sheltüh-ticketed, paid | "Get tickets" | `/events/{slug}#tickets` |
| Sheltüh-ticketed, all free | "Get free tickets" | same |
| Demo mode | "See tickets" | same |
| No ticket types yet | **No link** (the price line says "Tickets coming soon") | — |
| Sold out (B-WL) | "Join waitlist" | same, landing on the waitlist block |
| External ticketing | "Get tickets" | same. The event page holds "Get tickets on {provider}" and its click beacon (`home.md` §5.7, owner decision 3). |
| Event ended | No link | — |

**Keyboard and screen reader:**
- Tab order per card is **main link → Save → Get tickets → By organiser**.
- Its name is "Get tickets for {title}". It's a link, not a button, because it navigates.
- `home.md` §7 focus order is updated accordingly.

**Event-page arrival** (small frontend addition, no API):
- When the page renders with `location.hash === "#tickets"` (live mode: after the event loads), call `document.getElementById("tickets")?.focus({ preventScroll: false })`. The target already has `tabIndex={-1}`, so screen-reader and keyboard focus land on the tickets.
- `scroll-padding-top` already clears the header.

### 6.7 Share and calendar (owner requirements 2 and 3)

**Share** (new `components/ShareButton.tsx`).

*Event page:* in the title row, to the right of the `SaveButton` pill.
- `btn btn-outline btn-sm min-h-11` with a 16px share icon (box with arrow up, stroke 1.75) plus "Share".
- Below 375px it's icon-only, with `aria-label="Share {title}"`.

*Behaviour:*
1. **Native share.** If `navigator.share` exists and `navigator.canShare?.({ url }) !== false`, call it with:
   - `title`: the event title
   - `text`: `"{title} · {Sat 24 Oct, 7:00 pm} · {venue}"`
   - `url`: `${location.origin}/events/${slug}`
   - **No query string**, which strips `?ref=` tracking so one buyer's attribution isn't passed on.
   - An `AbortError` (the user cancelled) is silent.
2. **Clipboard fallback.** Otherwise, `navigator.clipboard.writeText(url)`. On success, an inline `p[role=status]` "Link copied" (14/20) appears beside the button for 4s, and the button label stays the same.
3. **Manual copy.** If the clipboard rejects, open a small popover: `rounded-control border border-foreground bg-card p-3` holding a read-only field with the URL (auto-selected) and a "Copy" outline sm button. Escape closes it and focus returns to Share.

*Cards:* no share control in this build. Optional phase 2 is a 44px "More" (⋯ icon) overflow menu holding Share (and, if wanted, Add to calendar), placed under Save at `right-1 top-12` on the media. Keep it off by default to protect card density.

*Previews:* there are no per-event OG previews today. Live event pages render client-side, and `generateMetadata` returns "Sheltüh". The site OG image (§4) applies to every share. Per-event previews are a dependency (§10).

**Add to calendar** (new `components/AddToCalendar.tsx`; lower priority).

*Placement:*
- **Event page:** directly under the "When" `dd`.
- **Checkout success:** under the event title.

*Trigger:* a text button, `inline-flex min-h-11 items-center gap-1 text-sm font-semibold underline underline-offset-4`, reading "Add to calendar" with a chevron, `aria-expanded`. It opens a popover menu (`rounded-control border border-foreground bg-card py-1`) of plain `min-h-11 px-4` links:
1. **"Apple Calendar"** is a plain link (no `download` attribute, no Blob) to `/events/{slug}/calendar.ics` (`lib/server/handlers/event-calendar.ts`), served as `text/calendar; charset=utf-8` with `Content-Disposition: inline; filename="{slug}.ics"` and `Cache-Control: public, max-age=300`, so iPhone Safari opens its own "Add to Calendar" sheet and a desktop browser hands the file to the calendar app. A Blob with `download` made phones save a file instead. Not `webcal://`: that subscribes to a feed rather than adding one event. Only published events (demo: the sample events), otherwise 404. The file:
   - `VCALENDAR` / `VEVENT`
   - `UID:{eventId}@sheltuh.com.au`
   - `DTSTAMP`: the response time
   - `DTSTART` / `DTEND` as UTC `YYYYMMDDTHHMMSSZ` from `startsAt` / `endsAt`. With no `endsAt`, use start + 2h.
   - `SUMMARY`: title
   - `LOCATION`: venue, address
   - `URL` (the configured site URL; in the demo, the request's origin) and `DESCRIPTION`: the first sentence, then the URL
   - Escape `,` `;` `\` and newlines, and fold lines at 75 octets.
2. **"Google Calendar"** opens `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates={start}/{end}&details=…&location=…` with `target="_blank" rel="noopener noreferrer"`, and an accessible name ending "(opens in a new tab)".
3. **"Outlook"** opens `https://outlook.live.com/calendar/0/action/compose?subject=…&startdt=…&enddt=…&location=…&body=…` (ISO UTC times), in a new tab like Google.
4. **"Download .ics (other apps)"**: the same URL, with `download="{slug}.ics"`.

*Order:* Apple, Google, Outlook, Download; on Android (user agent contains "Android") Google comes first. Read in the browser when the menu opens, so it never affects the server render.

*Keyboard:* Escape closes and returns focus. Arrow keys aren't required: these are plain links in a disclosure, not an ARIA menu.

*Data:* the confirmation page lacks the event's date and venue (`CustomerOrder` has `eventTitle` and `eventSlug` only); see §10.

### 6.8 Pricing display: ACCC all-inclusive (owner requirement 5)

The helpers already compute buyer totals: `getTicketBuyerTotalCents`, `getMinBuyerTotalCents`, `formatFeedPrice`, `formatFeedPriceParts` and `formatTicketHeadline` (all fee-inclusive via `lib/fees.ts`: 6% + A$0.50 per paid ticket, or 0 when the organiser absorbs it), and `formatTicketBreakdown` (the partial).

**Rule: the all-inclusive total is always the first and most prominent number.** Any partial (face value or fee) is shown only as a secondary breakdown: smaller or equal size, lighter weight, muted, and after the total. It's never shown alone.

| Surface | Spec |
| --- | --- |
| Cards (all variants), buy bar | `formatFeedPriceParts`. **Amount** ("From A$32.78") Instrument 600 14/20 black `tabular-nums`, then " incl. booking fee" 400 muted on the same line. Buy bar: amount 16/20 600, note 12/16 below. "From" is the cheapest buyer total. **Face value never appears on cards.** |
| Ticket row (`TicketSelector`) | 1. Name 16/22 600. 2. **Total per ticket** (`formatTicketHeadline`) **16/24 600 at every width**. Delete the `lg:text-sm lg:font-normal lg:normal-nums` downgrade: the total must not shrink on desktop. 3. Description 14/20 muted. 4. The breakdown (`formatTicketBreakdown`) as `meta` 12/16 muted, **always visible for paid tiers** (not only when quantity > 0), so the fee is explained before choosing. 5. Free: "Free" and no breakdown. |
| Order summary (`TicketSelector`, checkout) | Rows "Tickets" and "Booking fees" at 14/20 muted with values 14/20 `tabular-nums`. Then a 1px **black** rule. Then **"Total" 18/24 700 with value 20/28 700 `tabular-nums`**, the largest number in the panel. The fee rule line ("Booking fee: 6% of ticket face value + A$0.50 per paid ticket. Free tickets never carry a fee.") stays above the tiers, 14/20 muted. |
| Checkout success | "Total paid" uses the same treatment as Total. Subtotal and fees stay secondary. |
| External events | No price (owner decision 3). |
| Sold-out tier | Keep showing its total, in muted (it's still advertised). "Sold out" (`eyebrow`, black) replaces the stepper. **When the cheapest tier is sold out, cards' "From" must use the cheapest available tier** (needs B-WL data, §10). |

### 6.9 Ticket selector and checkout: quiet, predictable, trustworthy (owner requirement 6)

**Container:** the `#tickets` `Panel` content is a white card, `rounded-card border border-foreground bg-card p-4 sm:p-5`. Inside it:

1. **Steps:** an `ol` at the top in `eyebrow`, `flex gap-x-3 flex-wrap`. The current step is black; the rest are muted, separated by "→".
   - Paid: "1 Choose tickets → 2 Pay on Stripe → 3 Tickets by email"
   - Free: "1 Choose tickets → 2 Confirm by email → 3 Tickets"
   - Hint (12/16 muted): "Signed in with a verified email? Step 2 is usually skipped."
   - Static, with no progress bar.
2. **Fee rule line** (§6.8).
3. **Tier rows:**
   - Separated by `border-t border-surface-border`, not grey fills (drop `bg-surface`).
   - **Steppers:** `size-11 rounded-control border border-foreground`. Disabled at limits: `aria-disabled` → `border-surface-border text-muted`. Count Instrument 600 18/24 `tabular-nums w-10`.
4. **Order summary** (§6.8), with a black rule above it.
5. **Email field** when free (§6.2).
6. **Checkout button:** **`btn-solid btn-lg w-full`, black, not orange.** Remove the `lg:` size overrides so it's 48px everywhere. The label is unchanged ("Checkout" / "Get free tickets").
7. **Reassurance** at 12/16 muted (existing copy).
8. **Errors:** `Notice tone="danger" role="alert"` directly under the button.

**In checkout:** no orange, no `font-display`, no dots motion, no push-in, no badges, no "Demo" orange (demo's disabled button uses the §6.1 disabled style). The orange "Get tickets" CTA lives only **before** checkout: the buy bar and the hero.

**`/checkout/confirm` (`FreeOrderConfirm`) and `/checkout/success` (`CheckoutConfirmation`):**
- Single column `max-w-2xl`.
- **Loading / "Confirming your order…":** `DotsLoader announce label="Confirming your order"` in place of the `font-heading text-2xl` line.
- **Ready:**
  - Strap "Order confirmed" with `DotsMark xs joined` (static), and the reference on the right in `meta`.
  - h1 `display-md` event title.
  - Masked email line.
  - AddToCalendar (§6.7).
  - "Your tickets": a list of stubs (no `bg-surface` wrapper).
  - Totals card (`rounded-card border border-foreground bg-card p-4`).
  - Who's Going CTA (`outline lg`) and the back links (black, underlined; replace `text-accent` only if it's no longer black, otherwise leave it).
- **Error, not found and oversold:** the h1-style line `font-heading text-2xl`, the message, and a link. Same structure, no colour except `danger` text.

**`TicketStub`:**
- `rounded-card border border-foreground bg-card`, with dashed black perforations (unchanged).
- QR black on white with its quiet zone (`TicketQr` test pins `#ffffff`/`#000000`; unchanged).
- Code in Plex Mono per §3.2.
- Type label `eyebrow`.
- `UBarcode` ü in black.
- Print: `print:border-black print:bg-white`.

### 6.10 Event page (`EventDetailsView`, `WhosGoing`, buy bar)

**Grid:** as today (`lg:grid-cols-12`: content 7, aside 5, `lg:gap-14`).

**Order in the content column:**
1. **Media.** Below sm: full-bleed `-mx-5 aspect-[4/5] rounded-none`. From sm: `aspect-[3/2] rounded-card`. At lg it sits after the title, as today. Use `EventArt priority` (it's the LCP image), with **no push-in** here.
2. **Strap:** `eyebrow` reading "{Category} · {Suburb}", plus `DotsMark xs`. Save and Share are on the right.
3. **h1** `display-lg` (Instrument, never Bootzy), `max-w-[20ch]`.
4. **Phone key facts:** `meta` date line in black, then venue 14/20 muted, then `WhosGoingSummaryLink`.
5. DemoNotice.
6. Description: `text-base sm:text-lg leading-7`, `max-w-2xl`.
7. "Good to know" `Panel`.

**Aside (`lg:sticky lg:top-24`):**
- **When / Where / Organiser** as a `dl`. Each row is `border-t border-foreground py-3`: the `dt` is `eyebrow text-muted`, the `dd` is 16/24.
- AddToCalendar under When.
- Then Who's Going, then `#tickets` (§6.9).

**Buy bar (<lg):**
- Gets `data-surface="ink"`, replacing the hard-coded `bg-foreground text-background`.
- Price per §6.8.
- CTA `btn btn-signal btn-lg`: "Get tickets", or "See tickets" in demo, or "Join waitlist" when sold out.
- The heart stays in the `onDark` variant (keep the existing component variant until it's migrated to the ink scope).

**Who's Going** (visual only; behaviour per `whos-going.md`):
- Heading `font-heading text-xl` with `DotsMark xs`. When the viewer is listed, it's `joined`; on opt-in success it joins once (§5 #5).
- **Avatars:** `rounded-dot`. 32px in lists and 24px in stacks (`-ml-1.5`, `ring-2 ring-background`).
- Fills cycle `bg-foreground text-background`, then `bg-card text-foreground border border-foreground`, then `bg-surface text-foreground`. The **viewer's own avatar is `bg-signal text-black`**: the "you're connected" signal, 6.18:1.
- Initials Instrument 600 11px (minimum).

### 6.11 Waitlist UI (owner requirement 4; UI only, backend separate, §10)

**Event-level, shown in the `#tickets` card when every tier is sold out:**
- Each tier row shows its total (muted) plus "Sold out" (`eyebrow`, black) instead of the stepper.
- No order summary and no Checkout button.
- Then the waitlist block (`border-t border-foreground pt-4`):

| State | Render |
| --- | --- |
| Idle | `font-heading text-xl` "Sold out. Join the waitlist." Body 14/20: "We'll email you if tickets are released. Joining doesn't reserve a ticket or charge you." Email field (prefilled with the account email when signed in; editable). Fine print 12/16 muted with a **Privacy Policy** link. **`btn-signal btn-lg w-full`** "Join waitlist": this is the page's one conversion action once checkout isn't possible. |
| Submitting | Button `busy`, label "Joining…" |
| Joined | `DotsMark sm joined` (§5 #5) plus `font-heading text-xl` "You're on the waitlist", `role="status"`. Body: "We'll email {masked email} if tickets come up." Link: "Leave the waitlist" (only if the backend supports it). |
| Already joined (on load, or a 409) | Same as Joined, heading "You're already on the waitlist" |
| Error | `Notice tone="danger" role="alert"` with the API message; the field and button stay |
| Closed (event ended or waitlist off) | 14/20 muted "The waitlist for this event is closed." No form. |

- **A single tier sold out while others are on sale:** that row shows "Sold out", and nothing else changes. There's no per-tier waitlist in this build.
- **Cards and buy bar:** §6.5 `sold-out` and §6.10.
- **Focus:** after joining, focus moves to the "You're on the waitlist" heading (`tabIndex -1`), as the free-ticket "Check your inbox" flow already does.

### 6.12 Nav (`Nav.tsx`, `AuthNavLinks.tsx`)

**Header:** `bg-background border-b border-foreground` (was `border-surface-border`). Drop `lg:bg-background/95` (translucency reads as glass).

**Compact bar (<lg, 56px):**
- `Wordmark` 20px tall in the home link.
- Search (44px), Saved (44px), and the **Menu** button: Instrument 600 13/16 uppercase. Unread count: `rounded-badge bg-foreground text-background`.

**Menu popover:**
- Cream, `border-t border-foreground`.
- Primary links are `display-lg` (Instrument 700 upper). The active link gets the §5 #2 umlaut (8px squares, orange) instead of the black top bar.
- Account links Instrument 600 16/24, `min-h-11`.
- "For organisers" `btn-outline btn-lg w-full`.
- Footer strap: `eyebrow text-muted` "Melbourne · Australia".

**Desktop (≥lg, 70px, `--header-h` unchanged):**
- `Wordmark` 24px, the search field (§6.2) at `max-w-sm`, then the links.
- `navLinkClass` becomes `umlaut relative px-2 py-2 text-[0.8125rem] leading-4 font-semibold uppercase tracking-[0.01em]`. It drops the `before:` bar; hover and active use the umlaut per §5 #2.
- "For organisers" `btn-outline btn-sm`.

**Sticky rules** (door, thread) are unchanged (tested).

### 6.13 Footer (`Footer.tsx`)

**Root:** `<footer data-surface="ink">`.

**Order:**
1. `InstallPrompt`.
2. **Columns:** `grid grid-cols-2 gap-6 sm:grid-cols-3 sm:gap-8`. Headings `eyebrow text-muted`; links Instrument 15/24 cream, `py-1`, hover underline.
3. **Contact or demo line:** 14/20 muted, with the email link in cream underline.
4. **Sign-off:** the full-width uppercase `Wordmark` in `text-signal`, `mt-12 sm:mt-24` (§4).
5. **Bottom strap:** `border-t border-foreground/20 mt-6 pt-4 eyebrow text-muted flex justify-between`: "© {year} Sheltüh" plus the legal links (`min-h-11` on phones).

`text-background/70` everywhere is replaced by `text-muted` (#a39e93, 7.87:1).

### 6.14 Modals, sheets, notices, empty, loading, error

**Dialogs** (`ReportDialog`, `SuspendOrganiserDialog`, `UndoCheckInDialog` keeps the door scope):
- `rounded-card border border-foreground bg-card`, `max-w-lg w-[calc(100%-2.5rem)]`, `p-5 sm:p-8`.
- Backdrop `bg-black/50`, no blur.
- Title `font-heading text-xl`.
- Close: `size-11 rounded-control` outline, top-right.
- Actions right-aligned from sm, full-width stacked on phones (primary last on desktop, first on phones).
- **Below sm**, the dialog becomes a bottom sheet: `inset-x-0 bottom-0 rounded-b-none max-h-[90dvh] overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))]`.

**Notices and toasts:**
- **`Notice`:** unchanged (left rule 2px, black or danger, 14/20).
- **`FavouritesNotice`:** the black band becomes `data-surface="ink"`. There are still no floating toasts on the site.
- **Inline success:** `Notice` plus `DotsMark xs joined`.

**States:**
- **`EmptyState`:** `border-t border-foreground py-12`, `DotsMark lg`, `mt-6` title `display-md`, body 14/20 muted `max-w-md`, action `mt-6`.
- **Loading:** `DotsLoader` (§5 #4). Skeletons are `bg-surface` blocks of the final shape, never shimmering.
- **Error:** `Notice tone="danger" role="alert"` plus a `btn-outline` "Try again".

### 6.15 Map (`SceneMap*`, `components/map/*`)

- **`MapEventMarker`:**
  - The 48px button stays.
  - The inner `span` is `rounded-dot p-1 bg-foreground` (black ring). The image is `rounded-dot`.
  - **Selected:** `bg-signal scale-110` plus `ring-2 ring-foreground ring-offset-2 ring-offset-background`.
  - Hover: `scale-105`.
  - Delete `category-ring.ts` and `--cat-*`. Keep `data-category` (it's harmless and tested by attribute).
- **Cluster:** `rounded-dot bg-foreground text-background` count, Instrument 700 14px.
- **Map card:** `rounded-card border border-foreground bg-card`. Contents per §6.5 compact.
- **Map filter bar:** fields per §6.2; toggles per §6.3.
- **Tiles:** Esri light grey (neutral, unchanged).
- **Tests:** `tests/SceneMap.test.tsx:114,119` change from `.bg-cat-*` to asserting `data-category` and the accessible name.

### 6.16 Dashboard, analytics and admin density

These are tools: quiet, dense and black-structured, with **no orange except the "On sale" badge** and no `font-display`.

- **Page h1:** `display-md`, via `PageHeader size="md"`.
- **Body:** 14/20. Labels `eyebrow`. IDs, references, timestamps and codes in `meta`.
- **Money:** Instrument `tabular-nums`, with cents (as `lib/analytics-format.ts`).
- **Tables:** header row `eyebrow text-muted border-b border-foreground`; rows `min-h-11 border-b border-surface-border`; numbers right-aligned.
- **List and queue items:** ruled rows (`border-t border-foreground py-4`), not cards.
- **`StatGrid`:** numerals per §3.2.
- **`TimeSeriesChart`:** black bars, dashed previous period (unchanged). A hovered or focused bar may be `fill-signal` (non-text 3.25:1 on cream).
- **Editor forms:** §6.2, sections as `Panel`s.
- **Check-in** keeps the door scope.

## 7. Page-by-page direction

| Page | Direction |
| --- | --- |
| **Home** `/` | Follows `home.md` for structure, dedupe, windows, Trending and external cards; its visual sections are updated to this system. Hero h1 is the brand question (`display-xl`): "WHERE / IS ÜR / SHELTÜH?" (§3.3 pattern; owner Q1), with the descriptive intro directly below so it still explains the site. CTAs: `signal` "Explore events" + `outline` "Find your people" (jumps to the band; `home.md` §5.2). Section straps per §6.4. "Find your people" becomes the page's **one orange band**: `data-surface="signal"`, full-bleed. GuideCard is a white info card with a black border; CreatorsCard is `data-surface="ink"`. |
| **/events, /search** | `PageHeader brand` h1 "What's on." (`display-lg font-display`), strap "Events · Melbourne", existing intro (explains filtering). Filter bar: §6.2 fields on a `border-t border-foreground pt-5` row; the count in `meta`. Results: `EventTile` 4:5, grid `grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8`, quick buy per §6.6. Empty: §6.14. /search: same, with `SearchBar size="lg"`. |
| **Event page** | §6.7–6.11 |
| **Map** `/map` | h1 "Sheltüh near ü." (`display-lg font-display`; sr reads "Sheltüh near you"), with an optional `InlinePhoto` before "NEAR" (§8.3). The subtitle explains: "Events on the map. Tap a spot to see what's on there." Markers per §6.15; the panel is a white card. |
| **Auth** (login, signup, verify, forgot) | `max-w-md`. Strap "Account", h1 `display-lg`. Fields white; submit `btn-solid btn-lg w-full` (black). A Privacy Policy and Terms line under every form that collects data (12/16 muted, underlined). No orange, no motion. |
| **Account, Saved, Tickets** | `PageHeader size="md"`. Saved: the `EventTile` grid (as /events). Account sections are `Panel`s. Sign out is `btn-outline`. |
| **Messages** | Inbox rows ruled. Thread: own bubble `bg-foreground text-background rounded-card rounded-br-badge`; theirs `bg-card border border-surface-border rounded-card rounded-bl-badge`; timestamps `meta`. The Sheltüh system avatar is the `UMark` on `bg-signal`, `rounded-dot`. The composer is a field per §6.2. |
| **Organiser** (apply, submit, dashboard, analytics, editor, payouts, profile) | §6.16. The public organiser profile `/organisers/[id]` is editorial: h1 `display-lg`, then the event grid. |
| **Check-in** | Unchanged palette (§2.6). Fonts and shapes via shared classes. |
| **Admin** | §6.16 |
| **Legal, help, about, partners** (`ContentPage`) | `Page width="narrow"` (a centred 672px reading column; 30 Oct 2026: it was left-aligned in the 1152px column, leaving the right side empty on desktop). Sign in, sign up, reset password, verify and the organiser join page use `Page width="form"` (a centred 448px stacked column); `wide` stays the 1152px page column. All share the header's gutters (20px, 32px from 640px). h2 `display-md` 24/26 (replace `[&_h2]:text-3xl`); square bullets (§5 #9) replace `list-disc`; links black underlined; the Draft label per §6.3. Help may add a strap TOC (`eyebrow` links) at the top. |
| **404 / `NotFoundMessage`** | `DotsMark lg`, h1 `display-lg font-display` "Lost?", body "That page isn't here. Try what's on this week.", and `btn-solid` "See what's on" → /events |

## 8. Imagery and motion

### 8.1 Photography

- **Real Melbourne nights and people:** candid, close, flash or available light, movement, grain allowed. Natural colour with no filters, duotones or orange tints.
- **No stock.** That means no staged handshakes, laptops, generic crowds-from-behind, or AI imagery.
- **Organiser posters and flyers are shown as supplied.** Never crop text off a poster: if the source is a poster, centre-crop at the slot's ratio. Focal point is a backend dependency (§10).
- **Text on images** appears only on the featured card's functional scrim. Badges are opaque fills.

### 8.2 Crop ratios

| Slot | Ratio |
| --- | --- |
| `EventTile` (/events, /saved, organiser grid) | **4:5** (was 1:1) |
| Home cards | per `home.md` §4: standard 4:3, wide 3:2, compact square thumb, featured 4:5 / 1:1 / 3:2 / 16:9 / 4:5 by width |
| Event page | 4:5 full-bleed below sm, 3:2 `rounded-card` from sm |
| Map marker, avatars | 1:1, `rounded-dot` |
| OG | 1.91:1 (1200×630) |

**Fallback (`EventArt`):** always a fixed-ratio box, so there's no layout shift. Retune the 8 poster palettes in `lib/sample-events.ts` (which live events reuse via `assignPoster`) to brand colourways:

| Pattern | Background | Primary | Secondary |
| --- | --- | --- | --- |
| burst | `#000000` | `#ff4800` | `#fffae7` |
| rings | `#ff4800` | `#000000` | `#fffae7` |
| grid | `#fffae7` | `#000000` | `#ff4800` |
| stripes | `#000000` | `#fffae7` | `#ff4800` |
| waves | `#ff4800` | `#fffae7` | `#000000` |
| confetti | `#fffae7` | `#ff4800` | `#000000` |
| curtain | `#000000` | `#ff4800` | `#000000` |
| halftone | `#ff4800` | `#000000` | `#000000` |

The initial letter keeps 8% opacity in `var(--face-display)`.

### 8.3 `InlinePhoto` (brand device, optional)

- An `aria-hidden` span: `inline-block align-[-0.08em] h-[0.72em] aspect-[3/2] rounded-badge overflow-hidden mx-[0.08em]`, holding an `EventArt`.
- It sits inside a display line, at cap height.
- Use it **at most once per page**, on brand lines only (/map title; the home Community band may use it once).
- Never use it inside an event title.

### 8.4 Motion

| What | Motion | Reduced motion |
| --- | --- | --- |
| **Hero photo cell and featured card push-in** (`EventArt motion`) | Redefine `.ken-burns`, keeping the name so call sites don't change. `@keyframes push-in { from { transform: scale(1) } to { transform: scale(1.06) translate(-1%, -0.5%) } }` with `animation: push-in 4.5s cubic-bezier(.2,.7,.2,1) 1 both`. That's **one cycle, ≤5s, holding the end frame. It never loops** (`home.md` decision 6, WCAG 2.2.2). | Defined only inside `@media (prefers-reduced-motion: no-preference)`, so it's static. Acceptance: computed `animation-name: none` under `reduce`. |
| `.rise` entrance (not on the LCP h1) | 0.6s `cubic-bezier(.2,.7,.2,1)`, `translateY(1rem)`, staggered by `--d` | None |
| `.reveal` | Unchanged (scroll timeline) | None |
| Card image hover | `scale(1.03)` 300ms ease-out, `@media (hover: hover)` only | None (`motion-safe:`) |
| Card press | `scale(0.98)` 150ms | None |
| Umlaut on nav | `opacity` 150ms | Instant |
| `DotsLoader` | 0.9s alternate, infinite **while loading only** (an essential status indicator) | Static plus text |
| Dots join | 400ms once | Final state |
| Dialog / sheet | `opacity 0→1` plus `translateY(1rem)→0`, 200ms ease-out; close is 150ms | Opacity only, 100ms |
| **Removed** | `.float`, `.spin-slow`, `RoundBadge`, `Marquee`, `Burst`, `Scribble` (delete with their last users), `Carousel` autoScroll drift (proposal in §10) | — |

## 9. Implementation order (small increments, tests green at each)

| # | Increment | Files | Tests to update or add |
| --- | --- | --- | --- |
| 1 | **Tokens, fonts, icons.** The §2.1 values (with the `--highlight`/`--pop` aliases and flat `--shadow-card`), §2.3 scopes, §2.4 radii, §3.1 faces and utilities, the §3.2 utility bodies, `.ken-burns` → push-in, `APP_THEME_COLOR`, `offline.html`, `app/icon.svg`, regenerated PNGs/ICO, `app/opengraph-image.tsx` | `app/globals.css`, `app/fonts.ts`, `app/layout.tsx`, `lib/pwa/theme.ts`, `public/offline.html`, `app/icon.svg`, `public/icons/*`, `app/apple-icon.png`, `app/favicon.ico` | `e2e/pwa.spec.ts:27` → `"#fffae7"`; `pwa-manifest.test.ts` passes once `APP_THEME_COLOR` matches; `door-tokens.test.ts` must pass untouched. Add `tests/brand-tokens.test.ts` (part 1): `:root` defines `--background: #fffae7`, `--foreground: #000000`, `--card: #ffffff`, `--signal: #ff4800`; layout doesn't import Bricolage or Inter. |
| 2 | **Brand components, Nav, Footer** | `components/brand/*`, `Nav.tsx`, `AuthNavLinks.tsx`, `Footer.tsx` | `Nav.test.tsx` (the home link name is unchanged); Footer tests if any |
| 3 | **UI primitives:** `.btn*` and `signal`, fields, `SearchBar`, chips, `Strap`, `PageHeader`, `Panel`, `EmptyState`, `DemoNotice`, `ContentPage` | `components/ui/*`, `globals.css` | `Button.test.ts` (signal case); `SearchBar.test.tsx` (`text-base` kept) |
| 4 | **Cards:** `EventTile` 4:5, price parts, quick-buy link, `EventArt` palettes, `#tickets` focus on arrival | `ui/EventTile.tsx`, `EventArt.tsx`, `lib/sample-events.ts`, `EventDetailsView.tsx` | `EventTile.test.tsx` (heart position kept; add quick-buy name and order); `SceneMap.test.tsx` fixture unaffected |
| 5 | **Home** (`home.md` build F3, with this visual layer) | `components/home/*` | `phone-home-tokens.test.ts` → folded into `brand-tokens.test.ts`: no `bg-pop`/`text-pop`/`highlight`/`shadow-card` anywhere; `text-signal` never in a className with `text-xs`, `text-sm`, `text-base`, `eyebrow` or `meta` (§2.2) |
| 6 | **/events, /search, filters** | `app/events`, `app/search`, `EventFilterBar`, `EventResults` | `EventFilterBar.test.tsx` (select label unchanged) |
| 7 | **Event page:** layout, `TicketSelector` pricing hierarchy and quiet checkout, buy bar ink and signal, Who's Going visuals, Share, AddToCalendar | `EventDetailsView`, `TicketSelector`, `WhosGoing*`, `ShareButton`, `AddToCalendar` | `TicketSelector.test.tsx` (`btn-lg` kept; breakdown now always visible for paid tiers); `EventDetailsView.test.tsx` (`lg:hidden` kept); new Share (share / clipboard / fallback) and `.ics` builder unit tests |
| 8 | **Checkout pages and ticket stub** | `CheckoutConfirmation`, `FreeOrderConfirm`, `TicketStub` | `CheckoutConfirmation.test.tsx`, `TicketStub.test.tsx` (print classes kept), `TicketQr.test.tsx` unchanged |
| 9 | **Map:** markers, cluster, card, filters; delete `--cat-*` and `category-ring.ts` | `components/map/*`, `SceneMap*` | `SceneMap.test.tsx:114,119` |
| 10 | **Remaining pages:** auth, account, saved, messages, organiser, dashboard and analytics, admin, help and legal, 404 | as listed | class-pinning tests in `DashboardContent`, `PublicProfileForm`, `AnalyticsParts`, `OrganiserQueue` (the `p.eyebrow` selector is kept) |
| 11 | **Cleanup:** remove the `--highlight`/`--pop`/`--shadow-card` aliases, unused `Sticker` exports, `.float`/`.spin-slow`/`marquee` | `globals.css`, `ui/Sticker.tsx` | `brand-tokens.test.ts` part 2: the aliases are absent from `globals.css` |
| 12 | **Waitlist UI** (after the B-WL contract) | `TicketSelector`, cards, buy bar | New component tests for each §6.11 state |
| — | **Transactional emails** (done 22 Oct 2026): one shared layout, `lib/server/email-layout.ts` (`EMAIL_COLOURS` cream `#fffae7`, white card `#ffffff` with a 1px black hairline and 12px radius, ink `#000000`, muted `#6b675e`, divider `#ddd5ba`, Signal Orange `#ff4800`; `page()`, `heading()`, `eventTitle()`, `eventBlock()`, `button()`, `supportFooter`). Signal Orange is only the fill of the one button per email, with a black label and a black hairline; event titles are black. Light only (`color-scheme: light only`), tables, inline styles and `bgcolor`. | `ticket-email.ts`, `free-confirmation-email.ts`, `waitlist-email.ts`, `follower-email.ts` | `tests/server/email-brand.test.ts`: every builder uses only the shared colours (none of `#2b3cff`, `#f3f0e8`, `#0b0b0b`), orange only on its one button, black text on it, the shared card, heading and support line |

**Gates for every increment:** `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build` for increments 1, 5 and 7 (fonts, routes, OG). Run `npm run test:e2e` after increments 1 and 8. Hand off to `visual-qa` at 320, 375, 430, 640, 768, 1024 and 1280, in demo and live mode, after increments 2, 5, 7 and 10.

## 10. Dependencies and out of scope

**Backend contracts:**
- **B-WL (waitlist):**
  - Public event payloads gain per-ticket-type `remaining` or `soldOut`. Today `quantityAvailable` is the organiser's capacity (validated ≥1), not what's left, so the client **can't** know a tier is sold out.
  - Endpoints to join, check status (by account or email) and leave.
  - A notification email.
  - "From" pricing must use available tiers.
- **Calendar on confirmation:** `CustomerOrder` gains `eventStartsAt`, `eventEndsAt` and `venueName`/`venueAddress` (additive). The alternative is fetching `/api/events/{slug}` by `eventSlug`.
- **Per-event share previews:** server-side `generateMetadata` for live events (title, description, image) plus an image pipeline. Image variants and focal point are as in `home.md` §9.
- **`metadataBase`:** the production origin, needed for absolute OG URLs. Set it in `app/layout.tsx` metadata from an env var.

**Proposals (behaviour changes, for the manager):**
- `Carousel` drift on /events: turn off `autoScroll` (motion policy).
- A quick-buy **sheet** that opens the ticket selector over the grid. Revisit after launch data.
- Card overflow "More" menu (Share, Add to calendar).
- Category chips (a radio group) replacing the /events category `select`. Same behaviour; it needs `EventFilterBar.test.tsx` query updates.

**Out of scope:** the door check-in palette, the landing page on Cloudflare (not in this repo), illustration and icon-set redesign (keep the stroke icons, 1.75–2px), and personalisation.

## 11. Missing assets

1. **Bootzy TM font files** (WOFF2, every weight to be used) plus the **web licence**. Confirm self-hosting on `sheltuh.com.au`, PWA, pageview or domain limits, and use in server-generated OG images.
2. **The "additional variation" logomark** (pp. 19–22, dots closer together and rounder) as a **vector**. The PDF pages appear to be raster. Until then, "joined" is approximated by translating the standard paths (§5).
3. **The "SHELTÜH." lockup with the period** (p. 25) as a vector, if the owner wants it as an asset. Otherwise it isn't used.
4. **Official clear-space and minimum-size rules.** The book has none; §4 sets provisional values for the owner to confirm.
5. **Photography:**
   - The home hero, guide, creators and community images (`HOME_HERO`, `HOME_GUIDE`, `HOME_CREATORS`), and any `InlinePhoto` sources.
   - Usage rights and model releases. That includes the brand book's own photos (pp. 25–26), if they're to be reused.
6. **The uppercase wordmark as a PNG for email** (black on transparent or cream, about 2× a 24px-tall header, so ~212×48). Done 22 Oct 2026: `public/brand/sheltuh-wordmark-email.png` (black on cream, 212×48, shown at 106×24), rendered from `sheltuh-wordmark.svg` by `scripts/render-email-wordmark.ts` and attached inline (`cid:`, about 4 KB, so it shows where Outlook blocks remote images) as the ticket email's header, alt text "SHELTÜH" (it replaced the app icon beside the text "Sheltüh"). The other emails have no header. Owner to confirm the export. **Re-rendered 23 Oct 2026 as black on opaque white** with the white email page ([`theme-white-dark.md`](theme-white-dark.md) §5.12).

## Owner questions

1. **Hero copy:** h1 "Where is ür Sheltüh?" (screen readers hear "Where is your Sheltüh?"), with the existing intro explaining the site. Also "What's on." for /events and "Sheltüh near ü." for /map. OK, or keep "Find your room. Find your people."?
2. **Bootzy:** can you supply the files and the web licence? Until then, headlines use Instrument Sans Bold, set tight, as the brand book does.
3. **Shapes:** rounded-square buttons and avatars (8px controls, 12px cards) replacing pills and circles. Confirm.
4. **Orange budget:** one orange CTA per view (the hero, the event buy bar, waitlist), one orange band on the home ("Find your people"), and the footer wordmark in orange on black. Checkout stays black. Confirm.
5. **Map:** retire the per-category marker colours (black ring, orange when selected); category stays in the text. Confirm.
6. **Quick buy:** card "Get tickets" goes to the event page's ticket section rather than opening a sheet over the grid. Confirm.

## Owner decisions (21 Oct 2026)

1. Hero copy: the brand questions. Home "WHERE IS ÜR SHELTÜH?" with a plain line explaining event discovery under it; /events "WHAT'S ON."; /map "SHELTÜH NEAR Ü.".
2. Rounded-square buttons and avatars replace pills and circles. Orange budget as specified: one main orange button per view, one orange band on the home page, the orange footer wordmark; checkout stays black and quiet.
3. Per-category map colours are retired: black pins, orange when selected; category stays in text and accessible names.
4. Quick buy goes to the event page's tickets section (`/events/{slug}#tickets`, focus lands there), not a sheet.
5. Still needed from the owner: Bootzy font files and web licence; the closer-dots logomark variation as a vector; photography with usage rights.
6. Card quick-buy buttons are orange (Signal, black label) — owner request 21 Oct 2026; overrides the one-orange-button budget for cards.
