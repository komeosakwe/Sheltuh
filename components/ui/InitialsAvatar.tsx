import { initialsFor } from "@/lib/initials";

/**
 * A member's initials in a 32px square (never a circle: it isn't a control).
 * Decorative: the name beside it is the accessible name. `you` inverts it.
 */
export default function InitialsAvatar({ name, you = false }: { name: string; you?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center overflow-hidden text-xs leading-4 font-semibold tracking-wide ${
        you ? "bg-foreground text-background" : "bg-surface text-foreground"
      }`}
    >
      {initialsFor(name)}
    </span>
  );
}
