# Reserved seating: design spec

Status: proposed · Owner: ui-design-director · Scope: the seated-event panel on the event page, `/events/[slug]/seats`, the seated checkout's cancelled page, seat lines on the ticket stub, email and door, the organiser seat-map editor and the admin preview. Behaviour, data and decisions come from `docs/SEATING_PLAN.md` (final). Tokens, type, shapes and the orange budget come from `docs/design/brand-direction-one.md` (BD1), which wins on anything visual. Door colours stay as in `check-in.md`.

**Code read:** `app/globals.css`, `components/TicketSelector.tsx`, `components/EventDetailsView.tsx`, `components/tickets/TicketStub.tsx`, `components/check-in/ResultPanel.tsx`, `components/ui/{FilterChip,Section}.tsx`, `lib/pricing.ts`, `lib/types.ts` (`TicketType`), `lib/server/handlers/orders.ts` (`cancel_url`), `docs/design/check-in.md` §5.A8.

Proposed file names (the architect may rename them): `app/events/[slug]/seats/page.tsx`, `app/checkout/cancelled/page.tsx`, `components/seating/{SeatedTicketsPanel,SeatPicker,SeatMap,SeatGlyph,SeatPatterns,SeatList,SeatLegend,SectionChips,ZoomControls,FindSeats,SeatSummary,SeatLine}.tsx`, `components/seating/editor/{SeatMapEditor,GeneratorPanel,SelectionToolbar,InspectorPanel,ImportExport}.tsx`, `lib/seating/format.ts` (`formatSeatLine`, `speakSeatLine`).

---

## 1. Principles

1. **Monochrome seats, orange means "yours".** Tiers are told apart by fill pattern (outline, dots, hatch, cross-hatch, solid black). Signal Orange is used for one thing only on the map: the seats you've chosen. No new hues.
2. **Never colour alone.** Every state has a shape or glyph cue as well as its fill: a check for selected, a × for unavailable, a pictogram for wheelchair, a letter for companion. The legend names every pattern next to its all-inclusive price.
3. **The map is for looking, the list is complete.** Everything you can do on the map (choose, remove, find seats) you can also do in the List view, with real checkboxes, 44px targets, keyboard support and no dragging.
4. **Checkout stays quiet.** The seat page is a checkout surface (BD1 §6.9): black Checkout, no `font-display`, no badges, no motion beyond pan and zoom. The total is the largest number.
5. **Say the seat the same way everywhere.** "Stalls · Row F · Seat 12" on the page, the summary, the stub, the email and the door. Screen readers hear "Stalls, Row F, Seat 12".
6. **Be honest about holds.** Nothing is held while you browse. Pressing Checkout holds the seats, and the copy says for how long and what happens if you don't finish.

## 2. Tokens

**No new colour tokens.** Everything uses `foreground` (black), `background` (cream), `card` (white), `surface`, `surface-border`, `muted`, `signal`, `danger`. Add to `app/globals.css` only:

```css
:root {
  --seatbar-h: 5.5rem; /* 88px phone summary bar on /events/[slug]/seats (before safe area) */
}

/* Focus never hides under the seat bar (WCAG 2.4.11), as for the event buy bar. */
@media (width < 64rem) {
  html:has([data-seat-bar]) {
    scroll-padding-bottom: calc(var(--seatbar-h) + env(safe-area-inset-bottom) + 0.5rem);
  }
}
```

and extend the existing `umlaut` utility so tabs can use it (§5.4): add `&[aria-selected="true"]` to the `&[aria-current="page"], &[aria-current="true"]` selector list and to the matching `::before` opacity rule. No other change to the utility.

### 2.1 Map geometry (SVG user units, "u")

| Item | Value |
| --- | --- |
| Seat | 24u × 24u square, `rx="4"` (17%: the brand rounded square, never a circle) |
| Generator defaults | seat pitch 28u (4u gap), row pitch 32u, aisle = one empty seat pitch |
| Stage | rectangle, `rx="8"`, black fill, label "STAGE" (`eyebrow`, cream, 20:1) centred |
| Rendered seat size | `s = 24 × scale` CSS px. All thresholds in §5.3 are on `s`. |
| Zoom range | min = fit whole map (padding 16px); max = `s` 48px. Buttons step ×1.5. |
| Strokes | `vector-effect="non-scaling-stroke"`: 1px when `s` < 24, 1.5px at ≥ 24; selected 2px |
| Labels | Non-scaling: set `font-size = px / scale` so they stay 12px on screen at any zoom |

### 2.2 Tier treatments (fill patterns, `SeatPatterns.tsx` `<defs>`)

All patterns are `patternUnits="userSpaceOnUse"` on a white (`--card`) base with black (`--foreground`) marks. Square marks only (no circles).

| ID | Name in code | Fill | Approx. ink coverage |
| --- | --- | --- | --- |
| T1 | `outline` | White, black 1–1.5px stroke | 0% |
| T2 | `dots` | White + 1.5u black squares on a 6u grid | ~6% (reads light grey) |
| T3 | `hatch` | White + 45° black lines, 1.5u wide, 5u apart | ~30% |
| T4 | `cross` | White + ±45° black lines, 1.25u wide, 5u apart | ~45% |
| T5 | `solid` | Black | 100% |

**Assignment** (deterministic, so the same event always looks the same): sort the map's seated tiers by all-inclusive price ascending (`getTicketBuyerTotalCents`, ties by ticket type id), then:

| Tiers on the map | Treatments, cheapest → dearest |
| --- | --- |
| 1 | T1 |
| 2 | T1, T5 |
| 3 | T1, T3, T5 |
| 4 | T1, T2, T4, T5 |
| 5 | T1, T2, T3, T4, T5 |

**At most 5 seated tiers per map** (beyond that, patterns stop being tellable apart). The editor enforces it (§5.13); server validation is a proposal (§8).

### 2.3 Contrast (WCAG 2.2, BD1 §2.2 luminances)

| Pair | Ratio | Use |
| --- | --- | --- |
| Black seat stroke / black solid seat on cream map | 20.08:1 | Seat boundaries (1.4.11 ≥ 3) |
| Signal selected fill on cream map | 3.25:1 | Selected seat (non-text ≥ 3); plus 2px black stroke (20:1) and check |
| Signal selected next to T5 black | 6.18:1 | Selected among solid seats |
| Signal selected next to T1–T4 (white base) | 3.40:1 | Selected among light seats |
| Black check / black seat number on Signal | 6.18:1 | Check glyph, selected list chips |
| Black number on white plate / T1 | 21.00:1 | Seat numbers (12–14px) |
| Cream number or glyph on T5 black | 20.08:1 | Seat numbers and glyphs on solid seats |
| `muted` stroke and × on cream | 5.39:1 | Unavailable seat boundary |
| `muted` × on `surface` fill | 4.76:1 | Unavailable glyph |
| `muted` row labels on cream | 5.39:1 | Row labels (12px) |
| White T1 vs cream (fill only) | 1.05:1 | **Not relied on**: the black stroke carries T1 |
| `surface` unavailable vs cream (fill only) | 1.13:1 | **Not relied on**: the muted stroke and × carry it |

Orange is never text here, and never sits on `bg-surface` (2.87:1). Focus rings stay black (BD1 §2.5).

### 2.4 Type, spacing, radii

- Type: BD1 §3.2 only. Seat numbers Plex Mono 500 `tabular-nums` 12px (14px at `s` ≥ 40). Section labels `eyebrow` 12/16 black. Row labels `meta` 12/16 `muted`. Seat lines 14/20 600 (summary), 16/24 600 (stub).
- Spacing: the BD1 scale (4…96px). Radii: `rounded-control` (8px) for controls, list seat chips and zoom buttons; `rounded-card` (12px) for panels, sheets and the summary card; the map canvas is square (BD1 §2.4).
- Motion: §6.

## 3. Grid and layout

### 3.1 `/events/[slug]/seats`, phones and tablets (320–1023px)

A viewport-height tool under the site header: `flex h-[calc(100dvh-var(--header-h))] flex-col`. The footer follows below it (the page can scroll past), and the seat bar is in flow at the bottom of the tool, not `fixed`.

```
┌ site header (56px) ─────────────────────────────┐
│ A  ← (44px)  CHOOSE SEATS           [Find seats]│ 48px  px-4 sm:px-8, border-b border-foreground
│ B  MAP  LIST                                     │ 44px  tabs (§5.4)
│ C  ▢ A$32.78 Standard  ▨ A$48.40 Premium  Key   │ 40px  legend strip (§5.5), horizontal scroll
│ ┌ map canvas (flex-1, min-h 240px) ────────────┐│
│ │ [Stalls 42] [Circle 18] [Box A]   section chips (top-2, inside)
│ │                                               ││
│ │                   seats                  [+] ││
│ │  "Tap a section to zoom in"              [−] ││  hint bottom-left, zoom stack bottom-right
│ │                                          [⤢] ││
│ └───────────────────────────────────────────────┘│
│ D seat bar (data-seat-bar, ≥88px + safe area)    │ §5.10
└──────────────────────────────────────────────────┘
```

- Row A: the back link is a `size-11 rounded-control` icon link (← 16px), `aria-label="Back to {event title}"`. h1 `font-heading text-xl leading-6` "Choose seats", truncated. From `sm`, a `meta` date line and the venue in 14/20 muted sit under it (hidden below `sm` to save height). "Find seats" is `btn btn-outline btn-sm min-h-11` and opens the Find seats sheet (§5.9).
- At 320×568 the map gets about 290px; at 375×812, about 530px. The map never goes below 240px: on a shorter viewport the tool grows and the page scrolls.
- List view: the same rows A–C, then the list scrolls inside the flex-1 area (`overflow-y-auto`), and the seat bar stays.
- Mixed events (decision 2): general admission steppers live in the summary sheet (§5.10), above the totals.

### 3.2 Desktop (≥1024px)

`mx-auto max-w-7xl px-8 pt-6 pb-16`, then `grid grid-cols-[minmax(0,1fr)_24rem] gap-8`.

| Column | Contents |
| --- | --- |
| Left | Header row: back link `eyebrow` "← {event title}" (underlined, `min-h-11`), h1 `font-heading text-xl`, `meta` date · venue. Then tabs. Then the map canvas: `h-[calc(100dvh-var(--header-h)-13.5rem)] min-h-[32rem]`, `border border-foreground` (square), cream. The List view replaces the canvas in the same box and scrolls inside it. |
| Right (24rem) | `sticky top-[calc(var(--header-h)+1.5rem)] max-h-[calc(100dvh-var(--header-h)-3rem)] overflow-y-auto`. Order: Legend (§5.5, full form) → Find seats (§5.9, inline) → Summary card (§5.10) with Checkout. |

No legend strip and no seat bar at ≥lg.

### 3.3 Event page

No layout change: the seated panel (§5.1) takes `TicketSelector`'s place inside `#tickets` (`EventDetailsView`), in the same white card container.

### 3.4 Editor (≥1024px; §5.13)

`grid h-[calc(100dvh-var(--header-h))] grid-cols-[20rem_minmax(0,1fr)_20rem] grid-rows-[auto_minmax(0,1fr)]`: toolbar across the top, generators on the left, canvas in the centre, inspector on the right. Each side panel scrolls on its own. Below 1024px, see §5.13 "Small screens".

## 4. Imagery

- The seat page has **no event photo** (it's a tool). The only imagery is the SVG map.
- The event page keeps its photo and `EventArt` fallback exactly as now (BD1 §6.10). Seating adds no image needs, so there's no image-pipeline dependency.
- Venue background plans (a traced floor plan under the seats) are out of scope.
- Text on the map never sits over a pattern: numbers sit on a white plate (§5.3), labels on the cream canvas.

## 5. Components

### 5.1 Event page seated panel (`SeatedTicketsPanel.tsx`, replaces `TicketSelector` when the event has a seat map)

`EventDetailsView` renders it in place of `<TicketSelector>` when the event payload says it's seated (contract: §8). The container is identical to `TicketSelector`'s: `flex flex-col gap-5 rounded-card border border-foreground bg-card p-4 sm:p-5`.

1. **Steps** (as `TicketSelector`, `ol.eyebrow`): "1 Choose seats → 2 Pay on Stripe → 3 Tickets by email". All free: "1 Choose seats → 2 Confirm by email → 3 Tickets".
2. **Price line:** `formatFeedPriceParts(event)`. Amount 16/24 600 `tabular-nums` ("From A$32.78"), then the note " incl. booking fee" 400 muted on the same line. Never face value alone.
3. **Fee rule line** (only if a buyer pays a fee): as `TicketSelector`, 14/20 muted.
4. **Tier list** `ul`. Rows are `border-t border-surface-border py-3 first:border-t-0 first:pt-0`, each `grid grid-cols-[1rem_1fr_auto] gap-x-3 items-start`:
   - A 16px tier swatch (`SeatGlyph` in the tier's treatment, `aria-hidden`).
   - Name 16/22 600. Under it the breakdown in `meta` muted (`formatTicketBreakdown`), and under that the availability hint (item 5).
   - Right: `formatTicketHeadline` 16/24 600 `tabular-nums` (muted when sold out).
   - General admission tiers of a mixed event appear in the same list with an empty 16px swatch cell and the meta line "Standing · chosen on the next page".
5. **Availability hints** (words only, never colour), from the existing `soldOut` / `remaining` fields:
   - Tier with `remaining` (≤10): "Only {n} seats left", 12/16 600 black.
   - Tier `soldOut`: "Sold out" in `eyebrow` black, with the price muted.
   - Panel line above the CTA, 14/20: "Seats are numbered. You'll pick yours on a seat map." When any tier has `remaining`, it becomes "Few seats left in {tier}" (600). A richer count ("212 seats left") needs a contract (§8).
6. **CTA:** `ButtonLink variant="solid" size="lg" className="w-full"` "Choose your seats" plus a 16px →, to `/events/{slug}/seats`. It's black, not orange: the orange CTA lives in the buy bar only (BD1 §6.10), so a phone viewport never shows two oranges.
7. **Reassurance** 12/16 muted: "Nothing is held until you press Checkout on the next page."
8. **All seats sold out:** no CTA, every tier shows "Sold out", then `WaitlistBlock` exactly as in `TicketSelector` (BD1 §6.11). The seat page still opens read-only if visited directly.
9. **Demo:** identical, and the CTA works (the demo seated event's map is local). The seat page's Checkout is the demo disabled button (§5.10).

**Buy bar and cards:** the label becomes "Choose seats" for seated events (`quickBuyLabel`). Cards keep their target `/events/{slug}#tickets` (owner decision 4). The buy bar links straight to `/events/{slug}/seats` (a decision for the manager, §8; if declined, it keeps `#tickets`).

### 5.2 Seat page shell (`SeatPicker.tsx`)

It owns the selection, the active tab, the availability poll and the page's one polite live region (`p[role=status].sr-only`, mounted on load, using the same trailing no-break-space trick as `TicketSelector.announce` to repeat identical text).

| State | Render |
| --- | --- |
| Loading | Rows A–C rendered. The canvas is `bg-surface` with a centred `DotsLoader announce label="Loading the seat map"`. The seat bar shows "No seats chosen" with Checkout disabled. |
| Error (map fetch) | In the canvas area: `Notice tone="danger" role="alert"` "We couldn't load the seat map." plus `btn-outline` "Try again". The List tab is `aria-disabled`. |
| Ready | §5.3–5.10 |
| Availability stale | After 3 failed polls (30s), a `meta` muted line under the legend strip (desktop: under the legend): "Availability last updated {h:mm am}. Seats may already be taken." It clears on the next success. No alert. |
| All seats unavailable | The map renders (all unavailable). Seat bar and summary: "Every seat is taken." plus a link "Join the waitlist" → `/events/{slug}#tickets`. No Checkout. |
| Sales ended / event ended | `Notice` "Ticket sales for this event have ended." plus a link back to the event. The map is read-only (no selection) and there's no seat bar. |
| Preview (`?preview=1`, organiser or admin) | A strap above row A: `eyebrow` "Preview · what buyers see" with a `rounded-badge border border-foreground px-2 py-0.5` "Preview" badge (not orange). Checkout is replaced by the disabled button "Checkout is off in preview". |

Tab memory: the chosen tab is kept in `sessionStorage` (`sheltuh:seat-tab`) for the session (UI state only).

### 5.3 Seat map (`SeatMap.tsx`, `SeatGlyph.tsx`)

**Canvas:** `relative overflow-hidden bg-background touch-none select-none` (square corners). One `<svg>` with a `<g transform>` for pan and zoom.
- One-finger drag pans and pinch zooms.
- Ctrl/⌘ + wheel or a trackpad pinch zooms at the pointer. A plain wheel pans vertically. The page itself doesn't need to scroll at ≥lg, so this never traps page scroll.
- No inertia.

**Accessibility of the canvas:**
- The `<svg>` is `role="img"` with `aria-label="Seat map of {venue}. {n} seats available. To choose seats with a keyboard or screen reader, use the List tab."`.
- Individual seats are **not** focusable or exposed (the List is the accessible route, §7).
- The canvas wrapper is `tabIndex={0}`, with `aria-describedby` pointing to a hint that appears on focus, in `meta`: "Arrow keys move the map. + and − zoom. 0 shows it all."
- Keys: arrows pan 64px, `+`/`=` zoom in, `-` zoom out, `0` fits the map.
- Focus ring: the global ring with `outline-offset: -2px` (inside the canvas edge).

**Seat states** (all drawn by `SeatGlyph`; glyph visibility depends on the rendered size `s`, §2.1):

| State | Fill | Stroke | Content (when shown) | Non-colour cue |
| --- | --- | --- | --- | --- |
| Available, tier T1–T5 | Tier treatment (§2.2) | black | Seat number at `s` ≥ 32 | Pattern + legend |
| Selected | `signal` | 2px black | Black check (stroke 2.5u, 60% of the seat) at `s` ≥ 12, replacing the number | Check + heavier stroke |
| Unavailable (sold, held or blocked: one state) | `surface` | 1px `muted` | `muted` × (50% of the seat) at `s` ≥ 12 | × + no black boundary |
| Wheelchair space | Tier treatment | black | Wheelchair pictogram (ISA, stroke 1.75, 65% of the seat) instead of the number, at `s` ≥ 12 | Pictogram |
| Companion seat | Tier treatment | black | Letter "C", Plex Mono 500, 50% of the seat, at `s` ≥ 12 | Letter |
| Wheelchair / companion, selected | `signal` | 2px black | Check (the summary line names the kind) | Check |
| Wheelchair / companion, unavailable | `surface` | 1px `muted` | × | × |
| Hover (`pointer: fine` only) | unchanged | 2px black | Tooltip (below) | — |

**Content plates:** on T2–T4, numbers and glyphs sit on a white plate (`rx 2u`, 70% of the seat, centred) so they never cross the pattern. On T1 they're black directly, on T5 cream directly, and on a selected seat black on orange.

**Size thresholds** (`s` = rendered seat size in px):

| `s` | Seats | Labels | Tap or click on a seat |
| --- | --- | --- | --- |
| < 12 (overview) | Tier fill; selected is orange (no check); unavailable is `surface` + muted stroke; no glyphs | Section labels, stage | Zooms to `s` = 32, centred on the tap. Never selects. |
| 12–23 | + glyphs (check, ×, wheelchair, C) | + row labels at both ends of each row | Touch: zooms to `s` = 32. Fine pointer (mouse): selects. |
| 24–31 | as above | as above | Selects (touch and mouse). The pitch is ≥ 28px, which passes the 2.5.8 spacing test. |
| ≥ 32 | + seat numbers (12px; 14px at ≥ 40) | as above | Selects |

**Labels:** section labels in `eyebrow` black at the section's label anchor, always shown. Row labels in `meta` muted, 8px outside the first and last seat of each row, from `s` ≥ 12. Stage per §2.1. The best-seats focus point is never shown to buyers.

**Tooltip** (`pointer: fine`, on hover over any seat, including unavailable ones):
- `pointer-events-none absolute rounded-control border border-foreground bg-card px-3 py-2`, 8px above the seat (flipping below near the top edge), no arrow.
- Line 1, 14/20 600: "Stalls · Row F · Seat 12".
- Line 2, 14/20 `tabular-nums`: "A$65.30 incl. booking fee · Premium", or "Unavailable". Wheelchair spaces add "Wheelchair space".
- `aria-hidden` (the list carries the same text). Shown instantly, hidden on leave.

**Hint caption** (overview only): bottom-left, `meta` on an opaque `bg-background px-2 py-1` chip: "Tap a section to zoom in" (touch) or "Click a seat to choose it" (fine pointer). Hidden once `s` ≥ 24.

**Forced colours:** seats get `stroke: CanvasText`; selected gets `fill: Highlight` with the check in `HighlightText`; unavailable gets a `GrayText` stroke. Only the pattern `<defs>` keep `forced-color-adjust: none`, so the tiers stay distinct.

### 5.4 Map / List tabs

- `div[role=tablist][aria-label="Seat view"]` with two `button[role=tab]`: "Map" and "List".
- Each tab is `umlaut min-h-11 px-3` in Instrument 600 13/16, uppercase, tracking 0.01em (the nav link style).
- **Selected** (`aria-selected="true"`, via the §2 utility extension): orange dots over the label and a 2px black underline, offset 4px.
- **Unselected:** black text with no underline. Hover shows the black dots (the `umlaut` hover).
- Left and Right arrows move between tabs and activate them (automatic activation; the panels are cheap).
- Panels are `role="tabpanel"`, `aria-labelledby` their tab, `tabIndex={-1}`. The map panel's own focusable canvas follows.

### 5.5 Legend (`SeatLegend.tsx`)

**Phones (strip, row C):**
- `flex h-10 items-center gap-4 overflow-x-auto no-scrollbar px-4 sm:px-8 border-b border-surface-border`.
- One item per seated tier, cheapest first: `inline-flex shrink-0 items-center gap-2` holding a 16px swatch, the price 14/20 600 `tabular-nums` ("A$32.78") and the name 14/20 400 ("Standard").
- Then `meta` muted "Incl. booking fee".
- Then the **Key** button: a `min-h-11` text button, 14/20 600, underlined, `aria-expanded`. It opens a popover (`rounded-control border border-foreground bg-card p-4`, anchored under the strip, `w-[min(20rem,calc(100vw-2rem))]`) holding the full legend below. Escape closes it and returns focus.

**Full legend** (top of the desktop panel, and inside the Key popover):
- Heading `eyebrow text-muted` "Prices and key", then a `dl`.
- **Tier rows:** `border-t border-surface-border py-2`. A 20px swatch, the name 16/22 600, the all-inclusive price on the right 16/24 600 `tabular-nums`, and the breakdown in `meta` muted under the name.
- **State rows** (always all of them): "Your seats" (selected swatch), "Unavailable" (× swatch), "Wheelchair space" (pictogram), "Companion seat" (C). On mixed events only, add "General admission": a 20px `rounded-badge border border-foreground` with no fill, labelled "Standing, no seat".
- Footer 12/16 muted: "Unavailable includes sold, held and reserved seats."

### 5.6 Section chips (`SectionChips.tsx`)

- Inside the canvas: `absolute inset-x-0 top-2 flex gap-2 overflow-x-auto no-scrollbar px-2` on phones, `top-3 px-3` on desktop.
- The wrapper is a `nav` with `aria-label="Jump to a section"`. Shown only when the map has 2 or more sections.
- Each chip is a button (not a toggle) in `filterChipClass(false)`: the name 14/20 500 plus a `meta` muted count, "42 left" or "Sold out".
- Pressing a chip animates the view to fit that section (§6) and announces "Showing Stalls. 42 seats available."

### 5.7 Zoom controls (`ZoomControls.tsx`)

- `absolute right-3 bottom-3 flex flex-col gap-2` (desktop `right-4 bottom-4`).
- Three `size-11 rounded-control border border-foreground bg-card` buttons with 16px stroke icons (`aria-hidden`), each named by `aria-label` plus a `title` for pointer users:
  - `+` "Zoom in"
  - `−` "Zoom out"
  - a four-corner frame, "Show the whole map"
- At a limit: `aria-disabled="true"`, styled `border-surface-border text-muted` (focus stays on the button).
- Hover `bg-surface`. Each step zooms ×1.5 around the canvas centre.

### 5.8 Selection rules and messaging

**Limit of 10 seats per order** (decision 4):
- The 11th tap or checkbox is refused and nothing changes.
- The status region and an inline `Notice` (info tone, in the summary and seat bar, removed on the next successful change) say: "That's 10 seats, the most for one order. Remove one to choose another."
- The summary's empty state states the limit up front: "Choose up to 10 seats."

**General admission steppers** keep `TicketSelector`'s limits and messages (8 per type, plus the free-ticket cap). Whether GA counts toward the 10 is a contract question (§8); the copy assumes it doesn't.

**Wheelchair and companion confirmation** (decision 6):
- Choosing one opens a dialog (BD1 §6.14; a bottom sheet below `sm`).
- Title `font-heading text-xl`: "Wheelchair space" or "Companion seat". Body 16/24:
  - Wheelchair: "This space is kept for a wheelchair user. Book it only if you or someone in your group needs it."
  - Companion: "This seat is next to a wheelchair space, for someone going with a wheelchair user. Book it only if that's you."
- Actions: `btn-solid` "Choose this seat" (primary) and `btn-outline` "Cancel". Cancel leaves the seat unselected.
- It's asked once per kind per page visit.

**Status messages** (polite region). Exact strings:

| Event | Announcement |
| --- | --- |
| Add | "Added Stalls, Row F, Seat 12, A$65.30. 2 seats, total A$130.60 incl. booking fees." |
| Remove | "Removed Stalls, Row F, Seat 12. 1 seat, total A$65.30 incl. booking fees." |
| Limit | "That's 10 seats, the most for one order. Remove one to choose another." |
| Taken while choosing (poll) | "Stalls, Row F, Seat 12 was just taken and has been removed from your seats." An inline `Notice` in the summary repeats the words until the next change. |
| Section jump | "Showing Stalls. 42 seats available." |
| Find seats | §5.9 |

### 5.9 Find seats (`FindSeats.tsx`)

**Placement:**
- Phones: row A's "Find seats" opens a bottom sheet (BD1 §6.14) titled "Find seats".
- Desktop: inline in the side panel under the legend, as a block `border-t border-foreground pt-4` with the heading `eyebrow text-muted` "Find seats".

**Form** (`grid gap-4`; on desktop `grid-cols-2` for the two selects, with the button full width below):
- **"How many"**: `select` 1–10, default 2. Label `eyebrow text-muted`.
- **"Price"**: `select` with "Any price", then each seated tier as "Premium · A$65.30" (all-inclusive).
- Submit: `btn btn-outline w-full` (md) "Find seats". Outline, not solid: Checkout is the panel's one solid button.
- Busy: `busy`, label "Finding…".

**Results** (best available means nearest the focus point, adjacent in one row):
- **Found:**
  - The seats **replace** the current selection, the map animates to fit them, and the sheet closes.
  - Status: "Found 2 seats together: Stalls, Row F, Seats 11 and 12. They're now your seats."
  - An inline line in the summary, 14/20, with an "Undo" text button (underlined, `min-h-11`) that restores the previous selection. It disappears on the next change.
- **None:** inline under the button, an info `Notice` (not an alert): "No {n} seats together{ in Premium}. Try fewer seats or any price." The selection is unchanged.
- **Error:** `Notice tone="danger" role="alert"` "Couldn't search just now. Try again."

### 5.10 Summary (`SeatSummary.tsx`) and the phone seat bar

**Content** (the same in the desktop card and the phone sheet):
1. Heading `eyebrow text-muted` "Your seats".
2. Empty: 14/20 muted "No seats chosen yet. Choose up to 10 seats."
3. **Seat lines** `ul`, sorted by section, row, then seat. Each is `flex items-center gap-3 border-t border-surface-border py-2 first:border-t-0`:
   - Left, `min-w-0 flex-1`: `SeatLine` 14/20 600 "Stalls · Row F · Seat 12" (screen readers hear "Stalls, Row F, Seat 12"). Under it `meta` muted "Premium", plus " · Wheelchair space" or " · Companion seat".
   - Right: the all-inclusive price 14/20 600 `tabular-nums` ("A$65.30", or "Free" for free tiers).
   - Remove: a `size-11 rounded-control` icon button (16px ×) with `aria-label="Remove Stalls, Row F, Seat 12"`, hover `bg-surface`. Focus then moves to the next line's remove button, or to the heading if none are left.
4. Mixed events: a "General admission" sub-heading in `eyebrow text-muted`, then `TicketSelector`-style tier rows with steppers (same classes, same messages).
5. **Totals** `dl`, as `TicketSelector`: "Ticket face value" and "Booking fees" 14/20 (labels muted), a 1px black rule, then **"Total" 18/24 700 with its value 20/28 700 `tabular-nums`**, the largest number on the page. Under it `meta` muted "{n} seats".
6. The free-order email field when needed (as `TicketSelector`).
7. **Checkout:** `Button variant="solid" size="lg" className="w-full"`, "Checkout" or "Get free tickets". Disabled with nothing chosen. Busy: "Holding your seats…".
8. **Hold copy** 12/16 muted, under the button (§5.11).
9. The terms line (Purchase Terms, Privacy Policy) as `TicketSelector`.
10. Errors: `Notice tone="danger" role="alert"` directly under the button (§5.11).
11. Demo: `TicketSelector`'s demo button "Checkout unavailable in this demo" and its note.

**Desktop:** the content above in `rounded-card border border-foreground bg-card p-5`.

**Phone seat bar** (`data-seat-bar`, row D):
- `border-t border-foreground bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-8 min-h-[var(--seatbar-h)]`. It's white, not ink: this is checkout (BD1 §6.9).
- Layout `flex items-center gap-3`.
- **Left** (`min-w-0 flex-1`): a disclosure button (`min-h-11 text-left`, `aria-expanded`, `aria-controls` the sheet).
  - Line 1, `eyebrow`: "2 seats · Details" plus a 12px chevron that flips when open.
  - Line 2: the total 18/24 700 `tabular-nums` "A$130.60" with " incl. fees" 12/16 muted.
  - Empty: line 1 "No seats chosen"; line 2 "From A$32.78" 16/24 600 plus the note.
- **Right:** Checkout, `btn-solid btn-lg shrink-0 px-5`. At 320 the label stays "Checkout" (it fits: 48px tall, about 120px wide).
- **Sheet:** a non-modal panel above the bar, `absolute inset-x-0 bottom-full max-h-[70dvh] overflow-y-auto rounded-t-card border-x border-t border-foreground bg-card p-4`.
  - It holds items 1–6 and 8–10. Checkout stays in the bar.
  - Opening it moves focus to its heading (`tabIndex -1`). Escape or the disclosure closes it and returns focus.
  - The map stays visible above it.

### 5.11 Holds, conflicts and errors at Checkout

**Hold copy** (under Checkout, before pressing). The buyer-facing number is the Stripe page's lifetime (30 minutes, the plan's session expiry), not the 35-minute server hold, which adds a 5-minute buffer for payment confirmation. Keep both numbers in one constants module so the copy can't drift.
- Paid: "Seats aren't held while you choose. Pressing Checkout holds them for you while you pay on Stripe. You'll have 30 minutes; if you don't finish, they're released."
- Free, signed in: "Pressing Get free tickets books these seats straight away."
- Free, guest (decision 7): "We'll email you a link to confirm. Your seats are only held once you confirm, if they're still free."

If the manager wants the screen to say 35, the Stripe session expiry must also be 35 (§8).

**Conflict (409, some seats taken):**
- The taken seats are removed from the selection and turn unavailable on the map. The rest stay.
- `Notice tone="danger" role="alert"` under Checkout: "Some seats were taken while you were choosing: Stalls · Row F · Seat 12. We've removed them. Choose other seats, then press Checkout again."
- Focus stays on Checkout.
- If all were taken, the same notice opens with "Your seats were taken while you were choosing…".

**Too many holds (anti-hoarding, 429):** `Notice tone="danger" role="alert"` "A lot of people are checking out for this event right now. Try again in a minute." No retry timer.

**Back from Stripe (browser Back, `lib/seating/pending-checkout.ts`):** the tab's stored order is released on load or `pageshow`, and the inline note says "You left the payment page, so the seats held for you have been released. You weren't charged." The stored order is kept until the release has an answer (released, paid or processing; or 404) and dropped once its 35-minute hold would have lapsed. A network, 409, 429 or 5xx failure keeps it and is retried at the next `pageshow`, reload, or Checkout press (released first, before the new checkout starts); only one release runs at a time.
- Failure on load/pageshow: `role="alert"` "We couldn't release the seats held for your last checkout just now. We'll try again when you press Checkout, and they're released automatically within 35 minutes anyway. You weren't charged."
- Still failing at Checkout (no new checkout starts): `role="alert"` "We couldn't release the seats held for your last checkout yet, so we can't start a new one. Try Checkout again in a moment; those seats are released automatically within 35 minutes anyway. You weren't charged."

**Guest free booking, seats gone at confirm** (`/checkout/confirm`, the `FreeOrderConfirm` error state, BD1 §6.9 structure):
- `font-heading text-2xl` "Those seats have gone".
- Body: "Some of your seats were booked by someone else before you confirmed: Stalls · Row F · Seat 12. Nothing was booked."
- `btn-solid` "Choose seats again" → `/events/{slug}/seats`.

### 5.12 Cancelled page (`app/checkout/cancelled/page.tsx`)

Stripe's `cancel_url` for seated orders points here (contract: §8). Single column `max-w-2xl`, the BD1 §6.9 checkout-page structure, no orange.

| State | Render |
| --- | --- |
| Releasing | `DotsLoader announce label="Releasing your seats"` |
| Released | Strap `eyebrow` "Checkout cancelled" (no dots). h1 `display-md` with the event title. Body 16/24: "You weren't charged, and your seats have been released for others." Then `ButtonLink solid lg` "Choose seats again" → `/events/{slug}/seats` (full width on phones), and a black underlined link "Back to the event". |
| Already paid | "This order is already paid." plus a link to `/checkout/success?session_id=…` |
| Already released or expired | As Released, with the body "Your seats were already released. You weren't charged." |
| Error | `Notice tone="danger" role="alert"` "We couldn't release your seats just now. They'll be released automatically within 35 minutes. You weren't charged." plus `btn-outline` "Try again" and the two links |

The h1 takes focus on load (`tabIndex -1`), as on the confirm pages.

### 5.13 Organiser editor (`components/seating/editor/*`)

A tool surface (BD1 §6.16): quiet, dense and black-structured, never `font-display`. Orange appears only as the selected-seat outline and the focus-point mark (non-text, 3.25:1 on cream).

**Toolbar** (top row, `border-b border-foreground px-4 py-2 flex items-center gap-2`), left to right:
- h1 `font-heading text-xl` "Seat map".
- Status badge (BD1 §6.3): "Draft" (outline), "In review" (outline) or "Approved · locked" (black).
- `meta` muted "412 seats · 3 tiers".
- A spacer, then `btn-outline btn-sm` buttons: "Layouts" (shows and hides "Start from a layout", below), Undo, Redo, "Import", "Export", and "Preview as buyer" (opens the §5.2 preview in a new tab, with sr-only "(opens in a new tab)").
- `btn-solid btn-sm` "Save".
- All buttons are `min-h-10`.

**Start from a layout** (`LayoutPicker.tsx`, layouts in `lib/seating/layouts.ts`; owner request, 25 Oct 2026): a band under the toolbar notices, `border-b border-foreground px-4 py-4`, at every width (it's the one way to make a map on a phone).
- The toolbar's `btn-outline btn-sm min-h-10` "Layouts" (before Undo; `aria-expanded`, `aria-controls`) shows and hides it. It's open by itself on an empty map and closed when the map has seats. Never shown when the map is locked or in "Preview as buyer".
- h2 `font-heading text-lg` "Start from a layout", a 14/20 muted line ("Pick one to fill the map in one go, then change anything with the tools."; on a map with seats it adds "It replaces the seats on the map now (you can undo).").
- Two fields (BD1 §6.2, `sm:grid-cols-2`, `lg:max-w-2xl`): "About how many seats" (text, `inputMode="numeric"`, starts at 150; hint "Each layout keeps to its own size: the cards show the seats you'll get.") and "Price tier for these seats" (the event's ticket types with all-inclusive prices; starts on the first seated tier, else the first; the 6th tier onwards disabled). A number it can't read is a `role="alert"` error under the fields, `aria-invalid` on the input, and focus goes back to it.
- Five cards in a `ul`, one column, two from `sm`, five from `lg`. Each is a `<button>` (`rounded-card border border-foreground bg-card p-3 min-h-11`, `hover:bg-surface`): a schematic (SVG, `aria-hidden`: the stage outlined on `surface`, each row a black bar, aisles as gaps; drawn at a fixed size per layout), the name (14/20 600, the button's name), the one-line description and `meta` "{n} seats · 2 wheelchair spaces" (its description). Picking is one tap or Enter.

| Layout | Model | Range |
| --- | --- | --- |
| Rows facing a stage | One section "Stalls", straight rows about twice as wide as deep | 10–2,000 |
| Theatre with a centre aisle | One section, each row split by a two-seat aisle, numbered straight across; wheelchair spaces either side of the aisle | 12–2,000 |
| Stalls and side sections | "Left", "Stalls", "Right": the sides turned 20° towards the stage | 30–2,000 |
| Curved rows | One section in a 100° fan around the stage, more seats towards the back, each seat facing it | 20–1,200 |
| Small room | One section "Seats", at most 8 rows of 12 (about 40 is 4 rows of 10) | 8–96 |

Every layout has a stage with the focus point at its centre, rows A, B, C… front to back, seats 1, 2, 3… left to right, and in the front row two wheelchair spaces, each with a companion seat beside it. Cabaret tables aren't offered: the model has no table shape.
- **Empty map:** picking applies straight away; the band closes and focus moves to "Layouts". **Map with seats:** a `SeatDialog` "Replace the seat map?" ("{layout} ({n} seats) takes the place of the {m} seats on the map now. You can undo this before saving.") with `btn-solid` "Replace map" and `btn-outline` "Cancel". Either way it's one Undo step, the selection clears, and the live region says "{layout}: {n} seats. Save to keep it, or undo."

**Generators panel** (left, `border-r border-foreground p-4`), in `Panel`-style sections:
1. **"Add a section":**
   - A type `fieldset` with native radios, "Rectangular" and "Curved".
   - Fields (BD1 §6.2, 14px from `sm`):
     - Section name
     - Rows (1–50) and Seats per row (1–80)
     - Row labels (select): "A, B, C… (AA after Z)" or "1, 2, 3…"
     - Rows run: "Front to back" or "Back to front"
     - Seat numbers (select): "1, 2, 3… left to right", "Right to left" or "Odd left, even right"
     - First seat number
     - Price tier: a select of the event's ticket types, with their all-inclusive prices and swatches
     - Curved only: "Arc" (degrees, 10–180) and "Radius" (u)
   - While editing, a live ghost of the section shows on the canvas (seats with a 1px dashed black outline and no fill).
   - `btn-solid w-full` (md) "Add section". After adding, focus moves to the new section in the Sections list.
2. **"Sections"** list: ruled rows `border-t border-surface-border min-h-11`. Each shows the name and `meta` "8 rows · 160 seats", with actions "Select" (selects all its seats), "Rename" and "Delete" (danger text button, with a confirm dialog).
3. **"Stage and focus point":** stage X, Y, W and H number fields; focus point X and Y number fields, with "Reset to stage centre".
4. **Tier check:** if the event has more than 5 ticket types, a `Notice`: "A seat map can use up to 5 price tiers so buyers can tell them apart without colour. Use 5 or fewer here." The 6th tier onwards is disabled in the tier selects.

**Canvas** (centre):
- The same `SeatMap` renderer on cream, plus a decorative 1px `surface-border` grid every 32u, with the same zoom stack and keyboard pan and zoom.
- Click selects a seat; Shift+click adds to the selection.
- Dragging on empty space draws a marquee (`border border-dashed border-foreground`, no fill).
- Dragging selected seats moves them, snapping to 4u.
- Every drag has a non-drag alternative (§7).
- The focus point is a 20px `rounded-badge bg-signal` square with a black crosshair. It's draggable and can also be set with the number fields.

**Editor-only seat states:**

| State | Fill | Stroke | Glyph | Non-colour cue |
| --- | --- | --- | --- | --- |
| Selected | tier treatment | 2px black, plus a 2px `signal` outline 2px outside | — | Double outline; count in the toolbar |
| Blocked | `surface` | 1.5px dashed black (3u dash) | black × | Dashed boundary + × (distinct from the buyer's muted ×) |
| Duplicate or invalid label | tier treatment | 2px `danger` | "!" in `danger` on a white plate | Glyph + listed under Issues |
| Ghost (generator preview) | none | 1px dashed black | — | Dashed |
| Wheelchair / companion | as the buyer view | as the buyer view | pictogram / C | as the buyer view |

**Selection actions toolbar:**
- Appears at the top of the canvas when seats are selected: `absolute inset-x-3 top-3`, `role="toolbar" aria-label="Selected seats"`, `rounded-control border border-foreground bg-card px-3 py-2 flex flex-wrap items-center gap-2`.
- Arrow keys move between its controls (roving `tabIndex`).
- Contents, in order:
  - `eyebrow` "{n} selected" (a sibling `role="status"` announces changes)
  - "Tier" select
  - Toggles with `aria-pressed`, styled `filterChipClass`: "Wheelchair", "Companion", "Blocked"
  - "Relabel…" (a dialog: row label, first seat number, direction)
  - "Align row"
  - "Nudge": four arrow buttons, 4u each (Shift = 16u)
  - "Clear"
  - `btn-danger btn-sm` "Delete"
- Mixed values show the select as "Mixed" and the toggles as `aria-pressed="mixed"` with a dash glyph.

**Inspector** (right, `border-l border-foreground p-4`):
- **One seat selected:** fields for Section, Row label, Seat label, X, Y, Rotation, Tier, Kind (Standard / Wheelchair / Companion), and a Blocked checkbox.
- **Several selected:** counts per tier and per kind.
- **None selected:** a map totals table (tier → seats, wheelchair, companion, blocked) per BD1 §6.16 table rules, then an "Issues" list. Each issue is a button that selects the seats concerned.

**Import and export:**
- Export downloads `{slug}-seat-map.json`.
- Import uses a file input (`.json`) in a dialog. After parsing, it shows a result panel:
  - Valid: "{n} sections, {n} seats. Replace the current map?" with `btn-solid` "Replace map" and `btn-outline` "Cancel".
  - Invalid: `Notice tone="danger" role="alert"` listing up to 10 errors as `meta` paths ("sections[2].rows[4]: seat 12 is used twice"), then "+{n} more".

**Locked (approved):** the whole editor is read-only.
- The toolbar keeps Export and Preview.
- The canvas still pans and zooms. There's no selection toolbar.
- A `Notice` under the toolbar: "This seat map is locked because the event is approved. To change it, contact Sheltüh."

**Small screens (<1024px):** the editor shows the status, the counts, "Start from a layout" (above), the `Notice` "To draw or change seats one by one, the seat map editor needs a screen at least 1024px wide.", and Layouts, Import, Export, Preview as buyer and Save. This is a behaviour limitation, listed in §8.

**Empty map:** an `EmptyState` (BD1 §6.14) in the canvas, titled "No seats yet", with the body "Start from a layout (Layouts, above), add a section on the left, or import a seat map." and no action button (the panel is right there).

### 5.14 Admin preview

**Review queue** (`components/admin/EventQueue.tsx`), for seated events: a ruled row with
- `eyebrow text-muted` "Seat map";
- `meta` "412 seats · 3 tiers · 4 wheelchair · 4 companion · 6 blocked";
- black underlined links (`min-h-11`): "Preview as buyer" (the §5.2 preview) and "View in editor" (the read-only editor).

**Replacing a map** (decision 9) happens on the admin edit page:
- `btn-outline` "Replace seat map", enabled only when the event has no orders. Otherwise it's `aria-disabled`, with 12/16 muted "Can't replace: this event has orders."
- It opens the Import dialog plus a required "Reason (logged)" textarea. The confirm button is `btn-danger` "Replace map".

The preview keeps the buyer colours. Orange selected seats are a seat state, not an admin CTA, and BD1 §6.16's no-orange rule covers the UI chrome.

### 5.15 Seat lines on tickets, email and door

`lib/seating/format.ts`:
- `formatSeatLine({ section, row, seat, kind })` → "Stalls · Row F · Seat 12".
  - With no row label: "Box A · Seat 3".
  - Wheelchair: "Stalls · Row F · Wheelchair space 3". Companion seats keep "Seat".
- `speakSeatLine` → "Stalls, Row F, Seat 12" (for sr-only text and the door announcer).
- The `SeatLine` component renders `<span aria-hidden="true">{line}</span><span className="sr-only">{spoken}</span>`.

| Surface | Spec |
| --- | --- |
| `TicketStub` | New optional `seat` prop. Inside the existing label block (no new grid rows): the type label stays `eyebrow text-muted`, then `SeatLine` 16/24 600 black with `mt-1`. On phones it's in the header row's left column; from `sm`, in the row-1 cell. Black in print. Stubs are sorted by section, row, then seat. |
| Confirmation and account ticket lists | Inherit from `TicketStub`. Totals unchanged. |
| Ticket email (HTML) | Under each ticket's type name, a line in the same font, bold, 16px, black: "Stalls · Row F · Seat 12". Plain-text part: "Seat: Stalls, Row F, Seat 12". No other email restyling (BD1 §10). |
| Door `ResultPanel` (`TicketLine`) | A third line after the type: `SeatLine` `text-2xl leading-8 font-semibold`, larger than the type so staff can direct people. The same in the "Already checked in", "Ticket void" and "Wrong event" details. Door palette untouched. |
| Door announcer (`check-in.md` §5.A8) | Append the spoken seat: "Let in. Premium, ticket 2 of 3. Stalls, row F, seat 12." / "Don't let in. Already checked in at 8:42 pm. Stalls, row F, seat 12." |
| Recent scans | Append " · Stalls · Row F · Seat 12" to the ticket meta line. |

## 6. Motion

| What | Motion | `prefers-reduced-motion: reduce` |
| --- | --- | --- |
| Zoom buttons, section chips, tap-to-zoom, Find seats fit | `transform` 200ms `cubic-bezier(.2,.7,.2,1)` (Find seats: 300ms) | Instant jump |
| Drag pan, pinch zoom | Direct manipulation, 1:1, **no inertia** | Same |
| Seat state change (selected, taken by the poll) | None: an instant fill swap | Same |
| Phone summary sheet, Key popover | `opacity 0→1` + `translateY(1rem)→0` 200ms ease-out; close 150ms (BD1 §8.4) | Opacity only, 100ms |
| Dialogs (wheelchair confirm, import, relabel) | BD1 §8.4 dialog motion | BD1 reduced |
| Loading | `DotsLoader`, while loading only | Static + text |
| Editor ghost, marquee | None | — |

Nothing loops, pulses or counts down on screen. Map transitions run in JS and check `matchMedia("(prefers-reduced-motion: reduce)")`. CSS transitions live only inside `@media (prefers-reduced-motion: no-preference)`.

## 7. Accessibility (WCAG 2.2 AA)

| SC | How this design meets it |
| --- | --- |
| **1.4.1 Use of colour** | Tiers: pattern + legend name + price. Selected: check + 2px stroke + summary list. Unavailable: × + muted boundary + "unavailable" in names. Wheelchair and companion: pictogram and letter. Editor states: dashed or double outlines and glyphs. The List view uses native checkbox state, not fill alone. |
| **1.4.11 Non-text contrast** | §2.3: every seat boundary is ≥ 3:1 against cream; the selected fill is 3.25–6.18:1 against its neighbours; controls have 1px black boundaries. |
| **2.1.1 Keyboard** | The List view (below) does everything: choose, remove, find seats, check out. The canvas is still keyboard pannable and zoomable. Editor: every action is in the toolbar, the inspector and the generator forms. |
| **2.2.1 Timing adjustable** | Sheltüh's pages have no time limit: nothing is held while choosing, and there's no on-page countdown. The hold starts at Checkout and is stated before pressing. It's an essential limit (finite seats, anti-hoarding), so the essential exception covers the Stripe window. Expiry loses nothing: you aren't charged and can choose again (§5.12). |
| **2.4.11 Focus not obscured** | `scroll-padding-bottom` for `[data-seat-bar]` (§2). The summary sheet is opened by the user and moves focus into itself. |
| **2.5.7 Dragging movements** | Buyer: pan and zoom also work through the zoom buttons, section chips, tap-to-zoom and the keyboard; choosing is a single tap, or the List. Editor: the marquee has section "Select" and Shift+click; moving seats has the Nudge buttons and X/Y fields; the focus point has number fields. |
| **2.5.8 Target size (minimum)** | Map seats can render below 24px. The page offers the **equivalent** List view on the same page, with 44px seat checkboxes. Touch taps below `s` 24 zoom rather than select, and from `s` 24 the 28px pitch meets the spacing rule. All controls are ≥ 44px on phones; the 40px desktop toolbar buttons have ≥ 8px gaps. |
| **4.1.2 Name, role, value** | Tabs, the toolbar, `aria-pressed` toggles (including "mixed"), disclosures with `aria-expanded`, and checkbox names with section, row, seat, tier and price. |
| **4.1.3 Status messages** | One polite `role="status"` region covers selection, limits, section jumps, Find seats results and poll removals (§5.8). Errors that block Checkout use `role="alert"`. The editor's selection count is a status. |

**List view (`SeatList.tsx`)**, the accessible equivalent:
- **Toolbar** (`flex flex-wrap gap-3 border-b border-surface-border px-4 py-3`): a "Price" select ("All prices", then the tiers with prices) and a checkbox "Available seats only" (on by default).
- **Sections:** each is a `section[aria-labelledby]` with a disclosure header button (`min-h-11 w-full flex justify-between border-t border-foreground py-3`, `aria-expanded`).
  - The button holds an h2 `font-heading text-xl leading-6` "Stalls" and `meta` muted "42 of 120 available · from A$32.78".
  - Default: all expanded when there are 3 sections or fewer; otherwise the first section plus any that hold your seats.
- **Rows:** each is a `fieldset` (`border-t border-surface-border py-3`) with a `legend` in `eyebrow`: "Row F", plus " · Premium · A$65.30 incl. booking fee" when the whole row is one tier. The group is named "Stalls, Row F".
- **Seats:** `grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2`.
  - Each seat is a `label` (`flex min-h-11 items-center gap-2 rounded-control border border-foreground bg-card px-2`) holding a native checkbox (16px, black `accent-color`) and the seat number 14/20 600 `tabular-nums`.
  - A 12px tier swatch is added when the row mixes tiers. The wheelchair pictogram or "C" follows the number at 12px.
  - Checked: `has-[:checked]:bg-signal` (black text 6.18:1, black border).
  - Unavailable (when shown): native `disabled`, `bg-surface border-surface-border text-muted line-through`.
  - Focus: the global ring on the checkbox.
- **Checkbox names** (`aria-label`):
  - "Seat 12, Premium, A$65.30 incl. booking fee"
  - "Seat 3, wheelchair space, Standard, A$32.78 incl. booking fee"
  - "Seat 13, unavailable"
- **At the 10-seat limit**, unchecked boxes stay enabled. Checking one is reverted and announced (§5.8), so nobody is stranded on a disabled control.
- **Skip link:** above the map canvas, sr-only until focused, "Choose seats from a list". It switches to the List tab and focuses its first section header.

## 8. Dependencies, proposals and out of scope

**Contracts needed (backend):**
- **Event payload:** a seated flag (e.g. `seatMap: { version, seatCount } | null`) so `EventDetailsView` can pick the panel, and seated tiers' `soldOut` / `remaining` derived from seats. Optional: `seatsAvailable`, for "212 seats left".
- **Map payload:** sections (name, label anchor), rows (label, ends for row labels), seats (id, labels, x, y, rotation, tier, kind), the stage rectangle and the focus point; plus the availability bitmap (plan).
- **Checkout errors:** a 409 body listing the taken seat ids; a 429 for anti-hoarding; and a free-guest confirm error listing taken seats.
- **Cancel:** seated orders' Stripe `cancel_url` → `/checkout/cancelled?order={id}` (today it's `/events/{slug}`), plus a cancel endpoint for the page to call.
- **Seat data downstream:** the success, ticket and door payloads carry `seat { section, row, seat, kind }`.
- **Find seats:** an endpoint, or a client-side search over the map and bitmap (the architect decides).
- **Hold copy:** the buyer-facing minutes must equal the Stripe session expiry. This spec says 30 (the Stripe page), with a 35-minute server hold behind it. To show "35", set the session expiry to 35 too.

**Proposals (behaviour, for the manager):**
1. On seated events, the buy bar links straight to `/events/{slug}/seats` (label "Choose seats"); cards keep `#tickets`.
2. A server-side cap of 5 seated tiers per map (the editor already enforces it).
3. The editor needs a screen ≥ 1024px; phones get Preview, Import and Export only.
4. Decide whether general admission counts toward the 10-seat limit (the copy assumes it doesn't).

**Out of scope:** venue floor-plan images, standing areas drawn on the map, live block/unblock, a hold-on-tap countdown, Realtime, the Companion Card flow, a move-seat tool and seat chart analytics (all "Later" in the plan); any transactional email redesign beyond the seat line; any door palette change.

## Manager decisions (owner away, 21 Oct 2026)

1. Buyers are told "You'll have 30 minutes" (the Stripe page's lifetime); the 35-minute hold keeps a 5-minute buffer for payment confirmation.
2. On seated events the buy bar goes straight to the seat page; cards still go to the event's tickets section.
3. At most 5 seated tiers per map, enforced by the editor and the server.
4. The seat-map editor needs at least 1024px; phones get preview, import and export only.
5. General admission tiers on a mixed event don't count toward the 10-seat limit; they keep their existing per-type limits.
