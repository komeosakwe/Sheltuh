import DotsMark from "@/components/brand/DotsMark";

/**
 * Overlapping rounded-square avatars (the umlaut's shape). The caller decides
 * whether it renders at all (docs/design/mobile-home.md §5.4); this never
 * invents a number. `sm` is "N going" on a card; `lg` is five big avatars and
 * no number. Fills come from the surface's tokens, so the stack inverts
 * inside an ink or orange section with no extra props. With no initials (live:
 * signed-out visitors never receive names) there are no blank tiles: `sm` is
 * the two dots and "N going", and `lg` isn't shown.
 */

const SM_FILLS = [
  "bg-foreground text-background",
  "bg-card text-foreground border border-foreground",
  "bg-surface text-foreground",
];
/** The orange band's avatars: black, cream and white, each with black or cream initials. */
const LG_FILLS = ["bg-ink text-cream", "bg-cream text-ink", "bg-card text-ink"];

type Props =
  | { size?: "sm"; count: number; initials?: string[]; className?: string; id?: string }
  | { size: "lg"; initials?: string[]; className?: string };

export default function GoingStack(props: Props) {
  const initials = props.initials?.filter(Boolean) ?? [];
  if (props.size === "lg") {
    if (initials.length === 0) return null;
    return (
      <div aria-hidden="true" className={`flex pl-3 ${props.className ?? ""}`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={`-ml-3 flex size-14 items-center justify-center rounded-dot text-base leading-none font-semibold uppercase ring-4 ring-background ${LG_FILLS[i % LG_FILLS.length]}`}
          >
            {initials[i % initials.length]}
          </span>
        ))}
      </div>
    );
  }

  if (initials.length === 0) {
    return (
      <div id={props.id} className={`flex min-h-6 items-center gap-2 ${props.className ?? ""}`}>
        <DotsMark size="xs" className="text-signal" />
        <span className="text-xs leading-4 text-muted">{props.count} going</span>
      </div>
    );
  }

  return (
    <div id={props.id} className={`flex min-h-6 items-center ${props.className ?? ""}`}>
      {/* One letter per small avatar, overlapping by 6px: two letters in 24px get covered by the next one. */}
      <span aria-hidden="true" className="flex pl-1.5">
        {initials.slice(0, 3).map((initial, i) => (
          <span
            key={i}
            className={`-ml-1.5 flex size-6 items-center justify-center rounded-dot text-[0.6875rem] leading-none font-semibold uppercase ring-2 ring-background ${SM_FILLS[i]}`}
          >
            {Array.from(initial)[0]}
          </span>
        ))}
      </span>
      <span className="ml-2 text-xs leading-4 text-muted">{props.count} going</span>
    </div>
  );
}
