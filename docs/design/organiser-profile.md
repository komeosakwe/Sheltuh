# Organiser profile redesign (PR2 design spec)

Scope: the public organiser profile at `/organisers/[organiserId]`, plus the dashboard fields that feed it and
the admin queue rows that moderate it. This is step 2.0 of the organiser-profile build plan. PR1 (backend)
supplies `coverUrl` / `coverSmallUrl`, `eventCount`, `profileTags` / `customTags` and a past-events list capped
at 12.

Sources: the owner's brief and decisions (Nov 2026; no reference image was supplied), `docs/design-system.md`,
`docs/design/round-2-global.md`, and `docs/design/round-2-handoff.md`, whose owner amendments win. The components
were read from `origin/main` at e3d2df8.

Breakpoints are Tailwind's: **S** <640, **sm** 640–767, **M** 768–1023 (`md:`), **L** 1024–1279 (`lg:`) and **XL** ≥1280
(`xl:`). Verify at 320, 390, 768, 1024 and 1440, in Light and Dark, in demo and live modes, and at 200% text.

---

## 1. Principles

1. **The photo is the organiser's, the type is ours.** Nothing is ever written on the cover: no gradient, no title
   and no button. The name, facts and actions sit on the page below it, so the cover can be any photo (including
   one with words in it) and every text pair stays at a known contrast.
2. **One composition at every width.** The cover is followed by the logo overlapping its bottom-left corner, then
   the name, facts, actions and chips, stacked and left-aligned. Sizes step down and the links column folds under
   the bio below 1024px. **DOM order equals visual order** at every width, with no `order-*` (Round 2 amendment).
3. **Missing content collapses rather than being faked.** With no cover there's no band. With no logo there's no
   tile. With no events there's one line of copy. We never show placeholder art that could pass for a real photo
   or logo.
4. **One orange per view.** Follow (and "Sign in to follow") is the page's only Signal Orange control. The orange
   price labels on event cards are the existing, documented exception. Share and everything else are Secondary or
   plain.
5. **Facts read like a programme, not a dashboard.** Counts go on one line of text ("12 events · 1,240 followers"),
   not as big-number tiles. Past events are a ruled list (date | title | place), like a gallery's exhibition
   history.
6. **Token-first.** No new colours and no one-off `text-[…]` sizes. The one new size is a named `CategoryTag` size
   (§5.6).

## 2. Tokens

### 2.1 Colour

No change to `app/globals.css`. Every pair below is an existing token.

| Use | Light | Dark | Contrast |
| --- | --- | --- | --- |
| Name, bio, link labels, past titles | `--foreground` #000 on `--background` #fff | #fff on #000 | 21:1 |
| Fact labels, handles, past date and place, notes | `--muted` #5c5c5c on #fff | #a3a3a3 on #000 | 6.69:1 / 8.33:1 |
| Past row hover (muted text on `--surface`) | #5c5c5c on #f2f1ee | #a3a3a3 on #1f1f1f | 6.03:1 / 6.94:1 |
| Follow (signal) | `--signal-foreground` #000 on `--signal` #ff4800 | same | 6.18:1 |
| Follow on hover, focus and active | `--signal` on `--ink` | same | 6.18:1 |
| Chips (neutral tag) | `--tag-ink` #3a3936 on `--tag-tint` #eeece7 | #d6d3cc on #171715 | ≥4.5:1 (pinned by `tests/tag-contrast.test.ts`) |
| Cover frame while loading, failed, or in a dashboard placeholder | `--surface` #f2f1ee | #1f1f1f | (no text) |
| Logo cut-out ring | `--background` | `--background` | (no text) |
| Dashboard phone-crop shade | `--ink` at 50% over the photo | same | (no text) |
| Narrow-photo warning | `Notice tone="info"` (`border-foreground` rule, foreground text) | same | 21:1 |

### 2.2 Type (roles on this page)

| Role | Utility | Family / weight | Size / line-height | Tracking | Case |
| --- | --- | --- | --- | --- | --- |
| Strap "Organiser" | `Strap` (`eyebrow`) | Instrument Sans 500 | 12/16 | 0 | sentence |
| Name (h1) | `display-lg` (= heading-h1) | Instrument Sans 700 | 32/40; 40/48 from 768 | −0.015em | as entered (never transformed) |
| Facts line | `body-m` | Instrument Sans: number 600 `tabular-nums`, label 500 (`text-muted` at reading size) | 16/24 | 0 | sentence |
| Follow, Share | `label-button` (`.btn`, `secondaryActionClass`) | Instrument Sans 600 | 16/24 | 0 | sentence |
| Notify checkbox label | `text-sm` | Instrument Sans 400 | 14/20 | 0 | sentence |
| Chips | `CategoryTag size="md"` (new, §5.6) | Instrument Sans 500 | 14/20 | 0 | list labels as written; own words as entered |
| Bio | `body-l` | Instrument Sans 400 | 16/24; 18/28 from 768 | 0 | as entered |
| "Links" h2 | `eyebrow text-muted` (as today) | Instrument Sans 500 | 12/16 | 0 | sentence |
| Link rows | `text-sm` (as today) | 600 label, 400 muted handle | 14/20 | 0 | as built |
| Section heads (Upcoming events, Featured video, Past events) | `SectionHead` (`display-md` = heading-h3) | Instrument Sans 600 | 20/28; 24/32 from 768 | −0.01em | sentence |
| Past date | `mono-m` | Instrument Sans 400 `tabular-nums` | 14/20 | 0 | as formatted |
| Past title | `body-m font-semibold` | Instrument Sans 600 | 16/24 | 0 | as entered |
| Past place | `mono-m text-muted` | Instrument Sans 400 | 14/20 | 0 | as entered |
| Empty upcoming copy | `body-m text-muted` | Instrument Sans 500 | 16/24 | 0 | sentence |
| Report link | `text-sm` | Instrument Sans 400 | 14/20 | 0 | sentence |

There's no Bootzy on this page. Organiser names are data (Round 2 §1.7), and the Bootzy capital "I" is still
unresolved (Round 2 B1).

### 2.3 Spacing (8px scale; 4px only inside components)

| Gap | S (<768) | M (768–1023) | L / XL (≥1024) |
| --- | --- | --- | --- |
| Page top padding (`pt-*`) | 8 (`pt-2`) | 16 (`md:pt-4`) | 24 (`lg:pt-6`) |
| Back link → cover | 8 (`mt-2`) | 16 (`md:mt-4`) | 16 |
| Logo → strap | 16 (`mt-4`) | 24 (`md:mt-6`) | 24 |
| Cover → strap (no logo) | 24 (`mt-6`) | 32 (`md:mt-8`) | 32 |
| Strap → h1 | 8 (`gap-2`) | 8 | 8 |
| h1 → facts | 8 (`mt-2`) | 12 (`md:mt-3`) | 12 |
| Facts → actions | 24 (`mt-6`) | 24 | 24 |
| Actions block (incl. notify checkbox) → chips | 24 (`mt-6`) | 24 | 24 |
| Chips → bio | 24 (`mt-6`) | 32 (`md:mt-8`) | 32 |
| Bio → Links (stacked) | 32 (`mt-8`) | 32 | (side by side) |
| Between sections (identity/about, Upcoming, Featured video, Past, Report) | 40 (`mt-10`) | 48 (`md:mt-12`) | 64 (`lg:mt-16`) (Round 2 §1.4) |
| Page bottom padding | 48 (`pb-12`) | 64 (`md:pb-16`) | 96 (`lg:pb-24`) |

### 2.4 Radii, borders, motion

- **Radii.** The cover is `rounded-card` (16). The logo and the "Add logo" tile are `rounded-dot` (8). Chips are
  `rounded-badge` (8). Buttons are `rounded-control` (8). The dashboard cover preview is `rounded-card`. The admin
  cover thumbnail is `rounded-control`.
- **Borders.** The logo keeps its 1px `border-foreground`. The logo's cut-out is `ring-4 ring-background`: a solid
  4px page-colour ring. It's a cut-out that separates the logo from the photo, not a shadow. Past-list and link
  dividers are 1px `--surface-border`. Controls keep the 1.5px `border-control`.
- **Motion.** Hover and press change colour only: 200ms ease-out, `motion-safe:` (already in `.btn`,
  `secondaryActionClass` and `filterChipClass`). There's no image fade, no Ken Burns (`EventArt`'s `motion` is
  not used) and no lift or scale.

## 3. Grid and layout

**Container.** Use `page-container` (1312px of content; margins of 16 / 32 from 768 / 64 from 1280). This
replaces today's `mx-auto max-w-6xl px-5 sm:px-8`. Change `LiveOrganiserProfile`'s loading and error wrappers and
`OrganiserUnavailable` to `page-container` too, so the page doesn't jump sideways when it loads.

**DOM order (identical at every width):**
1. `BackLink` "All events" (kept, see U4)
2. Cover (`OrganiserCover`), only when there's a cover
3. `<header>`: logo (or the owner's "Add logo"), strap, h1, facts, actions (Follow + Share, then the notify
   checkbox), chips
4. Bio
5. Links section
6. Upcoming events section
7. Featured video section (only when there's one)
8. Past events section (only when there are any)
9. Report link

**Below 1024px:** one column, in that order.

**From 1024px:** items 3–5 sit in a 12-column grid (`lg:grid lg:grid-cols-12 lg:gap-x-8`):
- The header goes in columns 1–7, row 1 (`lg:col-span-7`).
- The bio goes in columns 1–7, row 2 (`lg:col-span-7 lg:row-start-2`).
- Links go in columns 9–12, rows 1–2 (`lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1 lg:self-start`).
  Their top padding matches the strap's offset only when the logo overlaps a cover: `lg:pt-22 xl:pt-26` (88 / 104
  = the overlap + 24). Otherwise it's `lg:pt-0`.

The reading order is the left column, then the right, which matches the DOM. Items 6–9 are full width.

**Measured layout:**

| | 390 | 768 | 1024 | 1440 |
| --- | --- | --- | --- | --- |
| Content width | 358 | 704 | 960 | 1312 |
| Cover | 358 × 176 (≈2.03:1) | 704 × 201 (7:2) | 960 × 274 (7:2) | 1312 × 375 (7:2) |
| Logo / overlap / left inset | 96 / 48 / 16 | 128 / 64 / 24 | 128 / 64 / 32 | 160 / 80 / 32 |
| Header + bio column | 358 | 704 (text capped at `max-w-2xl` 672) | 547 (7 of 12) | 752 (7 of 12) |
| Links column | 358, under the bio | 576 (`md:max-w-xl`), under the bio | 299 (4 of 12) | 416 (4 of 12) |
| Upcoming grid | 1 column, 358 | 2 columns, 340, gap 24 | 3 columns, 299, gap 32 | 4 columns, 304, gap 32 |
| Featured video | 358 × 201 | 704 × 396 | 768 × 432 (`max-w-3xl`) | 768 × 432 |
| Past row columns | 88 \| 1fr (place under title) | 128 \| 1fr \| 256 | 128 \| 1fr \| 320 | 128 \| 1fr \| 320 |
| Section gap | 40 | 48 | 64 | 64 |

At 320: content is 288, the cover is 288 × 176 (1.64:1), and the logo is 96. There must be no sideways scroll at
any width.

**Upcoming grid:** use `HOME_GRID` (`components/home/HomeAllEvents.tsx`: 1 / 2 / 3 / 4 columns). That's the
Round 2 grid ("1 per row" on phones). Today the profile uses `RESULTS_GRID`, which is 2 columns on phones and gives
a 171px card at 390. See U3. Move the constant to a shared module (for example `components/ui/grids.ts`) rather
than importing from `home/`. Implementer's call.

## 4. Imagery

### 4.1 Cover (`OrganiserCover`)

- **Stored:** 7:2. `coverUrl` is 2240×640 and `coverSmallUrl` is 1120×320, both WebP. The server centre-crops
  every upload.
- **Displayed aspect per breakpoint:** the frame is `aspect-[7/2] min-h-44`. Its height is the larger of
  width ÷ 3.5 and 176px:
  - Below 648px viewport (616px of content) the 176px floor applies. That's 1.64:1 at 320, ≈2.03:1 at 390 and
    3.5:1 at 648.
  - From 648px it's exactly 7:2, so the whole stored image shows.
  - This is the owner's "taller crop on phones". It's continuous, so there's no jump at a breakpoint.
- **Focal behaviour:** auto-centred (`object-cover object-center`). On phones the sides are cropped equally. The
  visible share of the photo's width is 47% at 320, 58% at 390 and 100% from 648. There's no per-organiser focal
  point (see §7).
- **`<img>`:**
  ```
  src={coverUrl}
  srcSet={coverSmallUrl ? `${coverSmallUrl} 1120w, ${coverUrl} 2240w` : undefined}
  sizes="(min-width: 80rem) min(calc(100vw - 8rem), 82rem), (min-width: 48rem) calc(100vw - 4rem), (min-width: 40.5rem) calc(100vw - 2rem), 616px"
  width={2240} height={640} alt="" loading="eager" fetchPriority="high" decoding="async"
  className="absolute inset-0 size-full object-cover object-center"
  ```
  `sizes` gives the *rendered width of the whole image*, not the frame's width. With `object-cover` under a
  height floor, the image is drawn 176 × 3.5 = 616px wide on phones. So at 390 a 2× or 3× screen picks the
  2240 file. A frame-width `sizes` would pick the 1120 file and look soft.
- **Text on the image:** none, ever (principle 1).
- **Frame:** `relative w-full overflow-hidden rounded-card bg-surface`. The `--surface` fill shows while the image
  loads and if it fails.
- **Alt:** `alt=""`. The cover is decorative. The h1 names the organiser, and there's no organiser-written
  description to read (see U8).
- **Failed image** (a takedown before the cached page catches up, or a network error): the frame keeps its size
  and shows the plain `--surface` fill, with no icon or text. Catch failures that happen before hydration, as
  `OrganiserLogo` does (`img.complete && img.naturalWidth === 0` in a ref callback, plus `onError`). Keep the
  frame rather than collapsing it, so nothing shifts after the page has painted.
- **No cover** (`coverUrl` absent): no frame at all (principle 3). The page starts with the back link, then the
  header. See U1 for the alternative.
- **Demo:** sample covers are static `public/events/*` photos with no small variant, so they have no `srcSet`. The
  same frame crops any shape.

### 4.2 Logo

- Keep `OrganiserLogo` with `fallback="none"`.
- Add a size `profile`: `size-24 sm:size-32 xl:size-40` (96 / 128 / 160). It's `lg` plus an XL step, so the logo
  holds its own against a 1312px cover.
- Add an optional `className` that's appended to the box.

**Overlap** (only when a cover is shown, failed included):
- The wrapper is `relative z-10 -mt-12 sm:-mt-16 xl:-mt-20 ml-4 md:ml-6 lg:ml-8 w-fit`. That's half the logo's
  height, at 16 / 24 / 32 from the cover's left edge.
- The box gets `ring-4 ring-background`. The bottom-left corner is the brief's choice. The inset keeps the logo off
  the cover's 16px corner radius.

**No cover:** the same box, in the flow, with no negative margin. The ring is invisible on the page colour, so
keep the class constant.

**No logo:** nothing renders. With a cover, the strap starts 24 / 32 below the cover. Without one, the strap
starts 16 below the back link.

**The owner's own profile with no logo:** `OwnLogoPrompt` sits in the logo's place, overlap included.
- It needs the `profile` sizes, and `bg-background ring-4 ring-background` when it overlaps. Today it's
  transparent, so the photo would show through its dashed box.
- Its focus ring (2px at a 3px offset) sits mostly on the page-colour ring, so it shows over any photo.

**Failed logo:** as today, it's left out.

### 4.3 Event images

These are unchanged. `EventCard` has a 2:1 image, `fit="poster"`, and `EventArt` poster art when there's no
`imageUrl`. Past rows have no images.

## 5. Components

### 5.1 `components/organisers/OrganiserProfileView.tsx` (restructure)

The props are unchanged (`profile`, `upcoming`, `past`, `headingRef`). The root is
`page-container flex flex-col pt-2 md:pt-4 lg:pt-6 pb-12 md:pb-16 lg:pb-24`, with children in the §3 order and
the spacing from §2.3.

**Strap and h1:** keep `<Strap label="Organiser" rule={false} />`. The h1 is `display-lg break-words text-balance
outline-offset-2`, with `ref` and `tabIndex` as today (focus target after Try again).

**Facts:** a `<ul className="body-m flex flex-wrap gap-x-6 gap-y-1">`. Each `<li>` holds a
`<span className="font-semibold text-foreground tabular-nums">` number, then a muted label. Items, in this order:
1. `eventCount` events: "1 event" / "N events" (`en-AU` grouping). Hidden when it's absent or 0.
2. `followerCount` followers: "N followers". Hidden unless it's a number (the API sends null under 10).
3. "Member since {Month YYYY}" (`formatMemberSince`), all muted. It's always present, so the list is never empty.

There are no separators. Wrapping can't strand a "·" at the start of a line. Screen readers read "12 events,
1,240 followers, Member since March 2026".

Stop reading `eventsHosted`; PR1 deprecates it.

**Actions:**
```
<FollowButton organiserId organiserName variant="signal" size="md"
  buttonClassName="min-w-0 flex-1 sm:flex-none sm:min-w-32"
  beside={<ShareButton path={`/organisers/${id}`} title={displayName} text={`${displayName} on Sheltüh`}
                       copyLabel="Link to this profile" copiedInLabel className="shrink-0" />} />
```
- Follow and Share are on one row at every width (`FollowButton`'s existing `beside` row:
  `flex w-full flex-wrap items-center gap-2`). The notify checkbox follows 12px below, as built.
- Share is about 103px wide (estimated from Instrument Sans metrics; check in visual QA). Follow takes the rest:
  about 247 at 390 and about 177 at 320.
- A long label ("Sign in to follow") may wrap to two lines inside the button, which then grows from 48px. Share
  never drops to a new row.

**Chips:** `<ul aria-label="Categories" className="flex flex-wrap gap-2">`.
- `profileTags` come first, in list order, as their `ORGANISER_TAGS` labels. `customTags` follow, in saved order,
  as entered.
- Each `<li>` holds a `CategoryTag tone="neutral" size="md"`.
- Omit the `<ul>` when both are empty.
- They aren't links and don't change on hover. Own words are React text only, never in an `href` or a `title`.

**Bio:** `<p className="body-l max-w-2xl whitespace-pre-line break-words">`. Leave it out when it's empty.

**Links:** `<section aria-labelledby="organiser-links">` with an h2 `eyebrow text-muted` "Links" and a 12px gap
(`gap-3`) to `<OrganiserLinks layout="list" />`. Classes are `md:max-w-xl lg:max-w-none` plus the §3 placement.
Leave the section out when there are no links.

**Upcoming:**
- `SectionHead id="organiser-upcoming" title="Upcoming events"`, then `<ul className={HOME_GRID}>` with
  `<li className="flex min-w-0"><EventCard event /></li>`.
- Card titles are h3 (`EventCard`).
- Empty state: `<p className="body-m text-muted">No upcoming events right now. <Link …>Browse all events</Link></p>`.
  The link is `text-foreground underline underline-offset-4 hover:decoration-2`. The section always renders.

**Featured video:**
- `<section aria-labelledby="organiser-video">` with `SectionHead id="organiser-video" title="Featured video"`,
  then `<div className="max-w-3xl"><VideoFacade … /></div>`.
- It moves out of the header column, so on phones the events come before a 200px player.
- It renders only when `featuredVideo` is set.

**Past events:** `SectionHead id="organiser-past" title="Past events"` followed by `<ul className="border-t border-surface-border">`
with up to 12 rows (the API caps them; the view also slices `past.slice(0, 12)` so the demo matches). Each row:

```
li  group/row relative grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 items-baseline
    md:grid-cols-[8rem_minmax(0,1fr)_16rem] md:gap-x-6 lg:grid-cols-[8rem_minmax(0,1fr)_20rem]
    border-b border-surface-border px-2 py-3 md:px-3 md:py-4
    hover:bg-surface has-[a:focus-visible]:bg-surface has-[a:active]:bg-surface-border
    has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-foreground
    motion-safe:transition-colors motion-safe:duration-200
  time  mono-m text-muted max-md:row-span-2   dateTime={startsAt}   formatDayWithYear(startsAt, now, eventZone(tz))
  a     body-m font-semibold line-clamp-2 break-words underline-offset-4 decoration-transparent
        group-hover/row:underline group-hover/row:decoration-current focus-visible:underline
        focus-visible:outline-none after:absolute after:inset-0 after:content-['']
        href=/events/{slug}   {event.title}
  span  mono-m text-muted truncate max-md:col-start-2   {venueName.trim() ? `${venueName} · ${place}` : place}
```

- The DOM order is date, title, place.
- On phones the date column is 88px. It wraps "Fri 25 Sep 2025" as "Fri 25 Sep / 2025" at the space and spans two
  rows, with the title over the place on the right. From 768 it's three columns on one line.
- The title link is the row's one stretched link. The global focus ring is dropped on it, because the row draws a
  2px inset `outline-foreground` (the `SceneEventRow` pattern).
- Rows are at least 68px tall on phones (title over place, 44, plus 24 of padding) and 56px from 768 (one line,
  24, plus 32 of padding). Every row is a ≥44px target.
- An empty list leaves the section out.

**Report:**
`<p className="text-sm text-muted mt-10 md:mt-12 lg:mt-16"><a href={reportOrganiserHref(...)} className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4 hover:decoration-2">Report this organiser</a></p>`.
- The `mailto:` goes to `SUPPORT_EMAIL`, with the subject "Report: {name} ({profile URL})".
- It shows in demo and live, signed in or out.

**Page states:**
- **Loading:** `LiveOrganiserProfile`'s centred `LoadingIndicator`, unchanged apart from the container.
- **Not found and error:** unchanged (`OrganiserUnavailable`, Try again), apart from the container.
- **Demo:** Follow is `aria-disabled` and shows the existing grey disabled look plus "Not available in this demo."
  Share and Report work. Make no API calls.

### 5.2 `components/organisers/OrganiserCover.tsx` (new)

Props: `{ url: string; smallUrl?: string }`. It's a client component, because of the `onError` state. Anatomy,
sizes and states are as in §4.1. It isn't focusable and has no hover. It renders nothing when `url` is unset (the
parent doesn't mount it then).

### 5.3 `components/organisers/FollowButton.tsx` (additive)

- **`variant?: "solid" | "signal"`** (default `solid`, so `EventHost` is unchanged):
  - Not following: `variant`.
  - Following: `outline` with the check icon, as today. The visible label stays "Follow", with `aria-pressed`. A
    toggle keeps one name.
  - Signed out: `ButtonLink` "Sign in to follow" takes `variant` (orange on the profile) instead of the fixed
    `outline`.
- **`buttonClassName?: string`** is appended to the button or link in every state (the demo included).
- **States** on the profile:
  - Signal: orange with a black label. Hover, `:focus-visible` and `:active` all give black with an orange label and
    an orange edge (existing `.btn-signal` rules), plus the global ring on focus.
  - Busy (a status load or a toggle): `aria-disabled`, which gives the grey `--surface` fill with a `--muted` label.
  - Following: outline. Hover gives a black fill with a white label.
- **Auth loading shift.** While auth is loading the component renders `row(null)`, so Share sits alone and then
  moves right when Follow appears. Recommended: when `variant="signal"`, render an `aria-hidden` placeholder
  `h-12 w-32 rounded-control bg-surface` in Follow's slot during auth loading (U11).

### 5.4 `components/ShareButton.tsx` (additive)

- **`path?: string`** is an alternative to `slug`. The URL is `origin + path` with no query or fragment.
  `aria-label` stays `Share {title}`.
- **`copyLabel?: string`** sets the popover's field label (default "Link to this event").
- **`copiedInLabel?: boolean`.** After a successful copy, the visible label reads "Copied" for `COPIED_FOR_MS`,
  with a check icon in place of the share icon. The `role="status"` text becomes `sr-only` (it still says "Link
  copied"). This keeps the Follow + Share row from widening by about 80px for 4 seconds, which at 320 would push
  Follow's label out of its box. The event page doesn't pass it, so it's unchanged.

**States:**
- Secondary look (`secondaryActionClass`, 48px). Hover gives a black fill with a white label. Focus gets the global
  ring.
- The popover falls back as built (`fixed inset-x-5` below 640, hanging from the right edge from 640).

### 5.5 `components/organisers/OrganiserLinks.tsx`

- **Order:** social links in `SOCIAL_NETWORKS` order (Instagram first), then the website last. This also changes
  the event page's Organiser card, which shares the component (plan Q6).
- **Focus twin:** add `group-focus-visible:underline` beside the existing `group-hover:underline` on the label.
- Everything else is unchanged: rows of at least 44px, a new-tab arrow, and the full `aria-label`.

### 5.6 `components/ui/CategoryTag.tsx` (additive)

Add `size?: "sm" | "md"`. The default `sm` is today's tag: `h-6 px-2 label-tag`, 24px at 12/16. `md` is
`h-8 px-3 body-s font-medium` (32px, 14/20, 500). Everything else is the same: the tint from `data-tag`, radius 8,
no outline, no hover, and `truncate`. Use `md` only for the profile chips. The longest list label ("Poetry &
spoken word") and 24-character own words fit at 320 without truncating. Record the size in
`docs/design-system.md`.

### 5.7 `components/dashboard/PublicProfilePanel.tsx`

- **Order** (matching the public page): the intro block, `OrganiserCoverField`, `OrganiserLogoField`,
  `OrganiserTagsField`, then `PublicProfileForm`. Keep the existing `gap-8`.
- **Intro copy:** "Changes go live straight away. To change your name, contact email or event categories,
  contact us."
- In the dashboard, Save buttons are `solid` (black), never signal.

### 5.8 `components/dashboard/OrganiserCoverField.tsx` (new; mirrors `OrganiserLogoField`)

**Anatomy** (root `id="cover"`, `data-organiser-cover-field`, `flex flex-col gap-3`, `aria-busy` while busy):

1. **Title:** `<p id="organiser-cover-title" className="eyebrow text-muted">Cover photo (optional)</p>`.

2. **Preview frame:** `relative aspect-[7/2] w-full max-w-2xl overflow-hidden rounded-card bg-surface`. That's
   672 × 192 at most, 358 × 102 at 390 and 288 × 82 at 320. The frame shows:
   - **Stored cover:** `<img alt="Your cover photo" className="size-full object-cover object-center">`. Use
     `coverSmallUrl` when present, otherwise `coverUrl`.
   - **Uploading:** the local object URL, `object-cover opacity-60`, `alt="Your new cover photo, uploading"`.
   - **None:** centred `text-xs text-muted` "No cover photo yet".
   - **Load failed:** "Couldn't show your cover photo".
   - **Phone-crop shade:** whenever an image is shown, two `aria-hidden` shades,
     `absolute inset-y-0 left-0 w-[26.5%] bg-ink/50` and the same on the right. They mark what a 320px phone
     crops away (47% stays). There's no text on them.

3. **Buttons row:** `flex flex-wrap gap-2`.
   - The native file input is `sr-only peer`, `accept="image/jpeg,image/png,image/webp"`, `aria-disabled` while
     busy, `aria-labelledby="organiser-cover-title organiser-cover-pick"` and
     `aria-describedby="organiser-cover-hint"`.
   - Its `<label>` is styled `buttonClass("outline","md")` with the `peer-focus-visible` ring, exactly as the logo
     field. It reads "Choose a cover photo", or "Change cover photo" once there is one.
   - "Remove cover photo" (`Button outline md`, busy "Removing…") shows when a cover exists and nothing is
     uploading. After removal, focus returns to the input.

4. **Hint:** `<p id="organiser-cover-hint" className="max-w-xl text-xs text-muted">`. The text: "JPEG, PNG or WebP,
   saved when you choose it. It's public, at the top of your profile. We crop it to a wide 7:2 strip; 2240 × 640
   px or larger looks sharpest. Phones show the middle (the clear area above), and your logo covers part of the
   bottom-left corner. Camera and location data is removed. Only upload a photo you have the rights to use."

5. **Uploading:** `DotsLoader label="Uploading"`.

6. **Narrow-photo warning:** `Notice tone="info"`, after a successful upload where the chosen image's 7:2 crop
   width, `min(width, height × 3.5)`, is under 2240. That's measured with `createImageBitmap` (EXIF-oriented) on
   the prepared file. The text: "Saved. This photo is {w} px wide where we crop it, so it's enlarged to 2240 px
   and may look soft on large screens. For a sharper cover, choose one at least 2240 px wide." It clears on the
   next choice or on removal. It isn't an error, so it gets no `role="alert"`; its words are added to the status
   announcement (7).

7. **Status** (`role="status" sr-only`):
   - "Uploading your cover photo…"
   - "Cover photo saved. It's on your public profile now."
   - With the warning: add " It's been enlarged, so it may look soft on large screens."
   - "Cover photo removed."

8. **Errors:** `ActionErrorNotice` with `logoErrorMessage`'s mapping for the field `cover`. The changed words are:
   - 400: `fieldErrors.cover` or "We couldn't use that file. Choose a JPEG, PNG or WebP image."
   - 403: "Only approved organisers can add a cover photo. Reload the page to check your profile's status."
   - 409: "…changed while the cover photo was uploading…"
   - 413: "That image is over 4 MB, even after shrinking it. Choose a smaller one."
   - 429: "You've changed your cover photo a lot today. Try again tomorrow."
   - 401 and 503: as the logo.

**Responsive:** below 640 the preview and buttons stack full width. Nothing sits beside the preview at any width;
the frame is too wide.

### 5.9 `components/dashboard/OrganiserTagsField.tsx` (new)

**Anatomy:**
- The root is a `<form noValidate>` that holds a
  `<fieldset id="categories" className="flex flex-col gap-4 border-t border-foreground pt-5" aria-describedby="tags-note tags-count">`.
- Its `<legend className="font-heading text-xl leading-6">Categories</legend>` matches the Social links fieldset.

1. **Note:** `<p id="tags-note" className="text-sm text-muted">`. The text: "Up to 5, shown on your profile under
   your name. Choose from the list, and add up to 2 in your own words."

2. **Count:** `<p id="tags-count" className="text-sm tabular-nums">`, reading "{n} of 5 chosen". `n` = list items
   plus non-blank own words.

3. **List group:** `<div role="group" aria-labelledby="tags-list-label">`.
   - The label is `<p id="tags-list-label" className="eyebrow text-muted">From the list</p>`.
   - Below it, `flex flex-wrap gap-2`, with the 18 `FilterChip`s in `ORGANISER_TAGS` order.
   - Each chip is 48px with the 1.5px stroke. Pressed chips are black with a white label and the two orange dots.
     Unpressed chips turn cream on hover. Every chip has `aria-pressed`.

4. **At the limit** (n = 5): every unpressed chip gets `aria-disabled="true"`. It stays focusable, gets no hover
   fill, and its classes become `border-surface-border text-disabled cursor-not-allowed`. Pressing it doesn't
   toggle. It sets the status to "That's 5. Unselect one to choose another." (`role="status"`), so the limit is
   said, not only shown in grey.

5. **Own words group:** `<div role="group" aria-labelledby="tags-own-label" aria-describedby="tags-own-hint">`.
   - The label is "In your own words (optional)" (eyebrow muted).
   - The hint (`text-xs text-muted`) states the rules from `lib/api/organiser-tags.ts`. Draft: "2 to 24
     characters: letters, numbers, spaces, & ' and -. No links, @, #, emoji or claims like "official"." The final
     words follow the owner's rule decisions (plan Q3).
   - **One row per own word:** `flex items-start gap-2`.
     - Input `id="tag-own-{i}"`, `fieldClass`, `min-h-12 w-full max-w-xs` (320). Its visible label
       (`text-sm font-medium`) is "Own word {i+1}".
     - Remove is `Button outline md` "Remove", with `aria-label` "Remove own word {i+1}". After removal, focus goes
       to the "Add" button, or to the previous input.
     - Under the input:
       - The counter `text-xs text-muted tabular-nums`, "{len} / 24".
       - The error `<p id="tag-own-{i}-error" className="text-sm text-danger">`, with `aria-invalid` and
         `aria-describedby` on the input.
   - **"Add your own word"** is `Button outline md`. It's shown while there are fewer than 2 rows. It's
     `aria-disabled` when n = 5, described by a line: "Unselect one from the list to add your own word." It
     appends an empty row and focuses its input.

6. **Live validation:**
   - Each input runs `parseCustomTag` (the shared module the API uses) on every change. Its message shows
     **verbatim**; the UI never writes its own rule text.
   - "Too short" and "empty" wait for the first blur, so the person isn't scolded on the first keystroke.
     Everything else (characters, length over 24, duplicates, a word matching a list label, claim words) shows as
     they type.
   - Valid input clears the message.
   - Blank rows are dropped on Save; that isn't an error.

7. **Save:** `Button solid lg` "Save categories", "Saving…" while busy (`busy`, which keeps focus).
   - **Before sending:** with any client error, focus the first invalid input and don't send.
   - **On success:** the status (`role="status" text-sm`, as `PublicProfileForm`) reads "Categories saved. They're
     on your public profile now." The fields reset to the server's normalised values (list order, de-duplicated).
   - **On a 400:** `fieldErrors.profileTags` shows under the list group and `customTags.<i>` under its input. Focus
     goes to the first one.
   - **On a 403 or 409:** the API's words in `role="alert"`.
   - **On an expired session:** the same `InlineReauth` recovery as `PublicProfileForm`. Nothing typed is lost.

8. **Initial state** when `profileTags` is null (not chosen yet):
   - Pre-select `tagsForEventCategories(organiser.categories)`, so the editor shows what the public page shows.
   - Add one muted line under the count: "We've started you with your event categories. Save to keep them, or
     change them."
   - See U7.

**Responsive:** the chips wrap; at 390 that's about 7–8 rows. The inputs are full width up to 320px. Every target
is at least 44px (chips, inputs and buttons are 48).

### 5.10 Admin: `components/admin/OrganiserItem.tsx`, `organiser-fields.ts`, `AdminOrganiserCover.tsx`

**Label column.** Widen it from `sm:grid-cols-[6rem_1fr]` to `sm:grid-cols-[8rem_1fr]`, so "Event categories"
and "Own words" don't break.

**Rows** (in this order):
1. Rename the existing "Categories" to **"Event categories"** (the reviewed ones, unchanged).
2. **"Profile categories"** (profile chips): `profileTags` labels joined with ", ". When it's null, show
   `<span className="text-muted italic">Not chosen yet (their profile shows their event categories)</span>`.
3. **"Own words"**: each word in curly quotes, joined with ", " (“Late-night”, “Queer joy”), so stray spaces are
   visible. Use `break-words`. When there are none, show the italic muted "None".
4. Website, socials, featured video and logo, as now.
5. **"Cover"**: `AdminOrganiserCover` (new).
   - It mirrors `AdminOrganiserLogo`: a token fetch of `coverSmallUrl` and an object URL that's revoked.
   - The image: `aspect-[7/2] w-full max-w-sm rounded-control border border-foreground bg-surface object-cover`
     (384 × 110), `alt="{name}'s cover photo"`.
   - While loading: "Loading the cover photo…" (muted). If it fails: "Couldn't load the cover photo." (danger).
   - When there's no cover: the italic muted "None".

**Removals.** Add `cover` and `customTags` to `REMOVABLE` and render them after video and logo, in that order. The
buttons are `outline sm min-h-11`. The reason box and confirm buttons are as built.
- **cover:** "Remove cover…" / "Remove cover" / "Remove {name}'s cover photo?" / "Removed {name}'s cover
  photo." / "Couldn't remove the cover photo. Try again."
- **customTags:** "Remove own words…" / "Remove own words" / "Remove {name}'s own words?" / "Removed {name}'s
  own words." / "Couldn't remove the own words. Try again."

**Edit log (`organiser-fields.ts`):**
- Labels: `cover` "Cover photo", `profileTags` "Profile categories", `customTags` "Own words".
- Order: … `featuredVideo`, `logo`, `cover`, `profileTags`, `customTags`, `status`.
- Formatting:
  - `cover` uses `formatLoggedLogo` ("Uploaded Fri 25 Sep, 8:05 pm").
  - `profileTags` maps the ", "-joined slugs to labels (an unknown slug stays as stored).
  - `customTags` stays as stored.

## 6. Accessibility

- **Headings:** h1 name, h2 Links, h2 Upcoming events, h3 card titles, h2 Featured video, h2 Past events.
  - The strap, facts and chips aren't headings.
  - The dashboard fields use `legend` / eyebrow `p` as their siblings do.
  - Admin rows stay `dt`.
- **DOM = visual order** at every width (§3). The only grid placement is the L/XL links column, which reads left
  column then right. Within past rows, cells stay in DOM order.
- **Names:**
  - Cover and logo are `alt=""` (decorative).
  - Follow is "Follow {name}" (`aria-pressed`). Share is "Share {name}".
  - Link rows are "Instagram: @handle (opens in a new tab)".
  - Each past row's link is the event title.
  - The chips list is "Categories".
  - The report link is its words.
- **Targets:**
  - 48px: Follow, Share, dashboard chips, inputs and buttons.
  - 44px (`min-h-11`): link rows, the back link, the notify checkbox's label, the report link and admin buttons.
  - 56px or more: past rows.
  - Chips on the public page aren't interactive.
- **Focus:**
  - The global 2px `--foreground` ring at a 3px offset is used everywhere.
  - Past rows use the inset row outline.
  - Over the cover, the "Add logo" link's ring sits on its 4px page-colour cut-out.
  - Follow's focus also turns it black with an orange label (the hover twin).
- **Hover twins:** link-row underline gets `group-focus-visible:underline`. Past rows get fill and underline on
  hover, focus-visible and `:active` (press: `bg-surface-border`). Nothing is shown on hover only.
- **Status messages** (`role="status"`): Follow/unfollow, copy, upload, save and the at-limit message. Errors use
  `role="alert"` or `ActionErrorNotice`.
- **Zoom:** at 200% text, chips wrap, the Follow label wraps inside its button, past rows grow, and nothing
  truncates except the past place line (its full text is in the event page) and the chip's ellipsis, which can't
  trigger at 24 characters.
- **Reduced motion:** nothing on this page moves beyond colour transitions, which are already `motion-safe:`.

## 7. Dependencies and out of scope

**Backend (PR1):** `coverUrl`/`coverSmallUrl`, `eventCount`, `profileTags` (always a list publicly; nullable on
the owner's record), `customTags`, 12 past events, the tags endpoint with keyed field errors, and admin removal of
cover and own words.

**Changes to the plan's step 2.1:**
- **`prepareCoverImage` should centre-crop to 7:2 *before* scaling,** then cap the width at 2800 (≤2800×800).
  Scaling the long edge to 2800 turns a 3000×4000 portrait into 2100×2800. Its crop is then 2100 wide, so it gets
  needlessly upscaled and warned about. The client crop matches the server's centre crop, so nothing visible
  changes, and the upload gets much smaller. The narrow warning then compares the prepared width with 2240.
- **New additive props:**
  - `OrganiserLogo`: size `profile` and `className`.
  - `OwnLogoPrompt`: the profile sizes and an overlap style.
  - `FollowButton`: `variant` and `buttonClassName`.
  - `ShareButton`: `path`, `copyLabel` and `copiedInLabel`.
  - `CategoryTag`: `size`.
- Move `HOME_GRID` to a shared module.

**Overlaps:**
- `round-2-part2` may touch `EventCard` and `Button`. Use them as they are.
- `OrganiserLinks`' order change shows on the event page's Organiser card.

**Docs:** add the `CategoryTag` md size, `OrganiserCover` and the profile composition to `docs/design-system.md`.

**Out of scope:**
- Per-organiser cover focal points (new data and an editor).
- Cover alt text written by the organiser (a new column).
- Covers for platform-managed organisers.
- Using the cover in the profile's OG and Twitter image.
- Chips linking to search.
- A loading skeleton for the profile.

## 8. Undecided (each with this spec's default)

1. **No cover.** Collapse (the default: no band, the header starts the page) or a same-size `--surface` band? At
   launch most organisers will have no cover, so a band would show an empty grey strip on most profiles.
2. **An owner-only "Add cover photo" prompt** on their own public profile, like "Add logo". This isn't in the brief,
   so it's not specced; it's a proposal.
3. **Upcoming grid on phones:** `HOME_GRID` (the default: 1 column, Round 2) or today's `RESULTS_GRID` (2 columns,
   171px cards at 390)?
4. **Keep the "All events" back link and the "Organiser" strap** (the default: both kept, as on main)? They're
   not in the brief.
5. **Chip size:** the new 32px/14px `md` (the default) or the existing 24px/12px tag?
6. **Logo at XL:** 160px (the default) or 128px at every width from 640?
7. **Tags editor when nothing has been chosen:** pre-select the mapped event categories (the default) or start
   empty?
8. **Cover alt text:** decorative for now. Do we want an organiser-written description later (backend)?
9. **Following state:** the visible label stays "Follow" plus a check, in outline (main's behaviour). Should it
   change to "Following"? That's a copy and AT change for `EventHost` too.
10. **Phone floor:** 176px (≈2:1 at 390; 47% of the photo's width visible at 320). Confirm, or choose 160px
    (51% at 320, 2.24:1 at 390).
11. **Auth-loading placeholder** for Follow (§5.3), to stop Share jumping. Recommended, but it's a `FollowButton`
    change.
12. **Facts as a text line** instead of main's big-number tiles. That's a deliberate visual change; confirm.
13. **Copy for `eventCount`:** "N events" counts upcoming and past published events. Is "events" right, or should
    it be "events hosted"?
14. **Report link on the owner's own profile:** shown (the default) or hidden?
15. **The `secondaryActionClass` focus and active fill twin** (Share). It's not required, since hover reveals
    nothing new, but it would match Round 2 everywhere. It's a global change, so it needs coordinating with
    round-2-part2.
16. **Own-word rules and their hint copy**, which wait on plan Q3: length, digits, claim words, scripts.
