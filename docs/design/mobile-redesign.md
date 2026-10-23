# Mobile UI/UX redesign: implementation spec

Status: P0 and P1 shipped (e16f18c); P2, the review fixes and the Refinement of 22 Oct 2026 implemented · Owner: ui-design-director · Date: 22 Oct 2026 · Branch `claude/wizardly-darwin-v2c9n2`

**P1 decisions (manager, 22 Oct 2026):** the §10.3 behaviour changes are accepted; "Only in the city" moves to the end of `/events`; the free label stays "Get free tickets"; "WHERE IS ÜR SHELTÜH?" is the footer's campaign line. Three fixes from the P0 screenshots are folded in: phone rail cards are smaller (§2.3, §5), a section's mono eyebrow never repeats its h2 and the h2 is one step smaller (§3.2.1, §6.3.3, now P1), and an ended event's buy bar shows no price (§6.5).

**Owner feedback round (22 Oct 2026, after P2; this document reflects it):** search is the hero's main action, with "Explore all events" a text link under it and a one-line demo label (§6.1); the six category buttons move straight under the hero, above This weekend (§6.3.1, §6.3.6); cards get 18px titles, 14px details at every width, 8px between lines, and a foot (price + ticket action) pinned to the bottom so prices and buttons line up across a row (§3.2, §6.2.1); rails don't scroll vertically and are checked as carousels at 320–430 (§4, §8.2); the Find your people copy now matches who can see what (§6.4.4); the event page's facts get more room (§6.5); the footer is shorter and the install offer is a quiet text line (§6.6). The floating dark circle seen on preview deployments is the Vercel Toolbar, not this app; no fixed element of ours overlaps navigation or ticket actions.

**Owner round, 23 Oct 2026 (wins over everything below it where they differ):**
- **Rails scroll sideways at every width** ("keep using the horizontal scrolling we worked on initially"). The home's event sections (This weekend, From organisers you follow, Popular right now / Coming up) are horizontal rails on desktop as on phones; they no longer become grids from 640px. Reinstated from the original `ui/Carousel` (deleted in 997e48c): full-bleed rails (wall to wall), the first card on a left buffer, now the page column's edge (`max(2rem, (100% − 72rem) / 2 + 2rem)`: 32px to 1152, 96px at 1280); cards run off the right edge so a partly visible card signals more; start-aligned mandatory scroll snap on that line; Previous/Next arrow buttons from 640px (`aria-disabled` at the ends so focus stays, paging by the cards wholly in view, instant under reduced motion), now in the section head beside its link rather than over the cards, and shown only while the rail overflows. Left out on purpose: the auto-drift and its Pause/Play button (moving content needs a pause control, WCAG 2.2.2; it fought touch scrolling; and it scrolled away from the soonest event), opening mid-rail, and the `w-screen` bleed (100vw counts the scrollbar and overflowed the page). Cards keep a fixed width (`rail`: 62vw up to 240px on phones, **256px from 640px**), never stretched; cells stretch to the tallest card so prices and buttons line up. The page itself never scrolls sideways (`e2e/responsive.spec.ts` at 320–1440). Code: `home/HomeRail`, `HomeRailSection`, `RailArrows`, `ui/SectionHead` (`actions`), `ui/EventCard` (`rail` width); `Home.tsx` places the event sections outside the page column.
- **Find your people, to the owner's mockup.** Full-bleed orange band, `py-12 sm:py-16 lg:py-20`, two columns from 1024px (`lg:grid-cols-12`: pitch 7, card 5), stacked before. Pitch: eyebrow "Better together" (`eyebrow tracking-widest`); one h2 on two lines, "See who’s going." / "Find your people." (sentence case, 700, `tracking-tighter`, 36 / 48 / 60px at phone / `sm` / `lg`: not `display-lg`); body on two lines, "Discover the crowd before you book." / "Create a free profile to see who’s going." (signed in: "Open an event to see who’s going."), 18px, 20px from `sm`; one large black action (`btn-solid`, 56px, sentence case, arrow): "Create profile now" → `/signup`, signed in "Find an event" → `/events`. Card: white (`bg-card`), `rounded-2xl` (16px), eyebrow "A look inside", the event's title (24 / 30px), four overlapping **circles** (64px, 80px from `sm`, a 4px white ring, `aria-hidden`), then "{N} people going" (the number 48 / 60px, read as one phrase) and a footnote. The event and count are the existing example rule (a real event on the page with a real thresholded count; the demo's sample count); with none, no card, and the pitch stands alone. Footnote: demo "Example event · Sample attendees"; live "Popular right now · Real count" (live examples only come from the trending list's going counts). Circles: demo, the sample attendees' initials in brand fills (black, orange, cream, black), or photos once `COMMUNITY_SAMPLE_FACES` (`home/home-content.ts`) lists licensed ones; live, plain person shapes, never a member's name, initials or face. The card's muted lines are `text-foreground/60` (#666 on white, 5.74:1), since `--muted` is black inside the band. `COMMUNITY_BENEFIT` is retired. **Exception:** these circles are the one place avatars are round (owner request); everywhere else avatars stay rounded squares (`rounded-dot`, §3.4).

**Refinement, 22 Oct 2026 (owner brief; this section wins over everything below it where they differ).** The site read as templated: heavy uppercase heads everywhere, bordered boxes, too much scrolling before the events. One pass through the shared tokens and components, not per-page overrides. Superseded rules below are marked *[Superseded: Refinement]*.

| Area | Now | Where |
| --- | --- | --- |
| Type | Heavy uppercase (`display-lg`) is a page's main headline only (the home's h1, page headers). Base `h1`–`h4` are sentence case (700, -0.015em, 1.2). `display-md` (section heads) is sentence case 20/24, 22/28 `sm`, 24/30 `lg`. New `title-lg` for the event title: sentence case 28/32, 36/40, 44/48, calmer than the hero. `eyebrow` tracking 0.04 → 0.02em; `meta` is no longer uppercase or tracked. Card and event-page dates are Instrument `text-sm`/`text-base`, not mono. | `app/globals.css` |
| Brand dots | At most one signature use per page: the home hero's eyebrow; the event page's Who's going title (it joins when you're going); `PageHeader`'s strap elsewhere. Gone from `SectionHead`, the event category line, the going summary link and cards. | `ui/SectionHead`, `EventDetailsView`, `WhosGoingSummaryLink` |
| Section head | No rule, no dots: a calm h2, optional note (`text-sm text-muted`), link on the baseline. | `ui/SectionHead` |
| Home | Hero: eyebrow, h1, one short line (`HOME_INTRO`), search. "Explore all events" and the hero's demo label are gone. The search's field has one magnifier (its submit button), and the header leaves its search icon out on `/` (as the desktop field already was), so the home has one search. The six category boxes become one chip row (`nav` "Browse by category", `filterChipClass`, 44px, "All events" first, then the six filters), scrolling inside its own container below 640px and wrapping from 640px. Sections `mt-6 sm:mt-10 lg:mt-12`. At 390×844 the first card's image and title are on the first screen (e2e). | `home/HomeHero`, `home/CategoryRow`, `SearchBar`, `Nav`, `home/Home`, `home/HomeEventSections` |
| Cards | Order: image (rail 4:3 on phones, square from `sm`; grid square) → title → date · time (`text-sm` medium) → venue · suburb → one small secondary line (`text-xs text-muted`: category, trending qualifier, "Reserved seating", count) → foot: all-inclusive price ("incl. booking fee") → action. Attendance is a count only, never faces (list payloads have no photos); a demo count reads "N going (sample)"; nothing below 3 (`GOING_COUNT_MIN`, shared with Who's Going). `data-card-state` = paid / free / sold-out / external / seated / ended / coming-soon; ended greys the image. `GoingStack` is deleted. | `ui/EventCard`, `lib/event-card.ts` (`cardGoing`, `cardState`) |
| Community band | *[Superseded: owner round, 23 Oct 2026, above]* "See who’s going before you book" as a section head, one benefit line (`COMMUNITY_BENEFIT`: the count from three people for everyone, names with a free profile), a compact example drawn from the page (a live trending count, or the demo sample's count labelled "(sample)"; nothing when there's none) and one action ("Sign up free" / "Find an event"). The steps moved to the event page. | `home/CommunitySection` |
| Who's going panel | "How Who’s Going works" (`details`/`summary`, 44px, page focus ring) at the panel's foot: the count from three; names and faces with a free profile and a verified email, no ticket needed; add yourself after a ticket; say hi once on the list. | `whos-going/HowItWorks`, `WhosGoing` |
| Event page | Photo → category → title (`title-lg`) → one facts block (When with time zone + Add to calendar on one row; Where with Get directions; Organised by + More from) → going count link (below `lg`) → one secondary row, Save + Share (`secondaryActionClass`: soft fill, no border, 44px). Then Tickets, then Who's going (the right-hand sticky column from `lg`), then About this event and Good to know. The old aside When/Where/Organiser list and the phone facts under the title are merged into that one block. **One Save**: in the action row, at every width, ended or not; the buy bar has none (`SaveButton` `pill` and `onDark` replaced by `action`). Buy bar: compact (`min-h-16`, `--buybar-h: 4rem`), price + one action, safe-area bottom padding, settles under the content at the page end, and focus scrolls clear of it (`scroll-padding-bottom`; e2e tabs through the page at 390). Phone photo max 32svh. | `EventDetailsView`, `favourites/SaveButton`, `ShareButton`, `ui/Button` |
| Footer | Restrained wordmark (`h-7 sm:h-8`), the campaign line small (`text-base` semibold, not `display-lg`), one note, the quiet install line. Fan support always open (a wrapping row on phones); Explore and Our company are disclosures below 640px (`FooterGroup`: button + `aria-expanded` + `aria-controls`, closed at first), columns from 640px. Legal links and © always visible. | `Footer`, `FooterGroup` |
| Demo | One sample-data disclosure per page: `DemoBanner`, a slim strip at the top of `main` (root layout, demo only): "Demo · Sample events, people and counts. No real bookings." `DemoNotice` is a quiet one-line note with a small "Demo" tag, kept only where something won't happen (checkout, waitlist, adding yourself, follow, messages, accounts). Removed: the hero's label, the event page's "fictional sample data" note, the /events and /map "Sample listings" notes, the footer's demo note. Demo counts and names stay labelled. | `DemoBanner`, `DemoNotice`, `app/layout.tsx`, `EventFeed`, `SceneMap`, `Footer` |

Measured in the demo at 390 (CSS px, page height): home 3663 → 2554, event 3613 → 3209; at 1280: home 4059 → 2994. Tests: `tests/EventCard.test.tsx` (order, states, count fallback and threshold), `tests/HomeStatic.test.tsx` (hero, single search icon, category row links, community), `tests/Nav.test.tsx` (no header search on `/`), `tests/SavePlacements.test.tsx` (one Save), `tests/brand-components.test.tsx` (footer disclosures, keyboard), `tests/DemoBanner.test.tsx`, `tests/WhosGoing.test.tsx` (How it works), `tests/brand-tokens.test.ts` (type rules); e2e `home.spec.ts`, `responsive.spec.ts` (first card at 390×844, chip row, footer by keyboard, buy bar vs focus), `event-page.spec.ts`, `demo.spec.ts` (one banner).

**P2 and review fixes (manager list, 22 Oct 2026):** accessibility findings A1–A11 and visual-QA findings V1–V16 are folded into the sections below; where an item left the choice open, the choice is recorded where it lands. In short: an external card says "Get tickets"; an ended event page has no buy bar at all; the demo closes Who's Going once an event has ended, as live does; refunds show only where a paid purchase is possible; the age restriction shows once; one section head, one back link and one demo label site-wide; the footer is compact with support first. The `row` card variant for the map list is **deferred** (§9).

Source of intent: the owner's brief of 22 Oct 2026 (mobile redesign and optimisation). **The brief wins over `home.md`, `mobile-home.md`, `mobile.md` and `brand-direction-one.md` where they conflict**: hero copy, home order, Up next, card anatomy and the section heads change here. Everything else in `brand-direction-one.md` (colour tokens, the orange budget, radii, no shadows, the fonts) still applies. Once this ships, add a line to the top of `home.md` and `mobile-home.md`: "Superseded for the hero, section order and cards by `mobile-redesign.md`."

**Code read:** `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/events/page.tsx`, `app/refunds/page.tsx`, `app/purchase-terms/page.tsx`, `components/home/*` (Home, HomeHero, UpNext, FeaturedEventCard, HomeEventCard, HomeEventSections, HomeEventsProvider, HomeRail, RailItem, SectionHead, CategoryRow, CardPrice, GoingStack, going.ts, GuideCard, CreatorsCard, CommunitySection, home-content.ts), `components/ui/{EventTile,Carousel,InitialsAvatar}.tsx`, `EventResults`, `SceneEventRow`, `map/SceneMapEventCard`, `organisers/OrganiserProfileView`, `EventDetailsView`, `WhosGoing`, `whos-going/{WhosGoingProvider,WhosGoingSummaryLink,NameList}`, `TicketSelector`, `waitlist/WaitlistBlock`, `QuickBuyLink`, `EventArt`, `favourites/SaveButton`, `Footer`, `Nav`, `pwa/InstallPrompt`, `RevealObserver`, `lib/{types,pricing,quick-buy,home-sections,home-events,sample-going,sample-organisers}.ts`, `lib/api/types.ts` (Going*, Profile*, Waitlist*), `lib/server/handlers/trending.ts`, `e2e/home.spec.ts`, the test file names under `tests/`, and the six before screenshots (home, event, sold-out event at 375 and 1280).

---

## 1. Principles

1. **Improve, don't rebuild.** Same routes, APIs, auth, Stripe, external ticketing, demo mode, brand tokens and fonts. Every change below is presentational unless it's flagged as a behaviour change (§10.3).
2. **One message per screen on a phone.** The hero says one thing (find your new thing) and offers one main action: the search (since the owner's 22 Oct feedback; it was an orange "Explore events" button). Everything else is a field (search), a list, or the next section.
3. **One card, the brief's order.** Image, category, date and time, title, venue, price with fees, going, then the action. The same component, spacing and button position everywhere. Only the width changes between variants.
4. **Real or absent.** Prices are all-inclusive. Going counts, avatars, waitlists and "N left" come only from data that exists. Demo samples stay labelled. Nothing invents urgency.
5. **Content is never hidden by default.** Nothing on the home waits for a scroll to become visible: that is the cause of the empty cream band (§8.1). Motion is only for feedback (press, hover) and the one photo push-in.
6. **Fix causes, not symptoms.** No global `overflow-x: hidden`, and no fixed pixel offsets for bars. Layout uses the existing tokens (`--header-h`, `--buybar-h`, `env(safe-area-inset-*)`).

---

## 2. Inventory: what's there now, and the consolidation

### 2.1 Home architecture today

`app/page.tsx` → `components/home/Home.tsx`:
- `HomeEventsProvider` loads the events, trending and following lists once, client-side. `selectHomeSections` (lib/home-sections.ts) de-duplicates them.
- `HomeHero` (server): eyebrow, h1 "WHERE IS ÜR SHELTÜH?", a photo cell beside the h1 below `lg`, intro, two CTAs ("Explore events" in orange, "Find your people" outline), `SearchBar`, `CategoryRow` (six icon discs, a sideways rail on phones), `DemoNotice`, then the `upNext` slot (`UpNext` → `FeaturedEventCard` plus a second orange `QuickBuyLink`).
- `HomeEventSections`: This weekend (`wide` cards), From organisers you follow (`standard`), Trending (`standard` + signal chip), Coming up near you (`standard`), the `guide` slot (`GuideCard`, "Only in the city"), Free & low-cost (`compact`).
- Then `CommunitySection` (an orange full-bleed band, "Find your people") and `CreatorsCard` (an ink card, "Bring your event to life").
- `RevealObserver` (in `app/layout.tsx`) hides every `[data-reveal]` / `[data-reveal-stagger] > *` with `opacity: 0` until an IntersectionObserver sees it.

### 2.2 Card-like components and their duplication

| Component | Used by | Media | Overlays on the image | Text | Action |
| --- | --- | --- | --- | --- | --- |
| `ui/EventTile` | `EventResults` (/events, /search, /saved), `OrganiserProfileView` (upcoming), `MemberProfileView` | 4:5 `rounded-card` | Category chip bottom-left; Save top-right | date, title, place, `CardPrice` | `QuickBuyLink narrow`; "By {organiser}" link |
| `home/HomeEventCard` `standard` | Following, Trending, Coming up | 4:3 | Category or trending chip top-left; Save | date, title, place, price, demo `GoingStack` | `QuickBuyLink` |
| `home/HomeEventCard` `wide` | This weekend | 3:2 | Date badge top-left, category chip bottom-left, Save | date, title, place, **description**, price, going | `QuickBuyLink` |
| `home/HomeEventCard` `compact` | Free & low-cost | 96/112px square thumb | none (badge in the text) | badge, date, title, place, price | `QuickBuyLink fullWidthOnPhones`, indented |
| `home/FeaturedEventCard` | Up next | 4:1 / 2:1 / 16:9 | "Up next" chip, Save; ink text block, arrow tile | title, date range, place, price, live summary count | `QuickBuyLink` outside the card |
| `SceneEventRow` | /map list | 80/96px thumb | none | selected, date, title link, place, category, price | Locate button, `QuickBuyLink narrow` |
| `map/SceneMapEventCard` | /map selection (overlay/sheet) | 3:2 or 80px thumb | none | category, date, title, place, price, location note | `QuickBuyLink fill`, "View event", dismiss |
| `ui/Carousel` | **nothing** (only `tests/Carousel.test.tsx`) | — | — | — | — |

Code repeated across them:
- The category label lookup (`EVENT_CATEGORIES.find…`), 5 copies: EventTile, HomeEventCard, SceneEventRow, SceneMapEventCard, EventDetailsView.
- The date line (`formatEventDateShort` · `formatEventTime` in `whitespace-nowrap` spans), 4 copies.
- The `[venueName, suburb].join(" · ")` place line, 3 copies, and one unfiltered copy in SceneEventRow.
- The title classes, the media hover classes and the three placeholders (`EventTilePlaceholder`, `HomeEventCardPlaceholder`, `FeaturedEventCardPlaceholder`).
- Five media ratios (4:5, 4:3, 3:2, square thumb, featured strip) and three chip positions.
- `CardPrice` and `GoingStack` live in `components/home/` but are imported by `components/ui/EventTile` and `components/map/*`, so the layering is upside down.

### 2.3 Consolidation plan: one card system

**New `components/ui/EventCard.tsx`**, with variants:

| Variant | Replaces | Width | Used by |
| --- | --- | --- | --- |
| `rail` | `HomeEventCard` standard, wide and compact | *[Superseded from 640px: owner round, 23 Oct 2026: a fixed 256px (`sm:w-64`), rails at every width]* Phones (<640): `w-[min(62vw,15rem)]`, so 198 / 232 / 240px at 320 / 375 / 430 (62% of a 375 screen, so the next card peeks), with a **square** image. From `sm`: fills its grid cell (`sm:w-full`) with a 4:5 image | Every home event section |
| `grid` | `EventTile` | Fills its cell (`w-full`) | `EventResults`, `OrganiserProfileView`, `MemberProfileView` |
| `row` (P2, **deferred**: §9) | `SceneEventRow` | Fills the list | /map list, with a `trailing` slot for the Locate button and a `selected` prop |

**Removed with no replacement:** `FeaturedEventCard` and `UpNext` (Up next leaves the hero, §6.1), the `wide` date badge and description, the compact thumb layout, `ui/Carousel.tsx` (unused) and its test.

**New `lib/event-card.ts`** (pure, unit-tested). Every card-like component imports these; none keeps its own copy:
- `categoryLabel(event): string`
- `placeLabel(event): string` (filtered join with " · ")
- `cardDateLabel(event, now): { date: string; time: string } | { running: string }`. An event already under way that ends after `now` returns `running: "Now on · until Sun 1 Nov"`; anything else returns the start's date and time.
- `cardCta(event, now): CardCta | null` (§6.2.3)
- `cardGoing(event, mode, signal?): { count: number; initials?: string[] } | null` (§6.2.5)
- `signalLabel(signal, external): string | null` (moves `trendingChipText` here; the "going" kind returns null because it shows in the going row instead)

**Moves (`git mv`, imports updated):** `components/home/CardPrice.tsx` → `components/ui/CardPrice.tsx`, and `components/home/GoingStack.tsx` → `components/ui/GoingStack.tsx`.

**`SceneMapEventCard`** stays its own component (it's a selection panel with a dismiss button), but it switches to the `lib/event-card.ts` helpers and `CardPrice`.

---

## 3. Tokens

### 3.1 Colour (unchanged values; the pairs this spec uses)

| Pair | Ratio | Use here |
| --- | --- | --- |
| Black `#000` on Cream `#fffae7` | 20.08:1 | Page text, card titles, outline buttons, the "Join waitlist" outline CTA |
| `--muted` `#6b675e` on Cream | 5.39:1 | Category line, venue, price note, going text, section note |
| `--muted` on White `#fff` | 5.63:1 | Category tiles' secondary text (none planned), field hints |
| Black on Signal `#ff4800` | 6.18:1 | Hero CTA, card "Buy tickets", buy bar CTA, the Find your people band |
| Cream on Black | 20.08:1 | Footer, the buy bar, the For organisers card, the event-page poster letterbox |
| Ink-scope `--muted` `#a39e93` on Black | 7.87:1 | Footer secondary text and legal links |
| Signal on Cream | 3.25:1 | **Non-text only** (DotsMark). Never text, never a 1px rule. |

No new colour tokens. No gradients: the featured-card scrim goes with `FeaturedEventCard`.

### 3.2 Type scale (roles → existing utilities) *[Superseded in part: Refinement — section h2, card category/date/title order, event title, footer campaign line, `meta`]*

Sizes are base (320–639) / `sm` 640 / `lg` 1024; leading is in px.

| Role | Utility / classes | Base | sm | lg | Tracking | Case | Wt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hero h1 | `display-lg font-display` (existing pair) | clamp 32–40 (32 @320/375, 36.5 @430) / lh 0.9 | 40 @640, 42 @768 | 56 @1024, 64 @1280, 72 max | display token (-0.045em) | upper | display token (700) |
| Hero eyebrow | `eyebrow` | 12/16 | | | 0.04em | upper | 500 |
| Hero intro | `text-base leading-6 sm:text-lg sm:leading-7` | 16/24 | 18/28 | | 0 | sentence | 400 |
| Section h2 | `display-md` (**resized in P1**, §3.2.1) | 24/26 → **20/22** | 28/30 → **24/26** | 32/34 → **28/30** | -0.03em | upper | 700 |
| Section note (weekend range) | `meta text-muted` | 12/16 | | | 0.02em | upper | 400 |
| See all | `text-sm leading-5 font-semibold underline` | 14/20 | | | 0 | sentence | 600 |
| Card category | `eyebrow text-muted` | 12/16 | | | 0.04em | upper | 500 |
| Card date | `meta text-foreground` | 12/16 | | | 0.02em | upper | 400 |
| Card title, `rail` | `font-sans normal-case text-lg leading-6 tracking-[-0.01em] font-semibold` (owner, 22 Oct: was 16/22) | 18/24 | | | -0.01em | sentence | 600 |
| Card title, `grid` | `… text-base leading-6 sm:text-lg` (16 on the two-column phone grid: at 18px a 134px card fits ≈11 characters a line) | 16/24 | 18/24 | | -0.01em | sentence | 600 |
| Card venue, price, going | `text-sm leading-5` on both variants at every width (owner, 22 Oct: the phone grid was 12/16) | 14/20 | 14/20 | | 0 | sentence | 400 (price amount 600) |
| Card CTA | `.btn` md (`grid` on phones: 12/16, `px-2`) | 13/16 | 13/16 | | 0.02em | upper | 600 |
| Event title (event page) | `display-lg` | 32–40 | 40–56 | 56–72 | -0.035em | upper | 700 |
| Panel title (Who's going, Tickets) | `font-heading text-xl leading-6` (Panel) | 20/24 | | | -0.025em | upper | 700 |
| Going count (event page preview) | `font-heading text-2xl leading-none tabular-nums` (was `text-4xl`) | 24/24 | | | -0.025em | — | 700 |
| Footer campaign line | `display-lg leading-[1.05]` (Instrument, **not** `font-display`; leading opened from 0.95 so line 2's Ü dots clear line 1: V1) | 32–40 | 40–56 | 56–72 | -0.035em | upper | 700 |
| Footer link | `text-[0.9375rem] leading-6` (existing) | 15/24 | | | 0 | sentence | 400 |
| Footer legal link | `text-sm leading-5 underline` (was `eyebrow`) | 14/20 | | | 0 | sentence | 400 |
| Back link (`ui/BackLink`, site-wide) | `text-sm leading-5 font-semibold underline`, decorative "←" | 14/20 | | | 0 | sentence | 600 |
| Section h2 (`ui/SectionHead`) | `display-md`, title `text-balance`; dots in an `h-lh` box so they centre on line 1 (V7) | 20/22 | 24/26 | 28/30 | -0.03em | upper | 700 |

#### 3.2.1 `display-md` change (done in P1, `app/globals.css`) *[Superseded: Refinement — sentence case, 20/24 → 24/30]*

```css
@utility display-md {
  font-family: var(--face-sans);
  font-weight: 700;
  font-size: 1.25rem;          /* 20px */
  line-height: 1.375rem;       /* 22px */
  letter-spacing: -0.03em;
  text-transform: uppercase;
  @media (width >= 40rem) { font-size: 1.5rem;  line-height: 1.625rem; }  /* 24/26 */
  @media (width >= 64rem) { font-size: 1.75rem; line-height: 1.875rem; } /* 28/30 */
}
```

This applies site-wide (section h2s, empty-state titles), which is what the brief asks for: one consistent, smaller heading step. It moved from P2 to P1 because the P0 screenshots showed the section heads too loud on phones. `display-xl` had no user once the hero switched: **deleted in P2** (`tests/brand-tokens.test.ts` now checks it stays gone).

**Mono selectively (P2, done):** Plex Mono stays on categories, dates and times, field and row labels (`dt`, "Order summary"), section notes, footer group headings and the © line. It came off:
- every back link: `components/ui/BackLink.tsx` is the one back link (Instrument `text-sm leading-5 font-semibold underline`, 44px tall, "←" decorative). The event page uses it with its existing words, "Back to all events" (to `/`, unchanged, as tests pin it); dashboards, admin and the door console share its `backLinkClass`;
- the footer legal links (`text-sm`, sentence case, underlined);
- every section strap: the home's (P1) and `ui/Section`'s `SectionHeader` strap (P2: `SectionHeader` is deleted; profiles and Saved use `SectionHead`, §6.3.3).

### 3.3 Spacing (Tailwind steps only: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64)

| Use | Base | sm | lg |
| --- | --- | --- | --- |
| Page gutter | 20 `px-5` | 32 `sm:px-8` | 32 |
| Home top (to the eyebrow) | 20 `pt-5` | 32 `sm:pt-8` | 40 `lg:pt-10` |
| Between home sections (also hero → first section) | 32 `mt-8` | 48 `sm:mt-12` | 64 `lg:mt-16` |
| Section rule → h2 | 12 `pt-3` | | |
| Section head → content | 12 `mb-3` | 20 `sm:mb-5` | |
| Rail gap / grid gap | 12 `gap-3` | rails `sm:gap-6` (owner, 23 Oct: rails at every width); results grids `sm:gap-x-6 sm:gap-y-8` | |
| Card media → text | 12 `pt-3` | | |
| Card text lines | 8 `gap-2` (owner, 22 Oct: was 4) | | |
| Card text → foot (price) | ≥ 12 `pt-3`, then `mt-auto` (the foot sits at the card's bottom) | | |
| Price → CTA | 12 `pt-3` | | |
| Card container padding | **0** (image-first, no container, everywhere) | | |
| Footer top / wordmark top | `pt-8` / `mt-8` (owner, 22 Oct: were 40/40) | `sm:pt-12` / `sm:mt-12` | |
| Event page side column (aside) | 24 `gap-6` at every width (was `sm:gap-8`; V13) | | |

### 3.4 Radii, borders, elevation

Unchanged. `rounded-card` (12px) for card media, the For organisers card and the event photo from `sm`. `rounded-control` (8px) for buttons, search, category tiles and the map row thumb. `rounded-badge` (4px) for badges. `rounded-dot` for avatars (the one exception: the four round circles in Find your people's "A look inside" card, an owner request of 23 Oct 2026). Section rule: `border-t border-foreground` (1px black). No shadows.

### 3.5 Motion tokens

Unchanged values. `.ken-burns` (one 4.5s cycle) stays on the desktop hero photo only. Card press is `scale(0.98)` over 150ms and image hover `scale(1.03)` over 300ms, both motion-safe. The `.rise` hero entrance and the home's `data-reveal` are removed (§7).

---

## 4. Grid and layout

- **Container:** `mx-auto max-w-6xl px-5 sm:px-8`. Content width is 280 / 335 / 350 (390) / 390 / 704 / 960 / 1088 at 320 / 375 / 390 / 430 / 768 / 1024 / ≥1152.
- **Breakpoints:** Tailwind defaults (`sm` 640, `md` 768, `lg` 1024). Mobile-first from 320.
- **Home rails (<640; from 640px too since the owner round of 23 Oct 2026, at the page column's inset):** horizontal, bleeding to the screen edges with `-mx-5 ps-5 scroll-px-5`, `snap-x snap-mandatory` with `snap-start` items (a swipe settles with a card's left edge on the 20px gutter, level with the section head), `gap-3`, and `py-4 -my-4` so focus rings aren't clipped. **`overflow-y-hidden`** (owner, 22 Oct): `overflow-x: auto` makes the rail a vertical scroller too, and a pixel of overhang let a diagonal swipe nudge it up and down. Cells stretch, so every card in a rail is the same height. Keyboard focus brings the whole card into view (`RailItem`, instant under reduced motion). The end padding is fixed per §8 item 4. `e2e/responsive.spec.ts` checks snap type and alignment, the gutter, the peek, equal heights, no vertical slack and no page overflow at 320, 375, 390 and 430.
- **Home grids (≥640):** *[Superseded: owner round, 23 Oct 2026. The rails stay horizontal at every width, with 256px cards from the page column's edge, a 24px gap and Previous/Next buttons in the section head; see the note at the top.]* The same `ul` becomes `sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4` (4 from 1024 since V10: 3 columns made desktop cards oversized), capped at 6 cards. A short last row stays short and left-aligned, at card size: cards never stretch to fill the row, so 2 cards read as 2 cards, not as empty columns. The loading skeleton shows a fourth placeholder from `lg`.
- **Results grid** (`RESULTS_GRID`, unchanged): `grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8`. Grid card widths are 134 / 161 / 189 at 320 / 375 / 430, 176 at 640, 216 at 1024 and 248 at 1280.
- **Category tiles:** `grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3`. Tiles are 88 / 106 / 125px wide at 320 / 375 / 430. Kept as tiles by the owner (22 Oct: "clear on mobile"), not chips.
- **Hero:** one column below `lg`. From `lg`: `lg:grid lg:grid-cols-12 lg:gap-x-8 lg:items-start`, with the text in `lg:col-span-7` and the photo in `lg:col-span-5 lg:col-start-8` (381px wide @1024, 435px @1280).
- **Event page:** unchanged grid (`lg:grid-cols-12`, main 7, aside 5).
- **Footer:** §6.6.

---

## 5. Imagery

| Context | Ratio | Crop | Text on image | Fallback |
| --- | --- | --- | --- | --- |
| Card media, `grid`; `rail` from `sm` | **4:5** (portrait suits organiser posters and candid photos) | `object-cover`, centre | **None.** Only the Save heart (opaque disc). The category and date move below the image. | `EventArt` generated poster, same box, no shift |
| Card media, `rail` on phones (<640) | **1:1** (`aspect-square sm:aspect-[4/5]`). At 4:5 and ≈75% of the screen width a P0 rail card ran past 1,000 CSS px; at 232px wide and square it's ≈ 430px, image to CTA, so one card fits a 667px screen with the next one peeking | `fit="auto"`: a portrait poster is shown whole on ink, anything else covers | None | `EventArt` |
| Map row thumb (P2) | 1:1, 80px (`sm` 96px) | cover | none | `EventArt` |
| Home hero photo (`lg` only) | 4:3 (381×286 @1024, 435×326 @1280) | cover | none | `HOME_HERO.poster` |
| Home hero photo (<lg) | **Dropped.** It squeezed the h1 into `whitespace-nowrap` lines beside a 88–155px cell. | — | — | — |
| For organisers card | phones 2:1 (`aspect-[2/1]`, was 16:9); `sm` half of the split, `sm:min-h-64` | cover | none | `HOME_CREATORS.poster` |
| Event page photo | phones: full-bleed 4:3, `max-h-[36svh]` (unchanged); `sm` 3:2 `rounded-card` | **`fit="auto"`** (below) | none | `EventArt` |

**Preserving organiser artwork: `EventArt` gains `fit?: "cover" | "auto"` (default `"cover"`).**
- With `"auto"`, the image's `onLoad` reads `naturalWidth` and `naturalHeight`. If `naturalHeight / naturalWidth ≥ 1.2` (a portrait poster) and the box is landscape or square, the `img` switches to `object-contain` on an ink background: the wrapper's `style.backgroundColor` becomes `var(--ink)` instead of `poster.background`. Otherwise it stays `object-cover`.
- The box size never changes, so there's no layout shift.
- The event page and the phone `rail` card (square box) use `"auto"`. On 4:5 `grid` cards an A-series poster (1:1.414) loses about 6% top and bottom, which is acceptable.
- This is a client-side heuristic. The robust fix is the backend dependency D3 (§10.1).

**Photography:** candid Melbourne nights, no stock, no filters (`brand-direction-one.md` §8.1). `HOME_HERO` (`/events/vintage-market-stall.jpg`) is a placeholder until the owner supplies a brand photo with rights (still an open asset).

---

## 6. Components

### 6.1 Hero (`components/home/HomeHero.tsx`, server; `Home.tsx`) *[Superseded in part: Refinement — intro copy, no "Explore all events" link, no demo label]*

**Copy (from the brief, exact):**
- Eyebrow: "Melbourne • What’s on" (rendered uppercase by `eyebrow`; U+2022 bullet), preceded by `DotsMark size="xs" className="text-signal"`.
- h1: "Find your new thing." Written as `<span className="block">Find your</span>{" "}<span className="block">new thing.</span>`. The literal space keeps the accessible name "Find your new thing.". Two lines at every width, and each line may wrap at 200% zoom: **no `whitespace-nowrap`**.
- Intro: "Discover Melbourne’s music, art, workshops and pop-ups. See who’s going before you book."
- **Main action: the search** ("Search events", `SearchBar size="lg"`). Owner, 22 Oct: the full-width orange "Explore events" button, the search and the demo label took half a phone's first screen.
- Then **"Explore all events"** + `ArrowRightIcon` → `/events`, an underlined 14px text link (44px tall) under the search. No orange button in the hero any more.

**Removed from the hero:**
- The second CTA ("Find your people"), so there is one dominant action. The band keeps `id="find-your-people"`.
- The photo cell below `lg`.
- `CategoryRow` (it becomes the "Explore by category" section, §6.3).
- The `upNext` slot (`UpNext`/`FeaturedEventCard` are deleted, along with their second orange CTA).
- All `.rise` classes.

**"WHERE IS ÜR SHELTÜH?" moves to the footer** as the campaign line directly above the oversized wordmark (§6.6). The question and its answer, the wordmark, then sit together on every page. It stays a brand line, not a heading, and keeps `BrandU spoken="Where is your Sheltüh?"`.

**Anatomy and classes:**
```
section[aria-labelledby=home-title].lg:grid.lg:grid-cols-12.lg:items-start.lg:gap-x-8
├─ div.lg:col-span-7
│  ├─ p.eyebrow.flex.items-center.gap-2.text-muted          DotsMark + "Melbourne • What’s on"
│  ├─ h1#home-title.mt-2.display-lg.font-display.sm:mt-4    "Find your / new thing."
│  ├─ p.mt-2.max-w-[40ch].text-base.leading-6.sm:mt-4.sm:text-lg.sm:leading-7.lg:max-w-[44ch]
│  ├─ div.mt-4.sm:mt-6.sm:max-w-xl   SearchBar size=lg submit label="Search events" placeholder="Search events"
│  └─ div.mt-1.flex.flex-wrap.items-center.gap-x-6
│     ├─ Link.inline-flex.min-h-11.items-center.gap-1.text-sm.leading-5.font-semibold.underline  "Explore all events" + ArrowRightIcon
│     └─ (demo) DemoNotice compact "Not real bookings."   (one line: slimmer badge, 12px note)
└─ div.hidden.lg:col-span-5.lg:col-start-8.lg:block
   └─ EventArt HOME_HERO, priority="when-shown", motion, className="aspect-[4/3] w-full rounded-card"
```
`Home.tsx` wrapper top padding: `pt-4 sm:pt-8 lg:pt-10` (owner, 22 Oct: was `pt-5`).

**Per width:**

| Width | Layout | h1 | Intro | CTA + search | Image | Approx. hero height (header excluded) |
| --- | --- | --- | --- | --- | --- | --- |
| 320 | 1 col, 280 wide | 32/28.8, 2 lines | 16/24, 4 lines | stacked, both full width, 48 tall, 12 apart | none | ≈ 378 (demo note incl.) |
| 375 | 1 col, 335 | 32, 2 lines | 3 lines | stacked | none | ≈ 354 |
| 430 | 1 col, 390 | 36.5, 2 lines | 3 lines | stacked | none | ≈ 362 |
| 768 | 1 col, 704 | 42, 2 lines | 18/28, 2 lines | one row: CTA (auto width, ≈200) + search (`flex-1`, max 416) | none | ≈ 300 |
| 1024 | 7 + 5 cols | 56 | 18/28, 2 lines in 44ch | one row | 381×286 | ≈ 330 |
| 1280 | 7 + 5 cols | 64 | 2 lines | one row | 435×326 | ≈ 340 |

**Acceptance:**
- At 390×844, the category buttons, the "This weekend" h2 (or the first section's h2) and the top of its first card are above the fold (`e2e/responsive.spec.ts`, `e2e/home.spec.ts`).
- At 1280×800 and 1440×900, the first section's first card starts above the fold.
- There is no horizontal overflow at 320.
- The h1 is never more than 2 lines at 100% text size.
- The 5-second test: eyebrow, h1 and one sentence are the only things above the search on a phone; nothing orange but the dots.

**States:** the hero is static. The CTA and search use their existing hover, focus-visible, active and disabled states. Search submit keeps `SearchBar`'s behaviour.

### 6.2 `EventCard` (`components/ui/EventCard.tsx`)

#### 6.2.1 Anatomy (both variants) *[Superseded: Refinement — order and media ratios]*

```
div.group/card.relative.flex.min-w-0.flex-col[data-event-card][data-variant]   (rail: w-[min(62vw,15rem)] shrink-0 sm:w-full)
│   focus ring for the whole card: has-[[data-card-link]:focus-visible]:outline-2
│     has-[[data-card-link]:focus-visible]:outline-offset-4 has-[[data-card-link]:focus-visible]:outline-foreground
│     has-[[data-card-link]:focus-visible]:rounded-card
│   press: motion-safe:transition-transform motion-safe:duration-150
│     motion-safe:has-[[data-card-link]:active]:scale-[0.98]
├─ 1 div.relative.overflow-hidden.rounded-card                              media (aria-hidden art)
│     EventArt w-full, aspect per variant (rail: aspect-square sm:aspect-[4/5], fit=auto; grid: aspect-[4/5]),
│     motion-safe:transition-transform duration-300 ease-out
│     motion-safe:group-hover/card:scale-[1.03]
├─ div.flex.min-w-0.flex-col.gap-2.pt-3                                     (8px between lines; owner, 22 Oct)
│  ├─ 2 p.eyebrow.text-muted.truncate          "Theatre" [+ " · Just announced" | " · Popular"]
│  ├─ 3 p#date.meta                            <nowrap>Sat 24 Oct</nowrap> <nowrap>· 7:30 pm</nowrap>  | "Now on · until Sun 1 Nov"
│  │     (the separator sits in the time's span, so a wrapped line never ends on "·": V8)
│  ├─ 4 h3.line-clamp-2.break-words.(title classes §3.2)
│  │     a#title[data-card-link][href=/events/{slug}][aria-labelledby="title date place price going"]
│  │       .after:absolute.after:inset-0.after:z-0.after:content-['']
│  │       .focus-visible:outline-none.underline-offset-4.group-hover/card:underline
│  ├─ 5 p#place.line-clamp-2.break-words.text-muted   "The Depot Theatre · Coburg"  (omitted when empty; two lines so the suburb isn't cut off at 320: A2)
│  └─ 6 div#going  GoingStack sm               §6.2.5 (omitted when null)
├─   SaveButton variant=overlay, className="absolute right-1 top-1 z-10"     (after the text in the DOM, on the media visually)
└─ div[data-card-foot].mt-auto.flex.flex-col.pt-3                           the foot, pinned to the card's bottom (not z-10: a tap on the price opens the event)
   ├─ 7 CardPrice#price                        §6.2.4 (grid: min-h-10 below 640, two lines' room)
   ├─ 8 CTA row: div.relative.z-10.flex.pt-3   QuickBuyLink (§6.2.3)
   │      no ticket action (cardCta null): div[data-cta-placeholder][aria-hidden].pt-3 > div.min-h-11.sm:min-h-10 (the button's room)
   └─   grid only, showOrganiser: Link.relative.z-10.inline-flex.min-h-11 "By {organiser}";
          no profile: the same row as plain text (p.min-h-11 "By {organiser}")
```

**Prices and buttons line up across a row (owner, 22 Oct 2026).** Rail and grid cells stretch to the row's tallest card and the card is a flex column, so `mt-auto` on the foot puts every card's price and button at the same height whatever the title's length. The going row moved up into the text block (above the foot), and anything only some cards have keeps its room in the foot (the button's room when there's no ticket action; the organiser row as text without a profile; two lines for the price on the phone grid, where it nearly always wraps), so the foot is the same height on siblings. Limits: a price that wraps on one rail card and not its neighbour (at 320, "From A$36.90 incl. booking fee" on a 198px card) or a grid button whose label wraps ("GET FREE TICKETS" at 134px) moves that card's price up by a line; the button still lines up.

**Whole-card click (the stretched link):**
- The title's `a` has an `::after` covering the whole card (`absolute inset-0`), so a tap anywhere on the image, text or empty space opens the event.
- Save, the CTA row and the organiser link are `relative z-10`, so they sit above the stretched area and keep their own targets. Nothing interactive is nested inside the link.
- **Accessible name:** the link is named by `aria-labelledby` = title, date, place, price, going (in that order, skipping absent parts), so it starts with the title. Unchanged by the foot (the going row now sits above the price on screen; the name keeps its order). **The category is not in it (A10):** it's on screen above the title, and repeating it in every card's name slowed scanning a long list.
- Save keeps "Save {title}" with `aria-pressed`. The CTA keeps the sr-only "{label} for {title}".
- **Tab order:** card link → Save → CTA → By organiser (unchanged).
- **Focus-visible:** the outline is drawn on the card root (the `has-[]` classes above), so the ring wraps the whole card. The link's own outline is suppressed. Save and the CTA keep their own rings.
- **Hover** (hover-capable only): the image scales 1.03 and the title underlines.
- **Active:** the card scales 0.98 when the link is pressed (not when Save or the CTA is pressed).
- **Text selection:** card text isn't selectable through the stretched link. That's accepted; titles are on the event page.

**Variant differences:**

| | `rail` | `grid` |
| --- | --- | --- |
| Width | `w-[min(62vw,15rem)]` <640, then `sm:w-full` | `w-full` (cell) |
| Media | `aspect-square` <640 with `fit="auto"`, then `sm:aspect-[4/5]` | `aspect-[4/5]`, cover |
| Title | 18/24 | 16/24, `sm:` 18/24 |
| Venue / price / going | 14/20 | 14/20 |
| CTA | `QuickBuyLink` default (self-start, `px-4`, 44px phones / 40px `sm`) | `narrow` (full width below 640, 12/16 label, arrow hidden <640, the label may wrap to 2 lines: never truncated) |
| Organiser row | never | `showOrganiser` (default true; false on the organiser's own profile): a link where there's a profile, plain text otherwise |
| Save | always | `showSave` (default true) |

**Sizes at 375:** a `rail` card is 232 wide; media 232×232 (square on phones), text ≈ 160 (category 16, date 16, title ≤48, venue 20, going 24, 8px gaps), foot ≈ 88 (price 20, CTA row 56, plus 12). Total ≈ 480 (was ≈ 424), still well inside one 667px screen. The next card starts at x = 264, so ≈ 111px of it shows. A `grid` card is 161 wide; media 161×201, total ≈ 400 with a two-line date and CTA.

**Placeholder (`EventCardPlaceholder`, replaces all three):**
- `div[aria-hidden]` with the variant's width.
- the variant's media box (`rail`: square on phones, 4:5 from `sm`; `grid`: 4:5) with `rounded-card bg-surface`, then `pt-3 flex flex-col gap-2` with bars `h-3 w-16`, `h-3 w-24`, `h-4 w-full`, `h-3 w-32` (each `bg-surface`, `max-w-full`).
- No shimmer.

**Loading / empty / error** are owned by the section (§6.3.4). **Image error:** `EventArt` falls back to the poster.

#### 6.2.2 Field order rules

- **Category line:** `categoryLabel(event)` plus at most one qualifier. The trending signal comes from `signalLabel` ("Just announced", or "Popular" for an external event's going signal or a "popular" label; it read "Popular this week" until V9). On the P0-only Free & low-cost rail, the badge read "Free" / "Under A$20" (the rail and the `badge` prop went in P1). The going kind never shows here (it's the going row).
- **Date line:** start date and time in Melbourne time. An in-progress multi-day event reads "Now on · until {end date}" (`cardDateLabel`). Never "Today!", never a countdown.
- **Price line:** §6.2.4.
- **No description** on cards (the old `wide` card's sentence goes).

#### 6.2.3 Ticket-state CTA mapping (`cardCta` in `lib/event-card.ts`, built on `lib/quick-buy.ts`)

`type CardCta = { label: QuickBuyLabel; href: string; tone: "signal" | "outline" }`. The first matching row wins.

| # | State (real data) | Condition | Price line (`CardPrice`) | CTA label | Target | Tone |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Ended | `Date.parse(endsAt ?? startsAt) <= now` | **"Ended"** (600, `text-muted`; new) | none | — | — |
| 2 | External, free | `ticketingMode === "external" && externalFree` | "Free" + muted "Tickets on {provider}" | "Get free tickets" (**was "Buy tickets"**) | `/events/{slug}#tickets` (the page holds the outbound link and its beacon; cards never link out) | signal |
| 3 | External, paid | `ticketingMode === "external"` | "Tickets on {provider}" (600) | **"Get tickets"** (was "Buy tickets"; A9: nothing is bought on Sheltüh) | same | signal |
| 4 | No tiers yet | `ticketTypes.length === 0` | "Tickets coming soon" (600) | none | — | — |
| 5 | Sold out, waitlist open | `isSoldOut(event)` and not ended | "Sold out" (600, black) | "Join waitlist" | `/events/{slug}#tickets` (the WaitlistBlock), also for seated events | **outline** (`buttonClass("outline","md")`, black on cream): a waitlist isn't a purchase, so it doesn't share the orange |
| 6 | Seated, on sale | `seating` and not sold out | "From A$X" + "incl. booking fee" | "Choose seats" | `/events/{slug}/seats` | signal |
| 7 | All on-sale tiers free | every `pricedTicketTypes` tier is 0 | "Free" + "No booking fee" (or "Paid tickets incl. booking fee" when a paid tier exists) | "Get free tickets" | `#tickets` | signal |
| 8 | Paid, on sale | otherwise | "A$X" or "From A$X" + "incl. booking fee" | "Buy tickets" | `#tickets` | signal |

- **Demo mode:** the same labels and targets. The event page says nothing is bookable (`TicketSelector`'s disabled checkout and the `DemoNotice`).
- **Waitlist "open":** the data has no explicit flag. Per `lib/types.ts` (`soldOut`: "While it hasn't ended, people can join its waitlist"), open means sold out and not ended. The API can still refuse with 409, and `WaitlistBlock` shows that on the event page. A card can't know it in advance (dependency D5).
- **Never on cards:** "Only N left", remaining counts, "selling fast", or any urgency.
- **`QuickBuyLink` change:** it takes `tone` (default `"signal"`). `quickBuyLabel` gains the external-free case (row 2) and, in P2, "Get tickets" for a paid external event (row 3). An external event's page and buy bar keep their own "Get tickets on {provider}" link out.
- The brief's "BUY TICKETS / GET FREE TICKET / SOLD OUT / JOIN WAITLIST / EXTERNAL TICKETS" are read as **states**, not literal labels. The existing tested labels ("Get free tickets", plural, because one booking can hold several) are kept. The external state shows in the price line ("Tickets on Humanitix") directly above the CTA.

#### 6.2.4 The fee note (`components/ui/CardPrice.tsx`, moved)

- The amount comes first: `font-semibold tabular-nums` black. Then a space and the note in `text-muted`, from `formatFeedPriceParts` (unchanged): "incl. booking fee", "No booking fee", "Paid tickets incl. booking fee".
- The price is always the all-inclusive buyer total (`getMinBuyerTotalCents`). "From" appears when on-sale tiers vary.
- New prop `now?: Date`: an ended event renders "Ended" and nothing else.
- The note never wraps under the amount at 375 for "A$31.70 incl. booking fee" (14px ≈ 170px at 232 wide). On a 134px `grid` card it wraps after the amount, which is acceptable: the amount stays first.
- **The note's last two words never split (V15):** they sit in one `whitespace-nowrap` span ("incl. <nowrap>booking fee</nowrap>"), so "fee" is never alone on a line. Choice: not a whole-note `nowrap`, which would overflow a 134px card with "Paid tickets incl. booking fee"; and ordinary spaces, not a no-break space, so the text and accessible names read exactly as before.

#### 6.2.5 Going on cards (`cardGoing`) *[Superseded: Refinement — a count only, "(sample)" in the demo, threshold 3]*

| Situation | Shown | Source |
| --- | --- | --- |
| External event | nothing | Who's Going is closed for external tickets |
| Demo mode (any card) | `GoingStack sm`: 3 one-letter avatars + "N going" | `demoGoing(event.id)` (fictional sample list). The home and /events already carry `DemoNotice`; keep those notices. |
| Live, trending signal `going` | `GoingStack sm` with no initials: DotsMark + "N going" | the server's thresholded `goingCount` (≥ threshold) |
| Live, anything else | nothing, and no reserved space | no list-level going data exists (D1) |

- Never avatars in live: signed-out visitors never receive names, and the list API carries none.
- Never "interested" (no such data). Never "friends" or "mutuals" (no such data).

### 6.3 Home order (`Home.tsx`, `HomeEventSections.tsx`, `lib/home-sections.ts`)

#### 6.3.1 Order and mapping

| # | Section (brief) | From today | Action | Hidden when |
| --- | --- | --- | --- | --- |
| 1 | Hero + event search | `HomeHero` (+ `UpNext`, `CategoryRow`) | **Keep, slimmed** (§6.1). Up next **removed**; categories **moved** to #1b | never |
| 1b | Explore by category | `CategoryRow` | **Owner, 22 Oct: straight under the hero, above This weekend** (was #4, after the event sections), so visitors can narrow down early. `mt-6 sm:mt-8 lg:mt-10` | never (static) |
| 2 | This weekend | This weekend (`wide`) | **Keep**, `rail` cards | `weekend.status === "hidden"` |
| 2b | From organisers you follow (signed-in, live) | Following | **Keep**, right after This weekend (personal, conditional; not in the brief's list, but it's the most relevant rail for a member who follows someone) | no followed events left after dedupe |
| 3 | Popular right now | Trending + Coming up near you | **Merge**: one slot. "Popular right now" when trending has ≥3 events left; otherwise the same slot is titled **"Coming up"** with the soonest not-yet-started events (≥2). Non-trending events are never labelled popular. | neither threshold met |
| — | Only in the city | `GuideCard` | **Remove from the home** (§6.3.5) | — |
| — | Free & low-cost | Free & low-cost (`compact`) | **Remove** (P1). It overlaps "Free" in Explore by category and This weekend. | — |
| 5 | Find your people | `CommunitySection` | **Keep, new copy** (§6.4.4) | never |
| 6 | For organisers | `CreatorsCard` | **Keep**, 2:1 image on phones | never |
| 7 | Footer | `Footer` | **Compact** (§6.6) | — |

#### 6.3.2 Dedupe and data rules (`selectHomeSections`)

- Drop `upNext`, `comingUp` and `lowCost` (P1). Add `popular: { kind: "popular"; items: TrendingItem[] } | { kind: "coming"; items: SheltuhEvent[] } | null`.
- **Claim order:** This weekend → Following → Popular/Coming. Each event appears at most once on the page.
- A section that's hidden claims nothing.
- Caps: 6 per section. Thresholds: trending ≥ 3 (`TRENDING_MIN`), coming ≥ 2.
- `shownEventIds` follows the new shape. `lib/home-events.ts` is unchanged (demo trending still ranks by sample count, labelled `going`).
- The weekend window logic and `formatWeekendRange` are unchanged.

#### 6.3.3 `SectionHead` (simplified; the site's one section head since P2) *[Superseded in part: Refinement — no rule, no dots, sentence case]*

The strap that repeated the h2 goes (it cost 28px per section and read the title twice). The new head:

`components/ui/SectionHead.tsx` (moved from `components/home/` in P2):
```
div.mb-3.flex.items-baseline.justify-between.gap-4.border-t.border-foreground.pt-3.sm:mb-5
├─ div.min-w-0
│  ├─ h2#id.display-md.flex.items-baseline.gap-2[tabIndex=-1]
│  │    span.flex.h-lh.shrink-0.items-center.self-start > DotsMark xs text-signal   (centred on line 1: V7)
│  │    span.min-w-0.break-words.text-balance {title}
│  └─ p.meta.mt-1.text-muted  (note, optional: "Fri 23 – Sun 25 Oct")
└─ Link.group/link.-mr-1.inline-flex.min-h-11.shrink-0.items-center.gap-1.px-1.text-sm.leading-5.font-semibold.underline.underline-offset-4
     link = { href, label = "See all", srLabel? }:
       with srLabel: sr-only "{label} {srLabel}" + aria-hidden "{label}"; without: the label alone
     + ArrowRightIcon (nudges 2px right on hover, motion-safe)
```

The `strap` prop is removed, and `note` is a plain string. **One alignment everywhere (V14):** the link sits on the h2's first-line baseline (the dots' box is `self-start`, out of the baseline, so the title sets it), with or without a note.

**Used by** the home sections, Explore by category, Only in the city, the organiser profile (Upcoming events, Past events), the member profile (Events … going to) and Saved (Coming up). `ui/Section`'s `SectionHeader` (strap + `mb-5 sm:mb-8` head) is **deleted**: its strap repeated each h2 (V3; the member profile's was "Going to"). **Eyebrow rule (P1, from the P0 screenshots, where "•• TRENDING" sat directly above an h2 "TRENDING"):** a mono eyebrow never repeats the heading it sits on. It's used only for context the heading doesn't say: This weekend's date range (the `note`, under the h2), "Find your people" above the band's "See who’s going before you book.", "For organisers" above "Bring your event to life", and "City guide" above the guide card's h3. The link shows only beside cards (This weekend with nothing on has none). Targets and labels (A8: a label says where it goes when the target isn't the section's own list):
- This weekend → `/events`, **"All events"** (`/events` has no weekend filter)
- Following → `/following`, "See all" (sr: "See all organisers you follow")
- Popular / Coming → `/events`, **"All events"** (not sorted by popularity either; choice: same rule as This weekend)
- Explore by category → none (it is the index)

#### 6.3.4 Section states

- **Loading:** one skeleton section in the first slot: rule, an `h-6 w-40 bg-surface` title bar, then 3 `EventCardPlaceholder rail` (the third `hidden md:flex`). `p[role=status].sr-only` says "Loading events…" (unchanged).
- **Error:** the page's one error, moved from `UpNext` into the first slot.
  - A `Notice tone="danger" role="alert"`: "Couldn’t load events. Check your connection and try again." Then `Button variant="outline" size="lg"` "Try again" (busy "Trying again…").
  - Move `UpNext`'s retry focus logic with it. On success after a retry, focus the first section's h2 (`tabIndex={-1}`), but only when focus was on `body`.
  - Static sections (#4–#6) still render.
- **Empty site** (ready, no upcoming events): in the first slot, a `rounded-card bg-surface p-5 sm:p-8` box with `DotsMark lg` and "No events have been published yet. Check back soon." (copy from `UpNext`).
- **This weekend, empty** (before the weekend, nothing on): the heading and "Nothing listed for this weekend yet. New events are added through the week." (unchanged).
- **Rails:** no section renders with 0 cards. No "See all" without cards.
- **No `data-reveal` and no first-section spacing special case:** every section is `mt-8 sm:mt-12 lg:mt-16`.

#### 6.3.5 Where "Only in the city" goes

There is no city-guide route, and its only content is a static card pointing at `/map`.
- **P1 (done, manager decision):** `GuideCard` leaves the home and is mounted at the end of `/events` (`app/events/page.tsx`, after `EventFeed`, `mt-12 sm:mt-16`), linking to `/map`. It shows whatever state the feed is in (loading, empty, error).
- Don't build a new Explore route until there's real editorial content to fill it.

#### 6.3.6 Explore by category (`CategoryRow.tsx`) *[Superseded: Refinement — a chip row, not six tiles]*

- `section[aria-labelledby="home-cats"]` with `SectionHead id="home-cats" title="Explore by category"`, **directly after the hero and before the first event section** (owner, 22 Oct 2026; it was after the event sections). The owner kept the six tiles (not a chip row).
- Links are unchanged (`HOME_CATEGORIES`, six, to `/events?category=…` / `?pricing=free`). It stays a `nav`? No: it becomes a `section` with a `ul`, since a heading plus a list is enough and there's one fewer landmark.
- **List:** `ul.grid.grid-cols-3.gap-2.sm:grid-cols-6.sm:gap-3` (no rail, no `RailItem`).
- **Tile:** `Link.flex.min-h-18.flex-col.items-center.justify-center.gap-2.rounded-control.border.border-foreground.bg-card.px-2.py-3.text-center` with `CategoryIcon` (24px) and the label `text-xs leading-4 font-semibold`. Black on white is 21:1.
- **States:**
  - Hover: `hover:bg-surface`.
  - Focus-visible: the global ring.
  - Active: `motion-safe:active:scale-95`.
- **Height:** 72px tiles in 2 rows (156 with the gap) on phones, 1 row from `sm`.

### 6.4 Who's Going

#### 6.4.1 What data exists (and what doesn't)

| Exists | Where | Visibility |
| --- | --- | --- |
| Confirmed opt-in count | `GoingSummary.count` (public). Withheld below 3 (`countHidden`). `closed` when ended, switched off, or external. | Everyone, when ≥3 |
| Names of opted-in attendees | `GoingAttendee.displayName` (`listGoingAttendees`, paged) | Signed-in, verified members with a profile only |
| Public member profile link | `GoingAttendee.profileId`, only when that member set `profileVisible` | as above |
| Profile photo | `hasAvatar` + `avatarThumbUrl` (96px; fetched with the bearer token, never in `src` directly; `MemberAvatar` does this) | as above |
| Viewer's own status | `MyGoingStatus` (going, eligible, hasProfile) | signed-in |
| Trending going count | `goingCount` on trending items, ≥ threshold | everyone |

**Not available, so never shown:**
- an "interested" signal (no data; the brief's confirmed-vs-interest distinction can't be made);
- shared interests;
- mutual follows or friends;
- avatars or counts on non-trending cards in live mode;
- names for signed-out visitors;
- avatars for attendees without a visible profile (initials only).

#### 6.4.2 Event page panel (`components/WhosGoing.tsx`): compact preview plus a disclosure

**Collapsed (the default, every state):**
```
Panel title: DotsMark + "Who's going"   (unchanged)
div.flex.items-center.gap-3                              (only when something is shown)
├─ GoingFaces (new, components/whos-going/GoingFaces.tsx), aria-hidden
│     up to 5 avatars, size-8 (32px) rounded-dot, -ml-1 overlap (first ml-0; was -ml-2, which covered two-letter initials: A4), ring-2 ring-background.
│     "You" first when going (InitialsAvatar you: orange). Then the first loaded attendees:
│     MemberAvatar (photo when profileId && hasAvatar and getToken) else InitialsAvatar by index.
│     Rendered only when names are loaded (attendees !== null).
└─ p.flex.items-baseline.gap-2   (only when count ≥ 3 and not hidden)
      span.font-heading.text-2xl.leading-none.tabular-nums {count}  span.eyebrow.text-muted "going"
Button "See who's going" (variant outline, size md, min-h-11, w-full sm:w-auto) + 16px chevron
      (rotate-180 when expanded, motion-safe 150ms), aria-expanded, aria-controls="wg-list"
      — shown when attendees has ≥1 entry or the viewer is going.
Action row (unchanged logic: demo disabled "Add yourself" + DemoNotice; signed-out "Sign in to see who's going";
      member states: Show me as going / Add yourself + OptInForm / Stop showing me / Get a ticket…)
```

**Expanded** (`aria-expanded="true"`):
- `div#wg-list.mt-4` holds the existing `NameList` (two columns; one column with message actions), "Show more" paging (6, then +12), the load-more error and "Report a name (by email)". All behaviour is unchanged.
- The root's `data-wg-expanded` is set while it's open (this keeps the `lg` aside unstuck).
- Focus stays on the toggle; rows from Show more take focus as they do today.
- Collapsing keeps the loaded pages (no refetch). Re-opening shows what's already loaded.
- `aria-controls="wg-list"` is set only while open: the list is unmounted when collapsed, so the reference never points at nothing.
- Adding yourself opens the list, since your own row confirms it and takes focus.

**No long lists:** collapsed shows ≤5 faces. Expanded starts at 6 names and grows only on request.

**States:**
- Loading: "Loading who’s going…" `min-h-30` (unchanged).
- Error: Notice + Try again (unchanged).
- Closed: the panel isn't rendered (unchanged).
- Signed-out, live, `countHidden`: no faces, no count, "Be one of the first to add yourself." + "Sign in to see who’s going" (unchanged).
- Signed-in, nobody: no faces, no button, "No one’s added themselves yet." (unchanged).
- Signed-in, 1–2 people (count hidden): faces only, no number, plus "See who's going". The faces are `aria-hidden`, so a `p.sr-only` beside them says the same names (`facesSummary`: "Going: you and Alex P."), never a number (A5).
- Demo: sample faces, the sample count, "See who's going" expands the sample names, and the `DemoNotice` "These names are samples…" stays. **Once the event has ended** (`endsAt`, or `startsAt` with no end) the demo list is closed, as the live API closes a real one: no panel, no summary link (V4; `WhosGoingProvider` takes `startsAt`/`endsAt`, read at first render).

**Phone summary under the title (`WhosGoingSummaryLink`):**
- Unchanged trigger rules (count ≥3 only).
- Visual: `DotsMark xs text-signal` + "{count} going" link to `#whos-going`, `min-h-11`.
- No faces there (keeps the first screen short).

#### 6.4.3 Privacy rules (must hold in every variant)

1. Names, faces and profile links render only from `listGoingAttendees` results, which the API serves only to verified members with a profile. Demo samples render only in demo mode.
2. Never derive attendance from ticket purchases. Only opted-in attendees (`set_going`) appear.
3. Below 3, no number anywhere (panel, summary link, cards).
4. A profile link only when `profileId` is present (the member chose `profileVisible`). Photos only via `MemberAvatar` with the token.
5. Suspended members never appear (server). The viewer's own suspended state shows `SuspendedNotice` (unchanged).
6. External events: nothing, anywhere.

#### 6.4.4 Home "Find your people" band (`CommunitySection.tsx`) *[Superseded: owner mockup, 23 Oct 2026 (see the note at the top); before that, Refinement — benefit, example, one action; steps moved to the panel]*

- Kept: full-bleed `data-surface="signal"`, `id="find-your-people"`, `tabIndex={-1}`, `aria-labelledby="home-people"`. No orange button inside.
- **Eyebrow:** `p.eyebrow` "Find your people" above the h2 (the band's name, and the `#find-your-people` target's visible label; it doesn't repeat the h2).
- **What's actually visible (read from `lib/server/handlers/going.ts`, `WhosGoingProvider`, `WhosGoing`, `docs/architecture.md` "Who's Going"; owner, 22 Oct 2026):**
  - **Signed out:** the count only, and only from 3 opted-in people (`countHidden` below that). No names, no faces.
  - **Signed in, no profile or unverified email:** the same count; the panel says names need a Who's Going profile (or a verified email).
  - **Signed in, verified email, a profile (free, made on /account with no ticket needed, or on the event page while adding yourself):** the opted-in members' display names, faces (photo or initials), and profile links where the member made theirs visible. So "see who's going before you book" is true for members.
  - **Ticket booked with that verified email, then opted in:** you appear on the list ("Show me as going"/"Add yourself"), and you can send a message request to others on the same list (and receive them).
- **h2:** "See who’s going before you book." (kept: true for members with a profile; `display-lg font-display`; the hero h1 is the other display use, never in the same viewport).
- **Body:** "Anyone can see how many are going, once there are three or more. Make a free profile and you’ll see who." (`text-base leading-6 sm:text-lg sm:leading-7 max-w-md`; was "Discover events through the people and creative communities around you.").
- **How it works**, in the order access opens up (the old first step, "Get a ticket on Sheltüh.", contradicted the h2):
  - Markup: `ol.mt-5.grid.gap-3.sm:grid-cols-3.sm:gap-6`. Each `li.border-t.border-foreground.pt-3` holds a `span.meta` number ("01", "02", "03") and a `p.text-sm.leading-5.mt-1`:
  1. "Sign up and make a free profile to see who’s going."
  2. "Got a ticket? Add yourself to the list, only if you want to."
  3. "Once you’re on the list, say hi to others going before the night."
- **The event page's own copy was checked and matches** (signed out: "Sign in to see who’s going"; no profile: "Names are shown to members with a Who’s Going profile"; no ticket: "Get a ticket to add yourself"); no change there.
- **Avatars:** `GoingStack lg` with the demo initials (demo only; live shows none).
- **CTA (unchanged logic):** signed-in → "Find an event" (`/events`); otherwise → "Join the community" (`/signup`). `ButtonLink variant="solid" size="lg" className="w-full sm:w-auto"`.
- **Secondary (A1, signed-out only):** "Browse events" (`/events`), an underlined 44px text link beside the button (`mt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6`), because buying needs no account.
- **`/signup` intro (A1), from what the code does:** "An account lets you add yourself to an event’s Who’s Going list, see who else is going, message people going to the same event, and apply as an organiser. You don’t need one to browse events or buy tickets." (Checkout takes a guest's email; names, messaging and organiser applications need an account.)
- **Layout:** phones stacked; `sm:grid sm:grid-cols-2 sm:gap-x-8`, with the h2 and avatars left and the body, steps and CTA right. Padding `py-10 sm:py-16` (was `py-12`).

### 6.5 Event details (`components/EventDetailsView.tsx`) *[Superseded in part: Refinement — order, one facts block, one Save, compact buy bar]*

**Phone order (unchanged except where noted):**
1. Back link (`ui/BackLink`, "Back to all events")
2. Photo
3. Category · suburb strap with Save/Share
4. h1
5. When, venue and going summary
6. DemoNotice
7. Description
8. Good to know
9. When (+ Add to calendar)
10. Where (+ **Get directions**)
11. Organiser (+ **More from**)
12. Who's going (compact)
13. Tickets (+ **Booking info**)
14. Buy bar

**When:**
- Keep `whenLabel` (start–end, "midnight" in words) and Add to calendar.
- Replace "Melbourne time" with **"Melbourne time (AEDT)"**, the abbreviation in effect at the start (new `formatTimeZoneLabel(startsAt)` in `lib/format.ts`). It uses `Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", timeZoneName: "short" })`. If that yields anything other than `AEST`/`AEDT` (e.g. "GMT+11"), fall back to "Melbourne time". Unit-test it with one AEDT date and one AEST date.

**Where: Get directions**
- New `lib/maps.ts`: `directionsHref(event): string | null` returns `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([venueName, venueAddress || suburb].filter(Boolean).join(", "))}`, or `null` when all three are empty.
- Why this URL:
  - It's Google's documented cross-platform Maps URL. It opens the Google Maps app on Android and on iOS when installed, otherwise Google Maps on the web, with the user's location as the origin.
  - No user-agent sniffing (so no hydration mismatch), no geo: scheme (unsupported on desktop and iOS Safari), no new dependency.
  - Address text rather than `coordinates`, because coordinates may be a suburb centroid (`lib/geo.ts`).
- **The address is interactive (P1, manager brief):** the Where `dd` holds one link, the address (`text-base leading-6 break-words`) with "Get directions" + the 16px external-arrow icon (`ExternalIcon`, shared with `ExternalTicketLink`) under it in a `min-h-11` underlined span:
  ```
  dd.mt-1 > a[data-directions].flex.w-fit.max-w-full.flex-col  target=_blank rel="noopener noreferrer"
       aria-label="Get directions to {venueName}, {venueAddress} (opens Google Maps in a new tab)"
    ├─ span  "{venueName}, {venueAddress}"
    └─ span.inline-flex.min-h-11.items-center.gap-1.text-sm.leading-5.font-semibold.underline  "Get directions" + ExternalIcon
  ```
  One target, no duplicate links. The accessible name holds both visible strings, says where it goes and that it opens a new tab. With nothing to route to (`directionsHref` null), the address is plain text. External events get it too (once).
- Demo: sample venues have street-style addresses. The link works, and the page's DemoNotice already says the listing is fictional.

**Organiser:**
- "Organised by {Link}" stays. When `organiserProfileHref(event)` is non-null, add a second line: `Link.inline-flex.min-h-11.items-center.gap-1.text-sm.leading-5.font-semibold.underline` "More from {organiserName}" + `ArrowRightIcon` → `${href}#organiser-upcoming`.
- The anchor targets `id="organiser-upcoming"`, the "Upcoming events" heading on the organiser profile (`OrganiserProfileView`). It works in live (`/organisers/{organiserId}`) and demo (the sample organiser's slug), because both come from `organiserProfileHref`.
- With no profile: plain text, no link.

**Who's going:** §6.4.2.

**Tickets (`#tickets`, unchanged contents, plus a Booking info block after the selector or panel):**
- **Availability:**
  - On sale: the selector.
  - Some tiers sold out: the per-tier "Sold out" words (unchanged).
  - All sold out: the waitlist (unchanged).
  - None yet: "Tickets coming soon."
  - "Only N left" only from the server's `remaining` (unchanged).
- **Fees:** the existing line ("Booking fee: 4% of ticket face value + A$0.50 per paid ticket. Free tickets never carry a fee.") and the per-tier "A$X incl. booking fee" + breakdown (unchanged).
- **Waitlist explainer** (`WaitlistBlock` idle state): keep "We’ll email you if tickets are released. Joining doesn’t reserve a ticket or charge you." and add one existing-policy sentence after it: "If tickets come up, it’s first come, first served." (the same policy the joined state already states).
- **Booking info: only where a paid purchase is possible (A6):** a Sheltüh-ticketed event with at least one paid tier that hasn't ended (sold out included, since tickets can come back through the waitlist; demo included). Not on a free-only, ended or external event.
  ```
  dl[data-booking-info].mt-4.flex.flex-col.gap-2.border-t.border-surface-border.pt-4.text-sm.leading-5
    dt.eyebrow.text-muted "Refunds"
    dd: "Refund conditions are in our " <Link /purchase-terms>Purchase Terms</Link> ". To ask for one, use "
        <Link /refunds>Request a refund</Link> "."
  ```
  It links the existing pages and invents no policy. **No age restriction here (V5):** it's in Good to know, once.
- External events keep their own copy ("Their terms apply"). No Booking info there.
- **Seated tier rows (V6)** match the standard ticket row: the name, the all-inclusive price under it at every width (no right-hand column), then the breakdown ("A$30.00 ticket + A$1.70 booking fee") or "Standing · chosen on the next page" in `mt-1 text-xs text-muted`, not mono.

**Sticky buy bar (`[data-buy-bar]`):**
- Kept as is: `sticky bottom-0`, last in the grid so it settles under the tickets, `min-h-18`, `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`, `html:has([data-buy-bar]) scroll-padding-bottom`.
- **Side safe areas (checked in P1, no change):** `body` pads `env(safe-area-inset-left/right)`, and the bar's `-mx-5` / `sm:-mx-8` only cancels the page wrapper's gutter, not the body's padding. So the bar's contents already sit inside a landscape notch. Extra `env()` padding on the bar would pad twice. The bottom inset is in the bar's own `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`.
- **Ended (behaviour change, §10.3; final in P2, A7): no buy bar at all**, for Sheltüh-ticketed and external events alike. Nothing's for sale, so a bar would only take screen. Save stays by the title. The Tickets panel opens with "This event has ended.": above the sold-out tiers and the closed waitlist when sold out, alone otherwise (seated events included, so there's no seat picking). No Booking info (A6). (P1 had a bar saying "This event has ended." with the date, and "See tickets" when sold out.)

**Photo:** `fit="auto"` (§5).

**Side column:** `gap-6` (24px) between the When/Where/Organiser list, Who's going and Tickets at every width (V13).

**Breathing room (owner, 22 Oct 2026):** the When/Where/Organiser rows are `py-4` (was `py-3`); the phone facts under the title are `gap-2` (was `gap-1`), the venue staying `text-sm leading-5` so the title, date and venue still clear the buy bar at 375×667; Good to know is `gap-5 text-sm leading-6` with `gap-2` between a label and its value (was `gap-4`, `gap-1`).

### 6.6 Footer (`components/Footer.tsx`, done in P2; shortened after the owner's feedback of 22 Oct 2026) *[Superseded: Refinement — restrained wordmark, disclosures]*

Every existing link stays, plus "Contact support". It's compact, with clearer hierarchy. The orange wordmark is unchanged (the owner: "it works"); the height comes out of the gaps and the install banner:

```
footer[data-surface=ink][data-page-end]
└─ div.mx-auto.max-w-6xl.px-5.pt-8.pb-[calc(1.25rem+env(safe-area-inset-bottom))].sm:px-8.sm:pt-12
   ├─ div.lg:grid.lg:grid-cols-12.lg:gap-x-8
   │  ├─ div.lg:col-span-5
   │  │  ├─ p.display-lg.leading-[1.05]  <BrandU spoken="Where is your Sheltüh?">Where is ÜR / Sheltüh?</BrandU>   (cream; a p, not a heading; V1)
   │  │  ├─ p.mt-2.max-w-sm.text-sm.leading-5.text-muted   live: "Curated creative events in Melbourne." / demo: "A local prototype. Sample events only — nothing here is a real booking."
   │  │  └─ InstallPrompt: a quiet line, mt-3 (below)
   │  └─ div.mt-6.grid.grid-cols-2.gap-x-6.gap-y-5.sm:grid-cols-3.lg:col-span-7.lg:mt-0   (nav.flex.flex-col, no gap: links are 32px rows)
   │     ├─ nav "Fan support":   Help & FAQs · Request a refund · Contact support (a plain <a href="mailto:SUPPORT_EMAIL">, lib/contact.ts)
   │     ├─ nav "Explore" (was "Resources"; same links): All events · Map · Search · For organisers
   │     └─ nav "Our company":   About Sheltüh · Become a partner
   ├─ Wordmark.mt-8.block.h-auto.w-full.text-signal.sm:mt-12   (kept, oversized, decorative)
   └─ div.mt-5.flex.flex-col.gap-2.border-t.border-foreground/20.pt-4.sm:flex-row.sm:items-center.sm:justify-between.sm:gap-4
      ├─ p.eyebrow.text-muted  "© 2026 Sheltüh"
      └─ nav "Legal": Privacy Policy · Terms of Use · Purchase Terms
            Link.flex.min-h-11.items-center.text-sm.leading-5.text-muted.underline.underline-offset-4.hover:text-foreground.sm:min-h-8
            gap-x-6, flex-wrap
```

- **Group headings:** `p.eyebrow.pb-1.text-muted` (unchanged).
- **Links:** `self-start py-1 text-[0.9375rem] leading-6` (32px targets).
- **Order:** "Fan support" comes first, so support and refunds are the first links a phone sees.
- **Support email:** live used to show "Questions? support@sheltuh.com.au" in the note; it's now the "Contact support" link in Fan support, in demo and live alike (the address is a real alias in both). `/help` and `/refunds` still print it.
- At 320 the 2-column grid puts "Our company" on row 2. At 375–639 it's the same. 3 columns from `sm`; from `lg` the campaign line and note take 5 columns and the groups 7.
- **Vertical budget at 375:** ≈ 32 + campaign 2 lines × 34 = 68 + 8 + note 40 + 24 + links ≈ 250 + 32 + wordmark ≈ 76 + legal ≈ 105, for ≈ 635 total (was ≈ 690 in P2, plus ≈ 150–200 more whenever the install banner showed).
- **Install offer (`components/pwa/InstallPrompt.tsx`, owner, 22 Oct 2026): a quiet secondary action**, not a banner. `div[role=group][aria-labelledby][data-install-prompt].mt-3.max-w-sm`: a muted `text-sm` line ("Get Sheltüh on your home screen" / iOS "Add Sheltüh to your Home Screen", the group's name) and two 44px underlined text buttons, "Install" (iOS: "Show me how", `aria-expanded`, which opens the three Add to Home Screen steps) and "No thanks" (muted). No border, no filled button. Behaviour unchanged: only where the browser can install it (or iOS Safari), never when installed, never on event, checkout, message, form or dashboard pages, "No thanks" remembered with the focused confirmation in its place.
- `display-lg` here is Instrument Sans, so `font-display` is still used at most once per view.

### 6.7 Header (`components/Nav.tsx`, P2 fixes)

- **One "Primary" landmark (A11):** the desktop row's `nav` is "Primary"; the phone menu's `nav` (inside the popover) is "Site menu".
- **No header search on the home (V16, choice: hide):** the hero has the page's search, so the desktop row leaves its "Search the site" field out on `/` (every other page keeps it; below `lg` the header only ever had the search icon link).
- **Search fields are named by their placeholder (A3, WCAG 2.5.3):** `SearchBar`'s hidden label is the placeholder, so the hero's and header's fields are "Search events" (the visible words); `/search` keeps "Search by event, venue or suburb", its placeholder.

### 6.8 Demo label (`components/DemoNotice.tsx`, V11) *[Superseded: Refinement — one DemoBanner per page; DemoNotice is a quiet note]*

"Demo — sample events" is a black-edged white badge (`border border-foreground bg-card text-foreground`, 21:1), no longer orange: it stays clearly visible without spending the orange budget. Every demo label stays where it was.

---

## 7. Motion

| What | Behaviour | Why | Reduced motion |
| --- | --- | --- | --- |
| Home section reveal (`data-reveal` on HomeEventSections, GuideCard, CreatorsCard) | **Removed** (P0) | It left whole sections at `opacity: 0` until scrolled: the empty band (§8.1), and needless per the brief | n/a |
| Hero `.rise` entrance | **Removed** (P0) | The hero should read instantly | n/a |
| Desktop hero photo push-in (`EventArt motion`) | Kept: one 4.5s cycle, holds the end frame | The one photographic flourish | Static (existing media query) |
| Card press | `scale(0.98)` 150ms, on the card link only | Tap feedback | none (`motion-safe:`) |
| Card image hover | `scale(1.03)` 300ms ease-out, hover-capable only | Pointer affordance | none |
| See who's going chevron | `rotate(180deg)` 150ms ease-out | State feedback | instant |
| New name rows | `.fade-in` 150ms (existing) | Shows what was added | none |
| Buttons | `.btn:active` 1px nudge (existing) | Press feedback | none |
| Section "See all" / "All events" arrow (P2.10) | `translate-x-0.5` on hover, 150ms | Pointer affordance | none (`motion-safe:`) |
| Back link arrow (P2.10) | `-translate-x-0.5` on hover, 150ms | Pointer affordance | none (`motion-safe:`) |
| `RevealObserver` elsewhere (`EventResults`, `OrganiserProfileView`, `ContentPage`, dashboard/admin lists) | Unchanged in P0/P1. P2 decision: remove site-wide or keep (open question 4). | The same blank-band artefact appears in full-page captures of those pages | Nothing (existing) |

---

## 8. Responsive audit checklist

Run at **320, 375, 390, 430, 768, 1024, 1280**, in demo and live (e2e mocks), on `/`, `/events`, `/events/[slug]` (on sale, sold out, external, seated, free, ended), `/map`, `/saved` and `/search`.

### 8.1 The empty cream band before the footer: cause and fix

- **Observed:** at 375 there's ≈1,460 CSS px of blank cream between This weekend and Find your people, plus ≈500px between the band and the footer. At 1280 there's the same pattern.
- **Cause (in code):**
  - `HomeEventSections` marks every section after the first `data-reveal` (`reveal()` returns `""`; Free & low-cost is always `data-reveal`). `GuideCard` and `CreatorsCard` are `data-reveal` too.
  - `RevealObserver` arms everything off-screen at load, or everything when the sections arrive later via its MutationObserver. That adds `.reveal-pending` (`opacity: 0; transform: translateY(.75rem)`) until an `IntersectionObserver` (rootMargin `0 0 -8% 0`) sees it.
  - A full-page capture never scrolls, so the observer never fires. The band is Trending, Coming up, Only in the city and Free & low-cost (≈1,460px on phones), and below the band, For organisers (≈500px), all present but invisible.
  - Real visitors who scroll do see them fade in. The same mechanism still shows blank space on fast flings and anchor jumps, and in any no-scroll renderer (screenshots, visual QA, some previews).
- **Fix (P0):**
  - Remove `data-reveal` from `HomeEventSections.tsx` (delete the `reveal()` helper and the `FIRST_SECTION` special case), `GuideCard.tsx` and `CreatorsCard.tsx`.
  - Add an e2e guard: after load at 375 with no scrolling, no element under `main` has `.reveal-pending`, and every `[data-home-section]` has computed `opacity: 1`.
  - Leave `RevealObserver` itself and `tests/RevealObserver.test.tsx` as they are (other pages still use it).
- **Not the cause:** there's no empty section element. `HomeEventSections` renders nothing for hidden sections.

### 8.2 Checklist

| # | Check | Known risk in code | Fix / rule |
| --- | --- | --- | --- |
| 1 | No horizontal overflow (`documentElement.scrollWidth - clientWidth ≤ 0`) **with `body { overflow-x: hidden }` removed** | `globals.css` `body { overflow-x: hidden }` masks causes. Candidates: the hero's `whitespace-nowrap` h1 lines (removed in P0); `ui/Carousel` `sm:w-screen` (100vw includes the scrollbar; delete the unused component); `-mx-5` bleeds (rails, event photo, buy bar: check each parent has matching padding at `sm`, where it's `-mx-8`); the `ShareButton` popover `fixed inset-x-5`; long unbroken titles or emails (`break-words` on every card title, `break-all` on emails) | Remove the `overflow-x: hidden` line as the **last** P0 step, after `e2e/responsive.spec.ts` passes at every width with it gone. Keep `padding-left/right: env(safe-area-inset-*)` on `body`. |
| 2 | Text clipping | Titles `line-clamp-2`; venue `truncate`; the hero h1 must wrap, not clip, at 200% | Card titles keep `line-clamp-2 break-words`. Nothing in the hero is `nowrap`. |
| 3 | Header spacing | 56px bar: wordmark 88 + search 44 + saved 44 + Menu ≈70 = 246 ≤ 280 at 320 | No change. Verify the umlaut and unread badge don't push Menu off at 320. |
| 4 | Carousel bounds | A flex scroll container's end padding is dropped by some engines (Safari) and counted by others (Chromium), so with `px-5` plus a spacer the end gap was 20px in one and 40px in the other (V12) | The rail `ul` has **no end padding** (`ps-5 pe-0`) and an `after:block after:w-2 after:shrink-0 after:content-['']` spacer below `sm`: 12px gap + 8px = 20px in every engine, whatever it does with padding. Acceptance: scrolled to the end, the last card's right edge is ≥ 20px from the viewport edge (`e2e/responsive.spec.ts`). |
| 5 | Button overflow | `grid` CTA at 134px: "GET FREE TICKETS" at 12px is ≈122px + 16px padding | The label wraps to 2 lines inside `min-h-11` (`text-center text-balance`), never truncates, never overflows. The hero CTA is full width <640. |
| 6 | Image cropping | Event photo `max-h-[36svh]` crops portrait posters to a strip | `fit="auto"` (§5). Cards: 4:5 cover. |
| 7 | Sticky bars | The buy bar sits mid-page in full-page screenshots (sticky artefact, not a bug). At the end of the page it must settle below the Tickets panel and never cover the last focusable control. | Keep the structure. Add the side safe-area padding (§6.5). The e2e check scrolls to the bottom: the bar's top ≥ the Tickets panel's bottom. |
| 8 | Floating widgets | **None persistent in the code.** The dark floating circle on Vercel preview deployments is the **Vercel Toolbar**, injected by Vercel, not this app (owner, 22 Oct: nothing to do in the app; it isn't on production). RouteProgress is `fixed`, top, `pointer-events-none`; the map sheet is `fixed` bottom with safe-area offsets; `InstallPrompt` is inline in the footer. The Next.js dev indicator (dev only) floats bottom-left in `next dev` screenshots and can overlap the buy bar's price. Ignore it in QA; it isn't in production. | Rule for any future third-party widget (chat, accessibility overlay): `bottom: calc(var(--buybar-h) + env(safe-area-inset-bottom) + 0.75rem)` on pages with `[data-buy-bar]` (`--seatbar-h` on the seat page), never over the header or a CTA. An accessibility overlay is not recommended (WCAG is met in the markup). |
| 9 | Safe areas | Header `pt-[env(safe-area-inset-top)]` ✓; buy bar bottom ✓ (sides added); footer bottom ✓; body sides ✓; map sheet ✓ | Test in iOS Safari landscape (notch) and as an installed PWA (`viewport-fit=cover`). |
| 10 | Footer alignment | Columns uneven at 320 (2 + 1) | §6.6: groups left-aligned to the gutter, a 2-col grid, the wordmark full width, legal links wrapping with `gap-x-6`. |
| 11 | Focus not obscured (WCAG 2.4.11) | Rails clip rings; the buy bar covers focus | Rails keep `py-4 -my-4`; card ring on the root with `outline-offset-4` stays inside the rail's 16px padding. `scroll-padding-bottom` (existing) for the buy bar. |
| 12 | Target size | Footer links 32px, legal 44px on phones; card CTA 44px; category tiles 72px; Save 44px | ≥ 24px everywhere (2.5.8); primary actions ≥ 44px. |
| 13 | Layout shift | Removing Up next and reveal removes late fades. Cards reserve media ratio. | No section changes height after load except loading → ready, which is the skeleton's own box. |
| 14 | Broken images | `EventArt` falls back to the poster on error (including before hydration) | Keep. e2e: route one image to 404 and expect the poster SVG. |

---

## 9. Phasing (each batch keeps every gate green)

Gates per batch: `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Tests change only where the brief changes behaviour or anatomy; no assertion is weakened. Removed tests go with the component they test, and the PR says so.

### P0: hero, cards, responsiveness, CTA clarity

| Area | Files |
| --- | --- |
| Empty band | `components/home/HomeEventSections.tsx`, `GuideCard.tsx`, `CreatorsCard.tsx` (drop `data-reveal`) |
| Hero | `components/home/HomeHero.tsx`, `Home.tsx` (wrapper padding, no `upNext`, categories section after the event sections, before `CommunitySection`), delete `UpNext.tsx` and `FeaturedEventCard.tsx`, `HomeEventSections.tsx` (error, empty and retry focus moved in), `lib/home-sections.ts` (no `upNext` claim; `shownEventIds`), `CategoryRow.tsx` (grid + section head) |
| Cards | new `components/ui/EventCard.tsx`, new `lib/event-card.ts`; `git mv` `home/CardPrice.tsx` and `home/GoingStack.tsx` → `ui/`; delete `ui/EventTile.tsx` and `home/HomeEventCard.tsx`; call sites `EventResults.tsx`, `FeedLoading.tsx`, `organisers/OrganiserProfileView.tsx`, `members/MemberProfileView.tsx`, `home/HomeEventSections.tsx` (every section `rail`, the P0 Free & low-cost rail shows its badge in the category line), `home/CommunitySection.tsx`, `map/SceneMapEventCard.tsx`, `SceneEventRow.tsx` (imports only); `lib/quick-buy.ts` (external-free label), `QuickBuyLink.tsx` (`tone`); `home/HomeRail.tsx` (end spacer); `components/EventArt.tsx` (`fit`) |
| CTA clarity, event page | `components/EventDetailsView.tsx` (buy bar ended state, side safe areas, `fit="auto"`) |
| Overflow | delete `components/ui/Carousel.tsx`; `app/globals.css` (remove `body` `overflow-x: hidden`, last) |
| Tests | `tests/EventTile.test.tsx` + card parts of `tests/HomeEventCard.test.tsx` → `tests/EventCard.test.tsx` (name order, tab order, stretched link `data-card-link`, Save and CTA outside the link, every §6.2.3 row, "Ended", demo vs live going); `tests/SoldOutCards.test.tsx`, `tests/SavePlacements.test.tsx` (new component), `tests/quick-buy.test.ts` (external free), new `tests/event-card.test.ts` (helpers); `tests/HomeStatic.test.tsx`, `tests/Home.test.tsx`, `tests/HomeEventSections.test.tsx`, `tests/home-sections.test.ts` (new hero copy, one CTA, no Up next, categories section, error/empty in the first slot); delete `tests/Carousel.test.tsx` with `Carousel`; `tests/BrandDetails.test.tsx` (GoingStack path); `e2e/home.spec.ts` (h1 name "Find your new thing.", remove the Up next and "Find your people" link tests, rail Tab test targets the "Coming up" section, keep the overflow, dedupe and push-in tests, push-in at 1280 since the photo is `lg` only); new `e2e/responsive.spec.ts` (§8: overflow at 320–1280 on `/`, `/events` and an event page, no `.reveal-pending` on the home without scrolling, rail end gutter, buy bar settles below tickets) |

### P1: home restructure, Who's Going, event-detail booking UX

| Area | Files |
| --- | --- |
| Home order | `lib/home-sections.ts` (`popular` with the coming fallback; drop `comingUp`, `lowCost`), `HomeEventSections.tsx`, `SectionHead.tsx` (no strap), `Home.tsx` (remove `GuideCard`), `CommunitySection.tsx` (copy, steps), `CreatorsCard.tsx` (2:1 phones) |
| Who's Going | `components/WhosGoing.tsx` (preview + disclosure), new `components/whos-going/GoingFaces.tsx`, `WhosGoingSummaryLink.tsx` |
| Event details | `components/EventDetailsView.tsx` (directions, more from organiser, time zone label, Booking info, ended buy bar and panel), new `lib/maps.ts`, `lib/format.ts` (`formatTimeZoneLabel`), `components/waitlist/WaitlistBlock.tsx` (one sentence), `components/home/icons.tsx` (`ExternalIcon`, moved from `ExternalTicketLink.tsx`) |
| From the P0 screenshots | `components/ui/EventCard.tsx` (phone rail media square, `fit="auto"`; `badge` prop removed with Free & low-cost), `app/globals.css` (`display-md`, brought forward from P2), `app/events/page.tsx` (`GuideCard` at the end) |
| Tests | `tests/home-sections.test.ts`, `tests/HomeEventSections.test.tsx`, `tests/HomeStatic.test.tsx` (strap test → new head test), `tests/HomeFollowingRail.test.tsx`; `tests/WhosGoing.test.tsx` (collapsed by default, `aria-expanded`, list hidden until toggled, faces only with names, privacy: no faces signed-out); `tests/EventDetailsView.test.tsx`, `tests/EventDetailsExternal.test.tsx` (no directions duplication, no Booking info for external), new `tests/maps.test.ts`, new `tests/WhosGoingPreview.test.tsx` (preview, disclosure, privacy), `tests/format.test.ts` additions, `tests/WaitlistBlock.test.tsx` (explainer), `tests/EventCard.test.tsx` (rail media), `tests/DemoSocial.test.tsx`, `tests/Home.test.tsx`; `e2e/event-page.spec.ts` (P1 items at 375 and 1280; ended bar), `e2e/home.spec.ts` (order at 375 and 1280, no repeated heads, rail card fits one screen, Only in the city on /events), `e2e/demo.spec.ts` (opens the list first) |

### P2: type and spacing, footer, microinteractions (done, with the review fixes)

| Area | Files | Status |
| --- | --- | --- |
| Type | `app/globals.css` (`display-xl` deleted), `components/ui/BackLink.tsx` (Instrument; `backLinkClass` shared with `analytics/shared.tsx`, `admin/AdminSeatMap.tsx`), `EventDetailsView.tsx` (uses it), `ui/SectionHead.tsx` (balanced title, dots on line 1, baseline link) | Done |
| One section head | `git mv components/home/SectionHead.tsx components/ui/SectionHead.tsx`; `ui/Section.tsx` (`SectionHeader` deleted); `organisers/OrganiserProfileView.tsx`, `members/MemberProfileView.tsx`, `favourites/SavedPageContent.tsx`, `home/{CategoryRow,GuideCard,HomeEventSections}.tsx` | Done |
| Spacing | `EventDetailsView.tsx` (aside `gap-6`), `home/HomeRail.tsx` (4 columns at `lg`, end gutter) | Done |
| Footer | `components/Footer.tsx` | Done |
| Review fixes | `lib/quick-buy.ts`, `lib/event-card.ts`, `ui/EventCard.tsx`, `ui/CardPrice.tsx`, `QuickBuyLink.tsx` (doc), `whos-going/{GoingFaces,WhosGoingProvider}.tsx`, `WhosGoing.tsx`, `SearchBar.tsx`, `Nav.tsx`, `DemoNotice.tsx`, `seating/SeatedTicketsPanel.tsx`, `home/CommunitySection.tsx`, `app/signup/page.tsx`, `SceneEventRow.tsx` (shared place label, date separator) | Done |
| Map row | `SceneEventRow` → `EventCard variant="row"` | **Deferred.** It would move the map list onto the stretched-link card (its title link, Locate button and selection state change), with `tests/SceneMap*.test.tsx` and the discovery e2e to rework: not low-risk in a fix batch. The row now uses the shared `placeLabel` (no dangling "·") and the card's date separator. |
| Reveal elsewhere | owner choice (open question 4) | Not changed |
| Docs | header lines in `home.md` and `mobile-home.md`; `docs/design-system.md` components | Done |

### Owner feedback round (22 Oct 2026, after P2)

| Area | Files |
| --- | --- |
| Hero: search first, text link, compact demo label | `components/home/HomeHero.tsx`, `components/DemoNotice.tsx` (`compact`), `components/home/Home.tsx` |
| Categories under the hero | `components/home/Home.tsx`, `CategoryRow.tsx` (doc only; the tiles are unchanged) |
| Cards: type, room, aligned feet | `components/ui/EventCard.tsx` |
| Carousels | `components/home/HomeRail.tsx` (`overflow-y-hidden`) |
| Event page room | `components/EventDetailsView.tsx` |
| Social copy | `components/home/CommunitySection.tsx` |
| Footer, install offer | `components/Footer.tsx`, `components/pwa/InstallPrompt.tsx` |
| Tests | `tests/EventCard.test.tsx` (foot, placeholders, sizes), `tests/HomeStatic.test.tsx` (hero action, demo label, social copy), `tests/Home.test.tsx` (order, categories before This weekend, no orange outside cards), `tests/InstallPrompt.test.tsx` (text buttons, iOS "Show me how"), `tests/brand-components.test.tsx` (compact footer, install line placement); `e2e/home.spec.ts` (order, band copy), `e2e/responsive.spec.ts` (hero action, rails at 320–430, first screen at 390×844) |

Hand-offs: `ux-accessibility-reviewer` after P0 and P1 (the card's stretched link and the Who's Going disclosure), then `visual-qa` at every width in §8 after each batch.

---

## 10. Dependencies, out of scope, proposals

### 10.1 Backend data that doesn't exist (don't fake it in the UI)

- **D1. List-level going.** `PublicEvent` has no `goingCount` (only trending items do), so live cards outside Popular show no going row. A future additive field must apply the same threshold and `closed` rules.
- **D2. Card avatars (live).** None for anyone on list payloads. It would need a privacy design (verified viewers only, visible profiles only) before any build.
- **D3. Image metadata.** `imageKind` (photo or poster) or a focal point (`imageFocalX/Y`), plus resized variants. Until then: `fit="auto"` on the event page, centre cover elsewhere.
- **D4. "Interested", mutuals, shared interests.** No data. Not shown.
- **D5. Waitlist open flag.** Cards infer "sold out and not ended". An explicit per-event flag would let cards drop "Join waitlist" when an organiser closes it early.
- **D6. Checkout on ended events.** Confirm the checkout handler refuses an ended event; the UI change in §10.3 shouldn't be the only guard.

### 10.2 Out of scope

New routes (no Explore/city guide), new social features, search behaviour, the map beyond the P2 row, dashboard/admin, the seat page, emails, the Bootzy swap, and the landing page (not in this repo).

### 10.3 Behaviour changes (accepted by the manager, 22 Oct 2026)

1. **Up next removed from the home** (with its live summary request). Its event flows into This weekend / Popular. The brief's section order has no Up next, and it carried a second orange CTA in the hero.
2. **Ended event page:** no "Buy tickets" in the buy bar and "This event has ended." in place of the selector (today the bar offers "Buy tickets" and the selector stays active).
3. **"Join waitlist" outline, not orange,** on cards (owner decision 6 made it orange; the brief asks for CTA clarity).
4. **External-free card label** "Get free tickets" (was "Buy tickets").
5. **Free & low-cost and the Guide removed from the home; Trending and Coming up merged.**
6. **The hero loses "Find your people" and the category row** (the categories become section 4).
7. **(P2, A7)** An ended event page has **no buy bar** (P1's "This event has ended." bar and its sold-out "See tickets" are gone).
8. **(P2, A9)** A paid external event's card says **"Get tickets"** (was "Buy tickets").
9. **(P2, V4)** The demo closes Who's Going once a sample event has ended, as live does.
10. **(P2, A6)** Booking info's refunds row shows only where a paid purchase is possible; the age restriction is no longer repeated there (V5).
11. **(P2, V16)** No header search field on the home at `lg`+ (the hero's is there).

### 10.4 Open questions for the owner

1. ~~Campaign line~~: decided, the footer.
2. ~~"Only in the city"~~: decided, the end of /events.
3. ~~"Get free tickets"~~: decided, kept (plural).
4. Scroll-reveal on /events, organiser and content pages: keep it (owner request of 21 Oct) or remove it site-wide, as on the home?
5. A brand hero photograph with usage rights, to replace the sample `vintage-market-stall.jpg` in the desktop hero.
