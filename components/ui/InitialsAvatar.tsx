import { initialsFor } from "@/lib/initials";

/** Everyone else's fills, in turn down a list: black, white with a black edge, sunken cream. */
const FILLS = [
  "bg-foreground text-background",
  "bg-card text-foreground border border-foreground",
  "bg-surface text-foreground",
] as const;

/**
 * A member's initials in a 32px rounded square (the umlaut's shape,
 * brand-direction-one.md §2.4; never a circle: it isn't a control).
 * Decorative: the name beside it is the accessible name. `you` is Signal
 * Orange with black initials (6.18:1); the rest take turns by `index`, so a
 * list doesn't read as one grey block. Initials are 12px, never under 11px.
 */
export default function InitialsAvatar({
  name,
  you = false,
  index = 0,
}: {
  name: string;
  you?: boolean;
  /** The row's place in its list, to vary the fill. */
  index?: number;
}) {
  const fill = you ? "bg-signal text-signal-foreground" : FILLS[Math.abs(index) % FILLS.length];
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-dot text-xs leading-4 font-semibold tracking-wide ${fill}`}
    >
      {initialsFor(name)}
    </span>
  );
}
