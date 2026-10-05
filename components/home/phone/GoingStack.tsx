/**
 * Overlapping avatar discs. The caller decides whether it renders at all (see
 * the data rules in docs/design/mobile-home.md §5.4); this never invents a
 * number. `sm` is "N going" on a card; `lg` is five big discs and no number.
 */

const FILLS = ["bg-pop text-foreground", "bg-highlight text-foreground", "bg-foreground text-background"];

type Props =
  | {
      size?: "sm";
      count: number;
      initials?: string[];
      /** `dark`: on the featured card's black scrim. */
      tone?: "card" | "dark";
      className?: string;
    }
  | { size: "lg"; initials?: string[]; className?: string };

export default function GoingStack(props: Props) {
  if (props.size === "lg") {
    return (
      <div aria-hidden="true" className={`flex pl-3 ${props.className ?? ""}`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={`-ml-3 flex size-14 items-center justify-center rounded-full text-base leading-none font-semibold uppercase ring-4 ring-background ${FILLS[i % FILLS.length]}`}
          >
            {props.initials?.[i]}
          </span>
        ))}
      </div>
    );
  }

  const dark = props.tone === "dark";
  return (
    <div className={`flex min-h-6 items-center ${props.className ?? ""}`}>
      {/* One letter per small disc, overlapping by 6px: two letters in a 24px disc get covered by the next one. */}
      <span aria-hidden="true" className="flex pl-1.5">
        {Array.from({ length: 3 }, (_, i) => (
          <span
            key={i}
            className={`-ml-1.5 flex size-6 items-center justify-center rounded-full text-[0.625rem] leading-none font-semibold uppercase ring-2 ${
              dark ? "ring-foreground" : "ring-card"
            } ${FILLS[i]}`}
          >
            {Array.from(props.initials?.[i] ?? "")[0]}
          </span>
        ))}
      </span>
      <span className={`ml-2 text-xs leading-4 ${dark ? "text-background/80" : "text-muted"}`}>
        {props.count} going
      </span>
    </div>
  );
}
