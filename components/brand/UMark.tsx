import BrandSvg, { type BrandSvgProps } from "./BrandSvg";
import { U_MARK } from "./marks";

/**
 * The secondary ü logo (favicon, app icons, the Sheltüh system avatar).
 * Minimum 16px tall; clear space 50% of its width (brand-direction-one.md §4).
 */
export default function UMark(props: BrandSvgProps) {
  return <BrandSvg mark={U_MARK} {...props} />;
}
