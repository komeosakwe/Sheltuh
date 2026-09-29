# Sheltüh design system

Editorial, cultural, minimal. Black + off-white carry the UI; event posters and
photography are the colour. No gradients, glass, heavy shadows or rounded cards.

## Tokens (`app/globals.css`)

Semantic colour tokens (`background`, `foreground`, `surface`, `surface-border`,
`muted`, `accent`, `danger`, `highlight`) — components only use these, so the
whole app re-skins from one place. `highlight` (acid yellow) is for a single
sticker-style label per page, at most.

Type: Anton (display, condensed) + Inter (body). Utilities: `display-xl`,
`display-lg`, `display-md`, `eyebrow` (small tracked caps). h1–h4 default to the
display face.

Shape: square everything; **only** pill buttons (`.btn`) and small round
controls are rounded. Hairline rules (`border-t border-foreground`) instead of boxes.

## Components (`components/ui/`)

| Component | Use |
| --- | --- |
| `Button`, `ButtonLink`, `buttonClass` | Pill CTAs: `solid`, `outline`, `light`, `danger`; sizes `sm`/`md`. CSS lives in `.btn*` |
| `Page`, `PageHeader`, `SectionHeader` | Page container and the oversized-title + intro + CTA header row |
| `Panel`, `EmptyState`, `Notice` | Ruled sections, empty states, inline errors/info |
| `EventTile` | Poster-first tile with metadata beneath |
| `Carousel`, `CarouselItem` | Horizontal scroll-snap rail |
| `Field`, `fieldClass` | Labelled flat form controls |
| `Sticker` (`RoundBadge`, `Burst`, `Marquee`) | Occasional expressive graphics; decorative, `aria-hidden` |

`components/EventResults.tsx` lays out feed results (the first 24 in a carousel, later
pages in a grid). Map uses Esri light-gray tiles.
