import { initialsFor } from "@/lib/initials";

/** Everyone else's fills, in turn down a list: black, white with a black edge, sunken surface. */
const FILLS = [
  "bg-foreground text-background",
  "bg-card text-foreground border border-foreground",
  "bg-surface text-foreground",
] as const;

const SIZES = {
  md: "size-8 text-xs leading-4",
  /** The Who's going card's faces and the This weekend cards' (owner's mockups, 8 Nov 2026). */
  face: "size-9 text-xs leading-4",
  strip: "size-7.5 text-xs leading-4",
  /** An organiser's initials on the event page's Organiser card (OrganiserLogo `card`). */
  card: "size-12 text-base leading-6",
  lg: "size-24 text-2xl leading-8 sm:size-32 sm:text-4xl sm:leading-10",
  field: "size-18 text-xl leading-7",
} as const;

/**
 * A member's initials in a 32px circle (the rules' Shape board: avatars stay
 * round). Decorative: the name beside it is the accessible name. `you` is Signal
 * Orange with black initials (6.18:1); the rest take turns by `index`, so a
 * list doesn't read as one grey block. Initials are 12px, never under 11px.
 * `size="lg"`: a member profile's header (96px, 128px from 640px).
 * `size="field"`: the photo beside its controls on /account (72px).
 * `shape="logo"`: an organiser's initials in place of their logo, in the
 * logo's own rounded square (OrganiserLogo), so the two swap without a change
 * of shape.
 */
export default function InitialsAvatar({
  name,
  you = false,
  index = 0,
  size = "md",
  shape = "circle",
}: {
  name: string;
  you?: boolean;
  /** The row's place in its list, to vary the fill. */
  index?: number;
  size?: keyof typeof SIZES;
  shape?: "circle" | "logo";
}) {
  const fill = you ? "bg-signal text-signal-foreground" : FILLS[Math.abs(index) % FILLS.length];
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden ${shape === "logo" ? "rounded-dot" : "rounded-full"} font-semibold tracking-wide ${SIZES[size]} ${fill}`}
    >
      {initialsFor(name)}
    </span>
  );
}
