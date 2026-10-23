import BrandSvg, { type BrandSvgProps } from "./BrandSvg";
import { WORDMARK, WORDMARK_LOWERCASE } from "./marks";

/**
 * The Sheltüh wordmark, drawn from the official vector (never typeset).
 * Uppercase is the primary logo (nav, footer sign-off, OG image); `lowercase`
 * is the secondary, for informal moments only. Minimum 16px tall uppercase,
 * 20px lowercase; clear space 25% of its height on every side
 * (docs/design/brand-direction-one.md §4). Colour comes from `text-*`.
 */
export default function Wordmark({ lowercase = false, ...props }: BrandSvgProps & { lowercase?: boolean }) {
  return <BrandSvg mark={lowercase ? WORDMARK_LOWERCASE : WORDMARK} {...props} />;
}
