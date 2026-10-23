import BrandSvg, { type BrandSvgProps } from "./BrandSvg";
import { DOTS_MARK } from "./marks";

export type DotsMarkSize = "xs" | "sm" | "md" | "lg";

/** 12, 20, 32 and 64px wide; the height follows (width ÷ 3.15). */
const SIZE_CLASS: Record<DotsMarkSize, string> = {
  xs: "w-3",
  sm: "w-5",
  md: "w-8",
  lg: "w-16",
};

/**
 * "Joined" moves the left dot +12.5 and the right dot −12.5 user units,
 * narrowing the gap from one dot to about 0.35 of one. It approximates the
 * brand book's closer-dots variation until that vector arrives (§11).
 */
const JOINED_TRANSFORMS = ["translate(12.5 0)", "translate(-12.5 0)"] as const;

/**
 * The two-dot motif (docs/design/brand-direction-one.md §5), in
 * currentColor. Only for the uses listed there: strap marker, empty states,
 * connection states, the loader. Never as a pattern, background or divider.
 */
export default function DotsMark({
  size = "sm",
  joined = false,
  className = "",
  ...props
}: BrandSvgProps & { size?: DotsMarkSize; joined?: boolean }) {
  return (
    <BrandSvg
      mark={DOTS_MARK}
      pathTransforms={joined ? JOINED_TRANSFORMS : undefined}
      data-joined={joined ? "" : undefined}
      className={`${SIZE_CLASS[size]} h-auto shrink-0 ${className}`.trim()}
      {...props}
    />
  );
}

/**
 * The loader (§5 #4): the dots move together and apart while something
 * loads, beside "{label}…". With reduced motion they hold still and the text
 * carries the state. `announce` makes it a status region; leave it off where
 * the host already owns a live region.
 */
export function DotsLoader({ label = "Loading", announce = false }: { label?: string; announce?: boolean }) {
  return (
    <div role={announce ? "status" : undefined} className="flex items-center gap-3">
      <DotsMark size="md" className="dots-loader text-foreground" />
      <span className="text-sm text-muted">{label}&hellip;</span>
    </div>
  );
}
