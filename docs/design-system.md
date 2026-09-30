# Sheltüh design system

Editorial, cultural, minimal. Black + off-white carry the UI; event posters and
photography are the colour. No gradients, glass, heavy shadows or rounded cards
(one scoped exception: the phone home, below).

## Tokens (`app/globals.css`)

Semantic colour tokens (`background`, `foreground`, `surface`, `surface-border`,
`muted`, `accent`, `danger`, `highlight`) — components only use these, so the
whole app re-skins from one place. `highlight` (acid yellow) is for a single
sticker-style label per page, at most.

Type: Bricolage Grotesque 800 (display, `font-heading`, loaded in `app/layout.tsx`)
+ Inter (body, `font-sans`). Utilities: `display-xl`, `display-lg`, `display-md`,
`eyebrow` (small tracked caps). h1–h4 default to the display face.

Shape: square everything; **only** pill buttons (`.btn`) and small round
controls are rounded. Hairline rules (`border-t border-foreground`) instead of boxes.

### Phone home exception (`docs/design/mobile-home.md`)

The home page below 640px (`components/home/phone/`) is softer, and only there:
`rounded-card` (1rem) + `shadow-card` on light cards, `rounded-badge` on the date
badge, `bg-card` (lifted paper) and `pop` pink (decoration and fills behind black
text, never text on paper). Yellow `highlight` also marks the search submit and
"Free" badges there. `tests/phone-home-tokens.test.ts` fails if these classes
appear outside `components/home/phone/` (and `ui/Sticker.tsx`, home of `Scribble`).
Shared components and desktop stay square and flat.

## Components (`components/ui/`)

| Component | Use |
| --- | --- |
| `Button`, `ButtonLink`, `buttonClass` | Pill CTAs: `solid`, `outline`, `light`, `danger`; sizes `sm`/`md`/`lg` (48px thumb actions). CSS lives in `.btn*` |
| `Page`, `PageHeader`, `SectionHeader` | Page container and the oversized-title + intro + CTA header row |
| `Panel`, `EmptyState`, `Notice` | Ruled sections, empty states, inline errors/info |
| `EventTile` | Poster-first tile with metadata beneath |
| `Carousel`, `CarouselItem` | Horizontal scroll-snap rail (desktop home, `/events`); drifts with a Pause control |
| `Field`, `fieldClass` | Labelled flat form controls |
| `Sticker` (`RoundBadge`, `Burst`, `Marquee`, `Scribble`) | Occasional expressive graphics; decorative, `aria-hidden` |

Phone home (`components/home/phone/`): `PhoneRail` (CSS-only scroll-snap rail, no
arrows, drift or listeners), `HomeEventCard` (`standard`/`wide`/`compact`),
`FeaturedEventCard`, `GoingStack` (avatar discs; never an invented number),
`SectionHead`, `CategoryRow`. Shared loaders: `lib/home-events.ts` (one request set
for both home trees), `lib/home-sections.ts`.

`components/EventResults.tsx` lays out feed results (the first 24 in a carousel, later
pages in a grid). Map uses Esri light-gray tiles.
