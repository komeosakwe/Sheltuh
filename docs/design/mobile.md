# Mobile (320–430px) design spec

Status: proposed · Owner: ui-design-director · Scope: phone experience of the public
surfaces (header, Discover, event page + ticket selector, search, map, footer, content
pages). Desktop (≥1024px) must look and behave exactly as it does today unless a line
below says otherwise.

References: DICE web captures supplied by the owner (event rail, full landing page,
"What else?", partner block, footer), and our current 390px captures
(`before_home/event/search/help/map.png`). Code read: `app/globals.css`, `app/layout.tsx`,
`docs/design-system.md`, `components/Nav.tsx`, `AuthNavLinks.tsx`, `SearchBar.tsx`,
`IntentHero.tsx`, `EventFeed.tsx`, `EventBrowser.tsx`, `LiveEventFeed.tsx`,
`EventFilterBar.tsx`, `EventResults.tsx`, `ui/Carousel.tsx`, `ui/EventTile.tsx`,
`EventArt.tsx`, `EventDetailsView.tsx`, `LiveEventDetails.tsx`, `TicketSelector.tsx`,
`HomeSections.tsx`, `ui/Sticker.tsx`, `ui/Section.tsx`, `ui/Field.tsx`, `ui/Button.tsx`,
`Footer.tsx`, `ContentPage.tsx`, `SceneMap.tsx`, `SceneMapFilterBar.tsx`,
`SceneEventRow.tsx`, `SceneMapPanel.tsx`, `CheckoutConfirmation.tsx`, `tickets/TicketStub.tsx`,
`lib/pricing.ts`, `lib/types.ts`, `tests/Carousel.test.tsx`, `e2e/public-feed-pagination.spec.ts`.

Note: the round "N" badge in every capture is the Next.js dev-mode indicator, not product UI.

**Update (Sept 2026):**
- **Font.** The display face is now **Bricolage Grotesque 800** (`app/layout.tsx`), not Anton. Read "Anton" below as `font-heading`; the type table's sizes still apply, but the px measurements were taken with Anton.
- **Phone home.** The home page below 640px now follows `docs/design/mobile-home.md`. It overrides this spec's no-rounding and no-brand-colour exclusions (§1, §3.0 radii, §3.2 "no text on images") **on that page only** (`components/home/phone/`). Hearts/save stay excluded everywhere.

---

## 1. Principles

What makes DICE feel the way it does on a phone, and what we take from it:

1. **The poster is the interface; chrome gets out of the way.** DICE's header is one
   thin row and everything else is artwork plus a plain text stack. On a 390x844 screen
   the first event is on screen straight away. *Adopt:* a 56px header, events in the
   first viewport, and poster art (or `EventArt`) as the largest thing on every event
   surface.
2. **Two voices of type, with extreme scale contrast.** Huge condensed display type is
   for moments (hero, event title). A plain grotesk handles all information: title,
   date, venue and price at 14–16px, with nothing in between. *Adopt:* Anton for
   h1/h2 moments only, and Inter for every piece of scannable metadata. There is no
   third "medium bold heading" style.
3. **Metadata is a plain stack under the image.** It reads title / date / venue / price,
   with no badges, boxes or icons. You scan it top to bottom like a gallery label.
   *Adopt as-is.* `EventTile` already does this, so we keep it.
4. **One black pill is the one action.** Each view has a single, obvious CTA, and on
   the event page it lives in the thumb zone at the bottom. *Adopt:* a sticky bottom
   buy bar on the event page, 48px pills for primary actions, and at most one solid
   pill per viewport.
5. **The price is final and always visible.** DICE shows the full price up front.
   *Adopt:* all-inclusive prices on tiles, list rows, the buy bar and the selector.
   This is also required by the ACL.
6. **Rhythm comes from black bands and generous but not wasteful spacing.** *Adopt:*
   a 48px section rhythm on phones (64–96px on desktop stays), with black bands kept
   for the partner block, the footer and the buy bar.

Deliberately **not** adopted: DICE's rounded image corners (we stay square), mascot or
illustration sets, logo walls (we have no partners to show), phone mock-ups,
"Get the app" / iOS / Android buttons, hearts/save, audio-preview play buttons,
personalised "for you" rails, and brand colour. Black, off-white and poster colour
remain our entire palette.

---

## 2. Current mobile problems (prioritised, with evidence)

Measurements come from the 390px full-page captures (px on the page at 1x) and the code.

| # | Problem | Evidence |
| --- | --- | --- |
| P1 | **The header takes a quarter of the screen and hides focused and anchored content.** | `Nav.tsx`: `flex-wrap` plus `order-last w-full` search puts the logo row, nav row (Discover/Map/Sign in + For organisers pill on a second line) and search row into 3–4 rows. It measures ~189px at 390 (`before_home` 0→189) and ~197px at 375. `globals.css` has `scroll-padding-top: 9rem` (144px), which is **less than the header height**, so anchor targets and keyboard-focused elements scroll under it (WCAG 2.4.11 risk). The header is `bg-background/95`, which is translucent (a glass-like effect we reject). |
| P2 | **The first event on Home sits at ~1190px, about 1.4 screens down.** | `before_home`: hero h1 283–378, intent pills wrap to 2 rows (425–500), marquee 563–624, section title 690, demo notice 813, filter form 917–1125, count 1153, first poster **1190**. |
| P3 | **The filter bar takes ~210px before any event.** | `EventFilterBar.tsx`: `grid-cols-1` below `sm` stacks Category select, date input and price radios with `gap-5`. It is always expanded. |
| P4 | **The event page buy flow is 2+ screens down, with no shortcut.** | `before_event`: title 339, poster 403–665, description 816, "Tickets" heading **1722**, first stepper ~2087, Checkout ~2284, footer 2441. `EventDetailsView.tsx`: the aside is only `lg:sticky`, so on phones it stacks after all content. There is no jump link and no persistent price. |
| P5 | **The carousel drifts on touch devices.** | `Carousel.tsx`: drift is enabled for everyone without reduced motion. The layout effect opens the rail **mid-list** (`cards[length/2]`), so on phones the first card shown is not the soonest event. A touch pauses it for only 2.5s before it resumes and moves away from the card the user landed on. A 60fps rAF loop writing `scrollLeft` costs battery. The Pause pill (`-top-10 right-4`) is the only way to stop it. |
| P6 | **Form controls at 14px make iOS zoom the page on focus.** | `ui/Field.tsx` `fieldClass` uses `text-sm`. `SearchBar` sm uses `text-sm`. `SceneMapFilterBar` inputs and selects use `text-sm`. iOS Safari zooms any focused input or select under 16px. |
| P7 | **Home spends ~1,100px below the feed on decoration.** | `before_home`: the WhatElse `EventArt` is `aspect-[4/5] w-full` (~437px of decorative rings) before the list. The PartnerBand word cloud adds ~150px and duplicates the marquee. |
| P8 | **The footer is ~650px tall.** | `before_home` 3126→3778. `display-xl` wordmark at 52px, `pt-16`, a 2-col link grid that wraps Resources onto a third row, and `mt-16` before the legal row. |
| P9 | **Type scale on phones is too large for long titles and too uniform.** | `display-xl` floors at 52px (`clamp(3.25rem, 11vw, …)`), so "FIND YOUR PEOPLE." fills the full 350px measure at 390 and would overflow the 280px measure at 320. `display-lg` floors at 44px for page and event titles. ContentPage h2s are 30px (`before_help`), which is heavy for FAQ question text. |
| P10 | **Search results use the Home carousel.** | `before_search`: results are a sideways rail (one card plus a peek), so you can't scan a result list. The header `“A”` plus a 62px-tall `size="lg"` search field plus `mb-12` push results to ~920px. |
| P11 | **The Map page nests a scroll area, uses emoji icons and has sub-44px controls.** | `SceneMap.tsx`: the list is `h-[420px] overflow-y-auto` inside the page scroll, so there are two scroll areas on a phone. `SceneMapFilterBar.tsx` uses the 🔍 (`&#128269;`) emoji. Time/category/price pills are `h-9` (36px). The map panel wrapper has no stacking context (`relative … overflow-hidden`), so Leaflet panes (z 400–1000) will likely paint over the sticky header (z-20) when scrolled. Verify. |
| P12 | **Some tap targets are small.** | The Checkout `.btn` is ~38px tall. "Back to all events" is an 11px text link (~16px tall). Price radios are ~20px tall labels. |

---

## 3. Specs

### 3.0 Tokens and global CSS (`app/globals.css`, `app/layout.tsx`)

**Breakpoints** are unchanged Tailwind defaults. Base covers 320–639 (phone), `sm` is
640, `md` is 768 and `lg` is 1024. **The compact header and the sticky buy bar apply
below `lg`**, because the event page is single-column up to 1023px.

**Colour pairs** (existing tokens, no new colours):

| Text / background | Ratio | Use |
| --- | --- | --- |
| `foreground` #0b0b0b / `background` #f3f0e8 | 17.3:1 | Body, titles |
| `muted` #6b675e / `background` | 4.9:1 | Secondary meta (≥12px) |
| `muted` / `surface` #eae6db | 4.5:1 | AA at the limit. Never below 12px on surface. |
| `background` / `foreground` | 17.3:1 | Buy bar, footer, bands |
| `background/70` / `foreground` | ≈8.7:1 | Footer and buy bar secondary text |
| `foreground` / `highlight` #e8ff3a | 17.7:1 | Demo sticker only |

**Add to `:root`:**

```css
--header-h: 3.5rem;   /* 56px compact header, < lg */
--buybar-h: 4.5rem;   /* 72px sticky buy bar, < lg */
```

and `@media (min-width: 64rem) { :root { --header-h: 4.25rem; } }`. That is 68px, the
current one-row desktop header (`py-4` + 36px logo). The engineer must measure
`header.offsetHeight` at 1280 and set this to the measured value.

**Replace** the `html` block:

```css
html {
  color-scheme: light;
  scroll-padding-top: calc(var(--header-h) + 0.5rem);
}
@media (max-width: 63.999rem) {
  html:has([data-buy-bar]) {
    scroll-padding-bottom: calc(var(--buybar-h) + env(safe-area-inset-bottom) + 0.5rem);
  }
}
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
```

In `app/layout.tsx`, add `data-scroll-behavior="smooth"` to `<html>`. Next 16 docs
(`upgrading/version-16.md`) say this makes Next disable smooth scrolling during route
navigations, so page changes still jump to the top instantly.

**Type scale.** Phone sizes are added inside the utilities, so desktop values are untouched:

```css
@utility display-xl {  /* existing desktop rule stays */
  font-size: clamp(3.25rem, 11vw, 7.5rem);
  /* … */
  @media (width < 40rem) { font-size: clamp(2.5rem, 12vw, 3.25rem); }
}
@utility display-lg {
  font-size: clamp(2.75rem, 8vw, 6rem);
  line-height: 0.9;
  /* … */
  @media (width < 40rem) { font-size: clamp(2.25rem, 10vw, 2.75rem); line-height: 0.95; }
}
```

Check in `npm run build` output that the nested media query compiles. If it doesn't,
put the same rules in plain CSS below the utilities with `@media (width < 40rem) { .display-xl {…} .display-lg {…} }`.

| Role | Family | Phone size / line-height | Tracking | Case | Weight |
| --- | --- | --- | --- | --- | --- |
| Hero h1 (`display-xl`) | Anton | 40px@320, 46.8@390, 51.6@430 (12vw) / 0.95 | -0.01em | upper | 400 |
| Page and event title (`display-lg`) | Anton | 36px@320, 39@390, 43@430 (10vw) / 0.95 | 0 | upper | 400 |
| Section title (`display-md`) | Anton | 28px / 0.95 (unchanged) | 0 | upper | 400 |
| Content h2 (FAQ) | Anton | 26px / 0.95 (`text-[1.625rem]`), `sm:` 30px | 0 | upper | 400 |
| Menu items | Anton | `display-lg` size | 0 | upper | 400 |
| Tile or row title | Inter | 16px / 22px (`text-base leading-snug`) | 0 | sentence | 600 |
| Meta (date, venue) | Inter | 14px / 20px | 0 | sentence | 400, `text-muted` |
| Price (tile, row) | Inter | 14px / 20px | 0 | as formatted | 600 |
| Price (buy bar) | Inter | 16px / 20px, `tabular-nums` | 0 | as formatted | 600 |
| Body / description | Inter | 16px / 26px (`text-base leading-relaxed`), `sm:text-lg` | 0 | sentence | 400 |
| Eyebrow / pill label | Inter | 11px / 16px | 0.14em (pill 0.12em) | upper | 600 |
| Form controls | Inter | **16px on phones** (`text-base sm:text-sm`) | 0 | sentence | 400 |

**Spacing scale** uses only these steps: 4, 8, 12, 16, 20, 24, 32, 48, 64 (Tailwind
`1 2 3 4 5 6 8 12 16`).
- Phone gutter is 20px (`px-5`). `sm+` is 32px (`sm:px-8`), unchanged.
- Phone section rhythm is 48px between major sections (`py-12`) and 32px within a
  section (`gap-8`). `sm+` keeps the current `py-16/24`.
- Stack gaps inside a block are 16px (`gap-4`). Metadata lines use 2px (`gap-0.5`).

**Radii:** 0 everywhere. `9999px` is only for pills and round stepper, icon and
chip controls. No change. (Exception: the phone home, see `mobile-home.md` §2.)

**Borders:** 1px `foreground` hairline for structural rules and 1px `surface-border`
for secondary dividers (the header bottom, list rows).

**Buttons.** Add a large size for primary thumb actions:

```css
.btn-lg { padding: 0.875rem 1.75rem; font-size: 0.8125rem; } /* 48px tall */
```

`Button`/`ButtonLink` get `size="lg"` (`buttonClass` maps `lg` to `btn-lg`). `sm` and
`md` are unchanged.

**Forms.** In `ui/Field.tsx`, change `fieldClass` from `text-sm` to `text-base sm:text-sm`
and add `min-h-12 sm:min-h-0`. This is phone-only and applies site-wide, which is
intended because it stops iOS focus zoom.

**Safe area.** The buy bar and menu panel pad with `env(safe-area-inset-bottom)`. This
is harmless when it's 0. Don't add `viewportFit: "cover"` in this pass, because it
would require safe-area left/right gutters on every page in landscape. If QA on iOS
Safari shows the buy bar under the home indicator, raise it as a follow-up (see §5).

### 3.1 Grid and layout (phones)

- **Content column:** full width minus a 20px gutter. That gives 280px at 320, 335 at 375,
  350 at 390 and 390 at 430. `max-w-6xl` still caps at `sm+`.
- **Full-bleed exceptions:** event poster, carousels, buy bar, black bands. Use
  `-mx-5 sm:mx-0` inside padded containers. Carousel already uses `ml-[calc(50%-50vw)] w-screen`.
- **Result grids:** 1-column rows on phones and 2/3/4 columns from `sm/md/lg`.
- **Minimum widths:** everything must work at 320 with no horizontal scroll except
  intentional rails. The body already has `overflow-x: hidden`, so check with
  DevTools that nothing relies on it.

### 3.2 Imagery

| Context | Ratio | Crop | Fallback |
| --- | --- | --- | --- |
| Feed tile (rail and grid) | 1:1 | `object-cover`, centre | `EventArt` pattern (always present) |
| Search/list row thumb | 1:1, 96px | `object-cover`, centre | `EventArt` |
| Map list row thumb | 1:1, 80px (existing) | centre | `EventArt`. **Pass `imageUrl`**, since `SceneEventRow` currently omits it, so photos never show there. |
| Event page hero | **1:1 on phones** (`aspect-square`), 4:3 from `sm` (unchanged desktop) | `object-cover`, centre | `EventArt` |
| Home hero collage | desktop only (unchanged, below 640px see next row) | — | — |
| Phone home (hero, cards, guide) | fixed per slot, see `mobile-home.md` §4 | centre | `EventArt` |
| WhatElse panel | **hidden below `lg`** | — | — |

- **No text on images on phones**, except the existing category sticker on tiles
  (`bg-background` label, 11px, contrast 17:1). Titles are always real text below the art.
- `EventArt` stays `aria-hidden`. The title is rendered as text elsewhere.
- **Focal point:** organiser photos are cropped from the centre. A square crop on
  the event page can cut faces, which is a backend dependency (§5). Don't
  propose art direction we can't honour.

### 3.3 Components

#### (a) Header: `components/Nav.tsx` (+ `AuthNavLinks.tsx`)

The header renders **two blocks**: the existing desktop row, made `hidden lg:flex`
with no other change, and a new compact bar that is `lg:hidden`.

Anatomy of the compact bar (56px):

```
<header className="sticky top-0 z-30 border-b border-surface-border bg-background">
  [compact bar  lg:hidden]  h-14 px-5 sm:px-8 flex items-center justify-between
     Logo  ·  [Search icon link 44x44] [Menu button 44 tall]
  [desktop row  hidden lg:flex]  existing markup unchanged
  [menu popover]
</header>
```

- **Header surface:** change `bg-background/95` to solid `bg-background`, add
  `border-b border-surface-border`, and change `z-20` to `z-30` so it sits above the
  buy bar and carousel controls.
- **Logo:** `font-heading text-3xl leading-none` (30px), `aria-label="Sheltüh home"`,
  same markup as today.
- **Search affordance:** `<Link href="/search" aria-label="Search">` with classes
  `flex size-11 items-center justify-center`. It contains the SearchBar magnifier SVG
  at `h-5 w-5`, `strokeWidth 2`, `text-foreground`. Set `aria-current="page"` on `/search`.
  This works without JS: `/search` already has the large field with
  `autoFocus={!query}`. The header's inline search form stays desktop-only.
- **Menu button:** `<button type="button" popoverTarget="site-menu">` with classes
  `eyebrow flex h-11 items-center px-3 -mr-3`. The label reads "Menu" when closed
  and "Close" when open. The browser exposes `aria-expanded` automatically for popover
  invokers, so don't add it by hand.
- **Menu panel** uses the native **Popover API**: no library, Escape and light-dismiss
  are built in, and focus returns to the invoker on close.
  - Element: `<div id="site-menu" popover="auto" ref={menuRef} className="lg:hidden m-0 inset-x-0 top-14 bottom-auto h-[calc(100dvh-var(--header-h))] w-full max-w-none overflow-y-auto overscroll-contain border-0 border-t border-foreground bg-background p-0 text-foreground">`
  - **Gotcha:** don't put any `display` class (`flex`, `grid`, `block`) on the
    popover root. An author `display` value overrides the UA
    `[popover]:not(:popover-open) { display:none }` and the menu would never close. Put
    layout on an inner wrapper.
  - Inner: `<nav aria-label="Primary" className="flex min-h-full flex-col px-5 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8">`
    1. **Primary list** (`ul`, `flex flex-col`): **Discover** (`/`) and **Map** (`/map`).
       Classes: `display-lg block py-2` (min 52px tall). The active item gets
       `aria-current="page"` and `underline decoration-2 underline-offset-8`, reusing
       `isActive`.
    2. **Account group** (`mt-6 border-t border-foreground pt-6 flex flex-col`):
       render `<AuthNavLinks className={menuAccountLinkClass} />`, where
       `menuAccountLinkClass = "flex min-h-11 items-center text-base font-semibold"`.
       This gives every existing state: Sign in (demo and signed-out), `…` while
       loading, or Admin (admins only), My events and Sign out.
    3. **For organisers:** `<ButtonLink href="/organisers/apply" size="lg" className="mt-8 w-full">`.
  - **Closing:** add an `onClick` on the inner nav that calls
    `menuRef.current?.hidePopover?.()` when `event.target.closest("a, button")` matches.
    This covers links and Sign out. Also add
    `useEffect(() => menuRef.current?.hidePopover?.(), [pathname])`. `hidePopover()` on
    an already-hidden popover is a no-op. The optional call keeps jsdom tests safe.
  - **Label and focus:** in a `useEffect`, listen to the popover's `toggle` event. On
    `newState === "open"`, set the label to "Close" and focus the first menu link.
    On `"closed"`, set it back to "Menu". Native behaviour returns focus to the invoker.
  - **Motion:** none. The panel appears instantly.
- **`AuthNavLinks.tsx`:** add an optional `className?: string` prop that defaults to
  `navLinkClass`. Desktop usage is unchanged.
- **States:**
  - Hover (mouse only): underline, as today.
  - `focus-visible`: the global 2px outline with 3px offset. Inside the popover, use
    `outline-offset-2` so the ring isn't clipped by `overflow-y-auto`.
  - Active: `aria-current` underline.
  - Loading auth: `…`, as today.
- **Scroll padding:** `--header-h` feeds `scroll-padding-top` (§3.0). In `app/page.tsx`,
  change `#feed`'s `scroll-mt-20` to `scroll-mt-4`, because `scroll-mt` and
  `scroll-padding` add together.
- **Destinations check:** Discover, Map, Sign in / My events / Sign out / Admin and For
  organisers are all in the menu. Search is in the header icon and the footer.
  Nothing is lost.

#### (b) Home hero: `components/IntentHero.tsx`

- Section: change `pt-8 pb-16 gap-10` to `pt-6 pb-8 gap-4 sm:pt-14 sm:pb-24 sm:gap-10`.
  Change the inner column `gap-10` to `gap-4 sm:gap-10`.
- Eyebrow: unchanged (11px, muted).
- H1: `display-xl` picks up the phone clamp, so it sets as 2 lines at every width
  from 320 to 430 (measured Anton ≈0.39em per char, "FIND YOUR PEOPLE." = 265px at 40px).
- Intent group: one horizontal row on phones:
  `flex flex-nowrap gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible`.
  Pills get `h-11 shrink-0 px-4` (44px). This is 1 row instead of 2, and the third
  pill peeks.
- Marquee: wrap it in `<div className="hidden sm:block">`. It saves ~60px, and it is
  unpausable moving content (see §5).
- **Target:** the hero block from the header bottom to the feed title is ≤ 270px at 390.

Home feed wrapper (`app/page.tsx`): change `py-16 sm:py-24` to `pt-8 pb-12 sm:py-24`.
In `SectionHeader` (`ui/Section.tsx`), change `mb-8` to `mb-5 sm:mb-8` and the intro's
`mt-3` to `mt-2 sm:mt-3`.

**Acceptance targets (390x844):** the first poster's top is ≤ 620px in demo mode and
≤ 560px in live mode, down from 1190. At 375x667 the first poster is at least
partly visible.

#### (c) Feed filters: `components/EventFilterBar.tsx`

On phones the bar collapses into a **Filters disclosure**. From `sm` up it looks
exactly as it does today.

- **Toggle row** (`sm:hidden`, before the form grid):
  `<button type="button" aria-expanded={open} aria-controls="event-filters" className="btn btn-outline h-11">`.
  The label is `Filters`, or `Filters · 2` when filters are active. Compute the count
  inside the component from props: `(category!=="all") + (pricing!=="all") + (onOrAfter!=="")`.
  Add a chevron SVG 12px after the label that rotates 180deg when open
  (`motion-safe:transition-transform`).
- **Panel:** the existing grid gets `id="event-filters"` and
  `className={`${open ? "grid" : "hidden"} sm:grid grid-cols-1 gap-4 sm:gap-5 sm:grid-cols-3 sm:items-end`}`.
  The form keeps `aria-label="Filter events"` and wraps both the row and the panel.
  The `border-t border-foreground pt-5` rule moves to the form, so it sits above the
  toggle row.
- Price radios: each label gets `min-h-11` on phones, with `gap-4` between options.
- Reset filters: unchanged, inside the panel.
- Default state is closed. It is local `useState(false)`, not persisted.
- Callers: in `EventBrowser` and `LiveEventFeed`, change the wrapper `gap-6` to
  `gap-4 sm:gap-6`. `EventFeed` (demo) gets the same change.
- **Test safety:** the labels "Category" and "On or after" are unchanged and still
  in the DOM (jsdom ignores the `hidden` class). The Playwright e2e runs at the
  desktop viewport, where the panel is `sm:grid`, so `getByLabel("Category")` still
  resolves.
- **States:** closed; open; active (count in label); `focus-visible` ring on toggle.
  Empty and error states are unchanged (`EmptyState`, `Notice`).

#### (d) Carousel on touch: `components/ui/Carousel.tsx`, `EventResults.tsx`

- **Drift is off on touch devices** (recommendation: off). Gate every drift decision
  (the `driftAvailable` effect **and** the mid-rail `useLayoutEffect`) on
  `matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)")`.
  - Why:
    - A swipe is the primary control on touch, and a rail that resumes moving 2.5s
      after you let go takes the card you chose away from you.
    - WCAG 2.2.2 lets us remove the Pause button entirely when nothing moves.
    - A continuous 60fps rAF plus `scrollLeft` writes drains battery on the device
      that has the least of it.
    - With drift off, the rail opens at **card 1, the soonest event**, instead of
      mid-list.
  - Desktop mouse users keep today's behaviour exactly.
- Card width on phones: `CarouselItem` changes from `w-[68vw] max-w-[320px]` to
  `w-[70vw] max-w-[300px] sm:w-[280px]`. Rail gap changes from `gap-5` to
  `gap-4 sm:gap-6`. Resulting card width and peek of the next card:
  - 320: 224px card, 60px peek.
  - 390: 273px card, 81px peek.
  - 430: 300px card, 94px peek.
  The peek signals "more" without arrows.
- Snap: keep `snap-x snap-mandatory`, `snap-start`, `scroll-pl-5`, `pl-5 pr-5` (phones).
- Arrows: unchanged (`hidden sm:flex`).
- Tile hover scale: Tailwind v4 `hover:`/`group-hover:` only apply under
  `(hover: hover)`, so there's no sticky scale on tap. Nothing to do.
- **Tests:** in `tests/Carousel.test.tsx`, `stubMatchMedia` must also answer the
  fine-pointer query. Add a `finePointer = true` parameter so `matches` is
  `!reducedMotion` for the combined query. Add one test: "no drift and no Pause button
  on a coarse pointer". This is a deliberate behaviour change, not a weakened assertion.

#### (e) Event page: `components/EventDetailsView.tsx`

Phone order: back link, full-bleed square poster, eyebrow + title + key facts, demo
notice, description, Good to know, **buy bar (sticky)**, When/Where/Organiser, Tickets.

- Wrapper: change `py-8 gap-10` to `pt-2 pb-12 gap-6 sm:py-14 sm:gap-10`.
- Back link: add `inline-flex min-h-11 items-center` (a 44px target, same look).
- Grid: change `gap-10` to `gap-8 lg:gap-14`. Main column: change `gap-10` to `gap-6 sm:gap-10`.
- **Poster:** `EventArt` gets
  `order-first lg:order-none -mx-5 w-[calc(100%+2.5rem)] aspect-square sm:mx-0 sm:w-full sm:aspect-[4/3]`.
  Moving it visually above the title is safe for reading and focus order because it
  is `aria-hidden` and not focusable.
- **Title block:** eyebrow category, then h1 `display-lg`, then a new **key-facts**
  paragraph with `lg:hidden text-sm leading-5`:
  - Line 1: `formatEventDateTimeRange(startsAt, endsAt)` in `text-foreground`.
  - Line 2: `{venueName} · {suburb}` in `text-muted`.
  - This mirrors DICE's date/venue directly under the title. Desktop already shows
    these in the sticky aside beside the title.
- Description: `text-base leading-relaxed sm:text-lg`.
- **Sticky buy bar** is a new grid child placed between the main column and `<aside>`,
  so it is `lg:hidden` and CSS-only:
  - Why it works:
    - `position: sticky; bottom: 0` inside the page grid, whose box starts at the top
      of the content, keeps it pinned to the bottom of the viewport while the reader
      is in the poster and description.
    - It **settles in its natural place directly above When/Where + Tickets**, so it
      can never cover the ticket selector or the footer.
    - It needs no IntersectionObserver.
  - Markup:
    ```
    <div data-buy-bar className="sticky bottom-0 z-20 -mx-5 sm:-mx-8 lg:hidden
         flex min-h-18 items-center justify-between gap-4 bg-foreground px-5 sm:px-8
         pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-background">
      <div className="min-w-0">
        <p className="text-base font-semibold leading-5 tabular-nums">{amount}</p>   // "From A$31.70" | "A$55" | "Free"
        <p className="text-xs leading-4 text-background/70">{note}</p>            // "incl. booking fee" | "No booking fee"
      </div>
      <a href="#tickets" className="btn btn-lg shrink-0 border-background bg-background text-foreground">
        {demo ? "See tickets" : "Get tickets"}
      </a>
    </div>
    ```
  - Price source: add `formatFeedPriceParts(event): { amount: string; note: string }` to
    `lib/pricing.ts`, next to `formatFeedPrice` and built from the same
    `getMinBuyerTotalCents`. This keeps a single price source that is all-inclusive by
    construction. Add unit tests for free, single-price and multi-price events, and
    for organiser-absorbs.
  - Edge case: if `event.ticketTypes.length === 0`, don't render the bar.
    `getMinBuyerTotalCents` would return `Infinity`.
  - At 320: the amount column is ~120px and the CTA is ~140px. Both fit, with the note
    on its own line.
- **Tickets anchor:** wrap the Tickets `Panel` in
  `<div id="tickets" tabIndex={-1} className="focus:outline-none">`. Fragment
  navigation then moves focus into the ticket area, so keyboard and screen-reader
  users land where sighted users do. `scroll-padding-top` keeps it clear of the
  header. Smooth scrolling happens only under `no-preference`.
- The aside is unchanged at `lg` (sticky right column). On phones, change its
  `gap-8` to `gap-6 sm:gap-8`.
- **States:**
  - Live loading, error and not-found: `LiveEventDetails` returns early, so there is
    no bar.
  - Demo: the bar shows the price and "See tickets", and the selector explains that
    checkout is unavailable.
  - `focus-visible` on the bar CTA: add `focus-visible:outline-background` so the ring
    is visible on black.

#### (f) Ticket selector on phone: `components/TicketSelector.tsx`

- Ticket row (`li`): keep `bg-surface p-4`. Change `gap-3` to `gap-4`.
- Ticket name: `text-base font-semibold`.
- Description: `text-sm text-muted` (4.5:1 on surface, never smaller).
- **Headline price:** `mt-1 text-base font-semibold tabular-nums` (it was `text-sm`
  regular). This is the all-inclusive number and must be the loudest thing in the row.
- Breakdown: stays `text-xs text-muted`.
- Stepper: keep the 44px circles. Change the count to `w-10 text-lg tabular-nums`.
  Phones keep the stacked layout (`flex-col`). At 320 there is 248px inside the row,
  and a side-by-side stepper would leave ~100px for the name and price.
- Order summary: `h3` unchanged. The Total row is `text-base`.
- **Checkout (live):** `btn btn-solid btn-lg mt-4 w-full` (48px). The label and the
  loading state (`Redirecting to checkout…`) are unchanged. The disabled state keeps
  `.btn:disabled` at opacity 0.5.
- **Demo disabled button:** replace the ad-hoc classes with
  `btn btn-lg mt-4 w-full cursor-not-allowed border-surface-border bg-surface-border text-muted`.
  Keep `disabled` and `aria-disabled`, and keep the text.
- Email input: add `min-h-12 text-base`, to stop iOS zoom and give a 48px target.
  Error states are unchanged (`role="alert"`, `aria-invalid`).
- Keep the fee disclosure paragraph above the selector in `EventDetailsView` as it is.

#### (g) Footer: `components/Footer.tsx`

- Container: change `pt-16 pb-8` to `pt-12 pb-8 sm:pt-24`.
- Wordmark: `text-[2.5rem] leading-[0.85] sm:display-xl`. Anton is set by
  `font-heading uppercase`, and the wordmark is 40px on phones. Put
  `font-heading uppercase` on the `<p>` so the phone value doesn't depend on
  `display-xl`.
- Grid: change `gap-12` to `gap-8 lg:gap-12`. Blurb and wordmark: change `gap-8` to `gap-4 sm:gap-8`.
- Link columns: `grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3`. Each column gets
  `gap-1`. Each link gets `py-1`, which makes a 28px tall target and passes 2.5.8.
  Put **Resources first in DOM order on phones?** No: keep the order and let
  Resources wrap. The changes above already bring it to target.
- Legal row: change `mt-16` to `mt-10 sm:mt-16` and add `gap-3`.
- **Target:** footer ≤ 540px at 390 (from ~650).

#### (h) Search and list results on phone

**`app/search/page.tsx`:**
- `PageHeader`: `mb-6 sm:mb-14`. Pass that through a new
  `className`/`compact` prop, or change `mb-10` to `mb-6` in `PageHeader` globally
  for phones only (`mb-6 sm:mb-14`). The second option is preferred because it is
  one line and every page benefits.
- SearchBar `size="lg"` on phones: `py-3 pl-12 text-base`, and `sm:py-4 sm:text-lg`
  from `sm`. Wrapper: `mb-8 sm:mb-12`.
- SearchBar `size="sm"` (desktop header only now): leave it.

**Results layout:**
- Add `layout?: "rail" | "list"` (default `"rail"`) to `EventResults`, and thread it
  from `app/search/page.tsx` through `EventFeed` to `EventBrowser` / `LiveEventFeed`.
  This is an additive prop, so Home is unchanged.
- `layout="list"` renders `<ul className="flex flex-col sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4">`
  with **no carousel**. Each `<li>` contains `<EventTile event layout="row" />`.

**`ui/EventTile.tsx`:** add `layout?: "stack" | "row"` (default `"stack"`, unchanged).

`row` on phones:
- Link classes: `grid grid-cols-[6rem_1fr] items-start gap-4 border-b border-surface-border py-4`.
  From `sm` up: `sm:flex sm:flex-col sm:gap-3 sm:border-0 sm:py-0`, the same as `stack`.
- Art: `aspect-square`, 96px wide on phones.
- The category sticker is `hidden sm:inline`. On phones the category shows as an
  eyebrow line above the title (`sm:hidden eyebrow text-muted`).
- Title: `line-clamp-2`. Venue: `truncate`. The price line is unchanged.
- The whole row is one link, at least 96px tall.

**States:**
- Loading: `Loading events…` (existing).
- Empty: `EmptyState` (existing).
- Error: `Notice` + Try again (existing).
- Load more: an outline pill with `w-full sm:w-auto` on phones and `btn-lg`.

Map list (`SceneEventRow`): keep its anatomy. Pass `imageUrl={event.imageUrl}` to
`EventArt`. That is a one-prop fix and a data-display change, not a behaviour change.

#### (i) Map page: `SceneMap.tsx`, `SceneMapFilterBar.tsx`, `SceneMapPanel.tsx`

- Page wrapper (`app/map/page.tsx`): change `py-12` to `pt-6 pb-12 sm:py-20`.
- The H1 picks up the phone `display-lg`. Change the intro `text-sm` to phone-only
  `text-sm leading-5`. The layout is otherwise unchanged.
- **Filters:** the search input stays visible. The location, time, date, category and
  price controls go behind the same **Filters** disclosure pattern as (c) on phones
  (`sm:hidden` toggle, `hidden sm:flex` panel). The active-filter chips row that
  already exists stays visible outside the disclosure as the summary.
- Replace the 🔍 emoji with the SearchBar magnifier SVG (`h-4 w-4 text-muted`).
  Replace the `⌖` glyphs with a 16px SVG crosshair (circle r=6 plus 4 ticks,
  `stroke-width 2`).
- Control heights: pills, selects and date are `h-11 sm:h-9`. Inputs use
  `text-base sm:text-sm`.
- **One scroll area on phones:** the list panel changes to
  `h-auto overflow-visible lg:h-[600px] lg:overflow-y-auto`. The map panel changes to
  `h-[60svh] min-h-[360px] lg:h-[600px]`. The `scrollIntoView` calls work against
  the page scroll unchanged.
- In `SceneMapPanel`, add `isolate` to the root `div` so Leaflet's z-indexes stay
  below the sticky header.
- The selected-event bottom card (`fixed … bottom-3`): add
  `bottom-[calc(0.75rem+env(safe-area-inset-bottom))]`, replace `shadow-xl` with no
  shadow (the border is enough), and make "View" `rounded-full` pill `px-5`
  (48px tall).

#### (j) Home lower sections: `components/HomeSections.tsx`

- WhatElse:
  - Section: change `py-16 gap-12` to `py-12 gap-8 sm:py-24 sm:gap-12`.
  - Art column: add `hidden lg:block` to the `aria-hidden` wrapper.
  - List items: `text-2xl` stays.
- PartnerBand:
  - Inner: change `py-16` to `py-12 sm:py-24`.
  - Word cloud: add `hidden lg:flex` (it's decorative and duplicates the marquee).
  - H2 `display-lg` picks up the phone size.
  - CTA: `ButtonLink variant="light" size="lg"`.

#### (k) Content pages: `ContentPage.tsx`, `ui/Section.tsx`

- `Page`: change `py-12` to `pt-8 pb-12 sm:py-20`.
- `PageHeader`: change `mb-10` to `mb-6 sm:mb-14`, and change the header `gap-6` to `gap-4 sm:gap-6`.
- ContentPage h2: `[&_h2]:text-[1.625rem] sm:[&_h2]:text-3xl`. Section `pt-6` is unchanged.

#### (l) Confirmation: `CheckoutConfirmation.tsx`, `TicketStub.tsx`

These are already acceptable on phones. One change: in `TicketStub`, change the code
from `text-2xl tracking-widest` to `text-xl tracking-wider sm:text-2xl sm:tracking-widest`
so 10–12 char codes don't wrap at 320. The `UBarcode` at `h-28` is unchanged.

### 3.4 Motion

| What | Behaviour | Reduced motion |
| --- | --- | --- |
| Carousel drift | Only on fine-pointer, hover-capable devices (desktop). None on phones. | None (existing). |
| Anchor jump to `#tickets` | `scroll-behavior: smooth` | Instant |
| Menu | No animation | — |
| Filters chevron | 150ms rotate | `motion-safe:` only |
| Marquee | Hidden on phones. Desktop unchanged (see §5 for 2.2.2). | `motion-reduce:animate-none` (existing) |
| Tile hover scale | Hover-capable devices only (Tailwind v4 default) | — |
| Colour transitions | 150ms on `.btn` (existing) | — |

---

## 4. Implementation plan (one increment per PR, desktop unchanged at each step)

For every step, verify at **320, 375, 390, 430** (DevTools device mode) and
**1024 and 1280** (desktop regression). Run `npx tsc --noEmit`, `npm run lint` and
`npm test`. Run `npm run test:e2e` where noted. Check both demo mode and live mode
(`NEXT_PUBLIC_SUPABASE_*` set).

1. **Tokens.** Files: `app/globals.css` (`--header-h`, `--buybar-h`, scroll padding,
   smooth scroll, display phone sizes, `.btn-lg`), `app/layout.tsx`
   (`data-scroll-behavior`), `components/ui/Button.tsx` (`size="lg"`),
   `components/ui/Field.tsx` (16px fields).
   *Verify:* `/`, `/help`, `/login` at phone widths. The hero h1 is 2 lines at 320
   with no overflow. Focusing inputs on iOS (or the Safari responsive mode) doesn't
   zoom. Font sizes at ≥640 are unchanged (compare computed `font-size` of `h1` at
   1280 before and after). Run `npm run build` to confirm the nested `@media` compiles.
2. **Compact header + menu.** Files: `components/Nav.tsx`, `components/AuthNavLinks.tsx`.
   *Verify:*
   - `document.querySelector('header').offsetHeight === 56` at all phone widths and
     68 (±measured) at 1280.
   - The menu opens and closes from the button. Escape closes it and returns focus to
     "Menu". Outside tap closes it. Tapping a link navigates and closes it.
   - Tab order: Menu, then the first link.
   - Signed out, signed in, admin and demo states each show the right items.
   - Tab through `/` and confirm no focused element hides under the header.
   - Add a Vitest test that renders `Nav` and asserts every destination link exists
     in the menu.
3. **Home spacing and hero.** Files: `IntentHero.tsx`, `app/page.tsx`, `ui/Section.tsx`
   (`SectionHeader`), `HomeSections.tsx`.
   *Verify:* at 390x844 the first poster top is ≤ 620 (demo) and ≤ 560 (live). The
   intent row is a single scrolling row. The desktop hero collage and marquee are unchanged.
4. **Filters disclosure (feed).** Files: `EventFilterBar.tsx`, `EventBrowser.tsx`,
   `LiveEventFeed.tsx`, `EventFeed.tsx`.
   *Verify:* toggle `aria-expanded`, the count updates, and reset works. Run
   `npx vitest run tests/LiveEventFeed.test.tsx` and **`npm run test:e2e`** (desktop,
   so the filters must stay visible).
5. **Carousel on touch.** Files: `ui/Carousel.tsx`, `tests/Carousel.test.tsx`.
   *Verify:* in device mode with touch emulation there is no Pause button and the rail
   starts at the soonest event. At 1280 with a mouse, drift and Pause work as before.
   All Carousel tests pass, plus the new coarse-pointer test.
6. **Event page + buy bar.** Files: `EventDetailsView.tsx`, `lib/pricing.ts` (+ a test
   in `tests/`).
   *Verify:*
   - `/events/<slug>` in demo and live, at 320 and 390.
   - The bar is pinned while reading and settles above When/Where. It never overlaps
     the tickets or the footer.
   - "Get tickets" jumps (smoothly, instant under reduced motion) and moves focus to `#tickets`.
   - Free, single-price and multi-price events show the correct all-inclusive amount.
   - Nothing changes at 1024 or 1280 (aside sticky, no bar).
7. **Ticket selector.** File: `TicketSelector.tsx`.
   *Verify:* 48px Checkout, the stepper at 320, the demo disabled button, the free-order
   email field and its error state (live mode).
8. **Footer.** File: `Footer.tsx`.
   *Verify:* ≤ 540px tall at 390, and the desktop layout is unchanged.
9. **Search list layout.** Files: `ui/EventTile.tsx`, `EventResults.tsx`, `EventFeed.tsx`,
   `EventBrowser.tsx`, `LiveEventFeed.tsx`, `app/search/page.tsx`.
   *Verify:*
   - `/search?q=a` at phone widths shows rows; `sm+` shows the grid.
   - Home still uses the rail.
   - Load more still works (`tests/LiveEventFeed.test.tsx`, e2e).
10. **Map.** Files: `app/map/page.tsx`, `SceneMap.tsx`, `SceneMapFilterBar.tsx`,
    `SceneMapPanel.tsx`, `SceneEventRow.tsx`.
    *Verify:*
    - There is a single page scroll on phones.
    - The map doesn't paint over the header when scrolled.
    - There is no emoji left (`grep -n "&#128269;" components`).
    - The selected-event card clears the home indicator.
    - The desktop split view is unchanged.
11. **Content pages + confirmation.** Files: `ContentPage.tsx`, `ui/Section.tsx`
    (`Page`, `PageHeader`), `tickets/TicketStub.tsx`.
    *Verify:* `/help`, `/about`, `/privacy`, and `/checkout/success` with a mocked
    order at 320.
12. **Docs.** Update `docs/design-system.md` (header, `btn-lg`, buy bar, list layout,
    phone type scale).

After step 12, run `ux-accessibility-reviewer` (menu, disclosure, buy bar) and then
`visual-qa` against this spec.

---

## 5. Out of scope / needs backend or product decisions

- **Not built, so not specified** (flag if a DICE pattern is wanted):
  - Saved events / hearts
  - "Who's Going" social signal (MVP item 6, not started)
  - App download buttons
  - Audio previews / play buttons
  - Personalised rails
  - Ticket wallet / transfer
  - Sold-out and waitlist states. `TicketType.quantityAvailable` exists, but there is
    no designed "sold out" UI. That's a product decision on the copy and whether the
    buy bar changes.
- **Image focal point (backend):** a square phone crop of organiser photos needs a
  stored focal point (e.g. `imageFocalX/Y` 0–1 mapped to `object-position`). Until
  then the crop is centred.
- **Responsive image pipeline (backend/infra):** `imageUrl` is served at original size
  via `<img>`. Phones would benefit from resized variants (Supabase image
  transformations or `next/image` with `remotePatterns`). Nothing in this spec depends
  on it.
- **Safe-area `viewportFit: "cover"`:** only if iOS QA shows the buy bar under the
  home indicator. It needs a follow-up adding `max(1.25rem, env(safe-area-inset-left/right))`
  gutters globally.
- **Marquee WCAG 2.2.2 on desktop:** it scrolls indefinitely with no pause control.
  Options are a pause toggle, stopping after one loop, or making it static. This is an
  accessibility/product call, and on phones it is simply hidden by this spec.
- **Quick category chips on the feed** (DICE-style genre pills above the rail): these
  would duplicate the Category select's state and add a second control with the same
  meaning. It's a product decision, and it would need e2e selector review
  (`getByLabel("Category")`).
- **Map list/map toggle semantics:** it uses `role="tablist"` without tab panels. Route
  it to `ux-accessibility-reviewer`.
- **Legacy `ORANGE`/inline-style constants** in the map components (all `#0b0b0b`)
  should become tokens. That's cleanup, not part of this pass.
- **Sticky order summary inside the ticket selector:** not needed for 1–3 ticket types.
  Revisit if organisers commonly list more than 3 types.
