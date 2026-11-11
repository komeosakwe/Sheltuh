# Sheltüh design system

> **Source of truth: the redesign** ("Sheltüh · Rules", the design rules boards, with the site redesign proposal and the website audit; Batch 1, Nov 2026). It supersedes [`design/brand-direction-one.md`](design/brand-direction-one.md), `design/mobile-redesign.md` and `design/home.md` wherever they disagree on visuals. This file is the short index and the record of what's built.

## Status

Batch 1, PR 1 (foundations) has landed: the tokens, the fonts, the type styles, buttons, chips, tags and the one event card. The header, footer, search, home, event page, Nearby and organiser pages are re-skinned in the PRs after it; until then they pick up the shared tokens and components only. Tokens still used by screens that haven't been redone (`--panel`, `--tint`, `--signal-ink`, `--night`, `--lilac`, `--sand`, `--peach`, `--soft-line`, `--signal-text`, `--shadow-soft`, `--shadow-float`) are retired with their last user.

## The system in one screen

- **Colour** (`app/globals.css`; Light / Dark, and the ink scope takes the Dark values):
  - surface/page `--background` #fff / #000; text/primary and border/strong `--foreground` #000 / #fff;
  - surface/muted `--surface` #f2f1ee / #1f1f1f; border/subtle `--surface-border` #e5e3de / #333 (1px dividers only);
  - text/secondary `--muted` #5c5c5c / #a3a3a3; text/disabled `--disabled` #a3a3a3 / #5c5c5c;
  - surface/card-hover `--hover` (`bg-hover`) cream #fffae7 / #1a1a1a: the hover fill of cards and filters, never a default fill.
  - **Signal Orange #ff4800** (`--signal`) is for the main action and the two-dot motif only, always with black text (6.18:1). Never small orange text on white, never an orange border or focus ring.
  - Category tints (`CategoryTag`, `[data-tag]`): live music, art, workshop, pop-up, theatre, fashion (defined, no category yet), free; each pair is at least 4.5:1 and swaps in Dark (`tests/tag-contrast.test.ts`). Tags only, never section or button fills.
- **Type** (`app/fonts.ts`): **Bootzy** (`--face-display`) for display headlines only, Regular with no synthesised bold and no size-adjusted fallback (missing glyphs fall to Instrument Sans); **Instrument Sans** for UI, headings, body, buttons and nav; **IBM Plex Mono** for facts (dates, times, places, eyebrows). The fifteen styles are utilities: `display-xl` / `display-l` / `display-m` (Bootzy, capitals), `heading-h1` … `heading-h4`, `body-l` / `body-m` / `body-s`, `label-nav`, `label-button`, `label-tag`, `mono-m`, `mono-s`. Display and Heading step down below 768px. The old names point at them: `display-lg` = heading-h1 (sentence case), `display-md` = heading-h3, `title-lg` = display-m, `eyebrow` = mono-s in capitals, `meta` = mono-s.
- **Ü**: only in display headlines, through `BrandU` (shown "FIND YOÜR NEXT THING.", read "Find your next thing."). The dotted body face and `DottedLine` are gone.
- **Shape**: radius 8 (`rounded-control`, `rounded-badge`) for things you tap and for tags, 16 (`rounded-card`, `rounded-sheet`, `rounded-panel`) for things you look at. People's avatars are round. No pills (the Google button keeps its own, per Google's rules) and no shadows. Chips, filters, inputs and secondary buttons have the 1.5px foreground stroke (`border-control`, `--stroke-control`).
- **Focus**: the global `:focus-visible` ring, 2px `--foreground` at a 3px offset: black on white, white in Dark and inside ink, so it shows around black and orange buttons.
- **Layout**: an 8px scale; `page-container` is the 1312px content column with 16 / 32 / 64px margins at 390 / 768 / 1440.
- **Motion**: hover changes colour over 200ms ease-out; no lift and no scale. Everything respects `prefers-reduced-motion`.

## Components (`components/ui/`, `components/brand/`)

| Component | Use |
| --- | --- |
| `Button`, `ButtonLink`, `buttonClass` | `signal` (Primary: orange, black label; black with an orange label on hover; one per view, never in checkout, forms, dashboards or admin), `outline` (Secondary: 1.5px stroke; black with a white label on hover), `solid` (black), `danger`. Sizes `sm` 40, `md` 48 (default), `lg` 56. Label/Button, sentence case. Disabled is grey. CSS in `.btn*`. `secondaryActionClass` is the Secondary look for an icon + label action. |
| `FilterChip`, `filterChipClass` | A toggle chip (`aria-pressed`): 48px, 1.5px stroke, radius 8; cream on hover; foreground-filled when selected, with the two orange dots. |
| `FilterDropdown` | A native `<select>` dressed as a filter: 48px, 1.5px stroke; cream on hover; foreground-filled when `active`. Named by `label`. |
| `CategoryTag` | A non-interactive tag in its category's tint (`tone`: a category, `free` or `neutral`): radius 8, 24px, Label/Tag. |
| `DateChip` | The card's date block (weekday, day, month in the event's zone), white with black text in both themes. Decorative. |
| `PriceTag` | The card's price label: orange with a black label, or `neutral`. Never a link, button or tab stop. |
| `GoingRow` | A card's going line: round faces (demo initials only) and "N going", "(sample)" in the demo. |
| `EventCard` (`rail`, `grid`), `EventCardPlaceholder`, `CardPrice` | The one event card: a 4:3 image (radius 16) with `DateChip` and Save; the tags (category, "Free", "Sold out", "Ended", "Reserved seating", a trending qualifier); the title (heading-h4, two lines); one mono line "SAT 14 NOV · 5PM · COBURG, VIC"; then `GoingRow` and the all-inclusive `CardPrice variant="tag"`. The title's link is the card's only link, stretched over it; Save (and a clip's Play) sit above it as siblings. Hover: a cream panel and a title underline. Sold out: the image at 60%. No ticket button and no "By organiser" (both are on the event page). Labels from `lib/event-card.ts`. |
| `InitialsAvatar` | Initials in a circle; `you` is orange with black initials. |
| `Page`, `PageHeader`, `Strap` | Page container; page header (mono strap + h1: `display-lg`, or `display-l` for a `brand` line) |
| `SectionHead` | The one section head (home, profiles, Saved): `display-md` h2, optional note and link. |
| `BackLink`, `Panel`, `EmptyState`, `Notice` | As before. |
| `BrandU`, `Wordmark`, `UMark`, `DotsMark`, `DotsLoader` (`components/brand/`) | The brand's Ü line, logo vectors, the two-dot motif and loader. |

Favourites (`components/favourites/`): `SaveButton` is a toggle with a fixed name and `aria-pressed` (a sign-in link when signed out). On a card (`overlay`) it's a 32px white square in a 48px target (40px from 768px); saved, the heart fills orange.

## Review gates (tests)

- `tests/brand-tokens.test.ts`: the token values, radii, faces, type styles and buttons above.
- `tests/tag-contrast.test.ts`: every category tag pair is at least 4.5:1 in Light and Dark.
- `tests/bootzy-font.test.ts`: the Bootzy file and README are present, loaded with `adjustFontFallback: false`, and the display stack ends in Instrument Sans.
- `tests/door-tokens.test.ts`: the door palette stays scoped to the scanner.
- `tests/pwa-manifest.test.ts`: `APP_THEME_COLOR` equals the first `--background` in `globals.css`.
