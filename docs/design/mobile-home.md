# Phone home page (< 640px) design spec

Status: proposed · Owner: ui-design-director · Scope: `/` below Tailwind `sm` (320–639px). At ≥640px the home page renders and behaves exactly as today.

**Reference:** the owner's phone mockup (`images/17.webp`).

**Code read:**
- `app/`: `page`, `layout`, `globals.css`, `events/page`, `search/page`, `signup/page`
- `components/`: `IntentHero`, `HomeSections`, `EventPreview`, `EventResults`, `EventFeed`, `EventArt`, `SearchBar`, `Nav`, `Footer`, `DemoNotice`, `ui/EventTile`, `ui/Carousel`, `ui/Section`, `ui/Button`, `whos-going/*`
- `lib/`: `types`, `data`, `format`, `pricing`, `sample-*`, `api/public-events`, `api/going`
- Other: `public/events/README.md`, `tests/EventPreview.test.tsx`, `docs/design-system.md`, `mobile.md`, `whos-going.md`

**Facts that shape this spec:**
- **Display font.** It is **Bricolage Grotesque 800** (`app/layout.tsx`). `design-system.md` and `mobile.md` still say Anton (§8).
- **No saved/favourites feature exists.** There is no `/saved` route, and a grep for saved/favourite/bookmark/wishlist only finds unrelated "saved changes" copy. So there are **no hearts**, in the header or on cards.
- **`/events` ignores query params today.** `EventBrowser` and `LiveEventFeed` both start at `useState("all")`. `listPublicEvents` already accepts `category` and `pricing`, so only a small change is needed (§5.13).
- **Categories.** We have `live-music`, `art`, `workshop`, `pop-up` and `theatre` only. There is no Nightlife, Food & Drink, Community, Fashion or Talks.
- **Carousel.** Below `sm`, `Carousel` is a vertical list with no rail. Phone rails therefore need a new CSS-only component (§5.5); `Carousel` is not changed.
- **No photos yet.** `SAMPLE_PHOTO_SLUGS` is empty. `EventArt` draws poster art and swaps to `imageUrl` once it loads.
- **Who's Going.** Counts are per event (`GET /events/{id}/going` → `{count, closed, countHidden}`). The list payload has no count.

## 1. Principles

1. **A printed guide in your pocket.** One uppercase cover headline, then short sections, each with a sentence-case title and "See all". The scale contrast is cover type against 12–16px Inter.
2. **Softness stays on the phone home.** Rounded cards and one soft shadow are allowed only in `components/home/phone/*`. Shared components (`EventTile`, `Carousel`, `Panel`, `.btn`) and all desktop surfaces stay square and flat.
3. **Colour comes from the pictures.** The UI is black and paper. Yellow marks search and "Free". Pink is used only as decoration or as a fill behind black text. It is never text on paper, a link or a state.
4. **Every tap goes somewhere real.** No hearts, no dead chips, no invented numbers. Every section has a data rule and a fallback (§6).
5. **Only the thumb moves things.** Rails use native scroll-snap. There is no JS scrolling and no autoplay.
6. **Photos drop in with no layout change.** Every image slot has a fixed ratio. `EventArt` fills it now, and `imageUrl` fills it later.

## 2. Tokens (`app/globals.css`)

```css
:root { /* add */
  --pop: #ff4fb0;   /* phone home only: scribble, "Up next"/"Under A$20" fills, avatar discs */
  --card: #fbfaf5;  /* phone home card surface (lifted paper) */
}
/* add inside the existing @theme inline: */ --color-pop: var(--pop); --color-card: var(--card);
@theme {
  --radius-card: 1rem;     /* rounded-card */
  --radius-badge: 0.5rem;  /* rounded-badge: date badge only */
  --shadow-card: 0 1px 2px rgb(11 11 11 / 0.06), 0 6px 16px -6px rgb(11 11 11 / 0.10);
}
```

**Allowed shapes, phone home only:**
- `rounded-card` plus `shadow-card`: the light cards in §5.6–5.10.
- `rounded-card` alone: the hero photo and the dark creators card.
- `rounded-badge`: the date badge.
- `rounded-full`: pills, chips, round icon buttons and avatar discs.

Nothing else is rounded or shadowed. Images are clipped by their card's `overflow-hidden`, sections stay flat, and shadows never animate. **Review gate:** `rg "rounded-card|shadow-card|bg-card|text-pop|bg-pop" components` may only match `components/home/phone/` and `components/ui/Sticker.tsx`.

**Contrast** (computed relative luminance):

| Pair | Ratio | Use |
| --- | --- | --- |
| `foreground` #0b0b0b / `card` | 18.8:1 | Card titles, prices |
| `muted` #6b675e / `card` | 5.4:1 | 12px card meta |
| `muted` / `background` #f3f0e8 | 4.9:1 | Eyebrows, going text on paper |
| `foreground` / `pop` | 6.6:1 | Text on pink badges |
| `foreground` / `highlight` #e8ff3a | 17.7:1 | FREE badge, search glyph |
| `background` / `foreground` | 17.3:1 | Creators card; featured scrim is ≥ 11:1 at worst |
| `pop` / `background` | 2.6:1 | Decoration only |

**Type.** Bricolage = `font-heading` 800. Inter = `font-sans`.

| Role | Family | 320 / 375 / 430 | LH | Tracking | Case | Wt |
| --- | --- | --- | --- | --- | --- | --- |
| Hero eyebrow | Inter | 11px (`eyebrow`) | 16px | 0.14em | upper | 600 |
| Hero h1 | Bricolage | 32 / 37.5 / 42px `text-[clamp(2rem,10vw,2.625rem)]` | 0.9 | -0.01em | upper | 800 |
| Hero intro, community body | Inter | 16px | 24px | 0 | sentence | 400 |
| Section h2, guide/creators title | Bricolage | 22px `text-[1.375rem]` | 28px | -0.01em | sentence (`normal-case`) | 800 |
| Featured title (h3) | Bricolage | 28 / 30 / 32px `text-[clamp(1.75rem,8vw,2rem)]` | 0.95 | -0.01em | upper | 800 |
| Wide-card title | Inter | 16px | 22px | 0 | sentence | 600 |
| Standard/compact card title | Inter | 14px | 20px | 0 | sentence | 600 |
| Card meta (date, venue, going) | Inter | 12px `text-muted` | 16px | 0 | sentence | 400 |
| Card price | Inter | 12px | 16px | 0 | as formatted | 600 |
| Chips, badges | Inter | 11px (`eyebrow`) | 16px | 0.14em | upper | 600 |
| Category label | Inter | 12px | 16px | 0 | sentence | 500 |
| "See all" | Inter | 14px | 20px | 0 | sentence | 600 |
| Date badge | Bricolage 14/16 (range) over `eyebrow` 11/12 (month) | | | | upper | 800/600 |
| Pills | `.btn .btn-lg` | 13px | 18px | 0.12em | upper | 600 |

The sentence-case Bricolage h2 is a deliberate third voice, scoped to this page. It relaxes `mobile.md` principle 2 here only.

**Spacing.** Steps are 4, 8, 12, 16, 20, 24 and 32 only.

| Use | Value |
| --- | --- |
| Gutter | 20px (`px-5`) |
| Between sections | 32px (`mt-8`) |
| Section header row to content | 12px (`mb-3`) |
| Rail gap | 12px (`gap-3`) |
| Card padding, standard and compact | 12px |
| Card padding, wide and guide | 16px |
| Card padding, creators | 20px |

## 3. Grid and layout

Content width is 280 / 335 / 390px at 320 / 375 / 430. Rails bleed to the screen edge (`-mx-5 px-5 scroll-px-5`): the first card aligns to the gutter and the next one peeks.

**Switch.** `app/page.tsx` renders `<PhoneHome className="sm:hidden" />` and wraps the existing tree (`IntentHero`, `#feed`, `WhatElse`, `PartnerBand`) in `<div className="hidden sm:block">`; the desktop markup is otherwise untouched. `display:none` removes the inactive tree from the accessibility tree, so there's never a duplicate h1 or landmark.

**Header and footer are unchanged.**
- `Nav` stays at 56px: wordmark, search icon, "Menu". The mockup's heart is omitted because there is no saved feature. Its hamburger isn't adopted either, since the "Menu" label is clearer and already built.
- `Footer` is already compacted per `mobile.md` §3.3g. Social icons are omitted because there are no accounts.

| # | Section | ≈ px at 375 |
| --- | --- | --- |
| 1 | Hero §5.1 | 400 |
| 2 | Search §5.2 (`mt-6`) | 52 |
| 3 | Categories §5.3 (`mt-6`) | 76 |
| – | Demo notice (demo only, `mt-6`) | 28 |
| 4 | Up next §5.6 (`mt-6`) | 335 |
| 5 | Coming up §5.7 | 360 |
| 6 | This month §5.8 | 400 |
| 7 | Only in the city §5.9 | 400 |
| 8 | Free & low-cost §5.10 | 150 |
| 9 | Find your people §5.11 | 260 |
| 10 | For creators §5.12, then `pb-12` | 380 |

## 4. Imagery

| Slot | Ratio | px at 320 / 375 / 430 | Now | Later |
| --- | --- | --- | --- | --- |
| Hero photo | Stretches to the h1's height | 98×115 / 124×135 / 155×151 | `HOME_HERO.poster` | `HOME_HERO.imageUrl = "/home/hero.jpg"` |
| Featured | 4:5 below 375, 1:1 from 375 | 280×350 / 335² / 390² | event poster | `event.imageUrl` |
| Standard card | 4:3 | 198×149 / 232×174 / 240×180 | event poster | `event.imageUrl` |
| Wide card | 3:2 | 256×171 / 300×200 / 320×213 | event poster | `event.imageUrl` |
| Compact thumb | 96px × card height (≥ 112) | – | event poster | `event.imageUrl` |
| Guide, creators | 16:9 | 280×158 / 335×188 / 390×219 | `HOME_GUIDE`/`HOME_CREATORS` poster | their `imageUrl` |

- **Slots.** Every slot is an `EventArt` sized by `className`. It already renders `<img class="object-cover">` and falls back to the poster on error, so adding photos changes no layout.
- **Photo sources.**
  - Demo: `public/events/<slug>.jpg`, with the slug added to `SAMPLE_PHOTO_SLUGS`.
  - Live: `event.imageUrl`.
  - Home art: a new `public/home/` folder with a README carrying the same rights note.
- **Crop.** Images crop from the centre. Sources should be squares of at least 1200px so they survive every ratio. A stored focal point needs backend work (§8).
- **Text on images.** Only the featured card puts text over an image, using the §5.6 scrim. Everywhere else, text sits beside or below the image, and badges use opaque fills.
- **Accessibility.** All art, icons and the scribble are `aria-hidden`. Titles are always real text, so no `alt` is needed.

## 5. Components

Files go in `components/home/phone/` unless noted, and are client components unless marked "server".

**5.0 `PhoneHome.tsx`** (server). Props: `{ className?: string }`. Renders §3's order inside `mx-auto px-5 pt-6 pb-12`.

**5.1 `PhoneHero.tsx`** (server): `<section aria-labelledby="home-title">`.
- **Eyebrow:** `p.eyebrow.text-muted.mb-3` "Melbourne · Naarm".
- **Headline row:** `grid grid-cols-[auto_minmax(5.5rem,1fr)] gap-x-3 items-stretch`.
  - **h1:** `h1#home-title` with `font-heading uppercase text-[clamp(2rem,10vw,2.625rem)] leading-[0.9] tracking-[-0.01em]`. Content: `<span class="block">Find your</span> <span class="block">room.</span> <span class="block">Find your</span> <span class="block">people.</span>`. That's 4 lines by design, and the spaces between spans keep the accessible text "Find your room. Find your people."
  - **Photo cell** (`relative`): `EventArt poster={HOME_HERO.poster} imageUrl={HOME_HERO.imageUrl} title="Sheltüh" priority className="h-full w-full rounded-card"`, plus `<Scribble className="pointer-events-none absolute -inset-2 -rotate-2 text-pop" />`.
- **Intro:** `mt-4 text-base leading-6 max-w-[34ch]`, reading "Live music, art, workshops and pop-ups, plus the people who make Melbourne's creative scene."
- **CTAs:** `mt-5 flex flex-col gap-2`, both `ButtonLink size="lg" className="w-full"`.
  - "Explore events" with a 16px arrow, linking to `/events`.
  - `variant="outline"` "Join the community", linking to `#find-your-people`, which holds the auth-aware CTA (§5.11).
  - They stack because side by side they'd need about 390px, which doesn't fit even at 430.
- **Acceptance:**
  - At 320, 375 and 430 the h1 sets in exactly 4 lines, and the photo column is at least 88px wide.
  - If "Find your" measures over 180px at 320, lower the clamp minimum to `1.875rem`.
  - Don't apply `.rise` to the h1; it is the LCP element.

**5.1a `Scribble`** is a new export in `components/ui/Sticker.tsx` (`{ className?: string }`) and is static. It renders `<svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">` containing one `path` with `vectorEffect="non-scaling-stroke"` and `d="M10 12 C32 1 76 -1 95 9 C101 30 99 71 93 93 C70 101 27 100 6 91 C-1 67 1 33 9 13 C14 5 24 3 34 6"`.

**5.2 Search.** `SearchBar` gets an additive `submit?: boolean`, defaulting to `false`, so existing callers are unchanged. Use `<SearchBar size="lg" submit label="Search events" />`.
- **Input with `submit`:** `h-13 py-0 pl-12 pr-14 text-base`. That's 52px tall, and the 16px text stops iOS zooming on focus. It keeps `rounded-full border-foreground bg-surface`.
- **Submit button:** `<button type="submit" aria-label="Search" className="absolute right-1 top-1/2 -translate-y-1/2 flex size-11 items-center justify-center rounded-full bg-highlight text-foreground hover:bg-foreground hover:text-highlight">`, holding the magnifier at `h-5 w-5`, stroke 2.
- **Input id:** use `useId()` instead of `site-search-${size}`, because `/search` also uses `lg`.

**5.3 `CategoryRow.tsx`**: `<nav aria-labelledby="home-cats">` with `h2#home-cats.sr-only` "Browse by category".
- **List:** `ul.no-scrollbar.-mx-5.-my-1.5.flex.gap-2.overflow-x-auto.px-5.py-1.5.snap-x.snap-proximity.scroll-px-5`.
- **Item:** a link with `flex w-18 shrink-0 snap-start flex-col items-center gap-1.5`, giving a 72×70px target.
  - Disc: `flex size-12 items-center justify-center rounded-full border border-surface-border bg-card`, holding a 24px `CategoryIcon` (stroke 1.75).
  - Label: `text-xs leading-4 font-medium text-center`.
- **Links:**
  - Live music → `/events?category=live-music`
  - Art → `?category=art`
  - Workshops → `?category=workshop`
  - Pop-ups → `?category=pop-up`
  - Theatre → `?category=theatre`
  - Free → `/events?pricing=free`

  The row is 472px wide, so it scrolls at every width and the sixth item peeks at 430.
- **States:**
  - Hover (hover-capable devices only): disc turns `bg-foreground text-background`.
  - Focus-visible: the global ring, kept unclipped by `py-1.5`.
  - Active: `motion-safe:active:scale-95`.
- **`CategoryIcon.tsx`:** hand-made 24×24 stroke SVGs, `aria-hidden`, with no icon library and no emoji. Icons: note, framed picture, hand with brush, storefront awning, stage curtain, price tag.

**5.4 `GoingStack.tsx`**. Props: `{ count: number; initials?: string[]; size?: "sm" | "lg" }`. The caller decides whether it renders.
- **`sm`:** three `size-6` discs overlapping by `-ml-2`, each with `ring-2 ring-card`. They're followed by `ml-2 text-xs leading-4 text-muted` "{count} going", all in `flex items-center min-h-6`.
  - Fills cycle: `bg-pop text-foreground`, `bg-highlight text-foreground`, `bg-foreground text-background`.
  - Initials: 10px, weight 600, uppercase.
  - The discs are `aria-hidden`; the text carries the meaning.
- **`lg`** (used in §5.11): five `size-14` discs with `-ml-3` and `ring-4 ring-background`, initials 16px/600. Never shows a number.
- **Data rules:**
  - **Demo:** `getSampleGoing(event.id)`, with `initials = attendees.slice(0,3).map(a => initialsFor(a.displayName))`. The count is always 8 or more.
  - **Live, featured card only:** one `getGoingSummary(event.id)` call. Render only when `!closed && !countHidden && count >= COUNT_THRESHOLD`, and **without initials**, because signed-out callers never receive names. Loading, error, hidden and closed states render nothing and reserve no space.
  - **Live, all other cards:** hidden until the list payload includes a count (§8). No N+1 fetches.

**5.5 `PhoneRail.tsx`**. Props: `{ children; labelledBy: string }`.
- **Markup:** `ul[aria-labelledby].no-scrollbar.-mx-5.-my-4.flex.gap-3.overflow-x-auto.overscroll-x-contain.px-5.py-4.snap-x.snap-mandatory.scroll-px-5`, with items as `li.shrink-0.snap-start`.
- **Padding:** `py-4`/`-my-4` stops the 16px shadow and focus rings being clipped.
- **No JS:** no arrows, drift, Pause button or listeners. It never autoscrolls on any pointer, so WCAG 2.2.2 does not apply.
- **`Carousel` is unchanged.** Its drift and pause rules still apply on the desktop home and `/events`.
- **Keyboard:** tabbing to a card link scrolls it into view natively.

**5.6 `FeaturedEventCard.tsx`**. Props: `{ event; mode: "demo" | "live" }`. It sits in `section[aria-labelledby=home-next]` with `h2#home-next.sr-only` "Up next".
- **Card:** a `Link` with `relative block aspect-[4/5] min-[375px]:aspect-square overflow-hidden rounded-card bg-foreground text-background shadow-card`.
- **Layers, bottom to top:**
  1. `EventArt.absolute.inset-0`.
  2. **Scrim:** `absolute inset-0 bg-linear-to-t from-foreground from-35% via-foreground/85 via-65% to-foreground/10`. It's functional, not decorative. Wherever text sits (up to 65% of the card height), black is at least 85% opaque, so paper-colour text stays at 11:1 or better even over a white photo.
  3. **Content:** `absolute inset-x-0 bottom-0 flex flex-col p-5 pr-16`, holding:
     - The badge, `eyebrow self-start rounded-full bg-pop px-3 py-1 text-foreground`, reading "Up next".
     - A `mt-2` h3 title in the featured style, `line-clamp-2`.
     - A `mt-2` meta block of `text-sm leading-5` lines with no gap between them:
       - `formatEventDateTimeRange(startsAt, endsAt)`
       - "{venueName} · {suburb}" in `text-background/80 truncate`
       - `formatFeedPrice(event)` in `font-semibold`
     - `mt-2 GoingStack sm`, with text in `text-background/80` and rings `ring-foreground`.
  4. **Arrow:** `absolute bottom-5 right-5 flex size-11 items-center justify-center rounded-full bg-background text-foreground` with a 20px chevron. It is `aria-hidden`; the whole card is the link.
- **Text budget:** about 205px, which is 59% / 61% / 53% of the card height at 320 / 375 / 430. So the text stays inside the zone where the scrim is at least 85%.
- **States:**
  - Hover: underline the title.
  - Focus-visible: the global ring, drawn outside the card.
  - Active: `motion-safe:active:scale-[0.99]`.
  - Loading: the same box in `bg-surface`, `aria-hidden`.
  - Empty and error: see §6.

**5.7 `HomeEventCard.tsx`**. Props: `{ event; variant: "standard" | "wide" | "compact"; mode; badge?: "free" | "low-cost" }`.

The whole card is one link: `group flex overflow-hidden rounded-card bg-card shadow-card`. In the DOM the image (`aria-hidden`) comes first, then the text. The title is an h3. Meta icons (12px calendar and pin) are inline SVG, `aria-hidden`, with a 4px gap to the text.

- **standard** (Coming up): `flex-col w-[62vw] max-w-60`, so 198 / 232 / 240px wide.
  - Image: `EventArt.aspect-[4/3]` with a category chip, `eyebrow absolute left-2 top-2 rounded-full bg-background px-2 py-0.5`.
  - Body: `flex flex-1 flex-col gap-1 p-3`, in this order:
    - Title, `line-clamp-2`.
    - `formatEventDateShort` · `formatEventTime`.
    - `venueName || suburb`, `truncate`.
    - `formatFeedPrice`.
    - `mt-auto pt-2 GoingStack sm`.
- **wide** (This month): `flex-col w-[80vw] max-w-80`, so 256 / 300 / 320px wide.
  - Image: `EventArt.aspect-[3/2]`, with a date badge at `absolute left-3 top-3 rounded-badge bg-card px-2 py-1 text-center` (from `formatDateBadge`), and the category chip at `left-3 bottom-3`.
  - Body: `p-4 gap-1`, in this order:
    - Title at 16/22, `line-clamp-2`.
    - First sentence of the description, 14/20 muted, `line-clamp-2`.
    - Price.
    - `GoingStack sm`.
- **compact** (Free & low-cost): `grid grid-cols-[6rem_1fr] w-[78vw] max-w-75 min-h-28`, so 250 / 292 / 300px wide and at least 112px tall. It uses `min-h` so zoomed text never clips.
  - Image: `EventArt.h-full`.
  - Body: `p-3 gap-1 min-w-0`, in this order:
    - Badge, `eyebrow self-start rounded-full px-2 py-0.5 text-foreground`: "Free" on `bg-highlight`, "Under A$20" on `bg-pop`.
    - Title, `line-clamp-1`.
    - "{dateShort} · {venue}", `truncate`.
    - `formatFeedPrice`. It is all-inclusive, and required because the badge only gives a band.
  - No going row.
- **States (all variants):**
  - Hover (hover-capable devices only): underline the title.
  - Focus-visible: the global ring, kept visible by the rail padding.
  - Active: `motion-safe:active:scale-[0.98] motion-safe:transition-transform motion-safe:duration-150`.
  - Loading: the same box in `bg-surface`, `aria-hidden`, with no shimmer.
  - Disabled: none.

**`SectionHead.tsx`**. Props: `{ id; title; seeAll?: { href; srLabel } }`.
- Row: `flex items-end justify-between gap-4 mb-3`, with the h2 styled as in §2.
- See all: `inline-flex min-h-11 items-center gap-1 -mr-1 px-1 text-sm font-semibold hover:underline underline-offset-4`, containing "See all", then `<span class="sr-only"> {srLabel}</span>`, then a 16px `aria-hidden` arrow.

**Rail sections.** Each is a `section[aria-labelledby]` containing `SectionHead` and `PhoneRail`:

| § | Section id | Title | See all | srLabel | Card |
| --- | --- | --- | --- | --- | --- |
| 5.7 | `home-coming` | "Coming up in Melbourne" | `/events` | "events" | standard |
| 5.8 | `home-month` | See §6 | `/events` | "events" | wide |
| 5.10 | `home-free` | "Free & low-cost" | `/events?pricing=free` | "free events" | compact |

**5.9 `GuideCard.tsx`**: `section[aria-labelledby=home-guide]`, with the h2 "Only in the city".
- The card is `overflow-hidden rounded-card bg-card shadow-card` and is not itself a link.
- Contents: `EventArt.aspect-video`, then a `p-4 flex flex-col gap-2` body:
  - `eyebrow text-muted` "City guide"
  - h3 at 22/28, sentence case
  - body text at 14/20, muted
  - `ButtonLink size="lg" className="mt-2 self-start"`
- Copy comes from `HOME_GUIDE` (§6).

**5.11 `CommunitySection.tsx`**: `section#find-your-people[aria-labelledby=home-people][tabIndex=-1].focus:outline-none`.
- **Heading and discs:** the h2 "Find your people", then `mt-4 GoingStack lg`.
  - Demo: initials from `getSampleGoing("home-community").attendees.slice(0,5)`.
  - Live: five discs with no initials.
  - Never "+3K" or any other number.
- **Body:** `mt-4 text-base leading-6`, reading "See who's going before you book. Add yourself to an event's guest list, and meet people who like what you like."
- **CTA:** `mt-5 ButtonLink variant="outline" size="lg" className="w-full"`, chosen via `useOptionalAuth()`:
  - Signed in: "Find an event" → `/events`.
  - Everyone else, including demo and while auth is loading: "Join the community" → `/signup`. This is also what SSR renders.

**5.12 `CreatorsCard.tsx`**: `section[aria-labelledby=home-creators]`.
- The card is `overflow-hidden rounded-card bg-foreground text-background`, with no shadow.
- Contents: `EventArt.aspect-video`, then a `p-5 flex flex-col gap-2` body:
  - `eyebrow text-background/70` "For creators"
  - `h2#home-creators` at 22/28, reading "Bring your event to life"
  - 14/20 `text-background/70`: "Reach people who go out for culture. Every listing is reviewed by a person, and fees are shown up front."
  - `ButtonLink variant="light" size="lg" className="mt-3 self-start focus-visible:outline-background"` "List your event" → `/organisers/apply`

**5.13 `/events` query params.** A small behaviour change that §5.3 needs.
- `app/events/page.tsx` becomes `async ({ searchParams }: PageProps<"/events">)` and reads the first value of each param:
  - `category` is kept only if it's in `EVENT_CATEGORIES`, otherwise it's `"all"`.
  - `pricing` is kept only if it's `"free"` or `"paid"`, otherwise it's `"all"`.
- It renders `<EventFeed key={`${category}|${pricing}`} initialCategory initialPricing />`. The props pass through `DemoEventFeed` → `EventBrowser` and `LiveEventFeed`, and only seed `useState`.
- The URL doesn't sync afterwards. The phone "Filters · 1" toggle already shows that a filter is active.
- **Tests:** valid and invalid params in both demo and live. `/search` and plain `/events` must stay unchanged.

**5.14 Helpers and additive changes.** The pure helpers get unit tests.
- **`lib/format.ts` `formatDateBadge(start, end?) → { range; month }`** in Melbourne time:
  - One day: `"3"`/`"OCT"`.
  - Span within a month: `"19–25"`/`"OCT"`.
  - Span across months: `"30 OCT–2"`/`"NOV"`.
  - An end on the same local date counts as one day.
- **`lib/home-sections.ts` `selectHomeSections(events, now)`** returns `{ featured?, comingUp, month: { title, items }, lowCost }` (§6).
- **`lib/home-events.ts` `loadHomeEvents()`** is `EventPreview`'s `loadPreview` moved verbatim, plus an in-flight dedupe: `inflight ??= load().finally(() => (inflight = null))`.
  - `EventPreview` and the phone sections mount together on every viewport and share one request set.
  - `EventPreview`'s behaviour and its test are unchanged.
- **`useIsPhone.ts`** extracts `EventPreview`'s `PHONE_QUERY` store. Phone event sections render cards only when it's true, so desktop pays no DOM cost. The data is client-loaded, so SSR is unaffected.
- **`EventArt` gets `priority?: boolean`.** When true it sets `loading="eager"` and `fetchPriority="high"`; otherwise loading stays `lazy`. Also add `decoding="async"`. Only the hero uses `priority`.

**Files.**
- **New, in `components/home/phone/`:** `PhoneHome`, `PhoneHero`, `CategoryRow`, `CategoryIcon`, `GoingStack`, `PhoneRail`, `FeaturedEventCard`, `HomeEventCard`, `SectionHead`, `PhoneEventSections` (loads events, renders sections 4–6 and 8), `GuideCard`, `CommunitySection`, `CreatorsCard`, `home-content.ts`, `useIsPhone.ts`.
- **New, elsewhere:** `lib/home-sections.ts`, `lib/home-events.ts`, `public/home/README.md`.
- **Changed (additive only):** `app/page.tsx`, `globals.css`, `ui/Sticker.tsx`, `SearchBar.tsx`, `EventArt.tsx`, `EventPreview.tsx` (loader import), `lib/format.ts`, and the `/events` chain (`app/events/page.tsx`, `EventFeed`, `EventBrowser`, `LiveEventFeed`).
- **Unchanged:** `Nav`, `Footer`, `Carousel`, `EventTile`, `EventResults`, `IntentHero`, `HomeSections`, and every desktop visual.

## 6. Data rules, states and data gaps

`selectHomeSections` takes the ≤ 24 soonest events from `loadHomeEvents` and first drops any that have ended (`endsAt ?? startsAt` < now). Demo data includes past September events, so this matters.

| Section | Rule | Hidden when |
| --- | --- | --- |
| Up next | `upcoming[0]` | No events (see Empty below) |
| Coming up in Melbourne | `upcoming[1..7]`, 6 events | Fewer than 2 |
| What's on… | This Melbourne month, excluding featured and Coming up, up to 6. If fewer than 2, use next month. Title: "What's on this month" or "What's on in {Month}" | Fewer than 2 |
| Free & low-cost | Excluding featured. `getMinBuyerTotalCents ≤ 2000` (all-inclusive), soonest first, up to 6. Badge "Free" when 0, otherwise "Under A$20" | Fewer than 2 |

Wide-card copy is `description` up to its first `". "`, clamped by CSS.

**`PhoneEventSections` states:**
- **Loading:** section 4 shows a featured placeholder, and section 5 shows its title with two standard placeholders. An always-mounted `sr-only` `role="status"` reads "Loading events…". Sections 6 and 8 appear after loading, below the fold.
- **Error:** section 4 becomes `Notice tone="danger" role="alert"` "Couldn't load events." followed by `Button variant="outline" size="lg" className="mt-3"` "Try again" (re-runs the load). Sections 5, 6 and 8 are hidden. Static sections still render.
- **Empty:** section 4 becomes `p.text-sm.text-muted` "No events have been published yet. Check back soon." The other event sections are hidden.
- **Demo:** `<DemoNotice>Sample listings, nothing here is a real booking.</DemoNotice>` sits above section 4.

**Data gaps, with proposed static content in `home-content.ts`:**
- **Featured.** There's no featured flag, so the honest label is "Up next" (the soonest event). Promoted listings (from about month 3) must be labelled "Promoted" under the ACL. Editorial picks can then use "Featured".
- **Trending.** There's no popularity data, so the section is renamed "Coming up in Melbourne". Bring back "Trending" once list items carry going counts and there's a product rule for it.
- **This month.** Derived from event dates, so there's no gap.
- **City guide.** There's no content and no `/guide` route. Proposed content:
  - Eyebrow: "City guide"
  - Title: "Melbourne after dark, mapped"
  - Body: "Laneway galleries, warehouse stages and back-room workshops. See what's on near you."
  - CTA: "Open the map" → `/map`
  - `HOME_GUIDE.poster = { pattern: "grid", background: "#0b0b0b", primary: "#f3f0e8", secondary: "#ff4fb0" }`
- **Browse by interest.** Omitted. With our taxonomy it would duplicate the category row and its destinations.
- **Community size ("+3K").** Omitted, because there's no such number.
- **Hero art:** `HOME_HERO.poster = { pattern: "burst", background: "#0b0b0b", primary: "#ff4fb0", secondary: "#f3f0e8" }`.
- **Creators art:** `HOME_CREATORS.poster = { pattern: "curtain", background: "#0b0b0b", primary: "#2b3cff", secondary: "#ff4fb0" }`.
- **Hearts and saved events.** Omitted until a real `/saved` exists.

## 7. Motion and accessibility

**Motion:**
- Nothing moves on its own. There's no drift, marquee (`IntentHero` is hidden), `.rise`, `.reveal`, `float` or scribble draw-on.
- Rails move only under the thumb, with native snap.
- Press feedback uses `motion-safe:` scale over 150ms: 0.98 on cards and 0.95 on category discs.
- The `#find-your-people` jump uses the existing smooth scroll, which is instant under `prefers-reduced-motion: reduce`.
- `.btn` keeps its 150ms colour transitions.

**Headings:**
- h1 "Find your room. Find your people."
- h2 "Browse by category" (sr-only)
- h2 "Up next" (sr-only), with the featured title as h3
- h2 "Coming up in Melbourne", with h3 card titles
- h2 "What's on…", with h3 card titles
- h2 "Only in the city", with an h3
- h2 "Free & low-cost", with h3 card titles
- h2 "Find your people"
- h2 "Bring your event to life"
- Footer

**Targets:**
- Pills: 48px.
- Search submit, See all and the featured arrow area: 44px.
- Category items: 72×70.
- Cards: at least 112px.
- Footer links: 28px, which passes 2.5.8.

**Names:**
- Card links take their name from their text: title, date, venue, price and "N going".
- "See all" has an sr-only suffix.
- The search submit is named "Search".
- Art, icons, discs, the scribble and the arrow are `aria-hidden`.
- Pink never carries text or state on paper.

**Zoom:** at 200% text, cards grow (`min-h`, `flex-1`), and the h1 may wrap past 4 lines, which is acceptable.

## 8. Performance, dependencies, out of scope

**Performance:**
- **Requests.** Both trees share one set of requests.
- **DOM.** Phone cards render only on phones. The desktop tree keeps its existing hidden cost of 6 tiles on phones; removing it isn't worth the test churn.
- **Rails and effects.** Rails are CSS only (no rAF, no listeners). Shadows are static, there's no `backdrop-filter` and no `filter` on SVG, and no new font weights or axes are added.
- **Images.** Once photos exist, the hero `<img>` loads eagerly at high priority and every other image is lazy.
- **Budget at 375.** At most 1,500 DOM nodes and CLS under 0.05. The placeholders reserve sections 4 and 5.

**Backend and product dependencies:**
1. A going count on `GET /events` list items, with the same threshold semantics (`null` when hidden or closed). Without it, cards can't show counts without N+1 requests.
2. A featured/promoted flag, with the "Promoted" label for paid placement.
3. Image variants (Supabase transforms, or `next/image` `remotePatterns`) and a focal point (`imageFocalX/Y`).
4. A taxonomy decision: adding Nightlife, Food & Drink, Community, Talks and Fashion changes `EventCategory` and needs a migration.
5. Guide content, or a CMS for editorial cards.
6. `/signup` intro copy: it says an account is for organiser applications. It should mention Who's Going, since "Join the community" now leads there.

**Docs to update after the build:**
- `design-system.md`: correct the font to Bricolage Grotesque 800, record the phone-home exception (radius, shadow, `pop`, `card`, yellow on search submit and "Free"), and add `PhoneRail`.
- `mobile.md` §1/§3.2: note that the phone home supersedes its no-rounding and no-colour exclusions. Hearts stay excluded.

**Out of scope:** the desktop home, `Nav`/`Footer` changes, syncing `/events` filters to the URL, hearts, social icons, autoplay.

**Build order.** Each PR keeps desktop identical. Verify at 320, 375, 430 and 1280, in demo and live.
1. Tokens, `Scribble`, `formatDateBadge`, `home-sections`, `home-events`, with tests.
2. `/events` params (§5.13).
3. Static phone sections and the `app/page.tsx` switch.
4. Event sections, `GoingStack` and states.
5. `ux-accessibility-reviewer`, then `visual-qa` against this spec.

**Gates:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. Also run `npm run test:e2e` after step 2, since e2e covers `/events`.
