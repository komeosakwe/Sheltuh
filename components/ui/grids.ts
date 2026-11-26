/**
 * The home's card grid, also the organiser profile's upcoming events (the rules' Layout board,
 * Round 2 §1.2): one column below 768px, two from 768px, three from 1024px and four from 1280px, so a card is never narrower than its foot needs to
 * sit on one line (who's going and the price label: 16rem): 304px at 1440 (1312px of content, 32px
 * gutters; up to 336px on wider screens), 264px at 1280 (64px margins), 298px at 1024 and 340px at 768. Gutters 16 / 24 / 32px,
 * rows 32px apart.
 */
export const HOME_GRID = "grid grid-cols-1 gap-x-4 gap-y-8 md:grid-cols-2 md:gap-x-6 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4";

/**
 * Saved's own grid (Latte's Saved frames), which My tickets shares: one card per row on phones, two
 * from 768px (328px cards at 768) and three from 1280px; 16px across and 24px down (16 down on
 * phones). The cards carry their own 16px padding.
 */
export const SAVED_GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-y-6 xl:grid-cols-3";
