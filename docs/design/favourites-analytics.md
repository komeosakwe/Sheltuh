# Favourites and organiser analytics: design spec

Status: built (see §8 for where the build differs) · Owner: ui-design-director · Scope: Part 1 the heart, its placements, `/saved` and the
nav entry. Part 2 `/dashboard/analytics` and `/dashboard/events/[id]/analytics`, including tracking links.
Desktop and phone (320+).

**Code read:** `docs/design-system.md`, `docs/design/{mobile,mobile-home,whos-going}.md`, `docs/ROADMAP.md`,
`app/globals.css`, `components/ui/{EventTile,Section,Button,Field,Carousel}.tsx`,
`components/home/phone/{HomeEventCard,FeaturedEventCard,GoingStack}.tsx`, `EventDetailsView.tsx`,
`EventResults.tsx`, `Nav.tsx`, `AuthNavLinks.tsx`, `DemoNotice.tsx`, `EventArt.tsx`, `components/dashboard/*`,
`app/dashboard/**`, `lib/{types,fees,pricing,format,safe-next-path}.ts`, `lib/api/{client,types}.ts`.

**Facts that shape this spec:**
- `lib/api/favourites.ts` and `lib/api/analytics.ts` don't exist yet, and `lib/api/types.ts` has no favourite or
  analytics types. §7 lists the contract this UI needs.
- `EventTile`, `HomeEventCard` and `FeaturedEventCard` are each one `<Link>`. A button can't sit inside a link, so
  every heart is a **sibling** of the link in a `relative` wrapper.
- `formatAud` drops cents on whole dollars ("A$32"). That's right for prices and wrong for reports.
- The editor lives at `/dashboard/[eventId]`. The static `analytics` and `events` segments take priority over it, so
  the new routes don't collide. The mixed path styles are noted in §7.
- `mobile.md` and `mobile-home.md` exclude hearts "until a real `/saved` exists". This spec lifts that exclusion.
  `pop` pink still never marks state: a saved heart is ink.

## 1. Principles

1. **The heart is a quiet bookmark, not a like.** Ink on paper, with no counts, bursts or colour. It never competes
   with the one black Checkout pill.
2. **Nothing a person does is lost.** Saves are optimistic and roll back with a visible reason. Sign-in returns and
   finishes the save. A remove never pulls the tile out from under your finger.
3. **Reports read like a printed statement.** Big Bricolage numerals for the headline numbers, Inter tables with
   right-aligned tabular figures, hairline rules. No boxes, gauges or gradients.
4. **Numbers are honest.** "—" means not counted and "0" means counted and none. Money always shows cents, and every
   number has a plain definition one tap away.
5. **Every chart is also a table.** Charts are ink shapes with direct labels. Shape (solid vs dashed) and words carry
   meaning, never colour alone.
6. **Privacy is the product.** No cookies, IPs or visitor IDs, and daily totals only. The UI says so plainly where
   organisers would look for "unique visitors".

## 2. Tokens

No new colours, fonts, radii or spacing steps. Spacing uses only 4, 8, 12, 16, 20, 24, 32, 48 and 64. Radii stay 0
except `rounded-full` on pills and the heart disc (a small round control, already allowed).

| Text / mark on background | Ratio | Use |
| --- | --- | --- |
| `foreground` / `background` | 17.3:1 | Heart, numerals, bars, table text |
| `muted` / `background` | 4.9:1 | Labels, axis text, dashed previous-period line (≥3:1 non-text) |
| `background` / `foreground` | 17.3:1 | Saved disc (paper heart on ink), feedback bar |
| `background/70` / `foreground` | ≈8.7:1 | Feedback bar secondary text |
| `surface-border` / `background` | 1.3:1 | Gridlines and bar tracks only (decorative) |
| `danger` / `background` | 5.7:1 | Error text, Delete pill |

| Role | Family | Size / LH | Tracking | Case | Wt |
| --- | --- | --- | --- | --- | --- |
| Analytics h1 (overview) | Bricolage | `display-lg` | -0.01em | upper | 800 |
| Analytics h1 (event title) | Bricolage | `display-md` (24–36px) | -0.01em | upper | 800 |
| Section h2 | Bricolage | `Panel` title (24px / 0.95) | -0.01em | upper | 800 |
| Stat numeral | Bricolage | 28/32 phones (`text-[1.75rem] leading-8`), 40/40 `sm+` (`sm:text-[2.5rem] sm:leading-10`), `tabular-nums` | -0.01em | — | 800 |
| Stat label (`dt`), table header | Inter | 11/16 `eyebrow text-muted` | 0.14em | upper | 600 |
| Stat change line | Inter | 12/16 `text-xs text-muted` | 0 | sentence | 400 |
| Table cell | Inter | 14/20 `text-sm`; numbers `tabular-nums text-right` | 0 | — | 400; totals 600 |
| Chart axis and annotation | Inter | 12/16 `text-xs text-muted tabular-nums` | 0 | sentence | 400 |
| Feedback bar | Inter | 14/20 `text-sm` | 0 | sentence | 400; action 600 |

**Motion:** the existing 150ms `.btn` colour transition and `fade-in` utility, plus `motion-safe:active:scale-90` on
the heart disc (150ms). Nothing else.

## 3. Grid and layout

- **`/saved`:** `Page` (`max-w-6xl`, `px-5 sm:px-8`). The results grid is the existing `EventResults` rest grid: 1
  column on phones, then 2, 3 and 4 at `sm`, `md` and `lg` (`gap-y-8 sm:gap-x-6 sm:gap-y-10`).
- **Analytics:** `Page width="wide"` (the dashboard's `max-w-3xl` is too narrow for a 7-column table). Sections stack
  with `flex flex-col gap-12 sm:gap-16`. On the event page from `lg`, "By ticket type" (`lg:col-span-7`) and "Traffic
  sources" (`lg:col-span-5`) share a `lg:grid lg:grid-cols-12 lg:gap-14` row; everything else is full width.
- **Phones (<640):** stats are 2 columns, tables become definition lists (§5.12), charts are full content width
  (280–390px) and 120px tall, and controls stack full width.

## 4. Imagery

No new imagery. Hearts sit top-right over existing art slots (`EventTile` 1:1, phone standard 4:3, wide 3:2,
featured 4:5 or 1:1), clear of the category chip and date badge at top-left. The disc is opaque paper with an ink
border, so it reads on any photo and on the `EventArt` fallback. `/saved` past rows show no art, and analytics shows
no event art.

## 5. Components

### Part 1: Favourites

**5.1 `components/favourites/FavouritesProvider.tsx`** (new, client). Mount it in `app/layout.tsx` inside the auth
provider.
- **Context:** `{ status: "idle"|"loading"|"ready"|"error"; isSaved(id): boolean; count: number; toggle(event: {id; title; slug}): void; mode: "demo"|"live" }`.
- **Live:** once signed in, one `GET` loads the saved ids (§7). Signed out means no request and an empty set.
- **Demo** (`!auth.configured`): `localStorage["sheltuh:saved:v1"] = {"ids": string[]}`. Read it after mount (SSR
  renders unsaved, so only a fill changes) and sync tabs with the `storage` event. If storage throws (private mode),
  keep an in-memory set with no error. The cap is 500 here too.
- **Optimistic toggle:** flip, announce, then `PUT` or `DELETE`. Requests per event are serialised and the **latest
  intent wins**: taps during a request only record the desired state, sent when it settles. On failure, roll back to
  the server state and show the error (§5.4).
- **Cap:** at `count >= 500` a save doesn't flip, and the cap message shows straight away. A server 409 does the same
  after a rollback.
- **Live region:** an always-mounted `<p role="status" className="sr-only">`. Clear it, then set the text on the next
  frame, so a repeated message is announced again.

**5.2 `components/favourites/SaveButton.tsx`** (new, client). Props: `{ event: { id: string; title: string; slug:
string }; variant: "overlay" | "plain" | "onDark" | "pill"; className?: string }`.
- **Name and state:** `aria-label="Save {title}"` with `aria-pressed={saved}`. A screen reader says "Save Night
  Market, toggle button, pressed". That's the ARIA toggle-button pattern: the name stays fixed and the state carries
  the meaning.
  - **This deviates from the brief**, which asked for a name that changes to "Remove {title} from saved" *and*
    `aria-pressed`. Together they read as "Remove … from saved, pressed", which contradicts itself.
  - If the manager prefers the changing names, drop `aria-pressed`. Use one approach, never both.
- **Signed out (live):** render a `<Link>` that looks the same (unsaved), is named "Sign in to save {title}" and points
  at `withNext("/login", "/events/{slug}?save=1")`. It works without JS and keeps the intent (§5.3).
- **Auth or ids loading:** render unsaved with `aria-disabled="true"` and ignore clicks. No spinner, no layout change.
- **`HeartIcon`** (`components/favourites/HeartIcon.tsx`, `aria-hidden`): 24×24 viewBox,
  `d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10Z"`,
  `stroke="currentColor" strokeWidth=1.75 strokeLinejoin="round"`. `fill` is `currentColor` when saved, else `none`.

| Variant | Where | Hit area | Visible mark: unsaved → saved |
| --- | --- | --- | --- |
| `overlay` | Over art (tiles; phone standard, wide and featured cards) | `flex size-11 items-center justify-center rounded-full` | Disc `size-9 rounded-full border border-foreground bg-background text-foreground` with an 18px outline heart → disc `bg-foreground text-background` with a filled heart |
| `plain` | Compact phone card body (on `bg-card`) | `size-11` | 20px ink outline → filled ink. No disc |
| `onDark` | Phone buy bar | `size-11` | Disc `size-9 border border-background text-background` → `bg-background text-foreground` with a filled heart; `focus-visible:outline-background` |
| `pill` | Event page title row | `Button variant="outline" size="md"` + `min-h-11 gap-2` | 16px heart + the label "Save". The label never changes (it must stay in the accessible name). Saved fills the heart and the pill stays outline, so it never competes with Checkout |

| State | Rule |
| --- | --- |
| Hover (hover devices only) | Unsaved: disc `ring-1 ring-foreground` (a 2px edge). Saved: `bg-accent-strong`. `pill`: the `.btn-outline` hover |
| Focus-visible | The global 2px ring with 3px offset on the 44px target; a paper ring for `onDark` |
| Active | `motion-safe:active:scale-90` on the disc |
| Loading or disabled | `aria-disabled`, looks unsaved, no opacity drop (it's a wait, not a refusal) |
| Error | Rolls back to the previous fill and shows the feedback bar (§5.4) |

**5.3 Signed-out return.** The event page's `pill` reads `save=1` with `useSearchParams` (wrap that client island in
`<Suspense>`).
- Once the viewer is signed in and the ids are `ready`, it saves (idempotent), shows the bar "Saved {title}.", and
  calls `router.replace` without `save` (`{ scroll: false }`). While the viewer is signed out, it does nothing.
- It returns to the event page, not the list that was tapped, because that page can always show the result. `withNext`
  already carries the path through Sign up → Verify.
- **Security review:** a crafted link can only add that page's event to the signed-in user's own list, and the bar
  offers Undo.

**5.4 `components/favourites/FavouritesNotice.tsx`** (new, rendered by the provider). A black band like the buy bar,
never a toast card.
- **Markup:** `fixed inset-x-0 bottom-0 z-40 bg-foreground text-background px-5 sm:px-8 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]`.
  Inside is `mx-auto max-w-6xl flex items-center justify-between gap-4 text-sm leading-5`, with actions in
  `flex shrink-0 items-center gap-2`.
- **Errors** add `border-t-2 border-danger` and always start with "Couldn't", so colour isn't the only signal.
- **Actions:** `inline-flex min-h-11 items-center px-2 font-semibold underline underline-offset-4` with
  `focus-visible:outline-background`. "Dismiss" is always present.
- **Timing:** success closes after 6s, or on Dismiss, navigation or the next heart action. Errors stay until dismissed
  or replaced. Focus never moves to the bar. It covers the phone buy bar (`z-40` over `z-20`) only while shown.

| Trigger | Visible bar | Live region (polite) |
| --- | --- | --- |
| Save or unsave (normal tap) | none (the fill is the feedback) | "Saved {title}." / "Removed {title} from saved." |
| Saved after sign-in return | "Saved {title}." · View saved · Undo · Dismiss | same |
| First save ever (live, per account) | "Saved. Find it any time under Saved." · View saved · Dismiss | "Saved {title}." |
| Network or 5xx | "Couldn't save {title}. Check your connection and try again." · Try again · Dismiss | same |
| No longer listed (404) | "Couldn't save {title}. It's no longer listed." · Dismiss | same |
| Cap (500) | "You've saved 500 events, the most you can. Remove some to save more." · Manage saved · Dismiss | same |
| Session expired (401) | "Your session has ended. Sign in to keep saving." · Sign in (`withNext`) · Dismiss | same |

**5.5 Placements (existing files that change).**
- **`components/ui/EventTile.tsx`:** wrap the output in `<div className={`relative ${className}`}>` holding the
  unchanged `<Link>` and `<SaveButton variant="overlay" className="absolute right-1 top-1" />` (the disc lands 8px in
  from the art's corner). Add `showSave?: boolean` (default `true`). The heart follows the title in DOM and tab order.
  This one change covers the home rail, `/events`, `/search`, `/saved` and `EventPreview`.
- **`components/home/phone/HomeEventCard.tsx`:** wrap each variant's link in a `relative` div, moving the width
  classes to the wrapper.
  - standard: `overlay` at `absolute right-1 top-1`.
  - wide: `overlay` at `absolute right-2 top-2`.
  - compact: `plain` at `absolute right-0 top-0`, with the body padding changed from `p-3` to `p-3 pr-11`.
  - Placeholders get no heart.
- **`components/home/phone/FeaturedEventCard.tsx`:** wrap it in a `relative` div and add `overlay` at
  `absolute right-3 top-3`, above the scrim's text zone. `pr-16` and the arrow are unchanged.
- **`components/EventDetailsView.tsx`:**
  - The eyebrow becomes a row, `div.flex.min-h-11.items-center.justify-between.gap-4`, holding `p.eyebrow.text-muted`
    (category) and `SaveButton variant="pill"`. The h1 keeps its full measure.
  - In the buy bar, wrap the CTA in `div.flex.items-center.gap-2` and put
    `SaveButton variant="onDark" className="hidden min-[375px]:flex"` before it. At 320 the price, heart and CTA need
    ~309px of the 280px available, so the bar heart drops there; the title heart remains.
- Map rows (`SceneEventRow`) are out of scope.

**5.6 `/saved`:** `app/saved/page.tsx` (server, metadata "Saved — Sheltüh") and
`components/favourites/SavedPageContent.tsx` (client).
- **Header:** `PageHeader eyebrow="Your list" title="Saved" intro="Events you've saved. Only you can see this list."`,
  then `p.text-sm.text-muted.-mt-2.mb-8` "{n} saved", or "{n} of 500 saved" from 450 up.
- **Demo:** `<DemoNotice>Saved on this device only. Nothing leaves your browser.</DemoNotice>`. Ids are resolved
  against the sample events, and unknown ids are skipped.
- **"Coming up":** `SectionHeader title="Coming up"`, then `<EventResults events={upcoming} layout="grid" />`, soonest
  first.
  - Add `layout?: "rail" | "grid"` to `EventResults` (default `"rail"`, so callers are unchanged). `grid` renders
    every event in the existing rest-grid markup, with no carousel and no drift: a saved list is for scanning.
  - Unsaving here **leaves the tile in place** with an empty heart until the next load. Focus stays put, re-saving is
    one tap, and the live region confirms it.
- **"Past and unavailable":** `Panel title="Past and unavailable" titleId="saved-past"`, hidden when empty.
  - A `ul` of `li.flex.items-center.justify-between.gap-4.border-b.border-surface-border.py-3`.
  - Left: the title (`text-base font-semibold leading-snug`). It links to `/events/{slug}` if ended but still listed,
    and is plain text if no longer listed. Under it, `text-sm text-muted` "Fri 25 Sep · Ended" or
    "Fri 25 Sep · No longer listed".
  - Right: `Button variant="outline" size="sm" className="min-h-11"` "Remove<span className="sr-only"> {title}</span>".
  - On remove the row is deleted and focus goes to the next row's Remove, else the previous one, else the h2
    (`tabIndex={-1}`).
  - Order: ended (newest first), then no longer listed.
- **Pagination:** 48 per page. "Load more" is `Button variant="outline" size="lg" className="w-full sm:w-auto"` (busy
  label "Loading…").

| State | Render |
| --- | --- |
| Auth loading | `p.text-sm.text-muted` "Loading…" |
| Signed out (live) | `EmptyState title="Sign in to see your saved events"`, body "Tap the heart on any event to keep it here.", action `ButtonLink size="lg" href="/login?next=/saved"` "Sign in" |
| Loading list | "Loading your saved events…" in a `min-h-64` region with `aria-busy="true"` |
| Error | `Notice tone="danger" role="alert"` "Couldn't load your saved events." + `Button variant="outline" size="lg" className="mt-3"` "Try again" |
| Empty | `EmptyState title="Nothing saved yet"`, body "Tap the heart on any event and it'll wait for you here.", action `ButtonLink size="lg" href="/events"` "Browse events" |
| Only past or unlisted | Under Coming up: `p.text-sm.text-muted` "Nothing coming up. Your past events are below." |
| Remove error (past row) | `Notice tone="danger" role="alert"` in the row: "Couldn't remove it. Try again." The button is re-enabled |

**5.7 Nav (`components/Nav.tsx`) and new `components/favourites/SavedNavLink.tsx`.**
- **Desktop row:** an icon-only link after Discover and Map, before `AuthNavLinks`:
  `Link href="/saved" aria-label="Saved" aria-current={pathname==="/saved" ? "page" : undefined}` with
  `flex size-9 items-center justify-center rounded-full hover:bg-foreground hover:text-background`.
  - A 20px heart: outline, filled while on `/saved`. It shows in every auth state.
  - It's 36px (still passes 2.5.8), so the 70px `--header-h` row doesn't grow. It costs ~48px of width, leaving the
    1024px search field at ~324px instead of 372px.
- **Compact bar (<lg):** the same link at `size-11`, between Search and Menu. At 320 the bar needs logo ~90 + 44 + 44
  + Menu ~90 = 268px of the 280px available. No count badge.
- **Phone menu:** add `{ href: "/saved", label: "Saved" }` to the menu's own primary `ul`, after Map, in the same
  `display-lg` style. `PRIMARY_LINKS` (the desktop text links) is unchanged.

### Part 2: Organiser analytics

New client components live in `components/analytics/`. Formatters go in `lib/analytics-format.ts`, with unit tests.

**5.8 Number formatting.**

| Value | Rule | Examples |
| --- | --- | --- |
| Counts | `Intl.NumberFormat("en-AU")`, never abbreviated | `0`, `1,204`, `12,480` |
| Money | `formatAudExact(cents)`: always 2 decimals, grouped, U+2212 for negatives | `A$0.00`, `A$1,204.50`, `−A$12.00` |
| Conversion | orders ÷ views, 1 decimal; `<0.1%` when above 0 but under 0.05%; "—" when views is 0 or null | `3.4%` |
| Change | Whole percent in words: "Up 12%", "Down 8%", or "No change" under 0.5%. "New" when the previous value was 0, "No earlier data" when it was null, "Up more than 999%" past that. Followed by " vs previous {n} days" | |
| No data | `null` renders `<span aria-hidden="true">—</span><span className="sr-only">No data</span>`, plus a footnote saying why | |
| Dates | Melbourne time. Range "1–30 Oct 2026" or "15 Sep – 14 Oct 2026". Axis "3 Oct", "Week of 6 Oct", "Oct 2026" | |
| CSV | Money as plain decimals (`1204.50`), ISO dates, header says AUD. Cells starting with `= + - @` get a leading `'` | |

**5.9 `RangeControls.tsx`.** Props: `{ value: Range; onChange(r: Range): void; allowAllTime: boolean; busy: boolean }`.
Layout `flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6`.
- **Date range:** `Field label="Date range"` with a `select` (`fieldClass sm:w-56`): "Last 7 days", "Last 30 days",
  "Last 90 days", "Last 12 months", "All time", "Custom dates". The overview defaults to Last 30 days, an event to All
  time.
- **Custom dates:** adds `Field "From"` and `Field "To"` (`type="date"`, `fieldClass`, max today) and
  `Button variant="outline"` "Apply" (`size="lg"` on phones, md with `min-h-11` from `sm`). Presets apply when picked;
  custom dates apply on Apply.
  - Error: "Choose an end date on or after the start date." in `text-sm text-danger` under To, with `aria-invalid`,
    and focus moves to To.
- **Compare:** `label.flex.min-h-11.items-center.gap-3.text-sm` wrapping a checkbox and "Compare with the previous
  period". Disabled for All time, with `text-xs text-muted` "There's no earlier period to compare with All time."
- **URL:** state is mirrored to `?range=7d|30d|90d|12m|all|custom&from=&to=&compare=1` via `router.replace` (no
  scroll). Invalid params fall back to the defaults.
- **On change:** the results region gets `aria-busy="true"` and stale numbers drop to `opacity-60` (layout kept). The
  page's polite status says "Showing {range label}." when the data lands.

**5.10 `StatGrid.tsx`.** Props: `{ stats: { label: string; value: string | null; change?: string; emphasis?: boolean }[]; footnote?: ReactNode }`.
- **Markup:** `dl.grid.grid-cols-2.gap-x-6.gap-y-8.border-t.border-foreground.pt-5.sm:grid-cols-4`. Each item is a
  `div.flex.flex-col.gap-2` with a `dt`, the numeral `dd` and the change `dd`. `emphasis` (Net) spans `col-span-2`.
- **Reading order:** "Gross A$1,204.50, Up 12% vs previous 30 days". No colour and no arrows: the words carry the
  direction.
- **Order:** overview is Views, Orders, Conversion, Tickets sold / Gross, Net. An event is Views, Orders, Conversion,
  Tickets sold / Gross, Fees, Net.
- **Definitions:** `details.mt-4.text-sm` with `summary.inline-flex.min-h-11.items-center.underline.underline-offset-4`
  "How these are worked out", then a `dl`:
  - Views: Times your event page was opened. We count page loads, not people.
  - Orders: Completed orders, free and paid. Refunded and failed orders aren't counted.
  - Tickets sold: Tickets in those orders.
  - Gross: What buyers paid, including any booking fees they paid.
  - Fees: Sheltüh booking fees (6% of ticket face value + A$0.50 per paid ticket), whether buyers paid them or you absorbed them.
  - Net: Gross minus fees. This is what Stripe pays out to you. Card processing costs come out of our share, not yours.
  - Conversion: Orders divided by views.

**5.11 `TimeSeriesChart.tsx`.** Props: `{ id: string; title: string; unitLabel: string; points: { date: string; value: number | null }[]; previous?: (number | null)[]; previousLabel?: string; bucket: "day" | "week" | "month" }`.
The event page shows two as small multiples, "Page views" and "Tickets sold". Never a dual axis.
- **Structure:** a `figure`. Header row `flex items-baseline justify-between gap-4`: an h3 `figcaption`
  (`text-sm font-semibold`, "Page views per day") and the total (`text-sm tabular-nums`, "1,204"). Under it,
  `text-xs text-muted` "Highest: 142 on 3 Oct".
- **Plot:** an SVG with `preserveAspectRatio="none"`, `h-[120px] sm:h-[160px] w-full`.
  - Bars are `fill-foreground`, 70% of the slot width, at least 1px.
  - Zero and null draw no bar. Nulls add the footnote "Views before {date} weren't counted."
  - Gridlines at 0, the midpoint and the max: `stroke-surface-border` 1px, `vector-effect="non-scaling-stroke"`. The
    max rounds up to 1, 2 or 5 × 10ⁿ.
- **Axis labels** are HTML, not SVG text (which would distort): Y top-left and bottom-left; X first and last, plus the
  middle at 14 or more buckets.
- **Previous period:** a polyline through the slot centres, `stroke-muted`, 1.5px, `stroke-dasharray="4 3"`.
  - Direct label at its right end: `text-xs text-muted` "Previous 30 days".
  - On phones, a key under the title instead: a 12px ink square "This period" and a 16px dashed rule "Previous 30 days".
- **Bucketing** is client-side from daily data: up to 62 days daily, up to 400 weekly, otherwise monthly. On phones
  (`useIsPhone`), more than 31 buckets also become weekly.
- **Hover or tap:** a 1px ink hairline on the slot, with an `aria-hidden` readout above the plot: "3 Oct: 142 views
  (previous 98)". Bars aren't tab stops; the table is the keyboard path.
- **Screen readers:** the SVG is `role="img"` with an `aria-label` like "Page views per day, 1 to 30 October 2026.
  Total 1,204. Highest 142 on 3 October."
- **Table alternative:** after both charts, `details > summary` "Show the numbers as a table" (44px, underlined) opens
  a daily `DataTable` with Date, Views, Orders, Tickets sold, Gross, Fees and Net. With compare on, add "Previous
  views" and "Previous tickets".
- **No data in range:** baselines are drawn with a centred `text-sm text-muted` overlay, "No views or sales in this
  period."

**5.12 `DataTable.tsx`.** Props: `{ caption: string; columns: { key; label; numeric?: boolean }[]; rows: { key: string; header: ReactNode; cells: ReactNode[] }[]; totals?: ReactNode[] }`.
- **`sm+`:** `table.hidden.w-full.border-collapse.text-sm.sm:table` with `caption.sr-only`.
  - Headers: `th[scope=col].eyebrow.text-muted.text-left.pb-3.align-bottom`, numeric ones `text-right`.
  - Each row's first cell: `th[scope=row].font-normal.text-left`.
  - Rows `border-t border-surface-border`; cells `py-3 pr-4 last:pr-0`; numbers `text-right tabular-nums whitespace-nowrap`.
  - `tfoot` is `border-t border-foreground font-semibold`, first cell "Total".
  - If it overflows, wrap it in `div.overflow-x-auto[tabIndex=0][role=region][aria-label={caption}]`.
- **Phones:** `ul.sm:hidden` with one `li.border-t.border-surface-border.py-4` per row. Each holds
  `p.text-base.font-semibold` (the header), then `dl.mt-2.grid.grid-cols-[1fr_auto].gap-x-4.gap-y-1.text-sm`
  (`dt.text-muted`, `dd.text-right.tabular-nums`). The totals are a final `li` with `border-foreground`, headed
  "Total".
- `display:none` takes the inactive version out of the accessibility tree, so nothing is read twice.

**5.13 `TrafficSources.tsx`.** A `Panel title="Traffic sources"` holding a `DataTable` with the columns Source, Views,
Share, Orders and Conversion.
- Each Views cell holds an `aria-hidden` bar: an `h-1 bg-surface-border` track with a `bg-foreground` fill at the share.
- Rows in fixed order: "Sheltüh" (feed, search, map, saved), "Tracking links", "Social" (Instagram, Facebook, TikTok,
  Threads), "Search engines", "Other websites", "Direct or unknown". Zero rows still show "0".
- Footnotes: "Shares are rounded and may not add to 100%." and "Sources come from the address people arrived from,
  grouped. We don't store the full address or anything about the visitor."

**5.14 `TicketTypeTable.tsx`.** A `Panel title="By ticket type"` holding a `DataTable` with the columns Ticket type,
Price, Sold, Gross, Fees and Net, plus totals.
- **Price:** the face value, with a muted line "Buyer pays fee" or "You absorb the fee".
- **Sold:** "42 of 100" with an `aria-hidden` bar `mt-1 h-1 w-full max-w-24` in the same colours. At full it reads
  "100 of 100 · Sold out".

**5.15 `TrackingLinks.tsx`.** A `Panel title="Tracking links" titleId="links"`.
- **Intro** (`text-sm max-w-xl`): "Make a link for each place you share this event, like your Instagram bio or a
  newsletter. We count the views and sales that come through each one. Sales count when someone buys in the same
  visit. Nothing identifies the people who click."
- **Create form:** `form.flex.flex-col.gap-3.sm:flex-row.sm:items-end`.
  - `Field label="Label" hint="Up to 40 characters, like “Instagram bio”."` with an input (`fieldClass sm:w-72`) and a
    code-point counter, `text-xs text-muted tabular-nums` "{n}/40".
  - `Button variant="solid"` "Create link" (`size="lg"` on phones, md with `min-h-11` from `sm`), busy label
    "Creating…". It's the page's only solid pill.
  - Errors: "Enter a label." or "Keep it to 40 characters or fewer." A 409 duplicate gives "You already have a link
    called “{label}”."
  - On success: clear the field, add the row at the top with `fade-in`, keep focus in the input, and announce "Link
    created: {label}."
- **Counter:** `text-xs text-muted` "{n} of 20 links". At 20 the form is replaced by `Notice` "You've made 20 links,
  the most for one event. Delete one to make another."
- **List:** a `DataTable` (caption "Tracking links, totals since each was created") with the columns Label, Link,
  Views, Orders and Revenue (gross).
  - **Link cell:** a `p.truncate.max-w-[16rem].text-sm.text-muted` URL (`title` = full URL), then
    `Button variant="outline" size="sm" className="min-h-11 min-w-[5.5rem]"`
    "Copy<span className="sr-only"> link for {label}</span>".
  - **Copy feedback:** the button reads "Copied" for 2s and the live region says "Link for {label} copied."
  - **Clipboard failure:** the `p` becomes a selected `input readOnly`, with "Couldn't copy. The link is selected, so
    copy it yourself."
- **Delete:** `Button variant="danger" size="sm" className="min-h-11"` "Delete<span className="sr-only"> {label}</span>"
  opens an inline confirm, not a modal.
  - A `div[role=group][aria-labelledby]` holds `p.text-sm.font-semibold` "Delete “{label}”?", then `text-sm` "Its
    numbers go with it. People who use the link still reach your event, they just aren't counted under this label."
    (depends on §7), then `Button variant="danger"` "Yes, delete" and `Button variant="outline"` "Cancel".
  - Focus: Cancel on open, back to Delete on Cancel. After deleting, the next row's Copy, else the Label input.
    Announce "Deleted {label}."
- **Empty:** `p.text-sm.text-muted` "No links yet. Make one for each place you post about this event."
- **Errors:** a load error gets `Notice tone="danger" role="alert"` + Try again. Create, copy and delete errors get a
  danger `Notice role="alert"` beside the control, which is re-enabled.

**5.16 `AnalyticsPrivacyNote.tsx`.** `Panel title="How we count"`, `text-sm max-w-2xl`: "We add up page views and sales
once per event per day, as totals. We don't use cookies, store IP addresses or give visitors an ID, so we can't show
unique visitors. Today's numbers are still adding up." It's also the explainer whenever there's no data.

**5.17 `LaterStagesNote.tsx`** (layout reserve). `section.border-t.border-surface-border.pt-5` with
`p.eyebrow.text-muted` "Coming later" and `p.mt-2.text-sm.text-muted.max-w-2xl` "Door check-ins and which suburbs your
attendees come from. They'll appear here when they're ready." No fake chart and no placeholder numbers. Stage C
sections slot in above it at full width.

**5.18 `/dashboard/analytics`:** `app/dashboard/analytics/page.tsx` (metadata "Analytics — Sheltüh") and
`components/analytics/AnalyticsOverview.tsx`, in order:
1. **Back link:** `Link.eyebrow.inline-flex.min-h-11.items-center.underline.underline-offset-4` "← Your events"
   (`/dashboard`).
2. **Header:** `PageHeader eyebrow="Organiser" title="Analytics"` with the intro "Ticket sales and page views across
   your events. Free for every organiser."
   - Action: `Button variant="outline"` "Export CSV" (sr-only " for {range label}"), busy label "Preparing…".
   - The CSV is built client-side from the loaded data as `sheltuh-analytics_{from}_{to}.csv`, with the columns
     Event, Starts, Status, Views, Orders, Tickets sold, Gross (AUD), Fees (AUD), Net (AUD), Conversion (%), and a
     Total row.
3. `RangeControls`, then `StatGrid` of the totals.
4. **`Panel title="By event"`:** a `DataTable` with Event, Views, Orders, Tickets, Gross, Net and Conversion, plus
   totals.
   - The row header links to that event's analytics (`font-semibold hover:underline underline-offset-4`), with
     `text-xs text-muted` "Fri 25 Sep · Published" under it.
   - Order: upcoming soonest first, then past newest first. Events with no activity show 0s.
5. `AnalyticsPrivacyNote`, then `LaterStagesNote`.

**5.19 `/dashboard/events/[id]/analytics`:** `app/dashboard/events/[id]/analytics/page.tsx` and
`components/analytics/EventAnalytics.tsx`, in order:
1. **Back links:** `nav[aria-label="Event"].flex.flex-wrap.gap-x-6` with "← Analytics" and "Edit event"
   (`/dashboard/{id}`), in the back-link style.
2. **Header:** `p.eyebrow.text-muted` "Event analytics", h1 `display-md` (the title), `p.text-sm.text-muted`
   "{date} · {venue} · {status}".
   - Actions: `ButtonLink variant="outline"` "View event page" (published only) and "Export CSV" (the daily table, as
     `sheltuh-{slug}_{from}_{to}.csv`).
3. `RangeControls` (`allowAllTime`), then `StatGrid`.
4. **`Panel title="Over time"`:** the two charts (`gap-8`), then the table `details`.
5. **Row:** `TicketTypeTable` and `TrafficSources`.
6. `TrackingLinks`, `AnalyticsPrivacyNote`, `LaterStagesNote`.

| State (both pages) | Render |
| --- | --- |
| Demo (`!auth.configured`) | As the dashboard: `p[role=alert]` "Accounts aren't configured in this environment yet." |
| Auth or organiser loading | `p.text-sm.text-muted` "Loading…" |
| Signed out | `EmptyState title="Sign in to see your analytics"` + `ButtonLink size="lg" href={withNext("/login", path)}` "Sign in" |
| Not an approved organiser | The dashboard's copy and Apply link |
| First load | Header, then "Loading analytics…" in a `min-h-96` region with `aria-busy="true"` |
| Error | `Notice tone="danger" role="alert"` "Couldn't load analytics." + `Button variant="outline" size="lg" className="mt-3"` "Try again". The range is kept |
| 404 (missing or not yours) | `EmptyState headingLevel={1} title="Event not found"`, body "It may have been deleted, or it belongs to another organiser account.", action "Back to analytics" |
| Overview, nothing published | `EmptyState title="Nothing to show yet"`, body "Analytics start when your first event is published.", action `ButtonLink` "New event" |
| Event never published | `Notice` "Analytics start when this event is published. Nothing has been counted yet." Stats, charts and tables are hidden. Tracking links and "How we count" stay, so links can be ready for launch |
| No activity in range | Stats show 0, charts show the overlay, tables show 0 rows |
| Views untracked for part of the range | Views and Conversion show "—", with the footnote "Views were first counted on {date}." |

**5.20 Entry points (existing files that change).**
- **`components/dashboard/DashboardContent.tsx`:**
  - Add `Link href="/dashboard/analytics" className="btn btn-outline w-fit"` "Analytics" after Payouts.
  - Each row becomes `li.flex.items-stretch.bg-surface`. The existing link moves inside as
    `flex flex-1 items-center justify-between p-4`, followed by a sibling link (not nested):
    `Link.eyebrow.inline-flex.min-h-11.items-center.border-l.border-background.px-4.underline.underline-offset-4`
    "Analytics<span className=\"sr-only\"> for {title}</span>".
- **`components/dashboard/EditEventPageContent.tsx`:** once the event loads, render
  `ButtonLink variant="outline" size="sm" className="min-h-11 w-fit"` "Analytics" above `EventEditor`. That also puts
  it above the locked "Published" panel. The site nav is unchanged.

## 6. Motion

| What | Behaviour | Reduced motion |
| --- | --- | --- |
| Heart press | Disc scales to 0.9 for 150ms (`motion-safe:active:`) | None |
| Heart state, copy feedback | Instant fill or text swap. No burst or fade | — |
| Feedback bar | Appears and disappears instantly (it never slides under a thumb) | — |
| New tracking-link row | `fade-in`, opacity only, 150ms | None (existing) |
| Charts | Render complete. No grow-in or draw-on | — |
| Range change | Opacity drops to 60%, no transition | — |

## 7. Dependencies, data gaps and out of scope

**Favourites API (`lib/api/favourites.ts`, types in `lib/api/types.ts`).** Every response is
`Cache-Control: private, no-store`, and the owner always comes from the token.
- `GET /api/favourites/ids` → `{ eventIds: string[] }` (at most 500). One request drives every heart.
- `PUT` and `DELETE /api/favourites/{eventId}`, both idempotent. 404 when the event isn't published. 409 at the cap.
  **`ApiError` has no `code`**, so either 409 is reserved for the cap on this route, or the backend adds
  `code: "favourites_limit"` (a contract change; the architect decides).
- `GET /api/favourites?cursor&limit=48` → `Paginated<SavedEvent>`, where
  `SavedEvent = { eventId; savedAt; availability: "listed"|"ended"|"unlisted"; event?: SheltuhEvent; title; slug; startsAt; endsAt? }`.
  Unlisted events need a title and date snapshot so the row can still be named. Server order: listed soonest first,
  then ended newest first, then unlisted.
- An optional per-account "first save" flag. If it's dropped, that bar never shows and the nav heart carries
  discovery.

**Analytics API (`lib/api/analytics.ts`).** Only the organiser's own events; anything else is a 404.
- `GET /api/organisers/me/analytics?from&to&compare=1` → `{ range; previousRange?; totals: Metrics; previousTotals?; events: { eventId; title; slug; startsAt; status; metrics; previousMetrics? }[]; viewsTrackedSince: string | null }`.
- `Metrics = { views: number | null; orders; ticketsSold; grossCents; feesCents; netCents }`.
  - `views` is null before tracking began.
  - Fees cover all booking fees, buyer-paid or absorbed; net is gross minus fees.
  - Refunded and `oversold_refund_required` orders are excluded.
  - Conversion is computed client-side.
- `GET /api/organisers/me/events/{id}/analytics?from&to&compare=1` → `{ event: {title, slug, status, startsAt, endsAt, venueName}; everPublished; totals; previousTotals?; daily: {date; views|null; orders; ticketsSold; grossCents; feesCents; netCents}[]; previousDaily?; ticketTypes: {ticketTypeId; name; priceCents; feePolicy; quantityAvailable; ticketsSold; grossCents; feesCents; netCents}[]; sources: {source: "sheltuh"|"links"|"social"|"search"|"other"|"direct"; views; orders}[]; viewsTrackedSince }`.
  `daily` includes zero days, and days are Melbourne days.
- **Tracking links:** `GET` and `POST /api/organisers/me/events/{id}/links` (`{label}`: 1–40 code points, unique per
  event, at most 20) and `DELETE …/links/{linkId}`. Items are `{ linkId; label; url; createdAt; views; orders; grossCents }`,
  all-time. **Decision needed:** does a deleted link's `?ref=` still load the event normally? The §5.15 copy assumes
  it does.
- **Collection (not UI):**
  - A view beacon from the event page sends `ref` and a bucketed referrer, with no cookies and no storage. Prefetches
    and bots are excluded.
  - Order attribution needs `ref` passed with checkout. **That's a behaviour change to `TicketSelector`**, and a
    proposal for the manager.
  - Needs a security and privacy review (referrer handling; `Referrer-Policy` may hide sources).

**Behaviour-changing frontend proposals:**
- The `?save=1` return (§5.3).
- `EventResults layout="grid"`.
- The `EventTile` wrapper div (check `tests/` selectors that assume the tile root is the link).
- The dashboard row's split links.
- Passing `ref` to checkout.

**Out of scope:**
- Demo analytics with sample numbers (later: `lib/sample-analytics.ts` with a `DemoNotice`).
- Sortable columns, per-link time series and email reports.
- Hearts on map rows, and count badges on the nav heart.
- Unique visitors, and stage C beyond the §5.17 note.
- Unifying `/dashboard/[eventId]` with `/dashboard/events/[id]`.

**Docs after the build:**
- `design-system.md`: SaveButton, the FavouritesNotice band, DataTable, StatGrid and the chart rules.
- `mobile.md` and `mobile-home.md`: hearts are no longer excluded.

## 8. As built: deviations from this spec

The UI follows the **built** API (`lib/api/favourites.ts`, `lib/api/analytics.ts`, `lib/api/types.ts`,
`docs/architecture.md` "Favourites" and "Organiser analytics"). Where this spec and the API differ, the API wins:

**Favourites**
- Routes: `PUT`/`DELETE /api/events/{id}/favourite` (not `/api/favourites/{id}`); `GET /api/favourites/ids`;
  `GET /api/favourites?cursor&limit` (max 50; the page asks for 48).
- 409 on `PUT` means only the 500 cap, so no `code` field is needed. `DELETE` 404 (nothing saved and the event
  isn't published) is treated as already removed, with no error.
- Heart naming: the spec's choice is kept, a fixed name "Save {title}" with `aria-pressed`, never a changing name as
  well. Signed out (live) it's a link named "Sign in to save {title}". **For the accessibility reviewer.**
- `/saved` lists in the API's order, **newest save first** (not soonest first), split client-side into "Coming up"
  (tiles) and **"Past events"** (rows with Remove; the date shows the year when it isn't this year). The API only lists
  published events, so the "no longer listed" rows, their copy and their ordering are dropped. After the last past row
  is removed the section stays, saying "No past events saved.", so focus can land on its heading.
- Removing a past row doesn't use the feedback bar: the row shows its own inline error.
- The "first save ever" bar is dropped (the API has no per-account flag), so the nav heart carries discovery.
- Failed removals get their own words: "Couldn't remove {title} from saved. …". When the ids fail to load, a heart
  tap shows "Couldn't load your saved events. …" with Try again (the heart isn't silently dead).
- Without a `FavouritesProvider` (isolated tests, previews) `SaveButton` renders nothing.
- Demo storage: `localStorage["sheltuh:saved:v1"]` (`lib/saved-storage.ts`), per browser (demo has no accounts).

**View counting** (`components/analytics/EventViewBeacon.tsx`)
- One `POST /api/events/{id}/view` per event per browser session (sessionStorage `sheltuh:viewed:v1`; once per page
  load if storage is blocked), via `recordEventView`: a same-origin `fetch` with `Content-Type: application/json`,
  `keepalive` and `credentials: "omit"`, never `navigator.sendBeacon`. Live only; waits out `document.prerendering`;
  every error ignored.
- Source buckets are the API's ten. `lib/view-source.ts` maps `utm_source`/`utm_medium` first, then the referrer's
  hostname; this site itself and no referrer are `direct`; the client never sends `tracking` (the server sets it).
  In-app navigation keeps the referrer the visit began with, so a view counts under where the visit started.
- `?ref=` codes (validated like the server's) are sent with the view and kept per event in sessionStorage
  `sheltuh:ref:v1` (`lib/tracking-ref.ts`, `getTrackingRef(eventId)`) for checkout to pass on.

**Analytics**
- Routes: `/organisers/me/analytics/overview` and `/organisers/me/events/{id}/tracking-links`; `compare=prevPeriod`.
- CSV export downloads the API's own files (`…/overview.csv`, `…/analytics.csv`), not a client-built CSV.
- Overview has no All time option (the API defaults to 30 days and caps ranges at 731 days); the event page's
  All time sends no dates (the API's default is the event's whole life).
- Views: `null` days render "—" / "No data". When views weren't counted for any of the range, Views and Conversion
  show "—". When counting began part-way (`viewsTrackedSince` inside the range) the views **count is shown** with a
  footnote, and Conversion is "—" (the API returns `conversionRate: null`), rather than hiding both.
- An optional `viewsUnreliable` flag (days, or the whole range, where the per-minute cap was hit) is read defensively
  and adds "Some views may be missing on these days: …". Absent means reliable.
- Traffic sources show **views only** (the API can't split orders by source): Your tracking links; Social
  (Instagram, Facebook, TikTok, X) as a row group with a subtotal; Search engines; Email and newsletters; Eventbrite;
  Other websites; Direct or unknown. No "Sheltüh" bucket exists. Footnote: "Sales can't be split by source, only by
  tracking link."
- New panel **"Tracking links in this period"** (the API's `trackingLinks`): the only per-source sales split,
  including deleted links' codes ("Deleted link (code)"). The manager table below keeps all-time numbers.
- By ticket type: "42 of 100" and its bar only for All time (sales in a shorter period against total capacity would
  mislead); otherwise just the count. A type that no longer exists shows "No longer offered".
- Tracking-link delete copy follows the API: the link still opens the event, nothing more is counted, and what it
  counted stays (without its label). Delete sits in a "Manage" column; the confirm is inline below the table.
- The page's charts use `useIsPhone` for the weekly switch; hover readouts are `aria-hidden` (the table is the path).
- Range changes show the new choice at once while the URL updates (no snap-back of the select or checkbox).
- Entry points: "Analytics" on the dashboard (button and per-row sibling link) and above the event editor.

**Open items**
- Desktop nav at 1024px signed in: the search field goes from ~266px to ~218px with the heart (spec estimated
  more room; measured on the live layout). Still usable; revisit if the nav grows again.
- Checkout passing `getTrackingRef(eventId)` is wired by the checkout pass (`TicketSelector`), not here.
