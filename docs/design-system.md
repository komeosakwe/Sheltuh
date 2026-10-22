# Sheltüh design system

> **Source of truth: [`docs/design/brand-direction-one.md`](design/brand-direction-one.md)** (Brand Direction One, "Structured Expression", adopted 21 Oct 2026). It defines the colours, type, logo use, the two-dot motif, radii, components, page direction, motion and the implementation order. Where this file or any older spec disagrees on visuals, that spec wins. This file is the short index and the record of what's built.

## Status

The brand rollout is in progress, following the increments in `brand-direction-one.md` §9. Until an increment lands, the code still uses the earlier tokens described under "Legacy" below. Update this file as each increment ships.

## The system in one screen

- **Colour:** Cream `#fffae7` background, White `#ffffff` cards and fields, Black `#000000` text and structure, and **Signal Orange `#ff4800`** for signature fills, the primary conversion CTA (one per view) and large display text only.
  - Orange is **never small text on light backgrounds** (3.25:1). Black on orange is 6.18:1.
  - Light only. Ink sections use `data-surface="ink"`; the one orange band per page uses `data-surface="signal"`.
  - The door check-in keeps its own functional palette (`[data-door]`, `--door-*`, `docs/design/check-in.md`).
- **Type:**
  - **Bootzy** (display token `--face-display`). Not yet licensed into the repo; Instrument Sans 700 set tight stands in, and it swaps with one token block (§3.4).
  - **Instrument Sans** for UI, headings and body.
  - **IBM Plex Mono** for metadata, labels and dates (`eyebrow`, `meta`).
- **Logo:** the official vectors in `public/brand/` (wordmark, lowercase wordmark, secondary ü, two-dot mark), inlined via `components/brand/*`. Never typeset the wordmark.
- **Shape:** rounded squares, from the umlaut. `rounded-card` 12px, `rounded-control` 8px, `rounded-badge` 4px, `rounded-dot` 28% for avatars and markers. No pills, no circles, no shadows. Structure comes from 1px black rules and the mono "strap".
- **Motif:** the two dots appear only in the places listed in `brand-direction-one.md` §5 (strap marker, active-nav umlaut, selected chip, loader, connection states, empty states).
- **Pricing:** the all-inclusive total is always first and most prominent; partial prices are secondary (§6.8). Checkout is quiet: black, no orange (§6.9).
- **Motion:** the photo push-in runs one cycle of 5 seconds or less and holds. Nothing loops except the loader while loading. Everything respects `prefers-reduced-motion`.

## Components (`components/ui/`, `components/brand/`)

| Component | Use | Brand spec |
| --- | --- | --- |
| `Button`, `ButtonLink`, `buttonClass` | `signal` (new, orange, max one per view, never in checkout), `solid` (black), `outline`, `danger`; sizes `sm` 32 / `md` 40 / `lg` 48px. CSS in `.btn*`. | §6.1 |
| `Field`, `fieldClass`, `SearchBar` | White, 1px black, `rounded-control`, mono labels | §6.2 |
| `Page`, `PageHeader`, `Strap` | Page container; page header (mono strap + display h1) | §6.4 |
| `SectionHead` | The one section head, site-wide (home, profiles, Saved): black rule, dots + `display-md` h2 (balanced), optional note, optional link on the h2's baseline ("See all …", or "All events" where the target isn't the section's own list). No strap repeating the title. Replaced `SectionHeader` in P2. | `mobile-redesign.md` §6.3.3 |
| `BackLink`, `backLinkClass` | The one back link: Instrument 14/20 semibold, underlined, 44px tall, decorative arrow | `mobile-redesign.md` §3.2 |
| `Panel`, `EmptyState`, `Notice` | Ruled sections, empty states with `DotsMark`, inline errors/info | §6.4, §6.14 |
| `EventCard` (`rail`, `grid`), `EventCardPlaceholder`, `CardPrice`, `GoingStack` | The one event card: image first, then category, date · time, title, venue · suburb (two lines at most), the all-inclusive price, going, the ticket action ("Buy tickets", "Get free tickets", "Get tickets" for external, "Choose seats", outline "Join waitlist"). The whole card opens the event; its link is named title, date, place, price, going. Labels from `lib/event-card.ts`. Replaced `EventTile`, the home cards and `Carousel` (P0). | `mobile-redesign.md` §6.2 |
| `Wordmark`, `UMark`, `DotsMark`, `DotsLoader` (new, `components/brand/`) | Official logo vectors; the two-dot motif and loader | §4, §5 |
| `ShareButton`, `AddToCalendar` (new) | Web Share with a copy-link fallback; Apple Calendar (`/events/{slug}/calendar.ics`), Google Calendar and Outlook | §6.7 |
| `Sticker` (`RoundBadge`, `Burst`, `Marquee`, `Scribble`) | **Retiring.** Not part of the brand; delete with their last users. | §8.4 |

Home (`components/home/`, spec `docs/design/mobile-redesign.md`, which supersedes `home.md` and `mobile-home.md` for the hero, section order and cards): `HomeHero`, `HomeEventSections`, `HomeRail` (a rail on phones; 2 / 3 / 4 columns from 640 / 768 / 1024px), `CategoryRow`, `CommunitySection`, `CreatorsCard`. Shared loaders: `lib/home-events.ts`, `lib/home-sections.ts`.

`components/EventResults.tsx` lays out feed results (the first 24 in a carousel, later pages in a grid; `layout="grid"` puts everything in the grid, as on `/saved`). The map uses Esri light-gray tiles. Markers are `rounded-dot` with a black ring, orange when selected; category colours are retired (§2.7, §6.15).

Favourites (`components/favourites/`, spec `docs/design/favourites-analytics.md`):
- `SaveButton` has variants `overlay` over art, `plain` on compact cards, `onDark` in the buy bar, and `pill` by the event title. It's a toggle with a fixed name and `aria-pressed`, and a sign-in link when signed out.
- Also `HeartIcon`, `SavedNavLink`, and the `FavouritesNotice` band (an ink bar, never a toast).
- The heart is black (cream on ink), never orange.

Analytics (`components/analytics/`):
- `StatGrid`: Instrument Sans tabular numerals on a hairline, change in words.
- `DataTable`: a table from `sm`, definition lists on phones; optional row groups.
- `TimeSeriesChart`: inline SVG black bars, dashed previous period, HTML axis text, always followed by a table.
- `ValueOrNoData`: "—" shown, "No data" read.
- Formatting lives in `lib/analytics-format.ts`: money always with cents, counts never abbreviated.
- Dashboards and admin are dense and black-structured, with no orange except the "On sale" badge (§6.16).

## Review gates (tests)

- `tests/door-tokens.test.ts`: the door palette stays scoped to the scanner. Unchanged by the brand rollout.
- `tests/pwa-manifest.test.ts`: `APP_THEME_COLOR` equals the first `--background` in `globals.css` (Cream after increment 1).
- `tests/brand-tokens.test.ts` (added in increment 1, extended in increments 5 and 11): brand hex values defined; no `pop`, `highlight` or `shadow-card` in components; `text-signal` never combined with small-text classes. It replaces `tests/phone-home-tokens.test.ts`.

## Legacy (until the increments land)

These were the tokens before 21 Oct 2026; they're kept here only so reviewers can recognise them. Paper `#f3f0e8` / ink `#0b0b0b`; Bricolage Grotesque 800 + Inter; pill buttons; square elsewhere; the phone-home exception (`rounded-card` 16px + `shadow-card`, `bg-card`, `pop` pink `#ff4fb0`, yellow `highlight` `#e8ff3a`); map category hues `--cat-*`. All of these are superseded by `brand-direction-one.md` §2.
