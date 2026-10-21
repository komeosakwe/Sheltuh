# Home page (all widths) design spec

Status: proposed · Owner: ui-design-director · Scope: `/` from 320px up.

> **Visual layer updated 21 Oct 2026 for `docs/design/brand-direction-one.md` (Brand Direction One).** The tokens, type, radii, colours and motion in §1.4, §2, §4, §5 and §8 below follow that spec, and it wins on any visual conflict. Structure, order, de-duplication (§6), the weekend window, Trending, external-ticketing cards, accessibility (§7, plus quick buy) and owner decisions 2–6 are unchanged. Decision 1 (soft cards with pink accents) is superseded: pink is replaced by Signal Orange, and cards follow the brand's rounded-square, image-first card.

This replaces the split home: `PhoneHome` below `sm` plus the desktop tree (`IntentHero`, `EventPreview`, `WhatElse`, `PartnerBand`) from `sm`. One tree generalises the phone home: rails below `sm`, grids from `sm`, and "Up next" inside the hero from `lg`. It builds on `docs/design/mobile-home.md`. Below 640px nothing changes except what this spec says.

**Code read:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/home/phone/*`, `IntentHero`, `EventPreview`, `HomeSections`, `EventResults`, `EventArt`, `DemoNotice`, `ui/{EventTile,Carousel,Section}`, `lib/{home-sections,home-events,types,pricing,format,scene-map-filters}.ts`, `lib/api/public-events.ts`, `lib/server/handlers/public-events.ts`, `lib/server/pagination.ts`, `tests/{phone-home-tokens,PhoneHome,PhoneEventSections}.test.*`, `docs/FEATURE_PLAN.md`, `docs/design-system.md`, `docs/design/mobile.md`, `docs/design/mobile-home.md`.

**Facts that shape this spec:**
- **`upcoming=1` exists on the server** (`ends_at > now()`), but `lib/home-events.ts` doesn't send it. It pages 3×10 with no `limit`, although the server default is 20 (max 50).
- **B2 and B4 aren't built.** `PublicEvent` and `SheltuhEvent` have no `ticketingMode`, and there's no `/api/events/trending`. The contracts this spec assumes are in §9.
- **"Up next" can be stale.** It is `upcoming[0]` sorted by `startsAt`, so an exhibition that opened weeks ago and is still running wins it.
- **Two trees today.** Both are always in the DOM (one `display:none`), sharing one request set.
- **`.ken-burns` and `.rise`/`.reveal` already sit inside `@media (prefers-reduced-motion: no-preference)`** in `globals.css`, so the push-in is already static under reduce. This spec keeps that and restricts where `motion` is used.
- **`useIsPhone` is also imported by `components/analytics/TimeSeriesChart.tsx`.**

## 1. Principles

1. **One page, one outline.** A single DOM serves every width, so the h1, landmarks and focus order are identical everywhere. The layout changes; the content doesn't.
2. **Each event appears once.** Sections claim events in a fixed priority order (§6.2). A later section never repeats one an earlier section showed, so the page reads as a guide, not a feed sliced several ways.
3. **Time first, then signal, then breadth.** The answer to "what's on soon" comes before "what's popular", which comes before "everything else". This follows the research: 93% of people find events too late.
4. **One brand language at every width** (`brand-direction-one.md`). Cards are image-first, with rounded-square media (`rounded-card` 12px), no container and no shadow. Section heads use the rule-and-strap structure. Orange is used once per view for the conversion CTA and once on the page as a band. Scale contrast does the editorial work: a 54–96px display h1 against 14–16px Instrument Sans and 12px Plex Mono metadata.
5. **Prices are honest or absent.** Sheltüh-ticketed events show the all-inclusive price (`formatFeedPriceParts`, total first). External events show where tickets are sold, never a price we can't vouch for.
6. **Nothing moves on its own except the photo push-in.** It runs one cycle of 5 seconds or less, holds its end frame, and is off under reduced motion. No drift, no marquee and no autoplay rails on the home.

## 2. Tokens

**`app/globals.css`:** per `brand-direction-one.md` §2. The home uses no home-only tokens any more. `rounded-card`, `bg-card` and the brand colours are site-wide, `shadow-card` is flat (then deleted), and `pop` is an alias of `signal` (then deleted).

**Scope gate:** `tests/phone-home-tokens.test.ts` is folded into `tests/brand-tokens.test.ts` (`brand-direction-one.md` §9, increment 5). That test asserts `bg-pop`, `text-pop`, `highlight` and `shadow-card` appear nowhere, and that `text-signal` never sits in a className with small-text classes. This replaces the old scope test because the classes are now site-wide by design. It doesn't weaken the gate.

**Contrast** (full table in `brand-direction-one.md` §2.2):

| Pair | Ratio | Use |
| --- | --- | --- |
| Black / Cream `#fffae7` | 20.08:1 | Page text |
| Black / White `#ffffff` | 21:1 | Info cards (Guide), fields |
| `muted` `#6b675e` / Cream | 5.39:1 | Card venue, section notes |
| Black / Signal `#ff4800` | 6.18:1 | Hero CTA label, "Up next" and "Free" badges, the Community band text |
| Cream / Black | 20.08:1 | Featured card text on the scrim (≥85% black), Creators card, Trending chip |
| Signal / Cream | 3.25:1 | **Non-text only**: strap dots. Never text. |

**Type.** Faces and utilities are as in `brand-direction-one.md` §3: Instrument Sans (`font-sans`, `font-heading`), Plex Mono (`eyebrow`, `meta`), and the display token (`font-display`; Bootzy when licensed). Sizes are given as base / `sm:` / `md:` / `lg:`. A blank cell inherits the cell to its left.

| Role | Base (<640) | sm 640 | md 768 | lg 1024 | LH | Tracking | Case | Wt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero strap | `eyebrow` (Plex Mono) 12px | | | | 16px | 0.04em | upper | 500 |
| Hero h1 (`display-xl`, display token) | `text-[clamp(2rem,10vw,2.625rem)]` | `sm:text-[clamp(3.375rem,8.5vw,6rem)]` (54@640, 65@768) | | (87@1024, 96@≥1130) | 0.88 | display token (-0.045em fallback) | upper | display token (700 fallback) |
| Hero intro | 16px | `sm:text-lg` 18px | | | 24 / `sm:leading-7` 28 | 0 | sentence | 400 |
| Section strap | `eyebrow` 12px | | | | 16px | 0.04em | upper | 500 |
| Section h2 (`display-md`) | 24px | 28px | | 32px | 26 / 30 / 34 | -0.03em | upper | 700 |
| Featured title (h3) | `clamp(1.75rem,8vw,2rem)` | `sm:text-[2rem]` | `md:text-[2.5rem]` | `lg:text-[2.25rem]` | 0.95 | -0.025em | upper | 700 |
| Featured meta | 14px | `sm:text-base` | | | 20 / `sm:leading-6` | 0 | sentence | 400 (price 600) |
| Card date (`meta`, Plex Mono) | 12px | | | | 16px | 0.02em | upper | 400 |
| Card title, standard/compact | 14px | `sm:text-base` | | | 20 / `sm:leading-[1.375rem]` | -0.01em | sentence | 600 |
| Card title, wide | 16px | | | | 22px | -0.01em | sentence | 600 |
| Card venue and price | 12px | `sm:text-sm` | | | 16 / `sm:leading-5` | 0 | sentence | 400 / price amount 600 |
| Wide-card description | 14px muted | | | | 20px | 0 | sentence | 400 |
| Chips and badges | `eyebrow` 12px | | | | 16px | 0.04em | upper | 500 |
| See all, quick buy | 14px | | | | 20px | 0 | sentence | 600 |
| Guide/creators title | 24px (`display-md`) | 28px | | | 26 / 30 | -0.03em | upper | 700 |
| Community line (`display-lg font-display`) | `display-lg` | | | | 0.9 | display token | upper | display token |
| Community body | 16px | `sm:text-lg` | | | 24 / 28 | 0 | sentence | 400 |

**Hero h1 acceptance:**
- Copy is pending owner question 1 in `brand-direction-one.md`.
- If the brand line is approved, the h1 is "WHERE / IS ÜR / SHELTÜH?": exactly 3 lines at 320, 375, 430, 640, 768, 1024 and 1280, and "SHELTÜH?" never breaks.
- If it isn't approved, keep "Find your room. Find your people.", where "Find your" sets on one line and the h1 is exactly 4 lines at those widths.
- If a line overflows the 7-column hero at 1024, lower the `sm:` clamp maximum to `5.5rem`.
- Re-run this acceptance when Bootzy is swapped in.

**Spacing.** Steps are 4, 8, 12, 16, 20, 24, 32, 48 and 64 only.

| Use | Base | sm | lg |
| --- | --- | --- | --- |
| Gutter | 20 (`px-5`) | 32 (`sm:px-8`) | 32 |
| Page top / bottom | `pt-6` / `pb-12` | `sm:pt-12` / `sm:pb-16` | |
| Between sections, including hero → first section | 32 (`mt-8`) | 48 (`sm:mt-12`) | 64 (`lg:mt-16`) |
| Section strap → h2 | 12 (`mt-3`) | | |
| Section head → content | 12 (`mb-3`) | 24 (`sm:mb-6`) | |
| Rail gap / grid gap | 12 (`gap-3`) | `sm:gap-x-6 sm:gap-y-8` (24/32) | |
| Card media → text | 12 (`gap-3`) | | |
| Hero: strap → h1 | `mb-3` | `sm:mb-4` | |
| Hero: h1 → intro → CTAs | `mt-4`, `mt-5` | `sm:mt-6`, `sm:mt-8` | |
| Hero: CTAs → search → categories → demo note | `mt-6` each | search `sm:mt-8` | |
| Hero: → Up next | `mt-6` | `sm:mt-8` | `lg:mt-0` (own column) |

**Radii and elevation** (`brand-direction-one.md` §2.4):
- `rounded-card` (12px): card media, featured card, Guide, Creators and the hero photo cell.
- `rounded-control` (8px): compact thumbs, search, buttons.
- `rounded-badge` (4px): chips and badges.
- `rounded-dot`: avatars and category discs.
- **No shadows.** The Guide card is White with `border border-foreground`.
- Placeholders, error and empty boxes are `rounded-card bg-surface`.

**Motion:** see §8.

## 3. Grid and layout

- **Container:** `mx-auto max-w-6xl px-5 sm:px-8`. Content width is 280 / 335 / 390 at 320 / 375 / 430; 576 @640; 704 @768; 960 @1024; and 1088 at ≥1152.
- **Breakpoints:** Tailwind defaults (sm 640, md 768, lg 1024).
- **Rails (<sm):** unchanged from the phone home. They bleed to the screen edges with `-mx-5 px-5 scroll-px-5` and snap.

**Grids (sm+):** the same `ul` becomes a grid.

| Section | Card | sm | md | lg |
| --- | --- | --- | --- | --- |
| This weekend | wide | 2 cols | 3 cols | 3 cols |
| Trending | standard | 2 | 3 | 3 |
| Coming up near you | standard | 2 | 3 | 3 |
| Free & low-cost | compact | 2 | 2 | 3 |

Caps are 6 per section, so grids fill 3×2 or 2×3. A short last row is allowed: don't pad it, and don't stretch cards to fill it.

**Hero (`lg`):** `section.lg:grid.lg:grid-cols-12.lg:gap-x-8.lg:items-start`.
- **Left column, `lg:col-span-7`:** strap, h1, intro, CTAs, search, categories, demo note.
- **Right column, `lg:col-span-5 lg:col-start-8 lg:pt-7`:** the Up next section. The 28px top padding aligns the card's top with the h1.
- **Card size:** 381×476 at 1024 and 435×544 at 1280.
- **Below lg:** Up next follows the demo note in the single column.

**Order** (DOM order is the same as visual order at every width; the § refers to §5):

| # | Section | Hidden when |
| --- | --- | --- |
| 1 | Hero (§5.2), containing Search, Categories (§5.3), Demo note and Up next (§5.5) | — |
| 2 | This weekend (§5.6) | §6.3 |
| 3 | Trending (§5.6) | Fewer than 3 after de-duplication |
| 4 | Coming up near you (§5.6) | Fewer than 2 |
| 5 | Only in the city: `GuideCard` (§5.8) | — |
| 6 | Free & low-cost (§5.6) | Fewer than 2 |
| 7 | Find your people (§5.8): the page's one orange band | — |
| 8 | Bring your event to life (§5.8) | — |

**Why this order:**
- This weekend comes right after the hero because "what's on soon" is the core job.
- Trending follows as the social signal: 87% of people skipped events because they didn't know anyone going.
- Coming up is the broad, chronological catch-all.
- The guide breaks up the run of card sections (as on phones today).
- Free & low-cost is a different axis (price) and comes last among events.

**Removed from `/`:**
- **`IntentHero`:** the intent pills, the collage and the unpausable marquee.
- **`EventPreview`:** a second listing of the same events, plus the drifting `Carousel`.
- **`WhatElse`:** it already wasn't on phones, and its promises live in the Creators copy and on the event page.
- **`PartnerBand`:** it duplicates Creators. `/partners` stays in the Footer.
- **"What's on this month":** a third chronological list once This weekend and Coming up exist.

These are owner questions; see the end of this spec.

## 4. Imagery

| Slot | <sm | sm | md | lg | Source / fallback |
| --- | --- | --- | --- | --- | --- |
| Hero photo cell | Stretches to the h1's height (98×115 to 155×151) | `sm:grid-cols-[auto_minmax(10rem,1fr)]`, ≈264×194 @640 | ≈460×313 @1023 | `lg:hidden` | `HOME_HERO` / poster |
| Featured | 4:5 (<375), 1:1 (≥375) | `sm:aspect-[3/2]` (576×384) | `md:aspect-video` (704×396) | `lg:aspect-[4/5]` (381×476 to 435×544) | `event.imageUrl` / `EventArt` |
| Standard | 4:3, 198–240 wide | 4:3, 276×207 | 4:3, 219×164 | 4:3, 304×228 to 346×260 | same |
| Wide | 3:2, 256–320 wide | 3:2, 276×184 | 3:2, 219×146 | 3:2, 304×203 to 346×231 | same |
| Compact thumb | 96px square (`rounded-control`) | `sm:grid-cols-[7rem_1fr]` (112px) | | | same |
| Guide, Creators | 16:9 | Half of a 2-col split, `sm:aspect-auto sm:h-full sm:min-h-64` | | | `HOME_GUIDE`/`HOME_CREATORS` |

**Text budget on the featured card:** about 233px from sm up, with title, meta and going on 24px lines. That's 61% of the height @640, 59% @768 and ≤49% at lg, so it stays inside the scrim zone, where black is at least 85% opaque.
- From sm, text stays inside `max-w-[36rem]`.
- No other slot puts text on an image. Chips and badges use opaque fills.
- The scrim is the only gradient on the site. It's functional, not decorative.

**Other rules:**
- **Crop:** centre crop, `object-cover`. A focal point needs backend work (§9).
- **Photography:** follow `brand-direction-one.md` §8.1: candid Melbourne nights, no stock, no filters.
- **Fallback:** every slot is an `EventArt` with a fixed ratio, so a missing or failing photo shows the generated poster in brand colourways (`brand-direction-one.md` §8.2), with no layout shift.
- **`priority`** (eager, high fetch priority) goes only on the featured card's `EventArt`. It sits above the fold at lg and is partly visible on phones. `HOME_HERO` keeps `priority` (it's the phone LCP image). At lg it's `display:none`, and its eager download is an accepted cost.
- **Accessibility:** all art is `aria-hidden`, and titles are always real text.

## 5. Components

Visual anatomy for every card is `brand-direction-one.md` §6.5. This section keeps the home-specific structure and data rules.

### Files

`components/home/phone/*` moves to `components/home/` (with `git mv`). The new names are below, and test imports must be updated.

| Action | File |
| --- | --- |
| **Reuse unchanged** | `EventArt`, `favourites/SaveButton`, `CategoryIcon`, `icons`, `going.ts`, `home-content.ts`, `SearchBar`, `DemoNotice`, `ui/Button`, `ui/Section` (`Notice`), `Nav`, `Footer` |
| **Change** | `app/page.tsx`, `PhoneHome` → `Home`, `PhoneHero` → `HomeHero`, `CategoryRow`, `PhoneRail` → `HomeRail`, `SectionHead`, `HomeEventCard`, `FeaturedEventCard`, `GoingStack` (rounded-dot avatars, brand fills), `PhoneEventSections` → `HomeEventSections`, `GuideCard`, `CommunitySection`, `CreatorsCard`, `lib/home-sections.ts`, `lib/home-events.ts`, `lib/api/public-events.ts` (additive `limit?: number`), `lib/pricing.ts` (additive `formatCardPrice`) |
| **New (minimal)** | `components/home/HomeEventsProvider.tsx` (context: load, compute, retry); `components/home/UpNext.tsx` (consumer for the hero slot); `lib/api/trending.ts`; `lib/external-ticketing.ts` (`ticketProviderName`, unless B2 ships one, in which case reuse it) |
| **Move** | `useIsPhone.ts` → `components/ui/useIsPhone.ts`, updating `TimeSeriesChart` |
| **Delete** (no other usages) | `IntentHero.tsx`, `EventPreview.tsx`, `HomeSections.tsx`, and their own tests (`IntentHero`, `EventPreview`, `WhatElse`). These tests are removed with the components they test, not to make anything pass. The `Scribble` is removed from the hero, so delete it from `ui/Sticker.tsx` if nothing else uses it. |

### 5.1 `app/page.tsx` and `Home.tsx`

`page.tsx` renders `<Home />` only, with no `sm:hidden` and no hidden desktop tree.

`Home` is a server component:

```tsx
<HomeEventsProvider>
  <div className="mx-auto max-w-6xl px-5 pt-6 pb-12 sm:px-8 sm:pt-12 sm:pb-16">
    <HomeHero upNext={<UpNext />} />
    <HomeEventSections guide={<GuideCard className="reveal mt-8 sm:mt-12 lg:mt-16" />} />
  </div>
  {/* Full-bleed orange band: outside the container. */}
  <CommunitySection className="mt-8 sm:mt-12 lg:mt-16" />
  <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
    <CreatorsCard className="reveal mt-8 sm:mt-12 lg:mt-16" />
  </div>
</HomeEventsProvider>
```

### 5.2 `HomeHero.tsx` (server)

Props: `{ upNext: ReactNode }`. Markup: `section[aria-labelledby=home-title]` with the lg grid from §3.

- **Left column** (`lg:col-span-7`), in this order:
  - **Strap:** `eyebrow text-muted` with `DotsMark xs` (orange), reading "Melbourne · What's on".
  - **Headline row:** `grid grid-cols-[auto_minmax(5.5rem,1fr)] sm:grid-cols-[auto_minmax(10rem,1fr)] lg:grid-cols-1 items-stretch gap-x-3 sm:gap-x-6`.
    - The h1 is `display-xl` with one `span.block` per line (§2 acceptance). The "ÜR" uses the `brand-direction-one.md` §3.3 pattern, so it's read as "your". **Remove `.rise` from the h1**, because it's the LCP element on every width.
    - The photo cell: `EventArt … priority motion className="h-full w-full rounded-card"`, with `lg:hidden`. **No `Scribble`.**
  - **Intro:** "Live music, art, workshops and pop-ups in Melbourne, curated, with the people going." Classes `mt-4 sm:mt-6 max-w-[34ch] sm:max-w-[40ch] text-base sm:text-lg`.
  - **CTAs:** `mt-5 sm:mt-8 flex flex-col gap-2 sm:flex-row sm:gap-3`.
    - "Explore events" → `/events` is `ButtonLink variant="signal" size="lg"`. This is the page's one orange CTA above the fold.
    - "Join the community" → `#find-your-people` is `variant="outline" size="lg"`.
    - Both are `w-full sm:w-auto`.
  - **Search:** `mt-6 sm:mt-8 sm:max-w-xl`, `<SearchBar size="lg" submit label="Search events" />`. The submit is black (`brand-direction-one.md` §6.2).
  - **Categories:** `<CategoryRow className="mt-6" />`. Discs are `size-12 rounded-dot border border-foreground bg-card`.
  - **Demo note** (demo only): `mt-6`, `<DemoNotice>Sample listings, nothing here is a real booking.</DemoNotice>`. It moves here from the event sections so its DOM position is fixed.
- **Right column:** `{upNext}` wrapped in `div.mt-6.sm:mt-8.lg:mt-0.lg:col-span-5.lg:col-start-8.lg:pt-7`.
- **`.rise`** stays on the strap, photo, intro, CTAs, search and categories with their existing `--d` delays. It is never on the Up next card.

### 5.3 `CategoryRow.tsx`

- **Below sm:** unchanged layout.
- **From sm:** the `ul` adds `sm:mx-0 sm:px-0 sm:overflow-visible sm:snap-none sm:gap-3`. Six 72px items plus five 12px gaps is 492px, which fits 576 without scrolling.
- **States:** hover `bg-surface`; focus uses the global ring; press `motion-safe:active:scale-95`.

### 5.4 `HomeRail.tsx` (was `PhoneRail`)

Props: `{ labelledBy: string; grid: "cards" | "compact"; children }`.

- **Base classes:** unchanged from `PhoneRail`.
- **Added classes:** `sm:mx-0 sm:my-0 sm:grid sm:gap-x-6 sm:gap-y-8 sm:overflow-visible sm:px-0 sm:py-0 sm:snap-none`, plus:
  - `cards`: `sm:grid-cols-2 md:grid-cols-3`
  - `compact`: `sm:grid-cols-2 lg:grid-cols-3`
- **`HomeRailItem`:** `li.flex.shrink-0.snap-start`, unchanged. It is a grid cell from sm.
- **No JS.**

### 5.5 Up next: `UpNext.tsx` and `FeaturedEventCard.tsx`

`UpNext` (client) reads the provider and renders `section[aria-labelledby=home-next]` with `h2#home-next.sr-only` "Up next". It then shows one of the states below.

All states share one box: `aspect-[4/5] min-[375px]:aspect-square sm:aspect-[3/2] md:aspect-video lg:aspect-[4/5] rounded-card`.

| State | Render |
| --- | --- |
| Loading | `FeaturedEventCardPlaceholder`: the box in `bg-surface`, `aria-hidden` |
| Ready | `FeaturedEventCard`, followed by its quick-buy row (`brand-direction-one.md` §6.6), outside the card |
| Error | The box in `bg-surface flex flex-col justify-end p-5 sm:p-8`, containing `Notice tone="danger" role="alert"` "Couldn't load events." then `Button variant="outline" size="lg" className="mt-3 self-start"` "Try again" (calls the provider's `retry`). The box keeps the hero's height, so there's no layout shift. |
| Empty (no upcoming events) | The same box in `bg-surface p-5 sm:p-8 flex flex-col justify-end`, containing `DotsMark lg` then `p.mt-6.text-base.leading-6` "No events have been published yet. Check back soon." (existing copy) |

**`FeaturedEventCard` changes:**
- **Aspect:** the box classes above, replacing `aspect-[4/5] min-[375px]:aspect-square`.
- **Visuals:** per `brand-direction-one.md` §6.5 `featured`:
  - The text block is in `data-surface="ink"`.
  - The "Up next" badge is `eyebrow rounded-badge bg-signal text-black px-2 py-1` with `DotsMark xs`, replacing `bg-pop rounded-full`.
  - The title is `font-heading` uppercase.
  - The arrow is `size-11 rounded-control bg-cream text-black`.
- **Text:** the content block adds `sm:p-8 sm:pr-20 sm:max-w-[36rem]`. The title gets the §2 sizes. The meta gets `sm:text-base sm:leading-6`.
- **`EventArt`:** add `priority`. Keep `motion` (§8).
- **External events** (`event.ticketingMode === "external"`):
  - The price line reads `formatCardPrice(event)` (§5.7).
  - No `GoingStack`, and `useLiveGoingCount` is called with `enabled = mode === "live" && !external`, so no request is made.
- **States:** hover, focus and active as today. The arrow is at `bottom-5 right-5`, and `sm:bottom-8 sm:right-8`.

### 5.6 `HomeEventSections.tsx` (was `PhoneEventSections`)

- **Data:** reads the provider. There's no data loading here and no `useIsPhone` gating: cards render at every width.
- **Sections:** each is `section[aria-labelledby]` with `SectionHead` + `HomeRail`, plus `reveal` and `mt-8 sm:mt-12 lg:mt-16`.

| id | h2 | Note (strap, right) | See all | Card | Rail `grid` |
| --- | --- | --- | --- | --- | --- |
| `home-weekend` | "This weekend" | Mon to Fri before 17:00: "Fri 23 – Sun 25 Oct" (`formatWeekendRange`, §6.3). During the weekend: "Until Sun 25 Oct" | `/events`, srLabel "events" | `wide` | `cards` |
| `home-trending` | "Trending" | — | none (no trending page) | `standard` with `signal` | `cards` |
| `home-coming` | "Coming up near you" (copy kept) | `hidden sm:block`: "The most interesting live music, art, workshops and pop-ups in your city — curated, not scraped." (copy kept from the desktop home; below the h2 as 14/20 muted, since it's too long for the strap) | `/events`, "events" | `standard` | `cards` |
| `home-free` | "Free & low-cost" | — | `/events?pricing=free`, "free events" | `compact` with `badge` | `compact` |

**Loading:**
- An always-mounted `p[role=status].sr-only` reads "Loading events…".
- Below the hero there's one skeleton section, `aria-hidden`:
  - A strap rule, then a `h-7 w-48 sm:h-8 bg-surface mt-3 mb-3 sm:mb-6` heading bar.
  - Then a `HomeRail`-shaped `div` holding 3 `HomeEventCardPlaceholder`s; the third is `hidden md:block`.
  - Placeholders get `sm:w-full sm:max-w-none`.
- No shimmer.
- The guide, community and creators sections render immediately below it.

**Error:** event sections are hidden; static sections still render. The alert lives in Up next (§5.5).

**Ready:** render per §6. Hidden sections render nothing; they don't reserve space.

**`SectionHead.tsx`** (`brand-direction-one.md` §6.4):
- Add `note?: { text: string; className?: string }`.
- Markup: the strap (`border-t border-foreground pt-2 eyebrow flex justify-between`: `DotsMark xs` + the h2's text in short form on the left, the note on the right in `text-muted`), then `mt-3` a row `flex items-end justify-between gap-4 mb-3 sm:mb-6` with the h2 (`display-md`) and See all.
- The strap label is `aria-hidden`, because the h2 already says it.
- See all: Instrument 600 14/20, underlined, a 16px → arrow, `min-h-11`.

### 5.7 `HomeEventCard.tsx`

**Anatomy:** image-first with no container (`brand-direction-one.md` §6.5).
- Drop `rounded-card bg-card shadow-card` from the link.
- `rounded-card overflow-hidden` goes on the media wrapper (`rounded-control` for compact).
- Text sits on the page under the media: `meta` date (black), title, venue (muted), price amount 600 + "incl. booking fee" 400 muted (`formatFeedPriceParts`), then `GoingStack`.
- The wide card's date badge is `rounded-badge bg-cream`. Category chips are `eyebrow rounded-badge bg-cream`.

**Widths:** each wrapper adds `sm:w-full sm:max-w-none`, so it is fluid in the grid:
- standard: `w-[62vw] max-w-60`
- wide: `w-[80vw] max-w-80`
- compact: `w-[78vw] max-w-75`

**Type:** the §2 sizes. Standard and compact titles get `sm:text-base sm:leading-[1.375rem]`; meta and price lines get `sm:text-sm sm:leading-5`. Compact columns become `grid-cols-[6rem_1fr] sm:grid-cols-[7rem_1fr]`.

**Badges** (compact): "Free" `bg-signal text-black`; "Under A$20" `border border-foreground bg-card`. Both `eyebrow rounded-badge px-2 py-0.5`.

**Quick buy (new):** a "Get tickets" sibling link under each card's main link, per `brand-direction-one.md` §6.6: labels by event state, `/events/{slug}#tickets`, 44px hit area, never orange. For compact, it's indented to the text column.

**New prop `signal?: TrendingSignal`** (Trending only), where `TrendingSignal = { kind: "going"; count: number } | { kind: "just-announced" } | { kind: "popular" }`.
- It replaces the category chip at `left-2 top-2` with `eyebrow absolute rounded-badge bg-foreground px-2 py-0.5 text-background`.
- The chip text is "{count} going", "Just announced" or "Popular this week".
- There are never raw view counts and never a number other than the server's thresholded going count.
- Trending cards don't render `GoingStack`, because the chip already carries it.

**External variant** (`ticketingMode === "external"`):
- The price line is `formatCardPrice(event)`:
  - External, free: "Free · Tickets on {provider}"
  - External, not free: "Tickets on {provider}"
  - Otherwise: `formatFeedPrice(event)`
- The line keeps the price style (600 weight).
- No `GoingStack`, and no "{N} going" chip: B2 has no Who's Going for these events. If the trending API labels one "going", show "Popular this week" instead.
- The card still links to `/events/{slug}`, and so does its quick-buy row. The outbound link and its click beacon live only on the event page, so there's no external-link icon on the card.
- `{provider}` comes from `ticketProviderName(url)`:
  - Known hosts: humanitix.com → Humanitix, eventbrite.com and eventbrite.com.au → Eventbrite, trybooking.com → TryBooking, moshtix.com.au → Moshtix, oztix.com.au → Oztix, ticketek.com.au → Ticketek, ticketmaster.com.au → Ticketmaster, dice.fm → DICE.
  - Anything else: "Tickets on the organiser's site" (owner decision 4).
  - The same helper drives the event page's "Get tickets on {provider}" (B2).

**Sold out** (when the B-WL data exists): the price line reads "Sold out" and the quick buy reads "Join waitlist" (`brand-direction-one.md` §6.5, §6.11).

**States:**
- **Hover:** the media scales 1.03 and the title underlines (hover-capable devices only).
- **Focus-visible:** the global ring on the main link. Rails keep `py-4`, and the grid doesn't clip.
- **Active:** `motion-safe:active:scale-[0.98]`.
- There's no disabled state.
- **Loading:** `HomeEventCardPlaceholder`: `rounded-card bg-surface` media at the card's ratio, plus three `bg-surface` text bars.

### 5.8 Static sections

**`GuideCard`:**
- A white info card: `rounded-card border border-foreground bg-card overflow-hidden`.
- From sm the card is `sm:grid sm:grid-cols-2`.
- Art: `aspect-video sm:aspect-auto sm:h-full sm:min-h-64`.
- Body: `p-4 sm:p-8 sm:self-center`, with the title at the §2 sizes.

**`CreatorsCard`:**
- `rounded-card overflow-hidden` with `data-surface="ink"`.
- Same split as the guide, but mirrored: the art gets `sm:order-last`.
- Body: `p-5 sm:p-8 sm:self-center`.
- The CTA is `btn-outline` (it inverts inside the ink scope).

**`CommunitySection`** (the page's one orange band):
- `section` with `data-surface="signal"`, **full-bleed** (outside the container, §5.1), and inner `mx-auto max-w-6xl px-5 sm:px-8 py-12 sm:py-16`.
- From sm: `sm:grid sm:grid-cols-2 sm:gap-x-8 sm:items-end`.
- Left column: the h2 (`display-lg`, plus `font-display` if owner Q1 approves brand lines) + `GoingStack lg`.
  - The avatars are `rounded-dot`, with fills cycling black/cream, cream/black and white/black, and `ring-4 ring-background` (orange).
- Right column: body (black on orange, 6.18:1) + CTA.
- The CTA is `btn-solid` (black, cream label), `w-full sm:w-auto`. **Never `btn-signal` here.**
- `id`, `tabIndex=-1` and the copy are unchanged.

### 5.9 `HomeEventsProvider.tsx` (client, new)

- **Context value:** `{ mode: "demo" | "live"; state: Loading | Error | Ready(HomeSections); retry() }`.
- **On mount** it runs:

  ```ts
  Promise.all([loadHomeEvents(now), loadHomeTrending(now).catch(() => [])])
  ```

  then `selectHomeSections(events, trending, now)`, where `now` is `new Date()` captured once per load.
- **Failures:** if the events load fails, the state is Error. If trending fails, the page proceeds with no Trending section; this is never an error.
- **Retry:** re-runs both loads.

## 6. Data rules

### 6.1 Loading (`lib/home-events.ts`)

**Live:**
- Make one request, `listPublicEvents({ upcoming: true, limit: 40 })`.
- **Weekend top-up:** if the page has a `nextCursor` and the last item's `startsAt` is before `weekendWindow(now).end`, make one more request, `listPublicEvents({ upcoming: true, onOrAfter: <Melbourne date key of window.start>, limit: 20 })`. Merge the results by `id`.
- That's at most 2 requests, plus 1 for trending and 1 for the featured going summary.

**Demo:** `getEvents()`, sorted soonest first.

**Past events:** the API returns only events that haven't ended. The client still drops events where `Date.parse(endsAt ?? startsAt) <= now`. This covers demo data, which includes past events, and long-open tabs.

**`loadHomeTrending(now)`:**
- **Live:** `getTrendingEvents()` from `lib/api/trending.ts`, adapted with `adaptPublicEvent`, keeping the server's order.
- **Demo:** upcoming sample events sorted by `getSampleGoing(id).count`, highest first (ties: soonest first), top 12, each with signal `{ kind: "going", count }`. It's deterministic and needs no API.

### 6.2 De-duplication: `selectHomeSections(events, trending, now)`

"Not started" means `startsAt > now`. Sections claim events in this order, and the result is a `Set<id>` of everything shown:

| Priority | Section | Pool and rule | Cap | Show when |
| --- | --- | --- | --- | --- |
| 1 | Up next | Soonest not-started event. If there is none, the soonest in progress. | 1 | ≥1 |
| 2 | This weekend | Unclaimed events overlapping the weekend window (§6.3), sorted by `max(startsAt, window.start)`, then `startsAt` | 6 | ≥1 (§6.3) |
| 3 | Trending | Unclaimed trending items, in server order | 6 | ≥3 after de-duplication (the API already hides <3) |
| 4 | Coming up near you | Unclaimed, not-started events, soonest first | 6 | ≥2 |
| 5 | Free & low-cost | Unclaimed upcoming events (in-progress included), soonest first, where Sheltüh-ticketed `getMinBuyerTotalCents ≤ 2000` or external with `externalFree`. Badge "Free" when 0 or `externalFree`, otherwise "Under A$20". **External paid events are excluded**: no verifiable price. | 6 | ≥2 |

- Only rendered events are claimed. A section that's hidden for being under its minimum releases its events to later sections.
- Priority 1 replaces today's `upcoming[0]`, which could feature an exhibition that opened weeks ago.

### 6.3 This weekend: `weekendWindow(now)` and `formatWeekendRange`

All in Australia/Melbourne wall-clock time, DST-safe. Build it with the `Intl` approach used in `lib/scene-map-filters.ts`.

**Window:**

| Now (Melbourne) | `during` | Window |
| --- | --- | --- |
| Mon 00:00 to Fri 16:59:59 | false | This week's Fri 17:00 to Sun 23:59:59.999 |
| Fri 17:00 to Sun 23:59:59 | true | `now` to this Sun 23:59:59.999 |

- **Membership:** `startsAt ≤ window.end && (endsAt ?? startsAt) ≥ window.start`. So a Fri 14:00–18:00 event counts, an exhibition open through the weekend counts, and anything in progress during the weekend counts.

**Note line:**
- `during = false`: "Fri 23 – Sun 25 Oct", or "Fri 30 Oct – Sun 1 Nov" across months.
- `during = true`: "Until Sun 25 Oct".

**Visibility:**

| Situation | Render |
| --- | --- |
| ≥1 unclaimed weekend event | The section, up to 6 wide cards |
| Weekend events exist, but all were claimed by Up next | Hidden: the event is already on screen above |
| Zero weekend events and `during = false` | **Empty state:** the strap and note, the h2, See all, then `p.text-sm.leading-5.text-muted` "Nothing listed for this weekend yet. New events are added through the week." No cards and no skeleton. |
| Zero weekend events and `during = true` | Hidden. "Nothing on" mid-weekend is a dead end, and Coming up shows what's next. |

**Unit tests** (`tests/home-sections.test.ts`): Thu 23:59, Fri 16:59, Fri 17:00, Sat noon, Sun 23:59, and Mon 00:00. Also the 4 Oct 2026 DST start and the 5 Apr 2026 DST end, a multi-day event, an in-progress event, and each de-duplication priority.

## 7. Accessibility

**Headings** (same at every width):
- h1: "Where is your Sheltüh?" as read by screen readers ("ÜR" is `aria-hidden`, followed by sr-only "your"; owner Q1). Fallback: "Find your room. Find your people."
- h2 "Browse by category" (sr-only)
- h2 "Up next" (sr-only), with the featured title as h3
- h2 "This weekend", h3 cards
- h2 "Trending", h3 cards
- h2 "Coming up near you", h3 cards
- h2 "Only in the city", h3
- h2 "Free & low-cost", h3 cards
- h2 "Find your people"
- h2 "Bring your event to life"

**Landmarks and names:**
- Each section is `aria-labelledby` its h2.
- Each rail or grid `ul` is `aria-labelledby` the same h2, so it's announced as a list of N.
- Card links take their name from their content: chip, date, title, venue, price or "Tickets on {provider}", and "N going".
- Quick-buy links are "Get tickets for {title}", "Get free tickets for {title}", "See tickets for {title}" (demo) or "Join waitlist for {title}".
- See all links are "See all events" or "See all free events".
- Art, icons, dots, discs and arrows are `aria-hidden`. Strap labels that repeat the h2 are `aria-hidden`.

**Focus order:** this is the DOM order, which matches the visual order at every width:
- Skip link → Nav → Explore events → Join the community → search input → Search submit → 6 category links → Up next card → its Save → its Get tickets → for each section: See all, then for each card, card link → Save → Get tickets.
- At lg, the left hero column comes before the right column, matching left-to-right reading.

**Rails (<sm):**
- Cards are reached with Tab, and the browser scrolls a focused card into view. `scroll-px-5` keeps it clear of the gutter.
- The `ul` isn't focusable, because it contains focusable links.
- There are no arrow keys, roving tabindex, arrow buttons or drift, so WCAG 2.2.2 doesn't apply to rails.

**Targets:**
- Hero buttons: 48px.
- Search submit, See all, Save, Get tickets: 44px.
- Category items: 72×70.
- Cards: at least 112px.

**Status:**
- "Loading events…" is a live region.
- The load error is `role="alert"` with a Try again button.
- Trending's absence is silent.

**Zoom:** at 200% text, cards grow (`min-h`, `flex-1`), and the h1 may wrap past its acceptance line count.

## 8. Motion

| What | Behaviour | Reduced motion |
| --- | --- | --- |
| Hero photo cell (`HOME_HERO`, <lg) and featured card art | Push-in via `EventArt motion` (the redefined `.ken-burns`, `brand-direction-one.md` §8.4): `scale(1) → scale(1.06) translate(-1%,-0.5%)`, **one cycle of 4.5s**, `cubic-bezier(.2,.7,.2,1)`, holding the end frame (`both`). **It never loops** (owner decision 6). **No other home image gets `motion`.** | Static. `.ken-burns` only exists inside `@media (prefers-reduced-motion: no-preference)`. Acceptance: under emulated `reduce`, the computed `animation-name` is `none` on both images. Without `reduce`, `animation-iteration-count` is `1`. |
| Hero entrance `.rise` (not the h1) | 0.6s, staggered by `--d` | None (the existing media query) |
| Section `.reveal` | Scroll-timeline rise | None |
| Card image hover | `scale(1.03)` 300ms ease-out, hover-capable only | None |
| Card press | `motion-safe:active:scale-[0.98]` over 150ms | None |
| `#find-your-people` jump | Smooth scroll | Instant (`html` rule) |
| Rails | Thumb or Tab only, native snap | — |
| Removed from home | `Carousel` drift, `Marquee`, `.float` collage, `Scribble` | — |

## 9. Dependencies and out of scope

**Backend contracts this spec assumes** (confirm or adapt inside `lib/api/*` and `lib/live/adapt.ts` only):
1. **B2:** `PublicEvent` and `SheltuhEvent` gain `ticketingMode: "sheltuh" | "external"`, `externalTicketUrl?: string` and `externalFree?: boolean` on list, slug and trending payloads. External events may have no ticket types (B1 already guards `Infinity`).
2. **B4:** `GET /api/events/trending` returns `{ items: { event: PublicEvent; label: "going" | "just-announced" | "popular"; goingCount?: number }[] }`.
   - `goingCount` is present only for `"going"`, and only when it's at or above `COUNT_THRESHOLD`.
   - When fewer than 3 events qualify, `items` is `[]`.
   - Events are published and not ended.
3. **Existing:** the server's `limit` param (max 50). `listPublicEvents` gains `limit?: number` (additive).
4. **Carried over from `mobile-home.md` §8:**
   - A going count on list items, so cards outside Trending can show "N going" live.
   - Image variants (Supabase transforms or `next/image` `remotePatterns`): the lg featured card is 435px CSS wide, so 870px source at 2x.
   - A focal point (`imageFocalX/Y`).
5. **B-WL** (`brand-direction-one.md` §10): sold-out data on list payloads, for the "Sold out · Join waitlist" card state.

**Proposals needing a behaviour change** (not in this build):
- `/events?when=weekend`, so This weekend's See all lands filtered.
- A `/trending` page, if Trending needs its own See all.

**Docs to update after the build:**
- `design-system.md`: record the home components (`HomeRail`, `HomeEventCard`, `SectionHead` strap) under `components/home/`.
- `mobile-home.md`: add a header line saying it's superseded at ≥640 by this spec, and visually everywhere by `brand-direction-one.md`.

**Out of scope here** (covered by `brand-direction-one.md`): `Nav`, `Footer`, `/events` and `EventTile` (B2/F1 can reuse `formatCardPrice` there), the event page, promoted/featured flags, and personalisation or geolocation (the "near you" copy is kept as-is).

**Build order** (F3, after B2 and B4 contracts exist; mock them in tests until then; after `brand-direction-one.md` increments 1–4):
1. `lib`: `weekendWindow`, `formatWeekendRange`, the new `selectHomeSections`, `formatCardPrice`, `ticketProviderName`, the loaders, with tests.
2. Folder move and renames, folding the token test into `brand-tokens.test.ts`, the `useIsPhone` move.
3. The provider, `UpNext`, the hero lg grid, and `HomeRail` grids.
4. Event sections and states, quick buy; delete the old desktop components.
5. Hand-offs: `ux-accessibility-reviewer`, then `visual-qa` at 320, 375, 430, 640, 768, 1024 and 1280, in both demo and live mode.

**Gates:** `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. No e2e covers `/` today. Add one Playwright smoke test for the home at 1280 and 390: one h1, Up next present, and no duplicate event links across sections.

## Owner decisions (21 Oct 2026)

1. ~~Soft cards at every width: confirmed. Cards keep the phone home's rounded corners, light shadow and pink accents from 640px up.~~ **Superseded by Brand Direction One** (`brand-direction-one.md`). Cards are image-first, with 12px rounded-square media, no shadow, and Signal Orange instead of pink.
2. Removed from `/`: the intent pills, poster collage and marquee, "What else?", the partner band (`/partners` stays in the footer) and "What's on this month". Confirmed.
3. External events show "Tickets on <provider>" and no price on cards ("Free · Tickets on <provider>" when free). Confirmed.
4. Unknown ticket sites show "Tickets on the organiser's site", not the bare hostname.
5. This weekend includes any event open during the window (exhibitions every weekend they're open), events starting in the window sorted first. Confirmed.
6. WCAG 2.2.2 (manager decision): the photo push-in runs once, finishes within 5 seconds and holds its end frame. It never loops, and it stays off under reduced motion. That needs no pause control.
