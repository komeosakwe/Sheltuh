import { getImageProps } from "next/image";

/**
 * Event photos the image optimizer may resize (`/_next/image`, next.config.ts `images.localPatterns`): only
 * the sample photos in public/events (the demo's, and the site's own stock photos). A published event's
 * photo (`/api/events/{id}/image?v=…`) never goes through it: an optimized copy outlives the photo's
 * takedown (next.config.ts says why), so it's used as it is, as is anything else (an object URL for a
 * photo being uploaded, another site's URL).
 */
const OPTIMIZABLE_PHOTO = /^\/events\/[\w-]+\.(?:jpe?g|png|webp)$/i;

/** Whether `src` is a photo the optimizer may resize (OPTIMIZABLE_PHOTO). */
export function isOptimizablePhoto(src: string): boolean {
  return OPTIMIZABLE_PHOTO.test(src);
}

/**
 * An event card's photo box at each width (EventCard): the home grid's one, two, three and four columns
 * (components/ui/grids.ts HOME_GRID); narrower rows and lists stay within it.
 */
export const CARD_PHOTO_SIZES = "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";

/** The home banner's slide: the page column (the page-container utility: 16px, 32px from 768, 64px from 1280; 1440px at most). */
export const BANNER_PHOTO_SIZES =
  "(min-width: 1568px) 1440px, (min-width: 1280px) calc(100vw - 8rem), (min-width: 768px) calc(100vw - 4rem), calc(100vw - 2rem)";

/** The event page's photo: the page column below 1024px, then 7 of 12 columns, 8 of 12 from 1280px. */
export const EVENT_PAGE_PHOTO_SIZES = "(min-width: 1280px) 66vw, (min-width: 1024px) 58vw, 100vw";

/** A ticket's photo row: the ticket is 360px at most, and the full width of a phone when it's shown full screen. */
export const TICKET_PHOTO_SIZES = "(min-width: 768px) 360px, 100vw";

export interface ResponsivePhoto {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * An event photo's `src`, `srcSet` and `sizes` for a plain `<img>` that fills its box: for a stock photo
 * (isOptimizablePhoto), the browser picks the smallest copy that is sharp at the box's width (`sizes`,
 * which must describe the layout) on its screen, in WebP or AVIF where it can show them, rather than the
 * full-size file. With no `sizes`, or any other photo (an organiser's upload above all), it's the photo
 * unchanged.
 */
export function responsivePhoto(src: string, sizes: string | undefined): ResponsivePhoto {
  if (!sizes || !isOptimizablePhoto(src)) return { src };
  const { props } = getImageProps({ src, alt: "", fill: true, sizes });
  return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
}
