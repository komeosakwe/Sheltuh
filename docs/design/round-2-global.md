# Round 2, Part 1: global fixes (implementation spec)

Source: `docs/design/round-2-handoff.md` (Latte's handoff, 16 Nov 2026). The owner's amendments at its top
**win** over the handoff. Scope: items 1.1–1.7, plus the designer's global chat notes (Buy tickets hover, nav
size). Part 2 and the homepage city-list hover are out of scope. The Figma "Round 2 samples" were not
supplied, so anything only Figma could settle is marked **UNRESOLVED** and listed in (B).

Breakpoints: **XL** ≥1280 (`xl:`), **L** 1024–1279 (`lg:`), **M** 768–1023 (`md:`), **S** <768 (base and
`sm:` 640). Verify at 1440, 1200, 1024, 768, 390 and 320, with no sideways scroll at any width.

## 0. Principles

1. The layout stays the same at every width: sizes step down, things may reflow, and **DOM order equals
   visual order** at every width (owner amendment). No `order-*` reshuffles.
2. Hover is never the only way to see something. Every hover state has a `:focus-visible` equivalent and,
   where it acts as press feedback, an `:active` one. Tailwind v4's `hover:` already only applies under
   `(hover: hover)`.
3. Facts (date, time, venue, place) are set in proportional Instrument Sans (`mono-s` / `mono-m` / `meta`,
   which are Instrument Sans with tabular figures in this codebase). Never `font-mono`.
4. Names are shown as entered. CSS never upper-cases an event title, venue or address. Short labels may be
   upper-case.
5. One stretched link per card or slide. Every other control is a sibling above it (`relative z-10`), never
   nested inside it.
6. Token-first: new sizes become named utilities in `app/globals.css`, not one-off `text-[…]` values.

## 1. Tokens (`app/globals.css`)

| Token / utility | Now | Target |
| --- | --- | --- |
| `--header-h` :77, :94–98 | 4rem; 6rem from 64rem | **3.5rem** (56); **4.5rem** (72) from 64rem |
| `label-nav` :592–597 | 1.125rem/1.5rem, 500 | **1rem/1.5rem**, 500 |
| `nav-button` font-size :810 | 1.125rem | **1rem** (line-height 1.5rem; padding, height and stroke unchanged) |
| `page-container` margin :706–711 | 16 / 32 from 48rem / 64 from **90rem** | 16 / 32 from 48rem / 64 from **80rem** (only `90rem` changes to `80rem`) |
| `event-title` :1412 | `text-transform: uppercase` | `text-transform: none` (1.7) |
| `.btn-signal` hover :1295–1299 | black fill, orange label and edge, `(hover:hover)` only | Keep it. In the same `@layer components` block, outside the hover media query, add `.btn-signal:focus-visible:not(:disabled, [aria-disabled="true"])` with the same three values. Keep the existing `:active`. |
| **new** `display-hero` | – | Bootzy (as `display-m`: face, 400, no synthesis, tracking, **uppercase**: it's a brand line, not data). 2.5rem/3rem; from 48rem 3rem/3.5rem; from 80rem 3.5rem/4rem (40/48, 48/56, 56/64) |
| **new** `title-banner` | – | Bootzy (face, 400, no synthesis), **no text-transform**. 1.75rem/2rem; from 48rem 2rem/2.5rem; from 80rem 2.5rem/3rem (28/32, 32/40, 40/48) |
| **new** `heading-section-l` | – | Instrument Sans 700, tracking −0.015em. 1.5rem/2rem; from 48rem 2rem/2.5rem (24/32, 32/40) |

Don't change `heading-h1` or `display-m`: `display-lg` aliases `heading-h1` across every page header.

Tests that pin the old values and need updating (test-engineer): `tests/brand-tokens.test.ts` (nav-button
1.125rem, `--header-h` 4rem/6rem), `tests/Nav.test.tsx:355` (`h-24`), `e2e/header-fit.spec.ts:103` ("6rem"),
`e2e/admin.spec.ts:484`, `tests/FeaturedCarousel.test.tsx`, `tests/EventCard.test.tsx`,
`tests/HomeEventSections.test.tsx`, `tests/HomeStatic.test.tsx`, `tests/SceneEventRow.test.tsx`,
`e2e/home.spec.ts` and `e2e/responsive.spec.ts`. Update the assertions to the new spec. Never delete them.

## 2. Items

### 1.1 Featured banner (`components/home/FeaturedCarousel.tsx`)

**Now:** slide `aspect-square sm:aspect-[2/1] lg:aspect-[7/2]` (:260). Ink panel `bg-background/90`
(:272–275), which renders as solid black because the unlayered `[data-surface="ink"]` background beats the
utility. Title `font-display text-2xl leading-8 uppercase md:text-4xl md:leading-10` (:278). Facts line with
time and price (`slideFacts` :27–31). Buy tickets plus Details (:282–293). Dots, Pause, Prev and Next sit
under the photo below 1024 and over it from 1024 (:190–239). The skeleton in `HomeEventSections.tsx:100`
mirrors the old ratios.

**Target structure (one slide):**
```
div[data-slide][data-surface=ink] relative isolate flex flex-col justify-end <aspect> group/slide
  div absolute inset-0 -z-10 overflow-hidden rounded-card   → EventArt (fit="auto", focus classes below)
  div aria-hidden absolute inset-0 -z-10 rounded-card bg-linear-to-b from-transparent from-35% to-black/80
  div (content, NOT positioned) <padding> <max-width>
    p  category                          mono-s text-foreground   (white in ink; was text-signal)
    h3 title-banner line-clamp-2 break-words mt-2
       Link[data-banner-link] href=/events/slug  underline decoration-transparent underline-offset-4
            group-hover/slide:decoration-current focus-visible:decoration-current
            after:absolute after:inset-0 after:z-0 after:rounded-card after:content-['']
    p  "{date} · {venue}"                body-m tabular-nums mt-3
    ButtonLink (cardCta) relative z-10 self-start mt-4   (only when cardCta() returns one)
```
- The ink scope on the slide paints black under the photo, which also serves as the loading backdrop. Never
  put `data-surface` on the content div: it would paint a black box again.
- **Aspect ratio:** S `aspect-[4/5]` below 640; `sm:aspect-[2/1]` 640–1023 (tablet "as now"); `lg:aspect-[5/2]`
  at L and XL. That gives 1312×525 at 1440, 1152×461 at 1280 and 960×384 at 1024. Content stays in the flow,
  so a slide with long words at 320px or 200% text grows rather than clipping. Skeleton (:100): `aspect-[4/5]
  sm:aspect-[2/1] lg:aspect-[5/2]`.
- **Focal point:** the event's `imageFocus` (inline `object-position`) applies at every ratio, as now. With
  no `imageFocus`, use per-breakpoint defaults on the `<img>`: `object-[50%_50%] sm:object-[50%_40%]
  lg:object-[50%_35%]`. Wider crops bias upward so subjects stay above the text zone. This needs an
  optional `imgClassName` prop on `EventArt`, appended to the `<img>` class (EventArt.tsx:275), which is an
  additive contract change. Use `fit="auto"` so a portrait poster shows whole on its blurred backdrop
  instead of being cropped to a strip (BD1 §8.1: never crop text off a poster).
- **Fallback (no `imageUrl`):** EventArt's poster art with the same gradient. No other change.
- **Padding:** S `p-6` (24); M `md:p-8` (32); L and XL `lg:p-12` (48). Content width: S full; M `md:max-w-md`;
  L `lg:max-w-xl`; XL `xl:max-w-2xl`. **Below 768**, the content also gets `pb-22` (24 + 48 control + 16 gap),
  so Buy tickets never collides with the controls at 320–767. From M up, the max-widths keep them apart:
  checked at 768 (content ends at 480, controls start at 488), 1024 and 1280.
- **Content:** category · title · date · venue · Buy tickets. Remove time, price and **Details**. Date is
  `cardDateLabel(event, now)`: `.date` ("Sat 21 Nov"), or `.running` for an event already on. Venue is
  `event.venueName.trim()`, else `eventPlaceName(event)`. Replace `slideFacts` with this. The CTA keeps
  `cardCta`'s real label (Buy tickets, Free tickets, Choose seats, or Join waitlist as outline) and its
  `aria-label` "`{label}: {title}`".
- **Buy tickets size:** M (48) below 1440 and L (56) from 1440: `ButtonLink size="md"` plus
  `min-[90rem]:min-h-14 min-[90rem]:px-8` (utilities beat `.btn` in the components layer).
- **Controls:** dots **plus Pause/Play** (amendment, overruling "dots only"). Delete Prev/Next and `step()`.
  Wrapper: `absolute right-6 bottom-6 z-10 md:right-8 md:bottom-8 lg:right-12 lg:bottom-12 flex items-center
  gap-2 [--foreground:var(--paper)]`. The last class makes focus rings white over the dark gradient. Keep
  the wrapper before the track in the DOM (WAI pattern). Dots: the white pill at every width, `h-10
  rounded-control bg-paper px-2`, with 24px dot buttons (`size-6`), inactive `bg-ink/60`
  (`group-hover/dot:bg-ink`), current `w-6 bg-signal`. Pause/Play: `size-12 md:size-10 rounded-control
  border-control border-ink bg-paper text-ink hover:bg-hover`.
- **Autoplay** (keep the existing logic): 6s, holds on mouse hover and on focus anywhere inside except
  Pause/Play, stops on touch, pointer-down or a user scroll, never runs (and Pause is hidden) under
  `prefers-reduced-motion`, and the live region is off while playing.
- **Swipe:** already native `snap-x snap-mandatory` scrolling on the track (:244). No dependency is needed.
- **Hover/focus:** hovering the slide underlines the title. Keyboard focus on the title link underlines it
  and shows the global ring (white in ink). Buy tickets keeps its own states. On touch the whole slide is the
  link, so nothing is hover-only.

**Accept:** at 1440 the banner is 1312×525. At 1200 it's 1136×454 with no text box, a gradient only, and the
title at 40px from 1280 and 32px at 1200. At 390 it's 4:5 with Buy tickets clear of the dots. Clicking
anywhere except Buy tickets, the dots or Pause opens the event. Tab order is Pause, the dots, title link,
Buy tickets. There's no `<a>` inside `<a>` (axe `nested-interactive` clean). With reduced motion there's no
autoplay and no Pause button. The title isn't upper-cased.

### 1.2 Responsive

| | XL | L | M | S |
| --- | --- | --- | --- | --- |
| Header (`Nav.tsx`) | `h-18` (:239 `h-24`→`h-18`) | `h-18` | compact `h-14` (:176 `h-16`→`h-14`) | `h-14` |
| Page margin | 64 | 32 | 32 | 16 (token, §1) |
| Hero (`HomeHero.tsx:19`) | one row | **one row**: `xl:` → `lg:` on `flex items-center justify-between gap-8` | headline row, search full width below | same as M |
| Badge (:21) | `xl:size-20` (80) | `size-18` (72) | hidden (B3) | hidden (B3) |
| Search wrapper (:33) | `xl:max-w-xl` | `lg:mt-0 lg:w-full lg:max-w-md` (drop `lg:max-w-2xl`) | full width | full width |
| Search (`SearchBar.tsx`) | inline bar | inline bar | **one field → existing sheet** | existing sheet |
| Category chips (`CategoryRow.tsx:45–46`) | one row (`xl:grid-cols-7`, as now) | **scroll**: every `lg:` wrap/overflow/margin class → `xl:`, `fadeClassName="xl:hidden"` | scroll | scroll |
| All events grid (`HomeAllEvents.tsx:30`) | 4 | 3 | 2 | **1**: `sm:grid-cols-2` → `md:grid-cols-2` |
| Rails: This weekend, Following (`HomeEventSections.tsx:30–32`) | 4-col grid | 3-col grid | **swipe**, two cards per view | swipe, `w-72` cards (next one peeks in) |

- Rails: swipe below `lg`. `ROW` becomes `… -mx-4 px-4 scroll-px-4 md:-mx-8 md:px-8 md:scroll-px-8 lg:mx-0 lg:grid
  lg:grid-cols-3 lg:gap-x-8 lg:gap-y-8 lg:overflow-visible lg:px-0 lg:py-0 xl:grid-cols-4`. `ROW_ITEM` is `w-72
  md:w-[calc((100%-1.5rem)/2)] lg:w-auto`, with gap `gap-x-4 md:gap-x-6`.
- Search sheet below 1024: in `SearchBar.tsx` every `md:` becomes `lg:` (:168, :186, :188, :203, :206, :236,
  :239, :244), and `matchMedia("(width >= 48rem)")` becomes `64rem` (:140). In `SearchSuggestions.tsx:43`
  `md:` becomes `lg:`. In `LocationPicker.tsx:505`, change only the **non-standalone** branch. Nearby's
  standalone picker and the shared popover (:532, :546, :551) must not change at M. This affects `/search` at
  768–1023 too, which is intended.
- **"When" field:** not built (`/search` reads only `q` and `near`). UNRESOLVED (B6). Don't add it.
- Order fixes (principle 1): `CommunitySection.tsx:114` remove `max-sm:order-last` (phones: head, Explore
  communities, band, cards). `CreatorsCard.tsx:31` remove `order-first lg:order-none` (phones: words, photo,
  button). Fixing the controls in 1.1 fixes the carousel's order.
- "Bring your event to / life": the 32px size (1.3) plus `text-balance` on the h2 (`CreatorsCard.tsx:26`).

**Accept:** at 1200 the search sits beside the headline and there's no empty band. At 1024 the hero is one
row with no overflow. At 768 the search is one field that opens the full-screen sheet, and Escape returns
focus. Below 1280 the chips scroll. At 640–767 All events is one column. There's no sideways page scroll at
320 or 768, and DOM order equals visual order at every width.

### 1.3 Type sizes

| Text | Where (now) | XL | L / M | S |
| --- | --- | --- | --- | --- |
| Nav | `label-nav`, `nav-button` (18) | 16 Medium | 16 | menu (unchanged `display-m`) |
| Hero h1 | `HomeHero.tsx:23` `text-[2.625rem] leading-[2.75rem] … md:display-m` (42 → 56 from 768; the "72" was the live site) | `display-hero` 56/64 | 48/56 | 40/48 |
| Hero lede | :28 `text-[1.0625rem] leading-7 … md:text-lg` (17–18) | `body-m` 16/24 (`text-muted`, 500 via the secondary rule) | 16 | 16 |
| Section titles | `heading-h1` (40/48, 32/40) | `heading-section-l` 32/40 | 32 | 24/32 |
| Banner title | 1.1 | `title-banner` 40/48 | 32/40 | 28/32 |

`heading-section-l` replaces `heading-h1` on `HomeSectionHead.tsx:35`, `CommunitySection.tsx:108` and the
band's h3 at :126 (so it isn't bigger than the section titles), `CreatorsCard.tsx:26`,
`community/LocalDiscovery.tsx:39`, `JoinBanner.tsx:70` and `WhoSeesYou.tsx:52` (also drop its `lg:text-5xl
lg:leading-tight`). City names in `ScenesByCity.tsx:75` are list items, not section titles, so leave them.

**Accept:** computed sizes match the table at 1440, 1200, 1024, 768 and 390.

### 1.4 Section spacing

The gap between sections is 64 at L and XL, 48 at M and 40 at S: **`mt-10 md:mt-12 lg:mt-16`**. Apply it to
`HomeEventSections.tsx:24` `SECTION` (was `mt-12 md:mt-16 lg:mt-24`), `Home.tsx:8` `SECTION_GAP` (was
`mt-16 md:mt-24`), `CommunityPage.tsx:22` (was `mt-12 md:mt-16 lg:mt-24`) and :26–27 (was `mt-16
lg:mt-24`). Leave the hero→banner→chips gaps (`mt-6 lg:mt-8`), the head→content gap
(`HomeSectionHead` `mb-6 md:mb-8 lg:mb-12`) and the page's bottom padding, since the handoff doesn't cover
them. **Accept:** chips→This weekend measures 64 at 1440 (was 96).

### 1.5 Event card (`components/ui/EventCard.tsx`, `PriceTag.tsx`, `lib/event-card.ts`)

| What | Now | Target |
| --- | --- | --- |
| Image | `MEDIA = "aspect-[4/3]"` (:16) | `aspect-[2/1]`. The placeholder and clip frame share `MEDIA`. Keep `fit="auto"` (a portrait poster shows whole on its blur) and the `imageFocus` behaviour. |
| Meta | one line: date · time · place (:24–30, :150) | **Two lines**, both `mono-s @2xs:mono-m text-muted truncate` (Instrument Sans). Line 1: `cardWhenParts()` (date · time [zone], or "Now on · until …"). Line 2: `cardWhereLabel()` = `[eventPlaceName(event), venueName.trim()]` joined " · " ("Northcote, VIC · Northcote Theatre", the handoff's "location · venue"). Add both helpers to `lib/event-card.ts`, keeping `cardMetaParts` for any other caller. Date/time **stay** (amendment). |
| Price label | `PriceTag` `bg-signal text-signal-foreground` (:21) | Signal tone only: add `group-hover/card:bg-ink group-hover/card:text-signal group-has-[[data-card-link]:focus-visible]/card:bg-ink group-has-[[data-card-link]:focus-visible]/card:text-signal motion-safe:transition-colors motion-safe:duration-200`. It stays a non-interactive label: no button, no tab stop. Neutral tone is unchanged. |
| Hover | cream panel and underline (:112–116, :145) | Keep. Add `focus-visible:decoration-current` to the link and an active state `group-has-[[data-card-link]:active]/card:opacity-100` on the panel (touch feedback). |
| Tags | category + Soon + state + qualifier (:130–139) | Unchanged for now. "One tag" is B4. |
| On cream (`surface="cream"`, new optional prop) | – | Root: `bg-card border-control border-foreground rounded-card hover:bg-surface has-[[data-card-link]:focus-visible]:bg-surface has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-3 has-[[data-card-link]:focus-visible]:outline-foreground`. No cream panel span. Link `after:inset-0` (not the negative insets). Media `rounded-b-none rounded-t-[calc(var(--radius-card)-var(--stroke-control))]`. Text block and foot `px-4`, foot `pb-4` (16, provisional: B9). The title underline and price inversion are the same as the default card. Use it in `community/LocalDiscovery.tsx:76`, and widen its `li` from `w-64` to `w-68` so the card stays ≥16rem inside the stroke and its foot stays on one line. |

Who's going: unchanged. Faces show only for demo samples, and live shows a thresholded count (amendment:
real, privacy-permitted data only).

**Accept:** the image is 2:1 at every width. Date and time show on line 1, place and venue on line 2, with no
monospace. Card hover or keyboard focus turns the price black with an orange label, and a touch press shows
the cream panel. On /community the cards are white with a 1.5px black stroke and turn grey (#F2F1EE, Dark
#1f1f1f) on hover or focus. AA holds: muted on surface is 6.03:1, orange on black 6.18:1.

### 1.6 Bootzy capital I: decision only (B1)

From the code: `app/fonts/bootzy/README.md` says the file maps Basic Latin (202 characters), so U+0049
exists. A **missing** glyph would fall back to Instrument Sans (`adjustFontFallback: false`) and look normal.
A hairline therefore means the font's own outline is drawn thin (Version 1.000, 2024, FL800). The repo
can't confirm this without rendering the glyph (a fontTools bounds check on `I` against `H` is a dev step).
Don't swap fonts in this round.

### 1.7 Letter case

Remove CSS upper-casing from event titles only: `FeaturedCarousel.tsx:278` (`uppercase`, now replaced by
`title-banner`) and the `event-title` utility (§1; `EventDetailsView.tsx:384`). Cards, Nearby rows, venues
and addresses already render as entered. Brand lines (hero h1, `display-*` on /community and /map), the
badge and state codes (VIC) stay upper-case. **No data transforms.** "OSAMA SON" versus "Baby Keem" is a data
fix, so it's B5. **Accept:** grep shows no `uppercase` on any element that renders `event.title`,
`venueName`, `suburb` or an address.

### Chat notes (global)

- **Buy tickets hover** (black, orange label): already `.btn-signal:hover`. Add the focus-visible equivalent
  (§1). The card price label follows it (1.5).
- **Nav size:** 16 Medium (§1).

### Nearby rows (`components/SceneEventRow.tsx`)

Keep the date/time line (`meta lg:mono-m`, Instrument Sans) per the amendment, overruling Part 2's
"remove". Add hover equivalents: root `has-[[data-card-link]:focus-visible]:bg-surface`, link
`focus-visible:underline` (hover is already `bg-surface` plus underline, and press is `bg-surface-border`).

## 3. Conflicts with the design system, and how they resolve

- **Mono:** the handoff says "location · venue in mono". The owner's 13 Nov decision and the amendment say
  Instrument Sans. Resolution: Instrument Sans (`mono-*` are sans in name only).
- **Date on cards and Nearby:** the handoff says remove it. The amendment says keep it. Resolution: keep it.
- **Cream:** design-system.md says `--hover` is "never a default fill", but LocalDiscovery already uses it as
  a panel fill. The handoff accepts the cream panel and adds the outlined-card rule. Resolution: allowed on
  that panel only, documented as an exception.
- **Signal Orange "one per view":** each banner slide and every card price label is orange. That's an
  existing exception, which the Round 2 samples confirm.
- **Button sizes:** the Rules page says L is for the hero and sticky bar only. The handoff makes the banner L
  at ≥1440 and M below. The samples win, per the handoff.
- **Display capitals:** the type board says `display-*` is all capitals. 1.7 says titles are in normal case.
  Resolution: capitals stay for brand lines, and event titles in Bootzy go mixed-case (see B2).
- **Margins:** the doc says 64 at 1440. The samples move it to 64 from 1280.
- **Banner opacity:** the owner's annotation asked for "60% opacity". That was about the old black box, and
  the gradient to 80% supersedes it.
- **Place order:** cards use location · venue (handoff). Nearby's `PlaceLines` and `placeLabel` use venue then
  place. That's a small inconsistency, left as is.
- **Stale doc:** update `docs/design-system.md` (EventCard 2:1, two meta lines, price hover, cream variant;
  margins; nav 16; header 56/72; the new utilities) in the same PR.

## 4. Dependencies and out of scope

- Per-event, per-breakpoint focal points would need new data (backend, plus the admin focus picker). B7.
- No new npm dependencies. Swipe already works through native scroll-snap.
- Out of scope: Part 2, the city-list image hover, Community availability (stays as now), sign-in,
  time-zone labels, and any "When" or filter definitions.

## A. Unambiguous: build now (in order; each step keeps the site working)

1. **Tokens** (§1): `--header-h`, `label-nav`/`nav-button` 16, `page-container` 80rem, `event-title` no
   uppercase, `.btn-signal:focus-visible`, and the new utilities `display-hero`, `title-banner` and
   `heading-section-l` (added, not yet used). Update the pinned token tests.
2. **Header heights**: `Nav.tsx` `h-14` / `h-18`. Check the menu drawer, sticky offsets and the seat picker
   (they read `--header-h`).
3. **Type and spacing**: section titles to `heading-section-l`, section gaps `mt-10 md:mt-12 lg:mt-16`
   (home and /community), `text-balance` on Creators, the two order fixes.
4. **Hero**: `display-hero`, lede `body-m`, one row from `lg`, badge 72/80, search wrapper widths.
5. **Category chips**: scroll below 1280.
6. **Grids and rails**: `HOME_GRID` 1 column below 768, rails swipe below 1024.
7. **EventCard**: 2:1, two Instrument Sans meta lines with date/time kept, price hover/focus inversion, focus
   underline, touch active, `surface="cream"` on /community.
8. **Nearby row** focus equivalents.
9. **Banner** rebuild (1.1): ratios, focal defaults (`EventArt` `imgClassName`), gradient, stretched title
   link, Buy tickets sibling M/L, dots plus Pause bottom-right, Prev/Next/Details removed, mixed-case title,
   skeleton ratios.
10. **Search sheet** extended to <1024 (bar only, not Nearby's picker).
11. **Header 64px after scroll** (XL only): an `IntersectionObserver` sentinel sets `data-scrolled` on the
    header, which switches the desktop row from `h-18` to `h-16` (transition `motion-safe:` only). Keep
    `--header-h` at 4.5rem so scroll padding never under-measures.
12. **Docs**: update `docs/design-system.md`.

Run after each step: `npx tsc --noEmit`, `npm run lint`, `npm test`. After steps 2, 6, 9 and 10, also run
`npm run test:e2e` (header-fit, home, responsive). Do visual QA at 1440, 1200, 1024, 768, 390 and 320 in
Light and Dark, and in demo and live.

## B. Unresolved decisions for the owner (each with a recommendation)

1. **Bootzy "I" (1.6).** Options: (a) the brand designer supplies a corrected Bootzy; (b) Instrument Sans
   Bold for any headline containing an "I", which is inconsistent and depends on the string; (c) Instrument
   Sans 700 for all **event titles** (banner and event page), keeping Bootzy for fixed brand lines. That
   matches BD1 §0 ("Bootzy for rare hero moments") and removes the problem from unpredictable data;
   (d) as an interim, a `unicode-range: U+0049` face from Instrument Sans placed ahead of Bootzy in
   `--face-display`. **Recommend (a), with (c) now.** Brand lines that still show the problem ("FIND YOÜR",
   "COMMUNITY") then wait for (a), or get (d).
2. **Mixed-case Bootzy titles** after 1.7: the lowercase glyphs have never been reviewed on the site.
   **Recommend** settling this together with B1(c).
3. **Hero badge below 1024**: the table shows a badge in the headline row at M and S but gives no size.
   **Recommend** keeping it hidden below 1024 (as now) until the samples give a size. If shown, use ≥44px so
   its Pause stays a valid target.
4. **Card "one tag"**: today a card can show category, "🔥 Tonight" (an emoji, which is off-brand), Sold
   out/Ended and a trending qualifier. Sold out/Ended are the card's only sold-out signal, because the price
   label hides itself. **Recommend** one slot: Ended or Sold out when true, otherwise the category. Drop
   SoonTag and the qualifier from cards, since the date line says when.
5. **Title casing in data** ("OSAMA SON"): **recommend** fixing individual records through the admin edit
   form, with the organiser's agreement, since it's their official name. No bulk title-casing.
6. **"When" in search** (Search · Where · When): there's no filter definition and the API doesn't support
   it. **Recommend** deferring it. Ship Search · Where.
7. **Per-breakpoint focal points per event**: needs a schema and admin UI (backend). **Recommend** deferring
   it. One `imageFocus` plus the per-breakpoint defaults in 1.1 cover it.
8. **Gradient legibility**: transparent to 35%, then 80% at the bottom, leaves only about 25–30% black at the
   top of the text block (the category line). White text there can fall below 4.5:1 on a bright photo.
   **Recommend** adding a mid stop (`via-black/60 via-60%`), if visual QA with the brightest demo photo fails.
9. **Outlined-card padding** (16px) and the **banner 4:5 cut-off at 640 or 768** (4:5 at 767px would be
   959px tall): both are provisional until the Round 2 samples are seen. **Recommend** 16px and 640.
10. **Header search icon on the home page** at M and S: the table shows it, but the code hides it on `/`
    because the hero has the search. **Recommend** keeping it hidden on `/`.
11. **Rails at 768–1023** ("swipe row / 2 per row"): built as a swipe with two cards per view. **Recommend**
    confirming this against the samples.
